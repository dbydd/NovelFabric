use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    project::ProjectError,
    storage::{Storage, StorageError, validate_segment},
};

const MEMORY_DIR: &str = "memory";
const FRONT_MATTER_DELIMITER: &str = "---";
const MARKDOWN_EXTENSION: &str = "md";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryEntry {
    pub scope: MemoryScope,
    pub key: String,
    pub title: String,
    pub timeline: String,
    pub timepoint: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryEntrySummary {
    pub scope: MemoryScope,
    pub key: String,
    pub title: String,
    pub timeline: String,
    pub timepoint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateMemoryEntryRequest {
    pub scope: MemoryScope,
    pub key: String,
    pub title: String,
    pub timeline: String,
    pub timepoint: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateMemoryEntryRequest {
    pub title: String,
    pub timeline: String,
    pub timepoint: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MemoryScope {
    Global,
    Branch { branch: String },
    Chapter { chapter: String },
    Agent { agent: String },
}

#[derive(Debug, Clone)]
pub struct MemoryService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("invalid memory key: {0}")]
    InvalidKey(String),
    #[error("invalid timeline segment: {0}")]
    InvalidTimeline(String),
    #[error("invalid timepoint segment: {0}")]
    InvalidTimepoint(String),
    #[error("invalid branch slug: {0}")]
    InvalidBranch(String),
    #[error("invalid chapter slug: {0}")]
    InvalidChapter(String),
    #[error("invalid agent id: {0}")]
    InvalidAgent(String),
    #[error("memory entry already exists: {0}")]
    AlreadyExists(String),
    #[error("memory entry not found: {0}")]
    NotFound(String),
    #[error("invalid memory document: {0}")]
    InvalidDocument(&'static str),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl MemoryService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn create(
        &self,
        project_slug: &str,
        request: CreateMemoryEntryRequest,
    ) -> Result<MemoryEntry, MemoryError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        validate_create_request(&request)?;

        let relative_path = entry_file_path(
            project_slug,
            &request.scope,
            &request.timeline,
            &request.timepoint,
            &request.key,
        );
        if self.storage.exists(&relative_path).await? {
            return Err(MemoryError::AlreadyExists(request.key));
        }

        let entry = MemoryEntry {
            scope: request.scope,
            key: request.key,
            title: request.title,
            timeline: request.timeline,
            timepoint: request.timepoint,
            body: request.body,
        };

        self.write_entry(project_slug, &entry).await?;
        Ok(entry)
    }

    pub async fn get(
        &self,
        project_slug: &str,
        scope: &MemoryScope,
        timeline: &str,
        timepoint: &str,
        key: &str,
    ) -> Result<MemoryEntry, MemoryError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        validate_scope(scope)?;
        validate_segment(key).map_err(|_| MemoryError::InvalidKey(key.to_string()))?;
        validate_segment(timeline)
            .map_err(|_| MemoryError::InvalidTimeline(timeline.to_string()))?;
        validate_segment(timepoint)
            .map_err(|_| MemoryError::InvalidTimepoint(timepoint.to_string()))?;

        let relative_path = entry_file_path(project_slug, scope, timeline, timepoint, key);
        if !self.storage.exists(&relative_path).await? {
            return Err(MemoryError::NotFound(key.to_string()));
        }

        let text = self.storage.read_text(&relative_path).await?;
        parse_entry_document(scope.clone(), key.to_string(), &text)
    }

    pub async fn delete(
        &self,
        project_slug: &str,
        scope: &MemoryScope,
        timeline: &str,
        timepoint: &str,
        key: &str,
    ) -> Result<MemoryEntry, MemoryError> {
        let existing = self
            .get(project_slug, scope, timeline, timepoint, key)
            .await?;
        let relative_path = entry_file_path(project_slug, scope, timeline, timepoint, key);
        self.storage.remove_file(&relative_path).await?;
        Ok(existing)
    }

    pub async fn update(
        &self,
        project_slug: &str,
        scope: &MemoryScope,
        timeline: &str,
        timepoint: &str,
        key: &str,
        request: UpdateMemoryEntryRequest,
    ) -> Result<MemoryEntry, MemoryError> {
        let _existing = self
            .get(project_slug, scope, timeline, timepoint, key)
            .await?;
        validate_update_request(&request)?;

        let updated = MemoryEntry {
            scope: scope.clone(),
            key: key.to_string(),
            title: request.title,
            timeline: request.timeline,
            timepoint: request.timepoint,
            body: request.body,
        };

        self.write_entry(project_slug, &updated).await?;
        Ok(updated)
    }

    pub async fn list(
        &self,
        project_slug: &str,
        scope: &MemoryScope,
    ) -> Result<Vec<MemoryEntrySummary>, MemoryError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        validate_scope(scope)?;

        let entries_root = entries_root(project_slug, scope);
        let resolved_root = self.storage.resolve(&entries_root)?;
        if !self.storage.exists(&entries_root).await? {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        collect_markdown_files(&resolved_root, &mut files).await?;

        let mut entries = Vec::with_capacity(files.len());
        for file in files {
            let relative = file
                .strip_prefix(self.storage.root())
                .map_err(|_| StorageError::PathEscapesRoot)?
                .to_path_buf();
            let text = self.storage.read_text(&relative).await?;
            let key = file_stem_string(&file)?;
            let entry = parse_entry_document(scope.clone(), key, &text)?;
            entries.push(MemoryEntrySummary {
                scope: entry.scope,
                key: entry.key,
                title: entry.title,
                timeline: entry.timeline,
                timepoint: entry.timepoint,
            });
        }

        entries.sort_by(|left, right| {
            (&left.timeline, &left.timepoint, &left.key).cmp(&(
                &right.timeline,
                &right.timepoint,
                &right.key,
            ))
        });
        Ok(entries)
    }

    async fn write_entry(
        &self,
        project_slug: &str,
        entry: &MemoryEntry,
    ) -> Result<(), MemoryError> {
        let relative_path = entry_file_path(
            project_slug,
            &entry.scope,
            &entry.timeline,
            &entry.timepoint,
            &entry.key,
        );
        let document = render_entry_document(entry);
        self.storage.write_text(&relative_path, &document).await?;
        Ok(())
    }
}

