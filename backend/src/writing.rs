use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    storage::{Storage, StorageError, validate_segment},
    timeline::{CreateBranchRequest, TimelineError, TimelineService},
};

const PROJECTS_DIR: &str = "projects";
const WRITING_CHAPTERS_DIR: &str = "writing/chapters";
const REVIEW_NOTES_DIR: &str = "writing/review-notes";
const WRITING_BRANCHES_DIR: &str = "writing/branches";
const CURRENT_CHAPTER_FILE: &str = "writing/current-chapter.txt";
const MARKDOWN_EXTENSION: &str = "md";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChapterRecord {
    pub project_slug: String,
    pub id: String,
    pub title: String,
    pub body: String,
    pub review_notes: Vec<ReviewNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChapterSummary {
    pub id: String,
    pub title: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReviewNote {
    pub reviewer: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WritingBranchRecord {
    pub id: String,
    pub source_chapter_id: String,
    pub source_title: String,
    pub branch_title: String,
    pub branch_description: String,
    pub branch_reason: String,
    pub origin_timepoint_id: String,
    pub timeline_branch_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateChapterRequest {
    pub id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateChapterRequest {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateReviewNoteRequest {
    pub reviewer: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchHistoricalChapterRequest {
    pub source_chapter_id: String,
    pub branch_id: String,
    pub branch_title: String,
    pub branch_description: String,
    pub branch_reason: String,
    pub origin_timepoint_id: String,
}

#[derive(Debug, Clone)]
pub struct WritingService {
    storage: Arc<Storage>,
    timeline_service: TimelineService,
}

#[derive(Debug, Error)]
pub enum WritingError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("invalid chapter id: {0}")]
    InvalidChapterId(String),
    #[error("invalid reviewer id: {0}")]
    InvalidReviewer(String),
    #[error("invalid branch id: {0}")]
    InvalidBranchId(String),
    #[error("invalid timepoint id: {0}")]
    InvalidTimepointId(String),
    #[error("chapter already exists: {0}")]
    ChapterAlreadyExists(String),
    #[error("chapter not found: {0}")]
    ChapterNotFound(String),
    #[error("current chapter pointer is invalid: {0}")]
    InvalidCurrentChapter(String),
    #[error("historical chapter edits require rollback/branch flow: {0}")]
    HistoricalEditRejected(String),
    #[error("invalid chapter document: {0}")]
    InvalidChapterDocument(String),
    #[error(transparent)]
    Timeline(#[from] TimelineError),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl WritingService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        let timeline_service = TimelineService::new(Arc::clone(&storage));
        Self {
            storage,
            timeline_service,
        }
    }

    pub async fn create_chapter(
        &self,
        project_slug: &str,
        request: CreateChapterRequest,
    ) -> Result<ChapterRecord, WritingError> {
        validate_project_slug(project_slug)?;
        validate_chapter_id(&request.id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let chapter_path = chapter_path(project_slug, &request.id);
        if self.storage.exists(&chapter_path).await? {
            return Err(WritingError::ChapterAlreadyExists(request.id));
        }

        let chapter = ChapterRecord {
            project_slug: project_slug.to_string(),
            id: request.id,
            title: request.title,
            body: request.body,
            review_notes: Vec::new(),
        };

        self.write_chapter(&chapter).await?;
        let current_chapter = self.current_chapter_id(project_slug).await?;
        if current_chapter.is_none() {
            self.set_current_chapter(project_slug, &chapter.id).await?;
        }

        Ok(chapter)
    }

    pub async fn list_chapters(
        &self,
        project_slug: &str,
    ) -> Result<Vec<ChapterSummary>, WritingError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let current_chapter = self.current_chapter_id(project_slug).await?;
        let chapter_files = self
            .storage
            .list_files(&project_root(project_slug).join(WRITING_CHAPTERS_DIR))
            .await?;

        let mut chapters = Vec::new();
        for path in chapter_files {
            if path.extension().and_then(std::ffi::OsStr::to_str) != Some(MARKDOWN_EXTENSION) {
                continue;
            }

            let id = path
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .ok_or_else(|| WritingError::InvalidChapterId(path.display().to_string()))?;
            let chapter = self.get_chapter(project_slug, id).await?;
            chapters.push(ChapterSummary {
                id: chapter.id,
                title: chapter.title,
                is_current: current_chapter.as_deref() == Some(id),
            });
        }

        chapters.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(chapters)
    }

    pub async fn get_chapter(
        &self,
        project_slug: &str,
        chapter_id: &str,
    ) -> Result<ChapterRecord, WritingError> {
        validate_project_slug(project_slug)?;
        validate_chapter_id(chapter_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let chapter_path = chapter_path(project_slug, chapter_id);
        if !self.storage.exists(&chapter_path).await? {
            return Err(WritingError::ChapterNotFound(chapter_id.to_string()));
        }

        let chapter_text = self.storage.read_text(&chapter_path).await?;
        let mut chapter = parse_chapter_document(project_slug, chapter_id, &chapter_text)?;
        chapter.review_notes = self.load_review_notes(project_slug, chapter_id).await?;
        Ok(chapter)
    }

    pub async fn update_chapter(
        &self,
        project_slug: &str,
        chapter_id: &str,
        request: UpdateChapterRequest,
    ) -> Result<ChapterRecord, WritingError> {
        // This is the main continuity invariant for the writing system:
        // only the current chapter is mutable in place.
        // Any historical edit must be redirected into an explicit branch/rollback flow so prior
        // timeline state stays reproducible and browser acceptance can reason about branching.
        let mut chapter = self.get_chapter(project_slug, chapter_id).await?;
        let current_chapter = self.current_chapter_id(project_slug).await?;
        match current_chapter.as_deref() {
            Some(current_id) if current_id == chapter_id => {}
            Some(_) | None => {
                return Err(WritingError::HistoricalEditRejected(chapter_id.to_string()));
            }
        }

        chapter.title = request.title;
        chapter.body = request.body;
        self.write_chapter(&chapter).await?;
        Ok(chapter)
    }

    pub async fn set_current_chapter(
        &self,
        project_slug: &str,
        chapter_id: &str,
    ) -> Result<(), WritingError> {
        validate_project_slug(project_slug)?;
        validate_chapter_id(chapter_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let chapter_path = chapter_path(project_slug, chapter_id);
        if !self.storage.exists(&chapter_path).await? {
            return Err(WritingError::ChapterNotFound(chapter_id.to_string()));
        }

        self.storage
            .write_text(
                &project_root(project_slug).join(CURRENT_CHAPTER_FILE),
                chapter_id,
            )
            .await?;
        Ok(())
    }

    pub async fn current_chapter_id(
        &self,
        project_slug: &str,
    ) -> Result<Option<String>, WritingError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        // The current chapter pointer is stored as a tiny text file instead of being duplicated into
        // every chapter artifact. That keeps branch-aware chapter metadata simple, but it means we
        // must validate the pointer on every read so stale/manual edits surface as explicit errors.
        let pointer_path = project_root(project_slug).join(CURRENT_CHAPTER_FILE);
        if !self.storage.exists(&pointer_path).await? {
            return Ok(None);
        }

        let pointer = self.storage.read_text(&pointer_path).await?;
        let chapter_id = pointer.trim();
        if chapter_id.is_empty() {
            return Ok(None);
        }
        validate_chapter_id(chapter_id)?;
        if !self
            .storage
            .exists(&chapter_path(project_slug, chapter_id))
            .await?
        {
            return Err(WritingError::InvalidCurrentChapter(chapter_id.to_string()));
        }
        Ok(Some(chapter_id.to_string()))
    }

    pub async fn add_review_note(
        &self,
        project_slug: &str,
        chapter_id: &str,
        request: CreateReviewNoteRequest,
    ) -> Result<Vec<ReviewNote>, WritingError> {
        let _chapter = self.get_chapter(project_slug, chapter_id).await?;
        validate_reviewer(&request.reviewer)?;

        let note = ReviewNote {
            reviewer: request.reviewer,
            body: request.body,
        };
        let mut notes = self.load_review_notes(project_slug, chapter_id).await?;
        notes.push(note);
        self.write_review_notes(project_slug, chapter_id, &notes)
            .await?;
        Ok(notes)
    }

    pub async fn branch_historical_chapter(
        &self,
        project_slug: &str,
        request: BranchHistoricalChapterRequest,
    ) -> Result<WritingBranchRecord, WritingError> {
        // Branching turns a forbidden historical edit into an explicit new timeline branch.
        // The writing-layer metadata mirrors the timeline-layer branch so the UI can explain both
        // the literary reason for the fork and the low-level branch identifier that was created.
        validate_project_slug(project_slug)?;
        validate_chapter_id(&request.source_chapter_id)?;
        validate_branch_id(&request.branch_id)?;
        validate_timepoint_id(&request.origin_timepoint_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let current_chapter = self.current_chapter_id(project_slug).await?;
        if current_chapter.as_deref() == Some(request.source_chapter_id.as_str()) {
            return Err(WritingError::HistoricalEditRejected(
                request.source_chapter_id,
            ));
        }

        let source_chapter = self
            .get_chapter(project_slug, &request.source_chapter_id)
            .await?;
        let metadata_path = writing_branch_path(project_slug, &request.branch_id);
        if self.storage.exists(&metadata_path).await? {
            return Err(WritingError::ChapterAlreadyExists(request.branch_id));
        }

        let timeline_branch = self
            .timeline_service
            .create_branch(CreateBranchRequest {
                project_slug: project_slug.to_string(),
                id: request.branch_id.clone(),
                title: request.branch_title.clone(),
                description: request.branch_description.clone(),
                origin_timepoint_id: request.origin_timepoint_id.clone(),
            })
            .await?;

        let writing_branch = WritingBranchRecord {
            id: request.branch_id,
            source_chapter_id: source_chapter.id,
            source_title: source_chapter.title,
            branch_title: timeline_branch.title,
            branch_description: timeline_branch.description,
            branch_reason: request.branch_reason,
            origin_timepoint_id: timeline_branch.origin_timepoint_id,
            timeline_branch_id: timeline_branch.id,
        };

        self.storage
            .write_json(&metadata_path, &writing_branch)
            .await?;
        Ok(writing_branch)
    }

    async fn write_chapter(&self, chapter: &ChapterRecord) -> Result<(), WritingError> {
        self.storage
            .write_text(
                &chapter_path(&chapter.project_slug, &chapter.id),
                &serialize_chapter_document(chapter),
            )
            .await?;
        Ok(())
    }

    async fn load_review_notes(
        &self,
        project_slug: &str,
        chapter_id: &str,
    ) -> Result<Vec<ReviewNote>, WritingError> {
        let notes_path = review_notes_path(project_slug, chapter_id);
        if !self.storage.exists(&notes_path).await? {
            return Ok(Vec::new());
        }

        let text = self.storage.read_text(&notes_path).await?;
        let notes: Vec<ReviewNote> = serde_json::from_str(&text)?;
        Ok(notes)
    }

    async fn write_review_notes(
        &self,
        project_slug: &str,
        chapter_id: &str,
        notes: &[ReviewNote],
    ) -> Result<(), WritingError> {
        self.storage
            .write_json(&review_notes_path(project_slug, chapter_id), &notes)
            .await?;
        Ok(())
    }
}

impl From<serde_json::Error> for WritingError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

fn validate_project_slug(slug: &str) -> Result<(), WritingError> {
    validate_segment(slug).map_err(|_| WritingError::InvalidProjectSlug(slug.to_string()))?;
    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(WritingError::InvalidProjectSlug(slug.to_string()));
    }
    Ok(())
}

fn validate_chapter_id(chapter_id: &str) -> Result<(), WritingError> {
    validate_segment(chapter_id)
        .map_err(|_| WritingError::InvalidChapterId(chapter_id.to_string()))?;
    if !chapter_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(WritingError::InvalidChapterId(chapter_id.to_string()));
    }
    Ok(())
}

fn validate_reviewer(reviewer: &str) -> Result<(), WritingError> {
    validate_segment(reviewer).map_err(|_| WritingError::InvalidReviewer(reviewer.to_string()))
}

fn validate_branch_id(branch_id: &str) -> Result<(), WritingError> {
    validate_segment(branch_id)
        .map_err(|_| WritingError::InvalidBranchId(branch_id.to_string()))?;
    if !branch_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(WritingError::InvalidBranchId(branch_id.to_string()));
    }
    Ok(())
}

fn validate_timepoint_id(timepoint_id: &str) -> Result<(), WritingError> {
    validate_segment(timepoint_id)
        .map_err(|_| WritingError::InvalidTimepointId(timepoint_id.to_string()))?;
    if !timepoint_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(WritingError::InvalidTimepointId(timepoint_id.to_string()));
    }
    Ok(())
}

async fn ensure_project_exists(storage: &Storage, project_slug: &str) -> Result<(), WritingError> {
    let metadata_path = project_root(project_slug).join("project.json");
    if storage.exists(&metadata_path).await? {
        Ok(())
    } else {
        Err(WritingError::ProjectNotFound(project_slug.to_string()))
    }
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn chapter_path(project_slug: &str, chapter_id: &str) -> PathBuf {
    project_root(project_slug)
        .join(WRITING_CHAPTERS_DIR)
        .join(format!("{chapter_id}.{MARKDOWN_EXTENSION}"))
}

fn review_notes_path(project_slug: &str, chapter_id: &str) -> PathBuf {
    project_root(project_slug)
        .join(REVIEW_NOTES_DIR)
        .join(format!("{chapter_id}.json"))
}

fn writing_branch_path(project_slug: &str, branch_id: &str) -> PathBuf {
    project_root(project_slug)
        .join(WRITING_BRANCHES_DIR)
        .join(format!("{branch_id}.json"))
}

#[must_use]
pub fn serialize_chapter_document(chapter: &ChapterRecord) -> String {
    format!(
        "---\nid: {}\ntitle: {}\n---\n\n{}",
        chapter.id,
        encode_metadata_value(&chapter.title),
        chapter.body.trim_start_matches('\n')
    )
}

pub fn parse_chapter_document(
    project_slug: &str,
    expected_id: &str,
    content: &str,
) -> Result<ChapterRecord, WritingError> {
    let remainder = content
        .strip_prefix("---\n")
        .ok_or_else(|| WritingError::InvalidChapterDocument("missing front matter".to_string()))?;
    let (metadata, body) = remainder.split_once("\n---\n").ok_or_else(|| {
        WritingError::InvalidChapterDocument("unterminated front matter".to_string())
    })?;

    let mut id = None;
    let mut title = None;
    for line in metadata.lines() {
        let (key, value) = line.split_once(':').ok_or_else(|| {
            WritingError::InvalidChapterDocument(format!("invalid metadata line: {line}"))
        })?;
        let value = value.trim_start();
        match key {
            "id" => id = Some(value.to_string()),
            "title" => title = Some(decode_metadata_value(value)),
            _ => {}
        }
    }

    let id = id.ok_or_else(|| WritingError::InvalidChapterDocument("missing id".to_string()))?;
    if id != expected_id {
        return Err(WritingError::InvalidChapterDocument(format!(
            "chapter id {id} does not match expected {expected_id}"
        )));
    }
    let title =
        title.ok_or_else(|| WritingError::InvalidChapterDocument("missing title".to_string()))?;

    Ok(ChapterRecord {
        project_slug: project_slug.to_string(),
        id,
        title,
        body: body.trim_start_matches('\n').to_string(),
        review_notes: Vec::new(),
    })
}

fn encode_metadata_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\n', "\\n")
}

fn decode_metadata_value(value: &str) -> String {
    let mut decoded = String::new();
    let mut escaped = false;

    for character in value.chars() {
        if escaped {
            if character == 'n' {
                decoded.push('\n');
            } else {
                decoded.push(character);
            }
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else {
            decoded.push(character);
        }
    }

    if escaped {
        decoded.push('\\');
    }

    decoded
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{
        BranchHistoricalChapterRequest, CreateChapterRequest, CreateReviewNoteRequest,
        UpdateChapterRequest, WritingError, WritingService,
    };
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
        timeline::{CreateTimepointRequest, TimelineService},
    };

    #[tokio::test]
    async fn current_chapter_edit_persists_and_review_notes_reload() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let writing_service = WritingService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha Project".to_string(),
                description: "writing primitives".to_string(),
            })
            .await
            .expect("project create should succeed");

        writing_service
            .create_chapter(
                "alpha-project",
                CreateChapterRequest {
                    id: "chapter-01".to_string(),
                    title: "Opening".to_string(),
                    body: "Draft one".to_string(),
                },
            )
            .await
            .expect("chapter create should succeed");

        writing_service
            .update_chapter(
                "alpha-project",
                "chapter-01",
                UpdateChapterRequest {
                    title: "Opening Revised".to_string(),
                    body: "Draft two".to_string(),
                },
            )
            .await
            .expect("current chapter update should succeed");

        writing_service
            .add_review_note(
                "alpha-project",
                "chapter-01",
                CreateReviewNoteRequest {
                    reviewer: "reviewer-1".to_string(),
                    body: "Tighten the hook.".to_string(),
                },
            )
            .await
            .expect("review note should persist");

        let reloaded_service =
            WritingService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let reloaded = reloaded_service
            .get_chapter("alpha-project", "chapter-01")
            .await
            .expect("chapter should reload");

        assert_eq!(reloaded.title, "Opening Revised");
        assert_eq!(reloaded.body, "Draft two");
        assert_eq!(reloaded.review_notes.len(), 1);
        assert_eq!(reloaded.review_notes[0].reviewer, "reviewer-1");
        assert_eq!(
            storage
                .read_text(Path::new(
                    "projects/alpha-project/writing/current-chapter.txt"
                ))
                .await
                .expect("current chapter pointer should exist"),
            "chapter-01"
        );
    }

    #[tokio::test]
    async fn historical_edit_is_rejected_when_chapter_is_not_current() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let writing_service = WritingService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "history-project".to_string(),
                title: "History Project".to_string(),
                description: "historical edit guard".to_string(),
            })
            .await
            .expect("project create should succeed");

        writing_service
            .create_chapter(
                "history-project",
                CreateChapterRequest {
                    id: "chapter-01".to_string(),
                    title: "First".to_string(),
                    body: "One".to_string(),
                },
            )
            .await
            .expect("first chapter create should succeed");
        writing_service
            .create_chapter(
                "history-project",
                CreateChapterRequest {
                    id: "chapter-02".to_string(),
                    title: "Second".to_string(),
                    body: "Two".to_string(),
                },
            )
            .await
            .expect("second chapter create should succeed");
        writing_service
            .set_current_chapter("history-project", "chapter-02")
            .await
            .expect("current chapter should switch");

        let result = writing_service
            .update_chapter(
                "history-project",
                "chapter-01",
                UpdateChapterRequest {
                    title: "First Revised".to_string(),
                    body: "Nope".to_string(),
                },
            )
            .await;

        assert!(matches!(
            result,
            Err(WritingError::HistoricalEditRejected(chapter_id)) if chapter_id == "chapter-01"
        ));
    }

    #[tokio::test]
    async fn branch_creation_path_persists_writing_and_timeline_metadata() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let writing_service = WritingService::new(Arc::clone(&storage));
        let timeline_service = TimelineService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "branch-project".to_string(),
                title: "Branch Project".to_string(),
                description: "branch flow".to_string(),
            })
            .await
            .expect("project create should succeed");

        writing_service
            .create_chapter(
                "branch-project",
                CreateChapterRequest {
                    id: "chapter-01".to_string(),
                    title: "First".to_string(),
                    body: "One".to_string(),
                },
            )
            .await
            .expect("first chapter create should succeed");
        writing_service
            .create_chapter(
                "branch-project",
                CreateChapterRequest {
                    id: "chapter-02".to_string(),
                    title: "Second".to_string(),
                    body: "Two".to_string(),
                },
            )
            .await
            .expect("second chapter create should succeed");
        writing_service
            .set_current_chapter("branch-project", "chapter-02")
            .await
            .expect("current chapter should switch");

        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "branch-project".to_string(),
                id: "tp-origin".to_string(),
                sequence: 1,
                title: "Origin".to_string(),
                summary: "where divergence starts".to_string(),
                branch_id: None,
            })
            .await
            .expect("timepoint create should succeed");

        let branch = writing_service
            .branch_historical_chapter(
                "branch-project",
                BranchHistoricalChapterRequest {
                    source_chapter_id: "chapter-01".to_string(),
                    branch_id: "fork-a".to_string(),
                    branch_title: "Fork A".to_string(),
                    branch_description: "alternate historical route".to_string(),
                    branch_reason: "Need to revise old chapter safely".to_string(),
                    origin_timepoint_id: "tp-origin".to_string(),
                },
            )
            .await
            .expect("branch creation should succeed");

        assert_eq!(branch.source_chapter_id, "chapter-01");
        assert_eq!(branch.timeline_branch_id, "fork-a");

        let writing_branch_text = storage
            .read_text(Path::new(
                "projects/branch-project/writing/branches/fork-a.json",
            ))
            .await
            .expect("writing branch metadata should exist");
        assert!(writing_branch_text.contains("Need to revise old chapter safely"));

        let timeline_branch = timeline_service
            .get_branch("branch-project", "fork-a")
            .await
            .expect("timeline branch should exist");
        assert_eq!(timeline_branch.origin_timepoint_id, "tp-origin");
    }

    #[tokio::test]
    async fn chapter_list_and_current_pointer_reload_from_disk() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let writing_service = WritingService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "reload-project".to_string(),
                title: "Reload Project".to_string(),
                description: "reload behavior".to_string(),
            })
            .await
            .expect("project create should succeed");

        writing_service
            .create_chapter(
                "reload-project",
                CreateChapterRequest {
                    id: "chapter-02".to_string(),
                    title: "Second".to_string(),
                    body: "Two".to_string(),
                },
            )
            .await
            .expect("chapter create should succeed");
        writing_service
            .create_chapter(
                "reload-project",
                CreateChapterRequest {
                    id: "chapter-01".to_string(),
                    title: "First".to_string(),
                    body: "One".to_string(),
                },
            )
            .await
            .expect("chapter create should succeed");
        writing_service
            .set_current_chapter("reload-project", "chapter-02")
            .await
            .expect("current chapter should switch");

        let reloaded = WritingService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let chapters = reloaded
            .list_chapters("reload-project")
            .await
            .expect("chapters should list");

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].id, "chapter-01");
        assert!(!chapters[0].is_current);
        assert_eq!(chapters[1].id, "chapter-02");
        assert!(chapters[1].is_current);
        assert_eq!(
            reloaded
                .current_chapter_id("reload-project")
                .await
                .expect("current pointer should load"),
            Some("chapter-02".to_string())
        );
    }
}
