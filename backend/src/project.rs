use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower as _;

use crate::storage::{Storage, StorageError, validate_segment};

const PROJECTS_DIR: &str = "projects";
const SYSTEM_AGENT_IDS: [&str; 4] = ["kp", "random-event", "project-auditor", "world-maintainer"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectRecord {
    pub slug: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct CreateProjectRequest {
    pub slug: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct ProjectService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("invalid project slug: {0}")]
    InvalidSlug(String),
    #[error("project already exists: {0}")]
    AlreadyExists(String),
    #[error("project not found: {0}")]
    NotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl ProjectService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn create(
        &self,
        request: CreateProjectRequest,
    ) -> Result<ProjectRecord, ProjectError> {
        validate_project_slug(&request.slug)?;
        let project_root = project_root(&request.slug);

        if self.storage.exists(&project_root).await? {
            return Err(ProjectError::AlreadyExists(request.slug));
        }

        bootstrap_project(self.storage.as_ref(), &request).await
    }

    pub async fn get(&self, slug: &str) -> Result<ProjectRecord, ProjectError> {
        validate_project_slug(slug)?;
        let metadata_path = project_root(slug).join("project.json");
        if !self.storage.exists(&metadata_path).await? {
            return Err(ProjectError::NotFound(slug.to_string()));
        }

        let text = self.storage.read_text(&metadata_path).await?;
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn list(&self) -> Result<Vec<ProjectRecord>, ProjectError> {
        let directories = self.storage.list_dirs(Path::new(PROJECTS_DIR)).await?;
        let mut projects = Vec::new();

        for directory in directories {
            let slug = directory
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .ok_or_else(|| ProjectError::InvalidSlug(directory.display().to_string()))?;
            let metadata = self.get(slug).await?;
            projects.push(metadata);
        }

        projects.sort_by(|left, right| left.slug.cmp(&right.slug));
        Ok(projects)
    }
}

impl From<serde_json::Error> for ProjectError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

fn validate_project_slug(slug: &str) -> Result<(), ProjectError> {
    validate_segment(slug).map_err(|_| ProjectError::InvalidSlug(slug.to_string()))?;

    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(ProjectError::InvalidSlug(slug.to_string()));
    }

    Ok(())
}

fn project_root(slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(slug)
}

async fn bootstrap_project(
    storage: &Storage,
    request: &CreateProjectRequest,
) -> Result<ProjectRecord, ProjectError> {
    let record = ProjectRecord {
        slug: request.slug.clone(),
        title: request.title.clone(),
        description: request.description.clone(),
    };

    let root = project_root(&request.slug);
    storage.ensure_dir(&root).await?;

    for relative_dir in [
        root.join("import/raw"),
        root.join("import/normalized"),
        root.join("import/chapters"),
        root.join("import/reports"),
        root.join("cards/characters"),
        root.join("cards/rules"),
        root.join("cards/world"),
        root.join("memory/global/entries"),
        root.join("memory/branches"),
        root.join("memory/chapters"),
        root.join("memory/agents"),
        root.join("writing/chapters"),
        root.join("writing/review-notes"),
        root.join("writing/branches"),
        root.join("simulation/sessions"),
        root.join("simulation/logs"),
        root.join("timeline/timepoints"),
        root.join("timeline/branches"),
        root.join("history"),
        root.join("agents/characters"),
    ] {
        storage.ensure_dir(&relative_dir).await?;
    }

    for agent_id in SYSTEM_AGENT_IDS {
        bootstrap_agent(storage, &root, agent_id).await?;
    }

    storage
        .write_text(
            &root.join("project.md"),
            &format!("# {}\n\n{}\n", record.title, record.description),
        )
        .await?;
    storage
        .write_json(&root.join("project.json"), &record)
        .await?;
    storage
        .write_text(&root.join("writing/current-chapter.txt"), "")
        .await?;
    storage
        .write_text(&root.join("simulation/active-session.txt"), "")
        .await?;
    storage
        .write_text(&root.join("history/commits.log"), "")
        .await?;
    storage
        .write_text(
            &root.join("history/rollback-events.md"),
            "# Rollback events\n",
        )
        .await?;
    storage
        .write_text(
            &root.join("timeline/index.json"),
            "{\n  \"branch_ids\": [],\n  \"timepoint_ids\": []\n}",
        )
        .await?;

    Ok(record)
}

async fn bootstrap_agent(
    storage: &Storage,
    project_root: &Path,
    agent_id: &str,
) -> Result<(), ProjectError> {
    let agent_root = project_root.join("agents").join(agent_id);
    storage.ensure_dir(&agent_root.join("skills")).await?;
    storage
        .write_text(&agent_root.join("soul.md"), &format!("# {agent_id}\n"))
        .await?;
    storage
        .write_text(&agent_root.join("memory.md"), "# Memory\n")
        .await?;
    storage
        .write_json(
            &agent_root.join("profile.json"),
            &serde_json::json!({ "agent_id": agent_id }),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{CreateProjectRequest, ProjectError, ProjectService};
    use crate::storage::Storage;

    #[tokio::test]
    async fn create_project_bootstraps_expected_layout() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ProjectService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        let created = service
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha Project".to_string(),
                description: "A text-first fiction project".to_string(),
            })
            .await
            .expect("project creation should succeed");

        assert_eq!(created.slug, "alpha-project");
        assert!(
            temp.path()
                .join("projects/alpha-project/project.md")
                .exists()
        );
        assert!(
            temp.path()
                .join("projects/alpha-project/agents/kp/soul.md")
                .exists()
        );
        assert!(
            temp.path()
                .join("projects/alpha-project/cards/characters")
                .exists()
        );
        assert!(
            temp.path()
                .join("projects/alpha-project/memory/global/entries")
                .exists()
        );
    }

    #[tokio::test]
    async fn duplicate_project_slug_is_rejected() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ProjectService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        let request = CreateProjectRequest {
            slug: "duplicate".to_string(),
            title: "Duplicate".to_string(),
            description: "First project".to_string(),
        };

        service
            .create(request.clone())
            .await
            .expect("first create should succeed");
        let result = service.create(request).await;

        assert!(matches!(result, Err(ProjectError::AlreadyExists(slug)) if slug == "duplicate"));
    }

    #[tokio::test]
    async fn list_and_get_reload_project_from_disk() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ProjectService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        service
            .create(CreateProjectRequest {
                slug: "beta-project".to_string(),
                title: "Beta Project".to_string(),
                description: "Disk-backed metadata".to_string(),
            })
            .await
            .expect("project create should succeed");

        let loaded = service
            .get("beta-project")
            .await
            .expect("project should reload");
        assert_eq!(loaded.title, "Beta Project");

        let listed = service.list().await.expect("projects should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].slug, "beta-project");
    }

    #[tokio::test]
    async fn invalid_slug_is_rejected() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ProjectService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        let result = service
            .create(CreateProjectRequest {
                slug: "Bad Slug".to_string(),
                title: "Bad".to_string(),
                description: "No spaces allowed".to_string(),
            })
            .await;

        assert!(matches!(result, Err(ProjectError::InvalidSlug(slug)) if slug == "Bad Slug"));
        assert!(!temp.path().join(Path::new("projects/Bad Slug")).exists());
    }
}
