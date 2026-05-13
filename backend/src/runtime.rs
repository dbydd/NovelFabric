use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{Storage, StorageError, validate_segment};

const PROJECTS_DIR: &str = "projects";
const AGENT_AUDIT_DIR: &str = "agents";
const PATCH_AUDIT_FILE: &str = "runtime-patch-log.md";
const MAX_READ_BYTES: usize = 256 * 1024;
const MAX_GLOB_RESULTS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadOutput {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GlobMatch {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GlobOutput {
    pub matches: Vec<GlobMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchResult {
    pub path: String,
    pub operation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchOutput {
    pub results: Vec<PatchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimeExecution {
    pub agent_id: String,
    pub intent: String,
    pub reads: Vec<ReadOutput>,
    pub matches: Vec<GlobMatch>,
    pub patch: Option<PatchOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimeReadRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimeGlobRequest {
    pub base: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentRuntimePatchOperation {
    Replace {
        path: String,
        old: String,
        new: String,
    },
    Write {
        path: String,
        content: String,
    },
    Append {
        path: String,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimePatchRequest {
    pub agent_id: String,
    pub operations: Vec<AgentRuntimePatchOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRuntimeExecuteRequest {
    pub agent_id: String,
    pub intent: String,
    #[serde(default)]
    pub reads: Vec<AgentRuntimeReadRequest>,
    #[serde(default)]
    pub globs: Vec<AgentRuntimeGlobRequest>,
    #[serde(default)]
    pub patch: Option<AgentRuntimePatchRequest>,
}

#[derive(Debug, Clone)]
pub struct AgentRuntimeService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum AgentRuntimeError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("invalid agent id: {0}")]
    InvalidAgentId(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("path not allowed: {0}")]
    PathNotAllowed(String),
    #[error("file not found: {0}")]
    NotFound(String),
    #[error("file too large: {0}")]
    FileTooLarge(String),
    #[error("pattern not supported: {0}")]
    UnsupportedPattern(String),
    #[error("replace target not found in file: {0}")]
    ReplaceTargetMissing(String),
    #[error("critical agent asset cannot be emptied: {0}")]
    CriticalAssetWouldBeEmpty(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl AgentRuntimeService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn read(
        &self,
        project_slug: &str,
        request: AgentRuntimeReadRequest,
    ) -> Result<ReadOutput, AgentRuntimeError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let relative = project_relative_path(project_slug, &request.path)?;
        let resolved = self.storage.resolve(&relative)?;
        let metadata = tokio::fs::metadata(&resolved).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AgentRuntimeError::NotFound(request.path.clone())
            } else {
                AgentRuntimeError::Storage(StorageError::Io(error))
            }
        })?;
        let size: usize = metadata
            .len()
            .try_into()
            .map_err(|_| AgentRuntimeError::FileTooLarge(request.path.clone()))?;
        if size > MAX_READ_BYTES {
            return Err(AgentRuntimeError::FileTooLarge(request.path));
        }
        let content = self.storage.read_text(&relative).await?;
        Ok(ReadOutput {
            path: request.path,
            content,
        })
    }

    pub async fn glob(
        &self,
        project_slug: &str,
        request: AgentRuntimeGlobRequest,
    ) -> Result<GlobOutput, AgentRuntimeError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let base = project_relative_path(project_slug, &request.base)?;
        let mut matches = Vec::new();
        collect_glob_matches(
            self.storage.as_ref(),
            &self.storage.resolve(&project_root(project_slug))?,
            &base,
            &request.pattern,
            &mut matches,
        )
        .await?;
        matches.sort();
        if matches.len() > MAX_GLOB_RESULTS {
            matches.truncate(MAX_GLOB_RESULTS);
        }
        Ok(GlobOutput {
            matches: matches.into_iter().map(|path| GlobMatch { path }).collect(),
        })
    }

    pub async fn patch(
        &self,
        project_slug: &str,
        request: AgentRuntimePatchRequest,
    ) -> Result<PatchOutput, AgentRuntimeError> {
        validate_project_slug(project_slug)?;
        validate_agent_id(&request.agent_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let mut results = Vec::with_capacity(request.operations.len());
        for operation in request.operations {
            let result = match operation {
                AgentRuntimePatchOperation::Replace { path, old, new } => {
                    let relative = project_relative_path(project_slug, &path)?;
                    let previous = self
                        .storage
                        .read_text(&relative)
                        .await
                        .map_err(map_not_found(&path))?;
                    if !previous.contains(&old) {
                        return Err(AgentRuntimeError::ReplaceTargetMissing(path));
                    }
                    let updated = previous.replacen(&old, &new, 1);
                    ensure_critical_asset_not_empty(&relative, &updated)?;
                    self.storage.write_text(&relative, &updated).await?;
                    PatchResult {
                        path: display_path(project_slug, &relative),
                        operation: "replace".to_string(),
                    }
                }
                AgentRuntimePatchOperation::Write { path, content } => {
                    let relative = project_relative_path(project_slug, &path)?;
                    ensure_critical_asset_not_empty(&relative, &content)?;
                    self.storage.write_text(&relative, &content).await?;
                    PatchResult {
                        path: display_path(project_slug, &relative),
                        operation: "write".to_string(),
                    }
                }
                AgentRuntimePatchOperation::Append { path, content } => {
                    let relative = project_relative_path(project_slug, &path)?;
                    let previous = if self.storage.exists(&relative).await? {
                        self.storage.read_text(&relative).await?
                    } else {
                        String::new()
                    };
                    let mut updated = previous;
                    updated.push_str(&content);
                    ensure_critical_asset_not_empty(&relative, &updated)?;
                    self.storage.write_text(&relative, &updated).await?;
                    PatchResult {
                        path: display_path(project_slug, &relative),
                        operation: "append".to_string(),
                    }
                }
            };
            self.append_audit_log(project_slug, &request.agent_id, &result)
                .await?;
            results.push(result);
        }
        Ok(PatchOutput { results })
    }

    pub async fn execute(
        &self,
        project_slug: &str,
        request: AgentRuntimeExecuteRequest,
    ) -> Result<AgentRuntimeExecution, AgentRuntimeError> {
        validate_agent_id(&request.agent_id)?;
        let mut reads = Vec::with_capacity(request.reads.len());
        for read in request.reads {
            reads.push(self.read(project_slug, read).await?);
        }
        let mut matches = Vec::new();
        for glob_request in request.globs {
            matches.extend(self.glob(project_slug, glob_request).await?.matches);
        }
        let patch = match request.patch {
            Some(patch_request) => Some(self.patch(project_slug, patch_request).await?),
            None => None,
        };
        Ok(AgentRuntimeExecution {
            agent_id: request.agent_id,
            intent: request.intent,
            reads,
            matches,
            patch,
        })
    }

    async fn append_audit_log(
        &self,
        project_slug: &str,
        agent_id: &str,
        result: &PatchResult,
    ) -> Result<(), AgentRuntimeError> {
        let audit_path = project_root(project_slug)
            .join(AGENT_AUDIT_DIR)
            .join(agent_id)
            .join("audit")
            .join(PATCH_AUDIT_FILE);
        let relative = audit_path;
        let previous = if self.storage.exists(&relative).await? {
            self.storage.read_text(&relative).await?
        } else {
            "# Runtime patch audit\n\n".to_string()
        };
        let updated = format!(
            "{previous}- operation: `{}` target: `{}`\n",
            result.operation, result.path
        );
        self.storage.write_text(&relative, &updated).await?;
        Ok(())
    }
}

fn validate_project_slug(slug: &str) -> Result<(), AgentRuntimeError> {
    validate_segment(slug).map_err(|_| AgentRuntimeError::InvalidProjectSlug(slug.to_string()))?;
    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(AgentRuntimeError::InvalidProjectSlug(slug.to_string()));
    }
    Ok(())
}

fn validate_agent_id(agent_id: &str) -> Result<(), AgentRuntimeError> {
    validate_segment(agent_id)
        .map_err(|_| AgentRuntimeError::InvalidAgentId(agent_id.to_string()))?;
    if !agent_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(AgentRuntimeError::InvalidAgentId(agent_id.to_string()));
    }
    Ok(())
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn project_relative_path(project_slug: &str, path: &str) -> Result<PathBuf, AgentRuntimeError> {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return Err(AgentRuntimeError::InvalidPath(path.to_string()));
    }
    let mut relative = project_root(project_slug);
    for segment in trimmed.split('/') {
        validate_segment(segment).map_err(|_| AgentRuntimeError::InvalidPath(path.to_string()))?;
        relative.push(segment);
    }
    ensure_allowed_relative_path(project_slug, &relative)?;
    Ok(relative)
}

fn ensure_allowed_relative_path(
    project_slug: &str,
    relative: &Path,
) -> Result<(), AgentRuntimeError> {
    let display = display_path(project_slug, relative);
    let allowed_prefixes = [
        "project.md",
        "cards/",
        "memory/",
        "timeline/",
        "writing/",
        "simulation/",
        "agents/",
        "history/",
        "import/",
    ];
    if allowed_prefixes.iter().any(|prefix| {
        let base = prefix.trim_end_matches('/');
        display == *prefix || display == base || display.starts_with(prefix)
    }) {
        Ok(())
    } else {
        Err(AgentRuntimeError::PathNotAllowed(display))
    }
}

fn display_path(project_slug: &str, relative: &Path) -> String {
    relative
        .strip_prefix(project_root(project_slug))
        .expect("project prefix should exist")
        .to_string_lossy()
        .replace('\\', "/")
}

async fn ensure_project_exists(
    storage: &Storage,
    project_slug: &str,
) -> Result<(), AgentRuntimeError> {
    let metadata_path = project_root(project_slug).join("project.json");
    if storage.exists(&metadata_path).await? {
        Ok(())
    } else {
        Err(AgentRuntimeError::ProjectNotFound(project_slug.to_string()))
    }
}

fn ensure_critical_asset_not_empty(
    relative: &Path,
    content: &str,
) -> Result<(), AgentRuntimeError> {
    let file_name = relative
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    if (file_name == "soul.md" || file_name == "memory.md") && content.trim().is_empty() {
        return Err(AgentRuntimeError::CriticalAssetWouldBeEmpty(
            relative.display().to_string(),
        ));
    }
    Ok(())
}

fn map_not_found(path: &str) -> impl FnOnce(StorageError) -> AgentRuntimeError + '_ {
    move |error| match error {
        StorageError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
            AgentRuntimeError::NotFound(path.to_string())
        }
        other => AgentRuntimeError::Storage(other),
    }
}

async fn collect_glob_matches(
    storage: &Storage,
    project_root: &Path,
    current: &Path,
    pattern: &str,
    matches: &mut Vec<String>,
) -> Result<(), AgentRuntimeError> {
    let mut pending = vec![current.to_path_buf()];

    while let Some(relative_dir) = pending.pop() {
        let resolved = storage.resolve(&relative_dir)?;
        let mut reader = match tokio::fs::read_dir(&resolved).await {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(AgentRuntimeError::Storage(StorageError::Io(error))),
        };

        while let Some(entry) = reader.next_entry().await.map_err(StorageError::Io)? {
            let path = entry.path();
            let file_type = entry.file_type().await.map_err(StorageError::Io)?;
            if file_type.is_dir() {
                let relative = path
                    .strip_prefix(storage.root())
                    .map(Path::to_path_buf)
                    .map_err(|_| AgentRuntimeError::InvalidPath(path.display().to_string()))?;
                pending.push(relative);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let display = path
                .strip_prefix(project_root)
                .map_err(|_| AgentRuntimeError::InvalidPath(path.display().to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            if simple_pattern_matches(pattern, &display)? {
                matches.push(display);
            }
        }
    }

    Ok(())
}

fn simple_pattern_matches(pattern: &str, candidate: &str) -> Result<bool, AgentRuntimeError> {
    if pattern.is_empty() {
        return Err(AgentRuntimeError::UnsupportedPattern(pattern.to_string()));
    }
    if pattern == "**/*.md" {
        return Ok(Path::new(candidate)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md")));
    }
    if let Some(prefix) = pattern.strip_suffix("/**") {
        return Ok(candidate == prefix || candidate.starts_with(&format!("{prefix}/")));
    }
    if let Some(suffix) = pattern.strip_prefix("**/*") {
        return Ok(candidate.ends_with(suffix));
    }
    if !pattern.contains('*') {
        return Ok(candidate == pattern);
    }
    Err(AgentRuntimeError::UnsupportedPattern(pattern.to_string()))
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{
        AgentRuntimeExecuteRequest, AgentRuntimeGlobRequest, AgentRuntimePatchOperation,
        AgentRuntimePatchRequest, AgentRuntimeReadRequest, AgentRuntimeService,
    };
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn read_glob_and_patch_stay_inside_project_boundary() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let runtime = AgentRuntimeService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "skill-project".to_string(),
                title: "Skill Project".to_string(),
                description: "runtime".to_string(),
            })
            .await
            .expect("project create should succeed");

        storage
            .write_text(
                Path::new("projects/skill-project/writing/chapters/ch1.md"),
                "# Chapter\n\nold line\n",
            )
            .await
            .expect("seed write should succeed");

        let read = runtime
            .read(
                "skill-project",
                AgentRuntimeReadRequest {
                    path: "writing/chapters/ch1.md".to_string(),
                },
            )
            .await
            .expect("read should succeed");
        assert!(read.content.contains("old line"));

        let globbed = runtime
            .glob(
                "skill-project",
                AgentRuntimeGlobRequest {
                    base: "writing".to_string(),
                    pattern: "**/*.md".to_string(),
                },
            )
            .await
            .expect("glob should succeed");
        assert_eq!(globbed.matches[0].path, "writing/chapters/ch1.md");

        let patch = runtime
            .patch(
                "skill-project",
                AgentRuntimePatchRequest {
                    agent_id: "project-auditor".to_string(),
                    operations: vec![
                        AgentRuntimePatchOperation::Replace {
                            path: "writing/chapters/ch1.md".to_string(),
                            old: "old line".to_string(),
                            new: "new line".to_string(),
                        },
                        AgentRuntimePatchOperation::Append {
                            path: "writing/review-notes/ch1.md".to_string(),
                            content: "- looks coherent\n".to_string(),
                        },
                    ],
                },
            )
            .await
            .expect("patch should succeed");
        assert_eq!(patch.results.len(), 2);

        let updated = storage
            .read_text(Path::new("projects/skill-project/writing/chapters/ch1.md"))
            .await
            .expect("updated chapter should exist");
        assert!(updated.contains("new line"));

        let audit = storage
            .read_text(Path::new(
                "projects/skill-project/agents/project-auditor/audit/runtime-patch-log.md",
            ))
            .await
            .expect("audit should exist");
        assert!(audit.contains("writing/review-notes/ch1.md"));
    }

    #[tokio::test]
    async fn execute_combines_read_glob_and_patch() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let runtime = AgentRuntimeService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "runtime-project".to_string(),
                title: "Runtime Project".to_string(),
                description: "runtime".to_string(),
            })
            .await
            .expect("project create should succeed");

        storage
            .write_text(
                Path::new("projects/runtime-project/writing/chapters/chapter-1.md"),
                "# Chapter 1\n\nBody\n",
            )
            .await
            .expect("seed chapter should succeed");

        let execution = runtime
            .execute(
                "runtime-project",
                AgentRuntimeExecuteRequest {
                    agent_id: "project-auditor".to_string(),
                    intent: "review chapter".to_string(),
                    reads: vec![AgentRuntimeReadRequest {
                        path: "writing/chapters/chapter-1.md".to_string(),
                    }],
                    globs: vec![AgentRuntimeGlobRequest {
                        base: "writing".to_string(),
                        pattern: "**/*.md".to_string(),
                    }],
                    patch: Some(AgentRuntimePatchRequest {
                        agent_id: "project-auditor".to_string(),
                        operations: vec![AgentRuntimePatchOperation::Write {
                            path: "writing/review-notes/chapter-1.md".to_string(),
                            content: "- PASS: stays before chapter ten\n".to_string(),
                        }],
                    }),
                },
            )
            .await
            .expect("execute should succeed");

        assert_eq!(execution.agent_id, "project-auditor");
        assert_eq!(execution.reads.len(), 1);
        assert!(!execution.matches.is_empty());
        assert!(execution.patch.is_some());
    }

    #[tokio::test]
    async fn patch_rejects_parent_escape_and_empty_critical_assets() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let runtime = AgentRuntimeService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "safe-project".to_string(),
                title: "Safe Project".to_string(),
                description: "runtime".to_string(),
            })
            .await
            .expect("project create should succeed");

        let escape = runtime
            .read(
                "safe-project",
                AgentRuntimeReadRequest {
                    path: "../outside.txt".to_string(),
                },
            )
            .await;
        assert!(escape.is_err());

        let empty_soul = runtime
            .patch(
                "safe-project",
                AgentRuntimePatchRequest {
                    agent_id: "kp".to_string(),
                    operations: vec![AgentRuntimePatchOperation::Write {
                        path: "agents/kp/soul.md".to_string(),
                        content: "   \n".to_string(),
                    }],
                },
            )
            .await;
        assert!(empty_soul.is_err());
    }
}
