use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tower as _;

use crate::storage::{Storage, StorageError, validate_segment};

const PROJECTS_DIR: &str = "projects";
const SYSTEM_AGENT_IDS: [&str; 6] = [
    "kp",
    "random-event",
    "project-auditor",
    "world-maintainer",
    "author",
    "reviewer",
];

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

    pub async fn delete(&self, slug: &str) -> Result<(), ProjectError> {
        validate_project_slug(slug)?;
        let root = project_root(slug);
        if !self.storage.exists(&root.join("project.json")).await? {
            return Err(ProjectError::NotFound(slug.to_string()));
        }
        self.storage.remove_dir_all(&root).await?;
        Ok(())
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
    let template = system_agent_template(agent_id);
    storage.ensure_dir(&agent_root.join("skills")).await?;
    storage
        .write_text(&agent_root.join("soul.md"), template.soul)
        .await?;
    storage
        .write_text(&agent_root.join("memory.md"), template.memory)
        .await?;
    storage
        .write_text(
            &agent_root.join("skills").join(template.skill_file),
            template.skill,
        )
        .await?;
    storage
        .write_json(
            &agent_root.join("profile.json"),
            &serde_json::json!({ "agent_id": agent_id, "kind": "system", "template_version": 1 }),
        )
        .await?;
    Ok(())
}

struct SystemAgentTemplate {
    soul: &'static str,
    memory: &'static str,
    skill_file: &'static str,
    skill: &'static str,
}