fn validate_create_request(request: &CreateMemoryEntryRequest) -> Result<(), MemoryError> {
    validate_scope(&request.scope)?;
    validate_segment(&request.key).map_err(|_| MemoryError::InvalidKey(request.key.clone()))?;
    validate_segment(&request.timeline)
        .map_err(|_| MemoryError::InvalidTimeline(request.timeline.clone()))?;
    validate_segment(&request.timepoint)
        .map_err(|_| MemoryError::InvalidTimepoint(request.timepoint.clone()))?;
    Ok(())
}

fn validate_update_request(request: &UpdateMemoryEntryRequest) -> Result<(), MemoryError> {
    validate_segment(&request.timeline)
        .map_err(|_| MemoryError::InvalidTimeline(request.timeline.clone()))?;
    validate_segment(&request.timepoint)
        .map_err(|_| MemoryError::InvalidTimepoint(request.timepoint.clone()))?;
    Ok(())
}

fn validate_scope(scope: &MemoryScope) -> Result<(), MemoryError> {
    match scope {
        MemoryScope::Global => Ok(()),
        MemoryScope::Branch { branch } => {
            validate_segment(branch).map_err(|_| MemoryError::InvalidBranch(branch.clone()))
        }
        MemoryScope::Chapter { chapter } => {
            validate_segment(chapter).map_err(|_| MemoryError::InvalidChapter(chapter.clone()))
        }
        MemoryScope::Agent { agent } => {
            validate_segment(agent).map_err(|_| MemoryError::InvalidAgent(agent.clone()))
        }
    }
}

fn validate_project_slug(slug: &str) -> Result<(), MemoryError> {
    validate_segment(slug).map_err(|_| MemoryError::InvalidProjectSlug(slug.to_string()))?;

    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(MemoryError::InvalidProjectSlug(slug.to_string()));
    }

    Ok(())
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new("projects").join(project_slug)
}

fn entries_root(project_slug: &str, scope: &MemoryScope) -> PathBuf {
    match scope {
        MemoryScope::Global => project_root(project_slug)
            .join(MEMORY_DIR)
            .join("global/entries"),
        MemoryScope::Branch { branch } => project_root(project_slug)
            .join(MEMORY_DIR)
            .join("branches")
            .join(branch)
            .join("entries"),
        MemoryScope::Chapter { chapter } => project_root(project_slug)
            .join(MEMORY_DIR)
            .join("chapters")
            .join(chapter)
            .join("entries"),
        MemoryScope::Agent { agent } => project_root(project_slug)
            .join(MEMORY_DIR)
            .join("agents")
            .join(agent)
            .join("entries"),
    }
}

fn entry_file_path(
    project_slug: &str,
    scope: &MemoryScope,
    timeline: &str,
    timepoint: &str,
    key: &str,
) -> PathBuf {
    entries_root(project_slug, scope)
        .join(timeline)
        .join(timepoint)
        .join(format!("{key}.{MARKDOWN_EXTENSION}"))
}

