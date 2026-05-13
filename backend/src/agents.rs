use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{Storage, StorageError, validate_segment};

const PROJECTS_DIR: &str = "projects";
const AGENTS_DIR: &str = "agents";
const SOUL_FILE: &str = "soul.md";
const MEMORY_FILE: &str = "memory.md";
const SKILLS_DIR: &str = "skills";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentAssetRecord {
    pub project_slug: String,
    pub agent_id: String,
    pub soul: String,
    pub memory: String,
    pub skills: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentSummary {
    pub agent_id: String,
    pub soul_title: String,
    pub skill_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateAgentAssetRequest {
    pub soul: String,
    pub memory: String,
}

#[derive(Debug, Clone)]
pub struct AgentAssetService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum AgentAssetError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid agent id: {0}")]
    InvalidAgentId(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("agent not found: {0}")]
    NotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl AgentAssetService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn list(&self, project_slug: &str) -> Result<Vec<AgentSummary>, AgentAssetError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        self.ensure_character_agents(project_slug).await?;

        let paths = self.storage.list_dirs(&agents_root(project_slug)).await?;
        let mut agents = Vec::with_capacity(paths.len());
        for path in paths {
            let agent_id = file_name_string(&path)?;
            let record = self.get(project_slug, &agent_id).await?;
            agents.push(AgentSummary {
                agent_id,
                soul_title: first_heading(&record.soul),
                skill_count: record.skills.len(),
            });
        }
        agents.sort_by(|left, right| left.agent_id.cmp(&right.agent_id));
        Ok(agents)
    }

    pub async fn get(
        &self,
        project_slug: &str,
        agent_id: &str,
    ) -> Result<AgentAssetRecord, AgentAssetError> {
        validate_project_slug(project_slug)?;
        validate_agent_id(agent_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        self.ensure_agent(project_slug, agent_id).await?;

        let root = agent_root(project_slug, agent_id);
        let soul = self.storage.read_text(&root.join(SOUL_FILE)).await?;
        let memory = self.storage.read_text(&root.join(MEMORY_FILE)).await?;
        let skills = list_skill_files(self.storage.as_ref(), project_slug, agent_id).await?;
        Ok(AgentAssetRecord {
            project_slug: project_slug.to_string(),
            agent_id: agent_id.to_string(),
            soul,
            memory,
            skills,
        })
    }

    pub async fn update(
        &self,
        project_slug: &str,
        agent_id: &str,
        request: UpdateAgentAssetRequest,
    ) -> Result<AgentAssetRecord, AgentAssetError> {
        validate_project_slug(project_slug)?;
        validate_agent_id(agent_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        self.ensure_agent(project_slug, agent_id).await?;

        let root = agent_root(project_slug, agent_id);
        self.storage
            .write_text(&root.join(SOUL_FILE), &request.soul)
            .await?;
        self.storage
            .write_text(&root.join(MEMORY_FILE), &request.memory)
            .await?;
        self.get(project_slug, agent_id).await
    }

    async fn ensure_character_agents(&self, project_slug: &str) -> Result<(), AgentAssetError> {
        let character_card_dir = project_root(project_slug).join("cards/characters");
        for card_path in self.storage.list_files(&character_card_dir).await? {
            if card_path.extension().and_then(std::ffi::OsStr::to_str) != Some("md") {
                continue;
            }
            let agent_id = card_path
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .ok_or_else(|| AgentAssetError::InvalidAgentId(card_path.display().to_string()))?;
            self.ensure_agent(project_slug, agent_id).await?;
        }
        Ok(())
    }

    async fn ensure_agent(
        &self,
        project_slug: &str,
        agent_id: &str,
    ) -> Result<(), AgentAssetError> {
        validate_agent_id(agent_id)?;
        let root = agent_root(project_slug, agent_id);
        self.storage.ensure_dir(&root.join(SKILLS_DIR)).await?;
        let soul_path = root.join(SOUL_FILE);
        if !self.storage.exists(&soul_path).await? {
            self.storage
                .write_text(
                    &soul_path,
                    &format!("# {agent_id}\n\n## Role\n待维护的角色灵魂与行为约束。\n"),
                )
                .await?;
        }
        let memory_path = root.join(MEMORY_FILE);
        if !self.storage.exists(&memory_path).await? {
            self.storage
                .write_text(
                    &memory_path,
                    &format!("# {agent_id} Memory\n\n- 尚无独立记忆。\n"),
                )
                .await?;
        }
        Ok(())
    }
}

async fn list_skill_files(
    storage: &Storage,
    project_slug: &str,
    agent_id: &str,
) -> Result<Vec<String>, AgentAssetError> {
    let files = storage
        .list_files(&agent_root(project_slug, agent_id).join(SKILLS_DIR))
        .await?;
    let mut skills = Vec::new();
    for file in files {
        skills.push(file_name_string(&file)?);
    }
    skills.sort();
    Ok(skills)
}

fn first_heading(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map_or_else(|| "Untitled agent".to_string(), ToString::to_string)
}

fn file_name_string(path: &Path) -> Result<String, AgentAssetError> {
    path.file_name()
        .and_then(std::ffi::OsStr::to_str)
        .map(ToString::to_string)
        .ok_or_else(|| AgentAssetError::InvalidAgentId(path.display().to_string()))
}

fn validate_project_slug(slug: &str) -> Result<(), AgentAssetError> {
    validate_segment(slug).map_err(|_| AgentAssetError::InvalidProjectSlug(slug.to_string()))?;
    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(AgentAssetError::InvalidProjectSlug(slug.to_string()));
    }
    Ok(())
}

fn validate_agent_id(agent_id: &str) -> Result<(), AgentAssetError> {
    validate_segment(agent_id)
        .map_err(|_| AgentAssetError::InvalidAgentId(agent_id.to_string()))?;
    if !agent_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(AgentAssetError::InvalidAgentId(agent_id.to_string()));
    }
    Ok(())
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn agents_root(project_slug: &str) -> PathBuf {
    project_root(project_slug).join(AGENTS_DIR)
}

fn agent_root(project_slug: &str, agent_id: &str) -> PathBuf {
    agents_root(project_slug).join(agent_id)
}

async fn ensure_project_exists(
    storage: &Storage,
    project_slug: &str,
) -> Result<(), AgentAssetError> {
    let metadata_path = project_root(project_slug).join("project.json");
    if storage.exists(&metadata_path).await? {
        Ok(())
    } else {
        Err(AgentAssetError::ProjectNotFound(project_slug.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use super::{AgentAssetService, UpdateAgentAssetRequest};
    use crate::{
        cards::{CardKind, CardService, CreateCardRequest},
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn list_includes_system_and_character_agents() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let agents = AgentAssetService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "agent-project".to_string(),
                title: "Agent Project".to_string(),
                description: "agent assets".to_string(),
            })
            .await
            .expect("project create should succeed");
        cards
            .create(CreateCardRequest {
                project_slug: "agent-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Protects the vault".to_string(),
            })
            .await
            .expect("character card should create");

        let listed = agents
            .list("agent-project")
            .await
            .expect("agents should list");
        assert!(listed.iter().any(|agent| agent.agent_id == "kp"));
        assert!(listed.iter().any(|agent| agent.agent_id == "aria"));

        let aria = agents
            .get("agent-project", "aria")
            .await
            .expect("aria should load");
        assert!(aria.soul.contains("# aria"));
    }

    #[tokio::test]
    async fn update_rewrites_soul_and_memory_text_files() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let agents = AgentAssetService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "agent-project".to_string(),
                title: "Agent Project".to_string(),
                description: "agent assets".to_string(),
            })
            .await
            .expect("project create should succeed");

        let updated = agents
            .update(
                "agent-project",
                "kp",
                UpdateAgentAssetRequest {
                    soul: "# KP\n\n主持规则。".to_string(),
                    memory: "# Memory\n\n- 审核一无二随。".to_string(),
                },
            )
            .await
            .expect("agent should update");

        assert_eq!(updated.soul, "# KP\n\n主持规则。");
        let disk_memory = storage
            .read_text(std::path::Path::new(
                "projects/agent-project/agents/kp/memory.md",
            ))
            .await
            .expect("memory should persist");
        assert!(disk_memory.contains("一无二随"));
    }
}