fn system_agent_template(agent_id: &str) -> SystemAgentTemplate {
    match agent_id {
        "random-event" => SystemAgentTemplate {
            soul: "# 随机事件编造 Agent\n\n## 职责\n创造与现有角色动机、世界状态兼容的新剧情事件。\n\n## 边界\n- 不直接替玩家角色做决定。\n- 不绕开 KP 裁定与项目审核。\n- 新事件必须能被后续世界观维护者吸收或解释。\n",
            memory: "# Random Event Memory\n\n- 初始职责：为每轮推演提供局部扰动、机会、冲突或线索。\n",
            skill_file: "random-event.md",
            skill: "# random-event\n\n## 输入\n- 当前时间点\n- 角色近期行动\n- 世界状态\n- RAG / StoryGraph 证据\n\n## 输出\n- 事件摘要\n- 触发原因\n- 影响角色\n- 需要后续确认的设定风险\n",
        },
        "world-maintainer" => SystemAgentTemplate {
            soul: "# 世界观维护者\n\n## 职责\n维护世界规则、地区设定、势力关系与新角色引入的一致性。\n\n## 原则\n- 遵循一无二随：已有设定优先；无设定时给出可回填的新设定。\n- 不让短期剧情爽点破坏长期世界逻辑。\n",
            memory: "# World Maintainer Memory\n\n- 初始职责：检查并记录新事件对世界观卡、规则卡和地区设定的影响。\n",
            skill_file: "world-update.md",
            skill: "# world-update\n\n## 检查项\n- 新地点 / 新组织 / 新资源是否需要设定卡。\n- 是否与既有世界规则冲突。\n- 是否需要追加记忆或时间点事实。\n\n## 输出\n- 可落盘设定更新\n- 冲突提示\n- 后续伏笔\n",
        },
        "kp" => SystemAgentTemplate {
            soul: "# KP\n\n## 职责\n主持每轮推演，按规则卡裁定行动结果，控制节奏并把散乱行动收束成可继续的局面。\n\n## 边界\n- 不替角色生成内心动机。\n- 不吞掉随机事件和世界观维护者的输入。\n- 规则缺失时先说明临时裁定依据。\n",
            memory: "# KP Memory\n\n- 初始职责：裁定角色行动、随机事件和世界状态之间的结果。\n",
            skill_file: "kp-adjudicate.md",
            skill: "# kp-adjudicate\n\n## 输入\n- 角色行动\n- 随机事件\n- 世界观维护建议\n- 规则卡\n\n## 输出\n- 裁定结果\n- 成功 / 失败 / 代价\n- 下一轮可行动局面\n",
        },
        "project-auditor" => SystemAgentTemplate {
            soul: "# 项目审核 Agent\n\n## 职责\n检查剧情是否偏离项目目标、大纲、时间线连续性与文本资产约束。\n\n## 边界\n- 不负责写小说正文。\n- 不直接否决可解释的分支，但必须指出风险。\n",
            memory: "# Project Auditor Memory\n\n- 初始职责：每轮推演后给出连续性、OOC、规则、世界观风险提示。\n",
            skill_file: "project-audit.md",
            skill: "# project-audit\n\n## 检查项\n- 是否偏离 project.md。\n- 是否破坏时间线连续性。\n- 是否有 OOC 或世界观冲突。\n- 是否需要创建分支而不是改写历史。\n\n## 输出\n- PASS / WARN / BLOCK\n- 依据文件\n- 修正建议\n",
        },
        "author" => SystemAgentTemplate {
            soul: "# 作者 Agent\n\n## 职责\n把推演记录、角色记忆与世界状态整理成小说章节草稿。\n\n## 边界\n- 不改写历史章节事实。\n- 不绕过审核 Agent 的一致性检查。\n",
            memory: "# Author Memory\n\n- 初始职责：根据推演报告和当前章节上下文生成可编辑正文。\n",
            skill_file: "author-draft.md",
            skill: "# author-draft\n\n## 输入\n- 当前章节\n- 推演日志\n- 角色卡 / 世界观卡 / 规则卡\n- ReportAgent 预写报告\n\n## 输出\n- 章节草稿\n- 依赖事实\n- 待审核点\n",
        },
        "reviewer" => SystemAgentTemplate {
            soul: "# 审核 Agent\n\n## 职责\n审核章节正文的字数、合规性、前文一致性、OOC 与世界观冲突。\n\n## 边界\n- 只给审核结论和修改建议，不替作者静默覆盖正文。\n",
            memory: "# Reviewer Memory\n\n- 初始职责：对创作页章节提供可追溯审核意见。\n",
            skill_file: "review-check.md",
            skill: "# review-check\n\n## 检查项\n- 字数与章节目标\n- 前后文一致性\n- 角色言行是否 OOC\n- 是否违反规则卡 / 世界观卡\n\n## 输出\n- PASS / WARN / BLOCK\n- 问题列表\n- 修改建议\n",
        },
        _ => SystemAgentTemplate {
            soul: "# Agent\n\n## 职责\n待维护的角色灵魂与行为约束。\n",
            memory: "# Memory\n\n- 尚无独立记忆。\n",
            skill_file: "agent-skill.md",
            skill: "# agent-skill\n\n## 输出\n- 目标\n- 依据\n- 行动\n- 风险\n",
        },
    }
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
        let kp_soul =
            tokio::fs::read_to_string(temp.path().join("projects/alpha-project/agents/kp/soul.md"))
                .await
                .expect("kp soul should be bootstrapped");
        assert!(kp_soul.contains("# KP"));
        assert!(
            temp.path()
                .join("projects/alpha-project/agents/kp/skills/kp-adjudicate.md")
                .exists()
        );
        assert!(
            temp.path()
                .join("projects/alpha-project/agents/author/skills/author-draft.md")
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

    #[tokio::test]
    async fn delete_project_removes_project_directory() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ProjectService::new(Arc::new(Storage::new(temp.path().to_path_buf())));

        service
            .create(CreateProjectRequest {
                slug: "delete-me".to_string(),
                title: "Delete Me".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project creation should succeed");

        service
            .delete("delete-me")
            .await
            .expect("project delete should succeed");
        assert!(!temp.path().join("projects/delete-me").exists());
        assert!(matches!(
            service.get("delete-me").await,
            Err(ProjectError::NotFound(_))
        ));
    }
}