async fn ensure_project_exists(storage: &Storage, project_slug: &str) -> Result<(), MemoryError> {
    if storage.exists(&project_root(project_slug)).await? {
        Ok(())
    } else {
        Err(MemoryError::ProjectNotFound(project_slug.to_string()))
    }
}

fn render_entry_document(entry: &MemoryEntry) -> String {
    let front_matter = serde_json::json!({
        "title": entry.title,
        "timeline": entry.timeline,
        "timepoint": entry.timepoint,
    });
    format!(
        "{FRONT_MATTER_DELIMITER}\n{front_matter}\n{FRONT_MATTER_DELIMITER}\n\n{}",
        entry.body
    )
}

fn parse_entry_document(
    scope: MemoryScope,
    key: String,
    text: &str,
) -> Result<MemoryEntry, MemoryError> {
    let mut sections = text.splitn(3, FRONT_MATTER_DELIMITER);
    let prefix = sections
        .next()
        .ok_or(MemoryError::InvalidDocument("missing front matter prefix"))?;
    if !prefix.trim().is_empty() {
        return Err(MemoryError::InvalidDocument(
            "front matter must start document",
        ));
    }

    let metadata = sections
        .next()
        .ok_or(MemoryError::InvalidDocument("missing metadata"))?;
    let body = sections
        .next()
        .ok_or(MemoryError::InvalidDocument("missing body"))?;

    let metadata: FrontMatter = serde_json::from_str(metadata.trim())?;
    validate_segment(&metadata.timeline)
        .map_err(|_| MemoryError::InvalidTimeline(metadata.timeline.clone()))?;
    validate_segment(&metadata.timepoint)
        .map_err(|_| MemoryError::InvalidTimepoint(metadata.timepoint.clone()))?;

    Ok(MemoryEntry {
        scope,
        key,
        title: metadata.title,
        timeline: metadata.timeline,
        timepoint: metadata.timepoint,
        body: body.trim_start_matches('\n').to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct FrontMatter {
    title: String,
    timeline: String,
    timepoint: String,
}

async fn collect_markdown_files(
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), StorageError> {
    let mut reader = match tokio::fs::read_dir(directory).await {
        Ok(reader) => reader,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(StorageError::Io(error)),
    };

    while let Some(entry) = reader.next_entry().await? {
        let path = entry.path();
        let file_type = entry.file_type().await?;
        if file_type.is_dir() {
            Box::pin(collect_markdown_files(&path, files)).await?;
        } else if path.extension().and_then(std::ffi::OsStr::to_str) == Some(MARKDOWN_EXTENSION) {
            files.push(path);
        }
    }

    Ok(())
}

fn file_stem_string(path: &Path) -> Result<String, MemoryError> {
    path.file_stem()
        .and_then(std::ffi::OsStr::to_str)
        .map(std::string::ToString::to_string)
        .ok_or(MemoryError::InvalidDocument("entry path missing file stem"))
}

impl From<ProjectError> for MemoryError {
    fn from(value: ProjectError) -> Self {
        match value {
            ProjectError::InvalidSlug(slug) => Self::InvalidProjectSlug(slug),
            ProjectError::NotFound(slug) => Self::ProjectNotFound(slug),
            ProjectError::AlreadyExists(slug) => {
                Self::Storage(StorageError::InvalidPathSegment(slug))
            }
            ProjectError::Storage(error) => Self::Storage(error),
        }
    }
}

impl From<serde_json::Error> for MemoryError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{
        CreateMemoryEntryRequest, MemoryError, MemoryScope, MemoryService, UpdateMemoryEntryRequest,
    };
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn create_persists_markdown_entry_with_metadata() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = MemoryService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let entry = service
            .create(
                "alpha-project",
                CreateMemoryEntryRequest {
                    scope: MemoryScope::Global,
                    key: "opening-fact".to_string(),
                    title: "Opening Fact".to_string(),
                    timeline: "storyline".to_string(),
                    timepoint: "0001".to_string(),
                    body: "The city remembers the flood.".to_string(),
                },
            )
            .await
            .expect("memory create should succeed");

        assert_eq!(entry.key, "opening-fact");

        let path = temp.path().join(Path::new(
            "projects/alpha-project/memory/global/entries/storyline/0001/opening-fact.md",
        ));
        let persisted = tokio::fs::read_to_string(path)
            .await
            .expect("entry file should exist");

        assert!(persisted.contains("\"title\":\"Opening Fact\""));
        assert!(persisted.contains("\"timeline\":\"storyline\""));
        assert!(persisted.ends_with("The city remembers the flood."));
    }

    #[tokio::test]
    async fn scoped_entries_are_separated_and_gettable() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = MemoryService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "scope-project".to_string(),
                title: "Scope".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let branch_scope = MemoryScope::Branch {
            branch: "alt-line".to_string(),
        };
        let agent_scope = MemoryScope::Agent {
            agent: "kp".to_string(),
        };

        service
            .create(
                "scope-project",
                CreateMemoryEntryRequest {
                    scope: branch_scope.clone(),
                    key: "shared-key".to_string(),
                    title: "Branch Memory".to_string(),
                    timeline: "branch-timeline".to_string(),
                    timepoint: "0002".to_string(),
                    body: "Branch-only fact".to_string(),
                },
            )
            .await
            .expect("branch memory should create");

        service
            .create(
                "scope-project",
                CreateMemoryEntryRequest {
                    scope: agent_scope.clone(),
                    key: "shared-key".to_string(),
                    title: "Agent Memory".to_string(),
                    timeline: "agent-timeline".to_string(),
                    timepoint: "0002".to_string(),
                    body: "Agent-only fact".to_string(),
                },
            )
            .await
            .expect("agent memory should create");

        let branch_entry = service
            .get(
                "scope-project",
                &branch_scope,
                "branch-timeline",
                "0002",
                "shared-key",
            )
            .await
            .expect("branch memory should load");
        let agent_entry = service
            .get(
                "scope-project",
                &agent_scope,
                "agent-timeline",
                "0002",
                "shared-key",
            )
            .await
            .expect("agent memory should load");

        assert_eq!(branch_entry.body, "Branch-only fact");
        assert_eq!(agent_entry.body, "Agent-only fact");
        assert_ne!(branch_entry.scope, agent_entry.scope);
    }

    #[tokio::test]
    async fn list_is_deterministic_and_update_rewrites_entry() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = MemoryService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "list-project".to_string(),
                title: "List".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let scope = MemoryScope::Chapter {
            chapter: "chapter-01".to_string(),
        };

        for request in [
            CreateMemoryEntryRequest {
                scope: scope.clone(),
                key: "beta".to_string(),
                title: "Beta".to_string(),
                timeline: "timeline-a".to_string(),
                timepoint: "0002".to_string(),
                body: "Second".to_string(),
            },
            CreateMemoryEntryRequest {
                scope: scope.clone(),
                key: "alpha".to_string(),
                title: "Alpha".to_string(),
                timeline: "timeline-a".to_string(),
                timepoint: "0001".to_string(),
                body: "First".to_string(),
            },
            CreateMemoryEntryRequest {
                scope: scope.clone(),
                key: "gamma".to_string(),
                title: "Gamma".to_string(),
                timeline: "timeline-b".to_string(),
                timepoint: "0001".to_string(),
                body: "Third".to_string(),
            },
        ] {
            service
                .create("list-project", request)
                .await
                .expect("memory create should succeed");
        }

        let listed = service
            .list("list-project", &scope)
            .await
            .expect("memory list should succeed");
        let listed_keys: Vec<_> = listed.iter().map(|entry| entry.key.as_str()).collect();
        assert_eq!(listed_keys, vec!["alpha", "beta", "gamma"]);

        let updated = service
            .update(
                "list-project",
                &scope,
                "timeline-a",
                "0001",
                "alpha",
                UpdateMemoryEntryRequest {
                    title: "Alpha Revised".to_string(),
                    timeline: "timeline-a".to_string(),
                    timepoint: "0001".to_string(),
                    body: "First revised".to_string(),
                },
            )
            .await
            .expect("memory update should succeed");
        assert_eq!(updated.title, "Alpha Revised");

        let reloaded = service
            .get("list-project", &scope, "timeline-a", "0001", "alpha")
            .await
            .expect("updated memory should reload");
        assert_eq!(reloaded.body, "First revised");
    }

    #[tokio::test]
    async fn create_requires_existing_project() {
        let temp = tempdir().expect("tempdir should exist");
        let service = MemoryService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        let result = service
            .create(
                "missing-project",
                CreateMemoryEntryRequest {
                    scope: MemoryScope::Global,
                    key: "entry".to_string(),
                    title: "Entry".to_string(),
                    timeline: "storyline".to_string(),
                    timepoint: "0001".to_string(),
                    body: "Body".to_string(),
                },
            )
            .await;

        assert!(
            matches!(result, Err(MemoryError::ProjectNotFound(slug)) if slug == "missing-project")
        );
    }
}
