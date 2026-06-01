use std::{collections::BTreeMap, fmt::Write as _, hash::Hasher, path::Path, sync::Arc};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    project::{CreateProjectRequest, ProjectError, ProjectService},
    simulation::{
        AdvanceRoundRequest, CharacterAction, CreateCharacterRequest, CreateSessionRequest,
        SimulationError, SimulationRole, SimulationService,
    },
    storage::{Storage, StorageError},
};

const PROJECTS_DIR: &str = "projects";
const GLOBAL_EXTERNAL_DIR: &str = "external";
const MAX_ROUNDS: u32 = 3;
const MAX_ITEMS: usize = 24;
const CONTENT_PREVIEW_CHARS: usize = 900;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSwarmInferenceRequest {
    pub client_request_id: Option<String>,
    pub domain: String,
    pub title: String,
    pub summary: String,
    pub items: Vec<ExternalSwarmItem>,
    pub questions: Vec<String>,
    #[serde(default = "default_rounds")]
    pub rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSwarmItem {
    pub id: Option<String>,
    pub title: String,
    pub content: String,
    pub published_at: Option<String>,
    pub source: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSwarmInferenceResponse {
    pub inference_id: String,
    pub project_slug: String,
    pub session_id: String,
    pub domain: String,
    pub title: String,
    pub rounds_completed: u32,
    pub item_count: usize,
    pub artifact_paths: ExternalSwarmArtifacts,
    pub summary_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSwarmArtifacts {
    pub manifest: String,
    pub report: String,
    pub input_items: Vec<String>,
    pub session: String,
    pub swarm_rounds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ExternalSwarmManifest {
    response: ExternalSwarmInferenceResponse,
    client_request_id: Option<String>,
    questions: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ExternalSwarmService {
    storage: Arc<Storage>,
    projects: ProjectService,
    simulation: SimulationService,
}

#[derive(Debug, Error)]
pub enum ExternalSwarmError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error(transparent)]
    Project(#[from] ProjectError),
    #[error(transparent)]
    Simulation(#[from] SimulationError),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl ExternalSwarmService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        Self {
            projects: ProjectService::new(Arc::clone(&storage)),
            simulation: SimulationService::new(Arc::clone(&storage)),
            storage,
        }
    }

    pub async fn create_or_get(
        &self,
        request: ExternalSwarmInferenceRequest,
    ) -> Result<ExternalSwarmInferenceResponse, ExternalSwarmError> {
        validate_request(&request)?;
        let inference_id = build_inference_id(&request);
        if let Some(existing) = self.get(&inference_id).await? {
            return Ok(existing);
        }

        let project_slug = format!("external-{}", slugify(&request.domain));
        self.ensure_project(&project_slug, &request).await?;

        let item_artifacts = self
            .write_input_items(&project_slug, &inference_id, &request.items)
            .await?;
        let session_id = inference_id.clone();
        let characters = build_characters(&request, &item_artifacts);
        let mut session = self
            .simulation
            .create_session(CreateSessionRequest {
                project_slug: project_slug.clone(),
                session_id: session_id.clone(),
                timeline: "external".to_string(),
                timepoint_id: "intake".to_string(),
                title: request.title.clone(),
                characters,
            })
            .await?;

        let mut swarm_rounds = Vec::new();
        for round in 1..=request.rounds {
            session = self
                .simulation
                .advance_round(
                    &project_slug,
                    &session_id,
                    AdvanceRoundRequest {
                        character_actions: build_character_actions(&request, &item_artifacts),
                        system_directives: build_system_directives(&request, round),
                        auditor_concludes_session: round == request.rounds,
                    },
                )
                .await?;
            swarm_rounds.push(project_swarm_round_path(&project_slug, &session_id, round));
        }

        let report_path = project_report_path(&project_slug, &inference_id);
        let manifest_path = project_manifest_path(&project_slug, &inference_id);
        let session_path = project_session_path(&project_slug, &session_id);
        let summary_markdown =
            render_report(&request, &item_artifacts, &session.logs, &swarm_rounds);
        self.storage
            .write_text(Path::new(&report_path), &summary_markdown)
            .await?;

        let response = ExternalSwarmInferenceResponse {
            inference_id: inference_id.clone(),
            project_slug,
            session_id,
            domain: request.domain,
            title: request.title,
            rounds_completed: request.rounds,
            item_count: request.items.len(),
            artifact_paths: ExternalSwarmArtifacts {
                manifest: manifest_path.clone(),
                report: report_path,
                input_items: item_artifacts
                    .iter()
                    .map(|artifact| artifact.path.clone())
                    .collect(),
                session: session_path,
                swarm_rounds,
            },
            summary_markdown,
        };
        let manifest = ExternalSwarmManifest {
            response: response.clone(),
            client_request_id: request.client_request_id,
            questions: request.questions,
        };
        self.storage
            .write_json(Path::new(&manifest_path), &manifest)
            .await?;
        self.storage
            .write_json(Path::new(&global_manifest_path(&inference_id)), &manifest)
            .await?;
        Ok(response)
    }

    pub async fn get(
        &self,
        inference_id: &str,
    ) -> Result<Option<ExternalSwarmInferenceResponse>, ExternalSwarmError> {
        let manifest_path = global_manifest_path(inference_id);
        if !self.storage.exists(Path::new(&manifest_path)).await? {
            return Ok(None);
        }
        let text = self.storage.read_text(Path::new(&manifest_path)).await?;
        let manifest: ExternalSwarmManifest =
            serde_json::from_str(&text).map_err(StorageError::Json)?;
        Ok(Some(manifest.response))
    }

    async fn ensure_project(
        &self,
        project_slug: &str,
        request: &ExternalSwarmInferenceRequest,
    ) -> Result<(), ExternalSwarmError> {
        match self.projects.get(project_slug).await {
            Ok(_) => Ok(()),
            Err(ProjectError::NotFound(_)) => {
                self.projects
                    .create(CreateProjectRequest {
                        slug: project_slug.to_string(),
                        title: format!("External inference: {}", request.domain),
                        description: format!(
                            "Generic external swarm inference project for domain `{}`.",
                            request.domain
                        ),
                    })
                    .await?;
                Ok(())
            }
            Err(error) => Err(error.into()),
        }
    }

    async fn write_input_items(
        &self,
        project_slug: &str,
        inference_id: &str,
        items: &[ExternalSwarmItem],
    ) -> Result<Vec<InputArtifact>, ExternalSwarmError> {
        let mut artifacts = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            let item_slug = unique_item_slug(index, item.id.as_deref().unwrap_or(&item.title));
            let path = project_item_path(project_slug, inference_id, &item_slug);
            self.storage
                .write_text(Path::new(&path), &render_item_markdown(index, item))
                .await?;
            artifacts.push(InputArtifact {
                character_id: format!("item-{:03}", index + 1),
                path,
                title: item.title.clone(),
                content: item.content.clone(),
            });
        }
        Ok(artifacts)
    }
}

#[derive(Debug, Clone)]
struct InputArtifact {
    character_id: String,
    path: String,
    title: String,
    content: String,
}

fn validate_request(request: &ExternalSwarmInferenceRequest) -> Result<(), ExternalSwarmError> {
    if request.domain.trim().is_empty() {
        return Err(ExternalSwarmError::InvalidRequest(
            "domain must not be empty".to_string(),
        ));
    }
    if request.title.trim().is_empty() {
        return Err(ExternalSwarmError::InvalidRequest(
            "title must not be empty".to_string(),
        ));
    }
    if request.summary.trim().is_empty() {
        return Err(ExternalSwarmError::InvalidRequest(
            "summary must not be empty".to_string(),
        ));
    }
    if request.items.is_empty() || request.items.len() > MAX_ITEMS {
        return Err(ExternalSwarmError::InvalidRequest(format!(
            "items length must be between 1 and {MAX_ITEMS}"
        )));
    }
    if request.questions.is_empty() {
        return Err(ExternalSwarmError::InvalidRequest(
            "questions must not be empty".to_string(),
        ));
    }
    if request.rounds == 0 || request.rounds > MAX_ROUNDS {
        return Err(ExternalSwarmError::InvalidRequest(format!(
            "rounds must be between 1 and {MAX_ROUNDS}"
        )));
    }
    for item in &request.items {
        if item.title.trim().is_empty() || item.content.trim().is_empty() {
            return Err(ExternalSwarmError::InvalidRequest(
                "each item requires title and content".to_string(),
            ));
        }
    }
    Ok(())
}

const fn default_rounds() -> u32 {
    1
}

fn build_inference_id(request: &ExternalSwarmInferenceRequest) -> String {
    let seed = request
        .client_request_id
        .as_deref()
        .unwrap_or(&request.title);
    let slug = slugify(seed);
    let hash = stable_hash(&format!(
        "{}:{}:{}",
        request.domain,
        seed,
        request.items.len()
    ));
    format!("external-{slug}-{hash:08x}")
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    hasher.write(value.as_bytes());
    hasher.finish()
}

fn build_characters(
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
) -> Vec<CreateCharacterRequest> {
    artifacts
        .iter()
        .map(|artifact| CreateCharacterRequest {
            character_id: artifact.character_id.clone(),
            display_name: artifact.title.chars().take(80).collect(),
            agenda: format!(
                "Represent this external source item during inference. Citation: {}. Scenario: {}. Questions: {}",
                artifact.path,
                request.summary,
                request.questions.join(" | ")
            ),
        })
        .collect()
}

fn build_character_actions(
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
) -> Vec<CharacterAction> {
    artifacts
        .iter()
        .map(|artifact| CharacterAction {
            character_id: artifact.character_id.clone(),
            summary: format!(
                "Source item `{}` contributes evidence from {}. Content preview: {}. Scenario questions: {}",
                artifact.title,
                artifact.path,
                preview(&artifact.content, CONTENT_PREVIEW_CHARS),
                request.questions.join(" | ")
            ),
        })
        .collect()
}

fn build_system_directives(
    request: &ExternalSwarmInferenceRequest,
    round: u32,
) -> BTreeMap<SimulationRole, String> {
    let questions = request.questions.join(" | ");
    BTreeMap::from([
        (
            SimulationRole::RandomEvent,
            format!(
                "Round {round}: infer plausible second-order developments for domain `{}` from the provided external items. Questions: {questions}",
                request.domain
            ),
        ),
        (
            SimulationRole::WorldMaintainer,
            format!(
                "Round {round}: maintain cross-item consistency, source boundaries, and uncertainty notes for `{}`.",
                request.title
            ),
        ),
        (
            SimulationRole::Kp,
            "Adjudicate which effects are direct, indirect, uncertain, or unsupported; keep every claim tied to cited input artifacts.".to_string(),
        ),
        (
            SimulationRole::ProjectAuditor,
            "Audit the inference for missing citations, overreach, duplicate evidence, and follow-up monitoring needs.".to_string(),
        ),
    ])
}

fn render_item_markdown(index: usize, item: &ExternalSwarmItem) -> String {
    let metadata =
        serde_json::to_string_pretty(&item.metadata).unwrap_or_else(|_| "{}".to_string());
    format!(
        "# Source item {number}: {title}\n\n- Source id: {id}\n- Source: {source}\n- Published at: {published_at}\n- URL: {url}\n\n## Content\n\n{content}\n\n## Metadata\n\n```json\n{metadata}\n```\n",
        number = index + 1,
        title = item.title,
        id = item.id.as_deref().unwrap_or(""),
        source = item.source.as_deref().unwrap_or(""),
        published_at = item.published_at.as_deref().unwrap_or(""),
        url = item.url.as_deref().unwrap_or(""),
        content = item.content,
    )
}

fn render_report(
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
    logs: &[crate::simulation::SessionLogEntry],
    swarm_rounds: &[String],
) -> String {
    let mut report = format!(
        "# External Swarm Inference: {}\n\n- Domain: `{}`\n- Items: {}\n- Rounds: {}\n\n## Scenario summary\n\n{}\n\n## Questions\n\n{}\n\n## Source artifacts\n\n",
        request.title,
        request.domain,
        artifacts.len(),
        request.rounds,
        request.summary,
        request
            .questions
            .iter()
            .map(|question| format!("- {question}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
    for artifact in artifacts {
        let _ = writeln!(report, "- `{}` — {}", artifact.path, artifact.title);
    }
    report.push_str("\n## Swarm rounds\n\n");
    for path in swarm_rounds {
        let _ = writeln!(report, "- `{path}`");
    }
    report.push_str("\n## Simulation log\n\n");
    for entry in logs {
        let _ = writeln!(
            report,
            "- Round {} / turn {} / {}: {}",
            entry.round, entry.turn, entry.actor_id, entry.summary
        );
    }
    report
}

fn project_item_path(project_slug: &str, inference_id: &str, item_slug: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/external/items/{inference_id}/{item_slug}.md")
}

fn project_manifest_path(project_slug: &str, inference_id: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/external/inferences/{inference_id}.json")
}

fn project_report_path(project_slug: &str, inference_id: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/external/reports/{inference_id}.md")
}

fn project_session_path(project_slug: &str, session_id: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/simulation/sessions/{session_id}.json")
}

fn project_swarm_round_path(project_slug: &str, session_id: &str, round: u32) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/simulation/swarm/{session_id}/round-{round:04}.json")
}

fn global_manifest_path(inference_id: &str) -> String {
    format!("{GLOBAL_EXTERNAL_DIR}/inferences/{inference_id}.json")
}

fn unique_item_slug(index: usize, value: &str) -> String {
    format!("{:03}-{}", index + 1, slugify(value))
}

fn slugify(value: &str) -> String {
    let mut slug = String::new();
    for character in value.chars() {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            slug.push(character);
        } else if character.is_ascii_uppercase() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
        if slug.len() >= 56 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "item".to_string()
    } else {
        trimmed.to_string()
    }
}

fn preview(value: &str, max_chars: usize) -> String {
    let mut output: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn creates_text_first_inference_and_is_idempotent() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ExternalSwarmService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let request = sample_request(5);

        let first = service
            .create_or_get(request.clone())
            .await
            .expect("inference should run");
        let second = service
            .create_or_get(request)
            .await
            .expect("idempotent inference should read manifest");

        assert_eq!(first, second);
        assert_eq!(first.item_count, 5);
        assert_eq!(first.rounds_completed, 1);
        assert_eq!(first.artifact_paths.input_items.len(), 5);
        assert_eq!(first.artifact_paths.swarm_rounds.len(), 1);
        for path in &first.artifact_paths.input_items {
            let absolute = temp.path().join(path);
            assert!(absolute.exists(), "item artifact should exist: {path}");
            let content = std::fs::read_to_string(absolute).expect("artifact should be readable");
            assert!(content.contains("## Content"));
        }
        assert!(temp.path().join(&first.artifact_paths.manifest).exists());
        assert!(temp.path().join(&first.artifact_paths.report).exists());
        assert!(temp.path().join(&first.artifact_paths.session).exists());
        assert!(
            temp.path()
                .join(&first.artifact_paths.swarm_rounds[0])
                .exists()
        );
        assert!(first.summary_markdown.contains("Source artifacts"));
    }

    #[tokio::test]
    async fn rejects_empty_item_batches() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ExternalSwarmService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let mut request = sample_request(1);
        request.items.clear();

        let error = service
            .create_or_get(request)
            .await
            .expect_err("empty request should fail");
        assert!(matches!(error, ExternalSwarmError::InvalidRequest(_)));
    }

    fn sample_request(item_count: usize) -> ExternalSwarmInferenceRequest {
        ExternalSwarmInferenceRequest {
            client_request_id: Some("framework-run-001".to_string()),
            domain: "market-impact".to_string(),
            title: "Five current items".to_string(),
            summary: "Infer cross-item impact without fabricating source material.".to_string(),
            items: (0..item_count)
                .map(|index| ExternalSwarmItem {
                    id: Some(format!("news-{index}")),
                    title: format!("Source headline {index}"),
                    content: format!("Current source content {index} with concrete evidence."),
                    published_at: Some("2026-06-01T00:00:00Z".to_string()),
                    source: Some("framework".to_string()),
                    url: Some(format!("https://example.invalid/{index}")),
                    metadata: BTreeMap::from([(
                        "rank".to_string(),
                        serde_json::Value::from(index),
                    )]),
                })
                .collect(),
            questions: vec![
                "What impacts are plausible?".to_string(),
                "What uncertainty remains?".to_string(),
            ],
            rounds: 1,
        }
    }
}
