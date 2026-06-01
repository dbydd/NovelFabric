use std::{collections::BTreeMap, fmt::Write as _, path::Path, sync::Arc};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    config::{LlmConfigService, LlmSettingsError},
    llm::{ChatMessage, LlmError, complete_chat},
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
    #[serde(default)]
    pub context: Option<ExternalSwarmContext>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ExternalSwarmContext {
    #[serde(default)]
    pub entity_cards: Vec<ExternalEntityCard>,
    pub background: Option<String>,
    pub worldview: Option<String>,
    #[serde(default)]
    pub research_notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalEntityCard {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalContextRequirement {
    pub key: String,
    pub label: String,
    pub question: String,
    pub required: bool,
    pub suggested_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalContextRequirementsResponse {
    pub domain: String,
    pub title: String,
    pub requirements: Vec<ExternalContextRequirement>,
    pub missing_required_keys: Vec<String>,
    pub is_ready: bool,
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
    pub context_requirements: ExternalContextRequirementsResponse,
    pub role_reasoning: Vec<ExternalRoleReasoning>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSwarmArtifacts {
    pub manifest: String,
    pub report: String,
    pub input_items: Vec<String>,
    pub session: String,
    pub swarm_rounds: Vec<String>,
    pub context: Option<String>,
    pub role_reasoning: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalRoleReasoning {
    pub role: String,
    pub model: Option<String>,
    pub status: String,
    pub output_path: String,
    pub summary: String,
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
    LlmSettings(#[from] LlmSettingsError),
    #[error(transparent)]
    Llm(#[from] LlmError),
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

    #[allow(clippy::too_many_lines)]
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

        let context_requirements = analyze_context_requirements(&request);
        let item_artifacts = self
            .write_input_items(&project_slug, &inference_id, &request.items)
            .await?;
        let context_path = self
            .write_context_artifact(
                &project_slug,
                &inference_id,
                &request,
                &context_requirements,
            )
            .await?;
        let role_reasoning = self
            .run_role_reasoning(
                &project_slug,
                &inference_id,
                &request,
                &item_artifacts,
                &context_requirements,
            )
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
                context: Some(context_path),
                role_reasoning: role_reasoning
                    .iter()
                    .map(|reasoning| reasoning.output_path.clone())
                    .collect(),
            },
            summary_markdown,
            context_requirements,
            role_reasoning,
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

    async fn write_context_artifact(
        &self,
        project_slug: &str,
        inference_id: &str,
        request: &ExternalSwarmInferenceRequest,
        requirements: &ExternalContextRequirementsResponse,
    ) -> Result<String, ExternalSwarmError> {
        let path = project_context_path(project_slug, inference_id);
        self.storage
            .write_text(
                Path::new(&path),
                &render_context_markdown(request, requirements),
            )
            .await?;
        Ok(path)
    }

    async fn run_role_reasoning(
        &self,
        project_slug: &str,
        inference_id: &str,
        request: &ExternalSwarmInferenceRequest,
        artifacts: &[InputArtifact],
        requirements: &ExternalContextRequirementsResponse,
    ) -> Result<Vec<ExternalRoleReasoning>, ExternalSwarmError> {
        let roles = [
            "entity-analyst",
            "world-context-analyst",
            "impact-analyst",
            "risk-auditor",
        ];
        let llm_config = LlmConfigService::new(Arc::clone(&self.storage))
            .load_resolved("external-swarm")
            .await?;
        let mut outputs = Vec::with_capacity(roles.len());
        for role in roles {
            let output = match &llm_config {
                Some(config) => {
                    let model = Some(config.model.clone());
                    match complete_chat(
                        config,
                        role_messages(role, request, artifacts, requirements),
                    )
                    .await
                    {
                        Ok(text) => (model, "llm_succeeded".to_string(), text),
                        Err(error) => (
                            model,
                            "llm_failed_fallback".to_string(),
                            fallback_role_reasoning(
                                role,
                                request,
                                artifacts,
                                requirements,
                                Some(&error.to_string()),
                            ),
                        ),
                    }
                }
                None => (
                    None,
                    "llm_not_configured_fallback".to_string(),
                    fallback_role_reasoning(role, request, artifacts, requirements, None),
                ),
            };
            let output_path = project_role_reasoning_path(project_slug, inference_id, role);
            let body =
                render_role_reasoning_markdown(role, output.0.as_deref(), &output.1, &output.2);
            self.storage
                .write_text(Path::new(&output_path), &body)
                .await?;
            outputs.push(ExternalRoleReasoning {
                role: role.to_string(),
                model: output.0,
                status: output.1,
                output_path,
                summary: output.2,
            });
        }
        Ok(outputs)
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

#[must_use]
pub fn analyze_context_requirements(
    request: &ExternalSwarmInferenceRequest,
) -> ExternalContextRequirementsResponse {
    let context = request.context.as_ref();
    let has_entity_cards = context.is_some_and(|ctx| !ctx.entity_cards.is_empty());
    let has_background = context
        .and_then(|ctx| ctx.background.as_deref())
        .is_some_and(|value| !value.trim().is_empty());
    let has_worldview = context
        .and_then(|ctx| ctx.worldview.as_deref())
        .is_some_and(|value| !value.trim().is_empty());
    let has_research_notes = context.is_some_and(|ctx| !ctx.research_notes.is_empty());
    let mut requirements = vec![
        ExternalContextRequirement {
            key: "entity_cards".to_string(),
            label: "人物/公司/组织卡".to_string(),
            question: "请提供这次推演涉及的公司、人物、组织或资产卡：它是谁、业务/角色、利益暴露、已知风险、证据来源。".to_string(),
            required: true,
            suggested_sources: vec!["OpenAlice market/news tools".to_string(), "company filings or profile tools".to_string()],
        },
        ExternalContextRequirement {
            key: "background".to_string(),
            label: "背景设定".to_string(),
            question: "请提供主体 agent 查到的背景设定：为什么这些新闻要放在同一场景里推演、近期上下文、关键因果假设。".to_string(),
            required: true,
            suggested_sources: vec!["OpenAlice news archive".to_string(), "market data context".to_string()],
        },
        ExternalContextRequirement {
            key: "worldview".to_string(),
            label: "世界观/市场机制".to_string(),
            question: "请提供推演世界观：市场机制、政策/地缘/行业约束、哪些规则在这个场景里必须保持一致。".to_string(),
            required: false,
            suggested_sources: vec!["Alice macro/economy tools".to_string(), "agent research notes".to_string()],
        },
        ExternalContextRequirement {
            key: "research_notes".to_string(),
            label: "主体 agent 研究笔记".to_string(),
            question: "请提供 Alice 主体 agent 已经整理的研究笔记、疑点、需要 NovelFabric 重点检验的假设。".to_string(),
            required: false,
            suggested_sources: vec!["workspace markdown notes".to_string(), "inbox/user instructions".to_string()],
        },
    ];
    requirements.retain(|requirement| match requirement.key.as_str() {
        "entity_cards" => !has_entity_cards,
        "background" => !has_background,
        "worldview" => !has_worldview,
        "research_notes" => !has_research_notes,
        _ => true,
    });
    let missing_required_keys = requirements
        .iter()
        .filter(|requirement| requirement.required)
        .map(|requirement| requirement.key.clone())
        .collect::<Vec<_>>();
    ExternalContextRequirementsResponse {
        domain: request.domain.clone(),
        title: request.title.clone(),
        requirements,
        is_ready: missing_required_keys.is_empty(),
        missing_required_keys,
    }
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
    if let Some(client_request_id) = request.client_request_id.as_deref() {
        let slug = slugify(client_request_id);
        let hash = stable_hash(&format!("{}:{client_request_id}", request.domain));
        return format!("external-{slug}-{hash:08x}");
    }

    let slug = slugify(&request.title);
    let request_fingerprint = serde_json::to_string(request).unwrap_or_else(|_| {
        format!(
            "{}:{}:{}",
            request.domain,
            request.title,
            request.items.len()
        )
    });
    let hash = stable_hash(&request_fingerprint);
    format!("external-{slug}-{hash:08x}")
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
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

fn role_messages(
    role: &str,
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
    requirements: &ExternalContextRequirementsResponse,
) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You are NovelFabric role `{role}`. Think as a constrained text agent. Cite artifact paths. Separate evidence from speculation. Return concise markdown."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: render_reasoning_prompt(role, request, artifacts, requirements),
        },
    ]
}

fn render_reasoning_prompt(
    role: &str,
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
    requirements: &ExternalContextRequirementsResponse,
) -> String {
    format!(
        "# Scenario\nDomain: {}\nTitle: {}\nSummary: {}\n\n# Role\n{}\n\n# Questions\n{}\n\n# Context\n{}\n\n# Missing context requests\n{}\n\n# Source artifacts\n{}\n",
        request.domain,
        request.title,
        request.summary,
        role,
        request.questions.join("\n- "),
        render_context_block(request.context.as_ref()),
        requirements
            .requirements
            .iter()
            .map(|requirement| format!("- {}: {}", requirement.key, requirement.question))
            .collect::<Vec<_>>()
            .join("\n"),
        artifacts
            .iter()
            .map(|artifact| format!("- {}: {}", artifact.path, artifact.title))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn fallback_role_reasoning(
    role: &str,
    request: &ExternalSwarmInferenceRequest,
    artifacts: &[InputArtifact],
    requirements: &ExternalContextRequirementsResponse,
    error: Option<&str>,
) -> String {
    let mut text = format!(
        "# {role} fallback reasoning\n\nLLM role reasoning is unavailable{}; deterministic scaffold reasoning is provided.\n\n",
        error.map_or(String::new(), |value| format!(" ({value})"))
    );
    let _ = writeln!(text, "Scenario: {} / {}", request.domain, request.title);
    let _ = writeln!(text, "Items considered: {}", artifacts.len());
    if !requirements.is_ready {
        text.push_str("\n## Ask Alice for more context\n");
        for requirement in &requirements.requirements {
            let _ = writeln!(text, "- {}: {}", requirement.label, requirement.question);
        }
    }
    text.push_str("\n## Evidence artifacts\n");
    for artifact in artifacts {
        let _ = writeln!(text, "- `{}` — {}", artifact.path, artifact.title);
    }
    text
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

fn render_context_block(context: Option<&ExternalSwarmContext>) -> String {
    let Some(context) = context else {
        return "No caller-provided context yet.".to_string();
    };
    let mut text = String::new();
    if !context.entity_cards.is_empty() {
        text.push_str("## Entity cards\n");
        for card in &context.entity_cards {
            let _ = writeln!(
                text,
                "- {} ({}, id={}): {} Evidence: {}",
                card.name,
                card.kind,
                card.id,
                card.summary,
                card.evidence.join(", ")
            );
        }
    }
    if let Some(background) = &context.background {
        let _ = writeln!(text, "\n## Background\n{background}");
    }
    if let Some(worldview) = &context.worldview {
        let _ = writeln!(text, "\n## Worldview\n{worldview}");
    }
    if !context.research_notes.is_empty() {
        text.push_str("\n## Research notes\n");
        for note in &context.research_notes {
            let _ = writeln!(text, "- {note}");
        }
    }
    if text.trim().is_empty() {
        "No caller-provided context yet.".to_string()
    } else {
        text
    }
}

fn render_context_markdown(
    request: &ExternalSwarmInferenceRequest,
    requirements: &ExternalContextRequirementsResponse,
) -> String {
    let mut text = format!(
        "# External inference context\n\n- Domain: `{}`\n- Title: {}\n- Ready: {}\n\n",
        request.domain, request.title, requirements.is_ready
    );
    text.push_str("## Provided context\n\n");
    text.push_str(&render_context_block(request.context.as_ref()));
    if !requirements.requirements.is_empty() {
        text.push_str("\n## Context NovelFabric asks Alice to provide\n");
        for requirement in &requirements.requirements {
            let _ = writeln!(
                text,
                "- **{}** (`{}`): {}",
                requirement.label, requirement.key, requirement.question
            );
        }
    }
    text
}

fn render_role_reasoning_markdown(
    role: &str,
    model: Option<&str>,
    status: &str,
    output: &str,
) -> String {
    format!(
        "# Role reasoning: {role}\n\n- Status: `{status}`\n- Model: `{}`\n\n{}\n",
        model.unwrap_or("n/a"),
        output
    )
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
    report.push_str("\n## Context status\n\n");
    let requirements = analyze_context_requirements(request);
    if requirements.is_ready {
        report.push_str("Provided context satisfies required NovelFabric context gates.\n");
    } else {
        report.push_str(
            "NovelFabric asked Alice for more context before/while running this inference:\n",
        );
        for requirement in &requirements.requirements {
            let _ = writeln!(report, "- {}: {}", requirement.label, requirement.question);
        }
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

fn project_context_path(project_slug: &str, inference_id: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/external/context/{inference_id}.md")
}

fn project_role_reasoning_path(project_slug: &str, inference_id: &str, role: &str) -> String {
    format!("{PROJECTS_DIR}/{project_slug}/external/role-reasoning/{inference_id}/{role}.md")
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
    use std::collections::BTreeMap;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn build_inference_id_differs_without_client_request_id() {
        let mut first = sample_request(5);
        first.client_request_id = None;
        first.title = "Daily market brief A".to_string();
        first.summary = "Summary A".to_string();
        let mut second = first.clone();
        second.summary = "Summary B".to_string();
        second.items[0].content = "Different body".to_string();

        assert_ne!(build_inference_id(&first), build_inference_id(&second));
    }

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
            context: None,
            rounds: 1,
        }
    }
}
