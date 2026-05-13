use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{Storage, StorageError, validate_segment};

const TIMELINE_INDEX_FILE: &str = "timeline/index.json";
const TIMEPOINTS_DIR: &str = "timeline/timepoints";
const BRANCHES_DIR: &str = "timeline/branches";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimepointRecord {
    pub id: String,
    pub project_slug: String,
    pub sequence: u64,
    pub title: String,
    pub summary: String,
    pub branch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BranchRecord {
    pub id: String,
    pub project_slug: String,
    pub title: String,
    pub description: String,
    pub origin_timepoint_id: String,
    pub timepoint_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TimelineIndex {
    pub branch_ids: Vec<String>,
    pub timepoint_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CreateTimepointRequest {
    pub project_slug: String,
    pub id: String,
    pub sequence: u64,
    pub title: String,
    pub summary: String,
    pub branch_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateTimepointRequest {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub branch_id: Option<Option<String>>,
}

#[derive(Debug, Clone)]
pub struct CreateBranchRequest {
    pub project_slug: String,
    pub id: String,
    pub title: String,
    pub description: String,
    pub origin_timepoint_id: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateBranchRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub timepoint_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct TimelineService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum TimelineError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid timeline identifier: {0}")]
    InvalidIdentifier(String),
    #[error("timeline artifact already exists: {0}")]
    AlreadyExists(String),
    #[error("timeline artifact not found: {0}")]
    NotFound(String),
    #[error("branch not found: {0}")]
    BranchNotFound(String),
    #[error("timepoint not found: {0}")]
    TimepointNotFound(String),
    #[error("timeline artifact belongs to a different project: {0}")]
    ProjectMismatch(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl TimelineService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn create_timepoint(
        &self,
        request: CreateTimepointRequest,
    ) -> Result<TimepointRecord, TimelineError> {
        validate_project_slug(&request.project_slug)?;
        validate_identifier(&request.id)?;
        if let Some(branch_id) = request.branch_id.as_deref() {
            validate_identifier(branch_id)?;
        }

        ensure_project_exists(self.storage.as_ref(), &request.project_slug).await?;
        ensure_timepoint_absent(self.storage.as_ref(), &request.project_slug, &request.id).await?;

        if let Some(branch_id) = request.branch_id.as_deref() {
            ensure_branch_exists_for_project(
                self.storage.as_ref(),
                &request.project_slug,
                branch_id,
            )
            .await?;
        }

        let record = TimepointRecord {
            id: request.id,
            project_slug: request.project_slug,
            sequence: request.sequence,
            title: request.title,
            summary: request.summary,
            branch_id: request.branch_id,
        };

        self.storage
            .write_json(
                &timepoint_metadata_path(&record.project_slug, &record.id),
                &record,
            )
            .await?;
        self.append_timepoint_to_index(&record.project_slug, &record.id)
            .await?;
        if let Some(branch_id) = record.branch_id.as_deref() {
            self.attach_timepoint_to_branch(&record.project_slug, branch_id, &record.id)
                .await?;
        }

        Ok(record)
    }

    pub async fn get_timepoint(
        &self,
        project_slug: &str,
        timepoint_id: &str,
    ) -> Result<TimepointRecord, TimelineError> {
        validate_project_slug(project_slug)?;
        validate_identifier(timepoint_id)?;
        load_timepoint(self.storage.as_ref(), project_slug, timepoint_id).await
    }

    pub async fn list_timepoints(
        &self,
        project_slug: &str,
    ) -> Result<Vec<TimepointRecord>, TimelineError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let index = load_timeline_index(self.storage.as_ref(), project_slug).await?;
        let mut records = Vec::with_capacity(index.timepoint_ids.len());
        for timepoint_id in index.timepoint_ids {
            records.push(load_timepoint(self.storage.as_ref(), project_slug, &timepoint_id).await?);
        }

        records.sort_by(|left, right| {
            left.sequence
                .cmp(&right.sequence)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    pub async fn update_timepoint(
        &self,
        project_slug: &str,
        timepoint_id: &str,
        request: UpdateTimepointRequest,
    ) -> Result<TimepointRecord, TimelineError> {
        validate_project_slug(project_slug)?;
        validate_identifier(timepoint_id)?;

        let mut record = load_timepoint(self.storage.as_ref(), project_slug, timepoint_id).await?;
        let previous_branch_id = record.branch_id.clone();

        if let Some(title) = request.title {
            record.title = title;
        }
        if let Some(summary) = request.summary {
            record.summary = summary;
        }
        if let Some(branch_id) = request.branch_id {
            if let Some(branch_id_value) = branch_id.as_deref() {
                validate_identifier(branch_id_value)?;
                ensure_branch_exists_for_project(
                    self.storage.as_ref(),
                    project_slug,
                    branch_id_value,
                )
                .await?;
            }
            record.branch_id = branch_id;
        }

        self.storage
            .write_json(
                &timepoint_metadata_path(project_slug, timepoint_id),
                &record,
            )
            .await?;

        if previous_branch_id != record.branch_id {
            if let Some(previous_branch_id_value) = previous_branch_id.as_deref() {
                self.detach_timepoint_from_branch(
                    project_slug,
                    previous_branch_id_value,
                    timepoint_id,
                )
                .await?;
            }
            if let Some(current_branch_id) = record.branch_id.as_deref() {
                self.attach_timepoint_to_branch(project_slug, current_branch_id, timepoint_id)
                    .await?;
            }
        }

        Ok(record)
    }

    pub async fn create_branch(
        &self,
        request: CreateBranchRequest,
    ) -> Result<BranchRecord, TimelineError> {
        validate_project_slug(&request.project_slug)?;
        validate_identifier(&request.id)?;
        validate_identifier(&request.origin_timepoint_id)?;

        ensure_project_exists(self.storage.as_ref(), &request.project_slug).await?;
        ensure_branch_absent(self.storage.as_ref(), &request.project_slug, &request.id).await?;
        let origin_timepoint = load_timepoint(
            self.storage.as_ref(),
            &request.project_slug,
            &request.origin_timepoint_id,
        )
        .await?;

        let record = BranchRecord {
            id: request.id,
            project_slug: request.project_slug,
            title: request.title,
            description: request.description,
            origin_timepoint_id: origin_timepoint.id.clone(),
            timepoint_ids: Vec::new(),
        };

        self.storage
            .write_json(
                &branch_metadata_path(&record.project_slug, &record.id),
                &record,
            )
            .await?;
        self.append_branch_to_index(&record.project_slug, &record.id)
            .await?;

        Ok(record)
    }

    pub async fn get_branch(
        &self,
        project_slug: &str,
        branch_id: &str,
    ) -> Result<BranchRecord, TimelineError> {
        validate_project_slug(project_slug)?;
        validate_identifier(branch_id)?;
        load_branch(self.storage.as_ref(), project_slug, branch_id).await
    }

    pub async fn list_branches(
        &self,
        project_slug: &str,
    ) -> Result<Vec<BranchRecord>, TimelineError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let index = load_timeline_index(self.storage.as_ref(), project_slug).await?;
        let mut records = Vec::with_capacity(index.branch_ids.len());
        for branch_id in index.branch_ids {
            records.push(load_branch(self.storage.as_ref(), project_slug, &branch_id).await?);
        }

        records.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(records)
    }

    pub async fn update_branch(
        &self,
        project_slug: &str,
        branch_id: &str,
        request: UpdateBranchRequest,
    ) -> Result<BranchRecord, TimelineError> {
        validate_project_slug(project_slug)?;
        validate_identifier(branch_id)?;

        let mut record = load_branch(self.storage.as_ref(), project_slug, branch_id).await?;

        if let Some(title) = request.title {
            record.title = title;
        }
        if let Some(description) = request.description {
            record.description = description;
        }
        if let Some(timepoint_ids) = request.timepoint_ids {
            for timepoint_id in &timepoint_ids {
                validate_identifier(timepoint_id)?;
                let timepoint =
                    load_timepoint(self.storage.as_ref(), project_slug, timepoint_id).await?;
                match timepoint.branch_id.as_deref() {
                    Some(current_branch_id) if current_branch_id == branch_id => {}
                    Some(_) => return Err(TimelineError::ProjectMismatch(timepoint_id.clone())),
                    None => return Err(TimelineError::BranchNotFound(timepoint_id.clone())),
                }
            }

            record.timepoint_ids = dedupe_preserving_order(timepoint_ids);
        }

        self.storage
            .write_json(&branch_metadata_path(project_slug, branch_id), &record)
            .await?;
        Ok(record)
    }

    async fn append_timepoint_to_index(
        &self,
        project_slug: &str,
        timepoint_id: &str,
    ) -> Result<(), TimelineError> {
        let mut index = load_timeline_index(self.storage.as_ref(), project_slug).await?;
        if index.timepoint_ids.iter().all(|id| id != timepoint_id) {
            index.timepoint_ids.push(timepoint_id.to_string());
            write_timeline_index(self.storage.as_ref(), project_slug, &index).await?;
        }
        Ok(())
    }

    async fn append_branch_to_index(
        &self,
        project_slug: &str,
        branch_id: &str,
    ) -> Result<(), TimelineError> {
        let mut index = load_timeline_index(self.storage.as_ref(), project_slug).await?;
        if index.branch_ids.iter().all(|id| id != branch_id) {
            index.branch_ids.push(branch_id.to_string());
            write_timeline_index(self.storage.as_ref(), project_slug, &index).await?;
        }
        Ok(())
    }

    async fn attach_timepoint_to_branch(
        &self,
        project_slug: &str,
        branch_id: &str,
        timepoint_id: &str,
    ) -> Result<(), TimelineError> {
        let mut branch = load_branch(self.storage.as_ref(), project_slug, branch_id).await?;
        if branch.timepoint_ids.iter().all(|id| id != timepoint_id) {
            branch.timepoint_ids.push(timepoint_id.to_string());
            self.storage
                .write_json(&branch_metadata_path(project_slug, branch_id), &branch)
                .await?;
        }
        Ok(())
    }

    async fn detach_timepoint_from_branch(
        &self,
        project_slug: &str,
        branch_id: &str,
        timepoint_id: &str,
    ) -> Result<(), TimelineError> {
        let mut branch = load_branch(self.storage.as_ref(), project_slug, branch_id).await?;
        let original_len = branch.timepoint_ids.len();
        branch.timepoint_ids.retain(|id| id != timepoint_id);
        if branch.timepoint_ids.len() != original_len {
            self.storage
                .write_json(&branch_metadata_path(project_slug, branch_id), &branch)
                .await?;
        }
        Ok(())
    }
}

impl From<serde_json::Error> for TimelineError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

fn validate_project_slug(slug: &str) -> Result<(), TimelineError> {
    validate_segment(slug).map_err(|_| TimelineError::InvalidProjectSlug(slug.to_string()))?;

    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(TimelineError::InvalidProjectSlug(slug.to_string()));
    }

    Ok(())
}

fn validate_identifier(identifier: &str) -> Result<(), TimelineError> {
    validate_segment(identifier)
        .map_err(|_| TimelineError::InvalidIdentifier(identifier.to_string()))?;

    if !identifier.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(TimelineError::InvalidIdentifier(identifier.to_string()));
    }

    Ok(())
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new("projects").join(project_slug)
}

fn timeline_index_path(project_slug: &str) -> PathBuf {
    project_root(project_slug).join(TIMELINE_INDEX_FILE)
}

fn timepoint_metadata_path(project_slug: &str, timepoint_id: &str) -> PathBuf {
    project_root(project_slug)
        .join(TIMEPOINTS_DIR)
        .join(format!("{timepoint_id}.json"))
}

fn branch_metadata_path(project_slug: &str, branch_id: &str) -> PathBuf {
    project_root(project_slug)
        .join(BRANCHES_DIR)
        .join(format!("{branch_id}.json"))
}

async fn ensure_project_exists(storage: &Storage, project_slug: &str) -> Result<(), TimelineError> {
    let metadata_path = project_root(project_slug).join("project.json");
    if storage.exists(&metadata_path).await? {
        Ok(())
    } else {
        Err(TimelineError::ProjectNotFound(project_slug.to_string()))
    }
}

async fn ensure_timepoint_absent(
    storage: &Storage,
    project_slug: &str,
    timepoint_id: &str,
) -> Result<(), TimelineError> {
    if storage
        .exists(&timepoint_metadata_path(project_slug, timepoint_id))
        .await?
    {
        Err(TimelineError::AlreadyExists(timepoint_id.to_string()))
    } else {
        Ok(())
    }
}

async fn ensure_branch_absent(
    storage: &Storage,
    project_slug: &str,
    branch_id: &str,
) -> Result<(), TimelineError> {
    if storage
        .exists(&branch_metadata_path(project_slug, branch_id))
        .await?
    {
        Err(TimelineError::AlreadyExists(branch_id.to_string()))
    } else {
        Ok(())
    }
}

async fn ensure_branch_exists_for_project(
    storage: &Storage,
    project_slug: &str,
    branch_id: &str,
) -> Result<(), TimelineError> {
    let branch = load_branch(storage, project_slug, branch_id).await?;
    if branch.project_slug == project_slug {
        Ok(())
    } else {
        Err(TimelineError::ProjectMismatch(branch_id.to_string()))
    }
}

async fn load_timeline_index(
    storage: &Storage,
    project_slug: &str,
) -> Result<TimelineIndex, TimelineError> {
    let path = timeline_index_path(project_slug);
    if !storage.exists(&path).await? {
        return Ok(TimelineIndex::default());
    }

    let text = storage.read_text(&path).await?;
    let mut index: TimelineIndex = serde_json::from_str(&text)?;
    index.branch_ids = dedupe_preserving_order(index.branch_ids);
    index.timepoint_ids = dedupe_preserving_order(index.timepoint_ids);
    Ok(index)
}

async fn write_timeline_index(
    storage: &Storage,
    project_slug: &str,
    index: &TimelineIndex,
) -> Result<(), TimelineError> {
    storage
        .write_json(&timeline_index_path(project_slug), index)
        .await?;
    Ok(())
}

async fn load_timepoint(
    storage: &Storage,
    project_slug: &str,
    timepoint_id: &str,
) -> Result<TimepointRecord, TimelineError> {
    let path = timepoint_metadata_path(project_slug, timepoint_id);
    if !storage.exists(&path).await? {
        return Err(TimelineError::TimepointNotFound(timepoint_id.to_string()));
    }

    let text = storage.read_text(&path).await?;
    let record: TimepointRecord = serde_json::from_str(&text)?;
    if record.project_slug != project_slug {
        return Err(TimelineError::ProjectMismatch(timepoint_id.to_string()));
    }
    Ok(record)
}

async fn load_branch(
    storage: &Storage,
    project_slug: &str,
    branch_id: &str,
) -> Result<BranchRecord, TimelineError> {
    let path = branch_metadata_path(project_slug, branch_id);
    if !storage.exists(&path).await? {
        return Err(TimelineError::BranchNotFound(branch_id.to_string()));
    }

    let text = storage.read_text(&path).await?;
    let mut record: BranchRecord = serde_json::from_str(&text)?;
    if record.project_slug != project_slug {
        return Err(TimelineError::ProjectMismatch(branch_id.to_string()));
    }
    record.timepoint_ids = dedupe_preserving_order(record.timepoint_ids);
    Ok(record)
}

fn dedupe_preserving_order(values: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::with_capacity(values.len());
    for value in values {
        if deduped.iter().all(|existing| existing != &value) {
            deduped.push(value);
        }
    }
    deduped
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use super::{
        CreateBranchRequest, CreateTimepointRequest, TimelineIndex, TimelineService,
        UpdateBranchRequest, UpdateTimepointRequest,
    };
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn list_timepoints_orders_by_sequence_then_identifier() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let timeline_service = TimelineService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha Project".to_string(),
                description: "timeline primitives".to_string(),
            })
            .await
            .expect("project create should succeed");

        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "alpha-project".to_string(),
                id: "tp-b".to_string(),
                sequence: 20,
                title: "Second beat".to_string(),
                summary: "middle".to_string(),
                branch_id: None,
            })
            .await
            .expect("timepoint create should succeed");
        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "alpha-project".to_string(),
                id: "tp-a".to_string(),
                sequence: 20,
                title: "Tie break beat".to_string(),
                summary: "middle tie".to_string(),
                branch_id: None,
            })
            .await
            .expect("timepoint create should succeed");
        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "alpha-project".to_string(),
                id: "tp-zero".to_string(),
                sequence: 1,
                title: "Opening".to_string(),
                summary: "start".to_string(),
                branch_id: None,
            })
            .await
            .expect("timepoint create should succeed");

        let listed = timeline_service
            .list_timepoints("alpha-project")
            .await
            .expect("timepoints should list");

        assert_eq!(
            listed
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["tp-zero", "tp-a", "tp-b"]
        );
    }

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn branch_association_persists_across_reload_and_update() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        let timeline_service = TimelineService::new(Arc::clone(&storage));

        project_service
            .create(CreateProjectRequest {
                slug: "branch-project".to_string(),
                title: "Branch Project".to_string(),
                description: "branch tests".to_string(),
            })
            .await
            .expect("project create should succeed");

        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "branch-project".to_string(),
                id: "origin".to_string(),
                sequence: 1,
                title: "Origin".to_string(),
                summary: "branch source".to_string(),
                branch_id: None,
            })
            .await
            .expect("origin create should succeed");

        timeline_service
            .create_branch(CreateBranchRequest {
                project_slug: "branch-project".to_string(),
                id: "fork-a".to_string(),
                title: "Fork A".to_string(),
                description: "alternate route".to_string(),
                origin_timepoint_id: "origin".to_string(),
            })
            .await
            .expect("branch create should succeed");

        timeline_service
            .create_timepoint(CreateTimepointRequest {
                project_slug: "branch-project".to_string(),
                id: "fork-a-1".to_string(),
                sequence: 2,
                title: "Branch beat".to_string(),
                summary: "branch beat summary".to_string(),
                branch_id: Some("fork-a".to_string()),
            })
            .await
            .expect("branch timepoint create should succeed");

        let reloaded_service =
            TimelineService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let branch = reloaded_service
            .get_branch("branch-project", "fork-a")
            .await
            .expect("branch should reload");
        assert_eq!(branch.timepoint_ids, vec!["fork-a-1"]);

        let loaded_timepoint = reloaded_service
            .get_timepoint("branch-project", "fork-a-1")
            .await
            .expect("timepoint should reload");
        assert_eq!(loaded_timepoint.branch_id.as_deref(), Some("fork-a"));

        reloaded_service
            .update_timepoint(
                "branch-project",
                "fork-a-1",
                UpdateTimepointRequest {
                    title: None,
                    summary: Some("updated summary".to_string()),
                    branch_id: Some(None),
                },
            )
            .await
            .expect("timepoint update should succeed");

        let updated_branch = reloaded_service
            .get_branch("branch-project", "fork-a")
            .await
            .expect("branch should reload after update");
        assert!(updated_branch.timepoint_ids.is_empty());

        reloaded_service
            .update_branch(
                "branch-project",
                "fork-a",
                UpdateBranchRequest {
                    title: Some("Fork A Revised".to_string()),
                    description: None,
                    timepoint_ids: Some(Vec::new()),
                },
            )
            .await
            .expect("branch update should succeed");

        let branch_metadata_text = storage
            .read_text(std::path::Path::new(
                "projects/branch-project/timeline/branches/fork-a.json",
            ))
            .await
            .expect("branch metadata should exist");
        assert!(branch_metadata_text.contains("Fork A Revised"));

        let index_text = storage
            .read_text(std::path::Path::new(
                "projects/branch-project/timeline/index.json",
            ))
            .await
            .expect("timeline index should exist");
        let index: TimelineIndex =
            serde_json::from_str(&index_text).expect("index should deserialize");
        assert_eq!(index.branch_ids, vec!["fork-a"]);
        assert_eq!(index.timepoint_ids, vec!["origin", "fork-a-1"]);
    }
}
