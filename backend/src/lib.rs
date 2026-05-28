#![forbid(unsafe_code)]

pub mod agent_output;
pub mod agents;
pub mod cards;
pub mod config;
pub mod import;
pub mod llm;
pub mod memory;
pub mod project;
pub mod report;
pub mod runtime;
pub mod simulation;
pub mod storage;
pub mod story_graph;
pub mod story_rag;
pub mod swarm;
pub mod timeline;
pub mod writing;

use std::{fmt, net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State},
    http::{Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::net::TcpListener;
use tower_http::{
    cors::{Any, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::info_span;
use tracing_subscriber as _;

use crate::{
    agents::{
        AgentAssetRecord, AgentAssetService, AgentSkillRecord, AgentSummary,
        UpdateAgentAssetRequest, UpsertAgentSkillRequest,
    },
    cards::{CardKind, CardRecord, CardService, CreateCardRequest, UpdateCardRequest},
    config::{
        LlmConfigService, LlmEndpointConfig, LlmRoleConfig, LlmRolesConfig, LlmSettingsError,
    },
    import::{ImportRecord, ImportService, ImportTxtRequest},
    llm::{ChatMessage, LlmApiStyle, LlmError, complete_chat},
    memory::{
        CreateMemoryEntryRequest, MemoryEntry, MemoryEntrySummary, MemoryScope, MemoryService,
        UpdateMemoryEntryRequest,
    },
    project::{CreateProjectRequest, ProjectRecord, ProjectService},
    report::{
        CreateBranchImpactReportRequest, CreateConsistencyReportRequest, CreateInterviewRequest,
        CreateSimulationReportRequest, CreateWritingPrewriteReportRequest, InterviewRecord,
        ReportKind, ReportRecord, ReportService, ReportSummary,
    },
    runtime::{
        AgentRuntimeExecuteRequest, AgentRuntimeExecution, AgentRuntimeGlobRequest,
        AgentRuntimePatchRequest, AgentRuntimeReadRequest, AgentRuntimeService,
    },
    simulation::{
        AdvanceRoundRequest, CharacterAction, CreateCharacterRequest, CreateSessionRequest,
        PossessCharacterRequest, SimulationRole, SimulationService, SimulationSession,
    },
    storage::Storage,
    story_graph::{
        StoryGraphEdge, StoryGraphEpisode, StoryGraphNode, StoryGraphRebuildOutput,
        StoryGraphService,
    },
    story_rag::{InsightForgeOutput, PanoramaSearchOutput, QuickSearchOutput, StoryRagService},
    swarm::SwarmTurnRecord,
    timeline::{
        BranchRecord, CreateBranchRequest, CreateTimepointRequest, TimelineService,
        TimepointRecord, UpdateBranchRequest,
    },
    writing::{
        BranchHistoricalChapterRequest, ChapterRecord, ChapterSummary, CreateChapterRequest,
        CreateReviewNoteRequest, UpdateChapterRequest, WritingBranchRecord, WritingService,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationConfig {
    pub server: ServerConfig,
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerConfig {
    pub bind_address: SocketAddr,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind_address: SocketAddr::from(([127, 0, 0, 1], 50000)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: ApplicationConfig,
    pub storage: Arc<Storage>,
    pub projects: ProjectService,
    pub imports: ImportService,
    pub reports: ReportService,
    pub agents: AgentAssetService,
    pub cards: CardService,
    pub memory: MemoryService,
    pub timeline: TimelineService,
    pub simulation: SimulationService,
    pub writing: WritingService,
    pub runtime: AgentRuntimeService,
    pub story_graph: StoryGraphService,
    pub story_rag: StoryRagService,
}

impl AppState {
    #[must_use]
    pub fn new(config: ApplicationConfig) -> Self {
        let storage = Arc::new(Storage::new(config.data_dir.clone()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));
        let reports = ReportService::new(Arc::clone(&storage));
        let agents = AgentAssetService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let memory = MemoryService::new(Arc::clone(&storage));
        let timeline = TimelineService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        let runtime = AgentRuntimeService::new(Arc::clone(&storage));
        let story_graph = StoryGraphService::new(Arc::clone(&storage));
        let story_rag = StoryRagService::new(Arc::clone(&storage));
        Self {
            config,
            storage,
            projects,
            imports,
            reports,
            agents,
            cards,
            memory,
            timeline,
            simulation,
            writing,
            runtime,
            story_graph,
            story_rag,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthPayload {
    pub status: String,
    pub service: String,
}

#[allow(clippy::too_many_lines)]
pub fn app(config: ApplicationConfig) -> Router {
    let state = AppState::new(config);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health_handler))
        .route(
            "/api/projects",
            get(list_projects_handler).post(create_project_handler),
        )
        .route(
            "/api/projects/{slug}",
            get(get_project_handler).delete(delete_project_handler),
        )
        .route("/api/projects/{slug}/import", post(import_txt_handler))
        .route("/api/projects/{slug}/agents", get(list_agents_handler))
        .route(
            "/api/projects/{slug}/agents/{agent_id}",
            get(get_agent_handler).put(update_agent_handler),
        )
        .route(
            "/api/projects/{slug}/agents/{agent_id}/skills/{skill_file}",
            get(get_agent_skill_handler)
                .post(upsert_agent_skill_handler)
                .delete(delete_agent_skill_handler),
        )
        .route(
            "/api/projects/{slug}/cards",
            get(list_cards_handler).post(create_card_handler),
        )
        .route(
            "/api/projects/{slug}/cards/{kind}/{card_id}",
            get(get_card_handler)
                .put(update_card_handler)
                .delete(delete_card_handler),
        )
        .route(
            "/api/projects/{slug}/memory",
            get(list_memory_handler).post(create_memory_handler),
        )
        .route(
            "/api/projects/{slug}/memory/{scope_kind}/{scope_id}/{timeline}/{timepoint}/{key}",
            get(get_memory_handler)
                .put(update_memory_handler)
                .delete(delete_memory_handler),
        )
        .route(
            "/api/projects/{slug}/timeline/timepoints",
            get(list_timepoints_handler).post(create_timepoint_handler),
        )
        .route(
            "/api/projects/{slug}/timeline/branches",
            get(list_branches_handler).post(create_branch_handler),
        )
        .route(
            "/api/projects/{slug}/timeline/branches/{branch_id}",
            get(get_branch_handler).put(update_branch_handler),
        )
        .route(
            "/api/projects/{slug}/writing/chapters",
            get(list_chapters_handler).post(create_chapter_handler),
        )
        .route(
            "/api/projects/{slug}/writing/chapters/{chapter_id}",
            get(get_chapter_handler).put(update_chapter_handler),
        )
        .route(
            "/api/projects/{slug}/writing/chapters/{chapter_id}/review-notes",
            post(create_review_note_handler),
        )
        .route(
            "/api/projects/{slug}/writing/branches",
            post(create_writing_branch_handler),
        )
        .route(
            "/api/projects/{slug}/runtime/read",
            post(runtime_read_handler),
        )
        .route(
            "/api/projects/{slug}/runtime/glob",
            post(runtime_glob_handler),
        )
        .route(
            "/api/projects/{slug}/runtime/patch",
            post(runtime_patch_handler),
        )
        .route(
            "/api/projects/{slug}/runtime/execute",
            post(runtime_execute_handler),
        )
        .route(
            "/api/projects/{slug}/knowledge/rebuild",
            post(rebuild_story_graph_handler),
        )
        .route(
            "/api/projects/{slug}/knowledge/graph/nodes",
            get(list_story_graph_nodes_handler),
        )
        .route(
            "/api/projects/{slug}/knowledge/graph/edges",
            get(list_story_graph_edges_handler),
        )
        .route(
            "/api/projects/{slug}/knowledge/graph/episodes",
            get(list_story_graph_episodes_handler),
        )
        .route(
            "/api/projects/{slug}/rag/quick",
            get(quick_story_rag_handler),
        )
        .route(
            "/api/projects/{slug}/rag/panorama",
            get(panorama_story_rag_handler),
        )
        .route(
            "/api/projects/{slug}/rag/insight",
            get(insight_story_rag_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/active-session",
            get(get_active_simulation_session_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions",
            post(create_simulation_session_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}",
            get(get_simulation_session_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}/swarm/{round}",
            get(get_simulation_swarm_round_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}/advance",
            post(advance_simulation_session_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}/possess",
            post(possess_character_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}/interview",
            post(create_interview_handler),
        )
        .route(
            "/api/config/llm-endpoint",
            get(get_llm_endpoint_handler).put(put_llm_endpoint_handler),
        )
        .route(
            "/api/config/llm-settings",
            get(get_llm_endpoint_handler).put(put_llm_endpoint_handler),
        )
        .route(
            "/api/config/llm-healthcheck",
            post(post_llm_healthcheck_handler),
        )
        .route("/api/config/llm-roles", get(list_llm_roles_handler))
        .route(
            "/api/config/llm-roles/{role_id}",
            get(get_llm_role_handler)
                .put(put_llm_role_handler)
                .delete(delete_llm_role_handler),
        )
        .route("/api/projects/{slug}/reports", get(list_reports_handler))
        .route(
            "/api/projects/{slug}/reports/simulation",
            post(create_simulation_report_handler),
        )
        .route(
            "/api/projects/{slug}/reports/consistency",
            post(create_consistency_report_handler),
        )
        .route(
            "/api/projects/{slug}/reports/branch-impact",
            post(create_branch_impact_report_handler),
        )
        .route(
            "/api/projects/{slug}/reports/writing-prewrite",
            post(create_writing_prewrite_report_handler),
        )
        .route(
            "/api/projects/{slug}/reports/{kind}/{id}",
            get(get_report_handler),
        )
        .layer(cors)
        .with_state(state)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<Body>| {
                info_span!(
                    "http_request",
                    method = %request.method(),
                    uri = %request.uri(),
                    version = ?request.version()
                )
            }),
        )
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
}

pub async fn run(listener: TcpListener, config: ApplicationConfig) -> Result<(), std::io::Error> {
    let address = listener.local_addr()?;
    tracing::info!(%address, "starting NovelFabric backend server");

    axum::serve(listener, app(config))
        .with_graceful_shutdown(shutdown_signal())
        .await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!(%error, "failed to install Ctrl+C handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::warn!(%error, "failed to install SIGTERM handler");
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }

    tracing::info!("shutdown signal received");
}

async fn get_llm_endpoint_handler(
    State(state): State<AppState>,
) -> Result<Json<LlmEndpointConfig>, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    match service.load_endpoint().await {
        Ok(Some(endpoint)) => Ok(Json(endpoint)),
        Ok(None) => Err(AppError::NotFound),
        Err(LlmSettingsError::Storage(_) | LlmSettingsError::Invalid(_)) => Err(AppError::Internal),
    }
}

async fn put_llm_endpoint_handler(
    State(state): State<AppState>,
    Json(body): Json<LlmEndpointConfig>,
) -> Result<Json<LlmEndpointConfig>, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    let saved = service
        .save_endpoint(body)
        .await
        .map_err(|error| match error {
            LlmSettingsError::Invalid(msg) => AppError::BadRequest(msg),
            LlmSettingsError::Storage(_) => AppError::Internal,
        })?;
    Ok(Json(saved))
}

async fn list_llm_roles_handler(
    State(state): State<AppState>,
) -> Result<Json<LlmRolesConfig>, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    service
        .load_roles()
        .await
        .map(Json)
        .map_err(|error| match error {
            LlmSettingsError::Invalid(msg) => AppError::BadRequest(msg),
            LlmSettingsError::Storage(_) => AppError::Internal,
        })
}

async fn get_llm_role_handler(
    State(state): State<AppState>,
    AxumPath(role_id): AxumPath<String>,
) -> Result<Json<LlmRoleConfig>, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    match service.load_role(&role_id).await {
        Ok(Some(role)) => Ok(Json(role)),
        Ok(None) => Err(AppError::NotFound),
        Err(LlmSettingsError::Invalid(msg)) => Err(AppError::BadRequest(msg)),
        Err(LlmSettingsError::Storage(_)) => Err(AppError::Internal),
    }
}

async fn put_llm_role_handler(
    State(state): State<AppState>,
    AxumPath(role_id): AxumPath<String>,
    Json(body): Json<LlmRoleConfig>,
) -> Result<Json<LlmRoleConfig>, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    service
        .save_role(&role_id, body)
        .await
        .map(Json)
        .map_err(|error| match error {
            LlmSettingsError::Invalid(msg) => AppError::BadRequest(msg),
            LlmSettingsError::Storage(_) => AppError::Internal,
        })
}

async fn delete_llm_role_handler(
    State(state): State<AppState>,
    AxumPath(role_id): AxumPath<String>,
) -> Result<StatusCode, AppError> {
    let service = LlmConfigService::new(Arc::clone(&state.storage));
    service
        .delete_role(&role_id)
        .await
        .map_err(|error| match error {
            LlmSettingsError::Invalid(msg) => AppError::BadRequest(msg),
            LlmSettingsError::Storage(_) => AppError::Internal,
        })?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct LlmHealthcheckRequest {
    pub role_id: Option<String>,
    pub endpoint: Option<LlmEndpointConfig>,
    pub role: Option<LlmRoleConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmHealthcheckPayload {
    pub ok: bool,
    pub role_id: String,
    pub provider: String,
    pub model: String,
    pub api_style: LlmApiStyle,
    pub latency_ms: u128,
    pub provider_status: Option<u16>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub response_preview: Option<String>,
}

async fn post_llm_healthcheck_handler(
    State(state): State<AppState>,
    Json(body): Json<LlmHealthcheckRequest>,
) -> Result<Json<LlmHealthcheckPayload>, AppError> {
    let payload = run_llm_healthcheck(Arc::clone(&state.storage), body).await;
    Ok(Json(payload))
}

async fn run_llm_healthcheck(
    storage: Arc<Storage>,
    request: LlmHealthcheckRequest,
) -> LlmHealthcheckPayload {
    let role_id = request.role_id.unwrap_or_else(|| "default".to_string());
    let started = std::time::Instant::now();
    let service = LlmConfigService::new(storage);
    let endpoint =
        match resolve_healthcheck_endpoint(&service, request.endpoint, &role_id, started).await {
            Ok(endpoint) => endpoint,
            Err(payload) => return payload,
        };
    let role = match resolve_healthcheck_role(&service, request.role, &role_id, &endpoint, started)
        .await
    {
        Ok(role) => role,
        Err(payload) => return payload,
    };
    execute_llm_healthcheck(role_id, endpoint, role, started).await
}

async fn resolve_healthcheck_endpoint(
    service: &LlmConfigService,
    request_endpoint: Option<LlmEndpointConfig>,
    role_id: &str,
    started: std::time::Instant,
) -> Result<LlmEndpointConfig, LlmHealthcheckPayload> {
    if let Some(endpoint) = request_endpoint {
        return Ok(endpoint);
    }
    match service.load_endpoint().await {
        Ok(Some(endpoint)) => Ok(endpoint),
        Ok(None) => Err(failed_healthcheck(
            role_id.to_string(),
            String::new(),
            String::new(),
            LlmApiStyle::OpenAiChatCompletions,
            started,
            None,
            "missing_config",
            "LLM endpoint / key is not configured. Save Endpoint / Key before testing.",
        )),
        Err(error) => Err(failed_healthcheck(
            role_id.to_string(),
            String::new(),
            String::new(),
            LlmApiStyle::OpenAiChatCompletions,
            started,
            None,
            "config_error",
            &error.to_string(),
        )),
    }
}

async fn resolve_healthcheck_role(
    service: &LlmConfigService,
    request_role: Option<LlmRoleConfig>,
    role_id: &str,
    endpoint: &LlmEndpointConfig,
    started: std::time::Instant,
) -> Result<LlmRoleConfig, LlmHealthcheckPayload> {
    if let Some(mut role) = request_role {
        role.role_id.clone_from(&role_id.to_string());
        return Ok(role);
    }
    match service.load_role(role_id).await {
        Ok(Some(role)) => Ok(role),
        Ok(None) => Ok(load_default_healthcheck_role(service).await),
        Err(error) => Err(failed_healthcheck(
            role_id.to_string(),
            endpoint.provider.clone(),
            String::new(),
            endpoint.api_style.clone(),
            started,
            None,
            "config_error",
            &error.to_string(),
        )),
    }
}

async fn load_default_healthcheck_role(service: &LlmConfigService) -> LlmRoleConfig {
    match service.load_role("default").await {
        Ok(Some(role)) => role,
        Ok(None) | Err(_) => LlmRoleConfig {
            role_id: "default".to_string(),
            model: crate::config::DEFAULT_LLM_MODEL.to_string(),
            api_style: None,
        },
    }
}

async fn execute_llm_healthcheck(
    role_id: String,
    endpoint: LlmEndpointConfig,
    role: LlmRoleConfig,
    started: std::time::Instant,
) -> LlmHealthcheckPayload {
    let config = crate::llm::LlmConfig {
        base_url: endpoint.base_url,
        api_key: endpoint.api_key,
        model: role.model.clone(),
        api_style: role
            .api_style
            .clone()
            .unwrap_or_else(|| endpoint.api_style.clone()),
    };
    match complete_chat(&config, healthcheck_messages()).await {
        Ok(response) => LlmHealthcheckPayload {
            ok: true,
            role_id,
            provider: endpoint.provider,
            model: role.model,
            api_style: config.api_style,
            latency_ms: started.elapsed().as_millis(),
            provider_status: None,
            error_kind: None,
            error_message: None,
            response_preview: Some(truncate_for_healthcheck(&response)),
        },
        Err(error) => {
            let (status, kind, message) = classify_llm_error(error);
            failed_healthcheck(
                role_id,
                endpoint.provider,
                role.model,
                config.api_style,
                started,
                status,
                kind,
                &message,
            )
        }
    }
}

fn healthcheck_messages() -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: "You are a NovelFabric LLM healthcheck. Reply with a short OK sentence."
                .to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: "Return: NovelFabric LLM healthcheck OK".to_string(),
        },
    ]
}

#[allow(clippy::too_many_arguments)]
fn failed_healthcheck(
    role_id: String,
    provider: String,
    model: String,
    api_style: LlmApiStyle,
    started: std::time::Instant,
    provider_status: Option<u16>,
    error_kind: &str,
    error_message: &str,
) -> LlmHealthcheckPayload {
    LlmHealthcheckPayload {
        ok: false,
        role_id,
        provider,
        model,
        api_style,
        latency_ms: started.elapsed().as_millis(),
        provider_status,
        error_kind: Some(error_kind.to_string()),
        error_message: Some(error_message.to_string()),
        response_preview: None,
    }
}

fn classify_llm_error(error: LlmError) -> (Option<u16>, &'static str, String) {
    match error {
        LlmError::Http(error) => {
            if error.is_timeout() {
                (None, "timeout", error.to_string())
            } else if error.is_connect() {
                (None, "network", error.to_string())
            } else {
                (None, "http", error.to_string())
            }
        }
        LlmError::Json(error) => (None, "schema_parse", error.to_string()),
        LlmError::EmptyChoice => (
            None,
            "empty_response",
            "provider returned no assistant text".to_string(),
        ),
        LlmError::ProviderStatus { status, body } => {
            let kind = if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
                "auth"
            } else if status.is_server_error() {
                "provider_5xx"
            } else if status == StatusCode::NOT_FOUND || body.to_ascii_lowercase().contains("model")
            {
                "model_not_found"
            } else if status == StatusCode::TOO_MANY_REQUESTS {
                "rate_limit"
            } else {
                "provider_status"
            };
            (Some(status.as_u16()), kind, body)
        }
    }
}

fn truncate_for_healthcheck(text: &str) -> String {
    const MAX_CHARS: usize = 180;
    let mut out = text.chars().take(MAX_CHARS).collect::<String>();
    if text.chars().count() > MAX_CHARS {
        out.push('…');
    }
    out
}

async fn health_handler(State(state): State<AppState>) -> Result<Json<HealthPayload>, AppError> {
    let _ = state.config.server.bind_address;

    Ok(Json(HealthPayload {
        status: String::from("ok"),
        service: String::from("novelfabric-backend"),
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectBody {
    pub slug: String,
    pub title: String,
    pub description: String,
}

async fn create_project_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<ProjectRecord>, AppError> {
    let record = state
        .projects
        .create(CreateProjectRequest {
            slug: body.slug,
            title: body.title,
            description: body.description,
        })
        .await
        .map_err(|error| match error {
            crate::project::ProjectError::AlreadyExists(slug) => {
                AppError::Conflict(format!("project already exists: {slug}"))
            }
            crate::project::ProjectError::InvalidSlug(slug) => {
                AppError::BadRequest(format!("invalid slug: {slug}"))
            }
            _ => AppError::Internal,
        })?;
    Ok(Json(record))
}

async fn list_projects_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectRecord>>, AppError> {
    let projects = state
        .projects
        .list()
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(projects))
}

async fn delete_project_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<ProjectRecord>, AppError> {
    let project = state
        .projects
        .get(&slug)
        .await
        .map_err(|error| match error {
            crate::project::ProjectError::NotFound(_) => AppError::NotFound,
            _ => AppError::Internal,
        })?;
    state
        .projects
        .delete(&slug)
        .await
        .map_err(|error| match error {
            crate::project::ProjectError::NotFound(_) => AppError::NotFound,
            crate::project::ProjectError::InvalidSlug(slug) => AppError::BadRequest(slug),
            _ => AppError::Internal,
        })?;
    Ok(Json(project))
}

async fn get_project_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<ProjectRecord>, AppError> {
    let record = state
        .projects
        .get(&slug)
        .await
        .map_err(|error| match error {
            crate::project::ProjectError::NotFound(_) => AppError::NotFound,
            _ => AppError::Internal,
        })?;
    Ok(Json(record))
}

async fn import_txt_handler(
    State(state): State<AppState>,
    AxumPath(project_slug): AxumPath<String>,
    mut multipart: Multipart,
) -> Result<Json<ImportRecord>, AppError> {
    let mut source_name = None;
    let mut raw_bytes = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::BadRequest(format!("multipart error: {error}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|error| AppError::BadRequest(format!("read error: {error}")))?;
        if name == "file" {
            raw_bytes = Some(data.to_vec());
        } else if name == "sourceName" {
            source_name = Some(String::from_utf8_lossy(&data).to_string());
        }
    }

    let raw_bytes =
        raw_bytes.ok_or_else(|| AppError::BadRequest("missing file field".to_string()))?;
    let source_name = source_name.unwrap_or_else(|| "imported.txt".to_string());
    let import_id = slugify(&source_name);

    let record = state
        .imports
        .import_txt(ImportTxtRequest {
            project_slug,
            import_id,
            source_name,
            raw_bytes,
        })
        .await
        .map_err(|error| {
            tracing::error!(%error, "import failed");
            AppError::Internal
        })?;
    Ok(Json(record))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAssetBody {
    pub soul: String,
    pub memory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSkillBody {
    pub body: String,
}

async fn list_agents_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<AgentSummary>>, AppError> {
    let agents = state.agents.list(&slug).await.map_err(map_agent_error)?;
    Ok(Json(agents))
}

async fn get_agent_handler(
    State(state): State<AppState>,
    AxumPath((slug, agent_id)): AxumPath<(String, String)>,
) -> Result<Json<AgentAssetRecord>, AppError> {
    let agent = state
        .agents
        .get(&slug, &agent_id)
        .await
        .map_err(map_agent_error)?;
    Ok(Json(agent))
}

async fn update_agent_handler(
    State(state): State<AppState>,
    AxumPath((slug, agent_id)): AxumPath<(String, String)>,
    Json(body): Json<AgentAssetBody>,
) -> Result<Json<AgentAssetRecord>, AppError> {
    let agent = state
        .agents
        .update(
            &slug,
            &agent_id,
            UpdateAgentAssetRequest {
                soul: body.soul,
                memory: body.memory,
            },
        )
        .await
        .map_err(map_agent_error)?;
    Ok(Json(agent))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardBody {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryScopeQuery {
    pub scope: Option<String>,
    pub scope_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryBody {
    pub scope_kind: String,
    pub scope_id: Option<String>,
    pub key: String,
    pub title: String,
    pub timeline: String,
    pub timepoint: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimepointBody {
    pub id: String,
    pub sequence: u64,
    pub title: String,
    pub summary: String,
    pub branch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchBody {
    pub id: String,
    pub title: String,
    pub description: String,
    pub origin_timepoint_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateBranchBody {
    pub title: Option<String>,
    pub description: Option<String>,
    pub timepoint_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterBody {
    pub id: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateChapterBody {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewNoteBody {
    pub reviewer: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingBranchBody {
    pub source_chapter_id: String,
    pub branch_id: String,
    pub branch_title: String,
    pub branch_description: String,
    pub branch_reason: String,
    pub origin_timepoint_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationCharacterBody {
    pub character_id: String,
    pub display_name: String,
    pub agenda: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationSessionBody {
    pub session_id: String,
    pub timeline: String,
    pub timepoint_id: String,
    pub title: String,
    pub characters: Vec<SimulationCharacterBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterActionBody {
    pub character_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvanceSimulationBody {
    pub character_actions: Vec<CharacterActionBody>,
    pub random_event_directive: Option<String>,
    pub world_maintainer_directive: Option<String>,
    pub kp_directive: Option<String>,
    pub project_auditor_directive: Option<String>,
    pub auditor_concludes_session: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PossessBody {
    pub character_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationReportBody {
    pub session_id: String,
    pub round: u32,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewBody {
    pub agent_ids: Vec<String>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsistencyReportBody {
    pub session_id: String,
    pub round: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchImpactReportBody {
    pub branch_id: String,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingPrewriteReportBody {
    pub chapter_id: String,
    pub query: Option<String>,
}

async fn get_agent_skill_handler(
    State(state): State<AppState>,
    AxumPath((slug, agent_id, skill_file)): AxumPath<(String, String, String)>,
) -> Result<Json<AgentSkillRecord>, AppError> {
    let skill = state
        .agents
        .get_skill(&slug, &agent_id, &skill_file)
        .await
        .map_err(map_agent_error)?;
    Ok(Json(skill))
}

async fn upsert_agent_skill_handler(
    State(state): State<AppState>,
    AxumPath((slug, agent_id, skill_file)): AxumPath<(String, String, String)>,
    Json(body): Json<AgentSkillBody>,
) -> Result<Json<AgentAssetRecord>, AppError> {
    let agent = state
        .agents
        .upsert_skill(
            &slug,
            &agent_id,
            UpsertAgentSkillRequest {
                file_name: skill_file,
                body: body.body,
            },
        )
        .await
        .map_err(map_agent_error)?;
    Ok(Json(agent))
}

async fn delete_agent_skill_handler(
    State(state): State<AppState>,
    AxumPath((slug, agent_id, skill_file)): AxumPath<(String, String, String)>,
) -> Result<Json<AgentAssetRecord>, AppError> {
    let agent = state
        .agents
        .delete_skill(&slug, &agent_id, &skill_file)
        .await
        .map_err(map_agent_error)?;
    Ok(Json(agent))
}

async fn list_cards_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<CardRecord>>, AppError> {
    let mut cards = Vec::new();
    for kind in [CardKind::Character, CardKind::Rule, CardKind::World] {
        let mut entries = state
            .cards
            .list(&slug, kind)
            .await
            .map_err(map_card_error)?;
        cards.append(&mut entries);
    }
    Ok(Json(cards))
}

async fn create_card_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<CardBody>,
) -> Result<Json<CardRecord>, AppError> {
    let kind = parse_card_kind(&body.kind)?;
    let record = state
        .cards
        .create(CreateCardRequest {
            project_slug: slug,
            id: body.id,
            kind,
            title: body.title,
            body: body.body,
        })
        .await
        .map_err(map_card_error)?;
    Ok(Json(record))
}

async fn get_card_handler(
    State(state): State<AppState>,
    AxumPath((slug, kind, card_id)): AxumPath<(String, String, String)>,
) -> Result<Json<CardRecord>, AppError> {
    let record = state
        .cards
        .get(&slug, parse_card_kind(&kind)?, &card_id)
        .await
        .map_err(map_card_error)?;
    Ok(Json(record))
}

async fn update_card_handler(
    State(state): State<AppState>,
    AxumPath((slug, kind, card_id)): AxumPath<(String, String, String)>,
    Json(body): Json<CardBody>,
) -> Result<Json<CardRecord>, AppError> {
    let record = state
        .cards
        .update(UpdateCardRequest {
            project_slug: slug,
            id: card_id,
            kind: parse_card_kind(&kind)?,
            title: body.title,
            body: body.body,
        })
        .await
        .map_err(map_card_error)?;
    Ok(Json(record))
}

async fn delete_card_handler(
    State(state): State<AppState>,
    AxumPath((slug, kind, card_id)): AxumPath<(String, String, String)>,
) -> Result<Json<CardRecord>, AppError> {
    let record = state
        .cards
        .delete(&slug, parse_card_kind(&kind)?, &card_id)
        .await
        .map_err(map_card_error)?;
    Ok(Json(record))
}

async fn list_memory_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<MemoryScopeQuery>,
) -> Result<Json<Vec<MemoryEntrySummary>>, AppError> {
    let scope = parse_memory_scope(query.scope.as_deref(), query.scope_id.as_deref())?;
    let entries = state
        .memory
        .list(&slug, &scope)
        .await
        .map_err(map_memory_error)?;
    Ok(Json(entries))
}

async fn create_memory_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<MemoryBody>,
) -> Result<Json<MemoryEntry>, AppError> {
    let scope = parse_memory_scope(Some(&body.scope_kind), body.scope_id.as_deref())?;
    let record = state
        .memory
        .create(
            &slug,
            CreateMemoryEntryRequest {
                scope,
                key: body.key,
                title: body.title,
                timeline: body.timeline,
                timepoint: body.timepoint,
                body: body.body,
            },
        )
        .await
        .map_err(map_memory_error)?;
    Ok(Json(record))
}

async fn get_memory_handler(
    State(state): State<AppState>,
    AxumPath((slug, scope_kind, scope_id, timeline, timepoint, key)): AxumPath<(
        String,
        String,
        String,
        String,
        String,
        String,
    )>,
) -> Result<Json<MemoryEntry>, AppError> {
    let scope = parse_memory_scope_path(&scope_kind, &scope_id)?;
    let record = state
        .memory
        .get(&slug, &scope, &timeline, &timepoint, &key)
        .await
        .map_err(map_memory_error)?;
    Ok(Json(record))
}

async fn update_memory_handler(
    State(state): State<AppState>,
    AxumPath((slug, scope_kind, scope_id, timeline, timepoint, key)): AxumPath<(
        String,
        String,
        String,
        String,
        String,
        String,
    )>,
    Json(body): Json<MemoryBody>,
) -> Result<Json<MemoryEntry>, AppError> {
    let scope = parse_memory_scope_path(&scope_kind, &scope_id)?;
    let record = state
        .memory
        .update(
            &slug,
            &scope,
            &timeline,
            &timepoint,
            &key,
            UpdateMemoryEntryRequest {
                title: body.title,
                timeline: body.timeline,
                timepoint: body.timepoint,
                body: body.body,
            },
        )
        .await
        .map_err(map_memory_error)?;
    Ok(Json(record))
}

async fn delete_memory_handler(
    State(state): State<AppState>,
    AxumPath((slug, scope_kind, scope_id, timeline, timepoint, key)): AxumPath<(
        String,
        String,
        String,
        String,
        String,
        String,
    )>,
) -> Result<Json<MemoryEntry>, AppError> {
    let scope = parse_memory_scope_path(&scope_kind, &scope_id)?;
    let record = state
        .memory
        .delete(&slug, &scope, &timeline, &timepoint, &key)
        .await
        .map_err(map_memory_error)?;
    Ok(Json(record))
}

async fn list_timepoints_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<TimepointRecord>>, AppError> {
    let records = state
        .timeline
        .list_timepoints(&slug)
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(records))
}

async fn create_timepoint_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<TimepointBody>,
) -> Result<Json<TimepointRecord>, AppError> {
    let record = state
        .timeline
        .create_timepoint(CreateTimepointRequest {
            project_slug: slug,
            id: body.id,
            sequence: body.sequence,
            title: body.title,
            summary: body.summary,
            branch_id: body.branch_id,
        })
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(record))
}

async fn list_branches_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<BranchRecord>>, AppError> {
    let records = state
        .timeline
        .list_branches(&slug)
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(records))
}

async fn create_branch_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<BranchBody>,
) -> Result<Json<BranchRecord>, AppError> {
    let record = state
        .timeline
        .create_branch(CreateBranchRequest {
            project_slug: slug,
            id: body.id,
            title: body.title,
            description: body.description,
            origin_timepoint_id: body.origin_timepoint_id,
        })
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(record))
}

async fn get_branch_handler(
    State(state): State<AppState>,
    AxumPath((slug, branch_id)): AxumPath<(String, String)>,
) -> Result<Json<BranchRecord>, AppError> {
    let record = state
        .timeline
        .get_branch(&slug, &branch_id)
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(record))
}

async fn update_branch_handler(
    State(state): State<AppState>,
    AxumPath((slug, branch_id)): AxumPath<(String, String)>,
    Json(body): Json<UpdateBranchBody>,
) -> Result<Json<BranchRecord>, AppError> {
    let record = state
        .timeline
        .update_branch(
            &slug,
            &branch_id,
            UpdateBranchRequest {
                title: body.title,
                description: body.description,
                timepoint_ids: body.timepoint_ids,
            },
        )
        .await
        .map_err(map_timeline_error)?;
    Ok(Json(record))
}

async fn list_chapters_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<ChapterSummary>>, AppError> {
    let records = state
        .writing
        .list_chapters(&slug)
        .await
        .map_err(map_writing_error)?;
    Ok(Json(records))
}

async fn create_chapter_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<ChapterBody>,
) -> Result<Json<ChapterRecord>, AppError> {
    let record = state
        .writing
        .create_chapter(
            &slug,
            CreateChapterRequest {
                id: body.id,
                title: body.title,
                body: body.body,
            },
        )
        .await
        .map_err(map_writing_error)?;
    Ok(Json(record))
}

async fn get_chapter_handler(
    State(state): State<AppState>,
    AxumPath((slug, chapter_id)): AxumPath<(String, String)>,
) -> Result<Json<ChapterRecord>, AppError> {
    let record = state
        .writing
        .get_chapter(&slug, &chapter_id)
        .await
        .map_err(map_writing_error)?;
    Ok(Json(record))
}

async fn update_chapter_handler(
    State(state): State<AppState>,
    AxumPath((slug, chapter_id)): AxumPath<(String, String)>,
    Json(body): Json<UpdateChapterBody>,
) -> Result<Json<ChapterRecord>, AppError> {
    let record = state
        .writing
        .update_chapter(
            &slug,
            &chapter_id,
            UpdateChapterRequest {
                title: body.title,
                body: body.body,
            },
        )
        .await
        .map_err(map_writing_error)?;
    Ok(Json(record))
}

async fn create_review_note_handler(
    State(state): State<AppState>,
    AxumPath((slug, chapter_id)): AxumPath<(String, String)>,
    Json(body): Json<ReviewNoteBody>,
) -> Result<Json<Vec<crate::writing::ReviewNote>>, AppError> {
    let record = state
        .writing
        .add_review_note(
            &slug,
            &chapter_id,
            CreateReviewNoteRequest {
                reviewer: body.reviewer,
                body: body.body,
            },
        )
        .await
        .map_err(map_writing_error)?;
    Ok(Json(record))
}

async fn create_writing_branch_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<WritingBranchBody>,
) -> Result<Json<WritingBranchRecord>, AppError> {
    let record = state
        .writing
        .branch_historical_chapter(
            &slug,
            BranchHistoricalChapterRequest {
                source_chapter_id: body.source_chapter_id,
                branch_id: body.branch_id,
                branch_title: body.branch_title,
                branch_description: body.branch_description,
                branch_reason: body.branch_reason,
                origin_timepoint_id: body.origin_timepoint_id,
            },
        )
        .await
        .map_err(map_writing_error)?;
    Ok(Json(record))
}

async fn runtime_read_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(request): Json<AgentRuntimeReadRequest>,
) -> Result<Json<runtime::ReadOutput>, AppError> {
    Ok(Json(state.runtime.read(&slug, request).await?))
}

async fn runtime_glob_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(request): Json<AgentRuntimeGlobRequest>,
) -> Result<Json<runtime::GlobOutput>, AppError> {
    Ok(Json(state.runtime.glob(&slug, request).await?))
}

async fn runtime_patch_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(request): Json<AgentRuntimePatchRequest>,
) -> Result<Json<runtime::PatchOutput>, AppError> {
    Ok(Json(state.runtime.patch(&slug, request).await?))
}

async fn runtime_execute_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(request): Json<AgentRuntimeExecuteRequest>,
) -> Result<Json<AgentRuntimeExecution>, AppError> {
    Ok(Json(state.runtime.execute(&slug, request).await?))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagQuery {
    pub query: String,
}

async fn rebuild_story_graph_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<StoryGraphRebuildOutput>, AppError> {
    let output = state
        .story_graph
        .rebuild(&slug)
        .await
        .map_err(|error| map_story_graph_error(&error))?;
    Ok(Json(output))
}

async fn list_story_graph_nodes_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<StoryGraphNode>>, AppError> {
    let nodes = state
        .story_graph
        .load_nodes(&slug)
        .await
        .map_err(|error| map_story_graph_error(&error))?;
    Ok(Json(nodes))
}

async fn list_story_graph_edges_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<StoryGraphEdge>>, AppError> {
    let edges = state
        .story_graph
        .load_edges(&slug)
        .await
        .map_err(|error| map_story_graph_error(&error))?;
    Ok(Json(edges))
}

async fn list_story_graph_episodes_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<StoryGraphEpisode>>, AppError> {
    let episodes = state
        .story_graph
        .load_episodes(&slug)
        .await
        .map_err(|error| map_story_graph_error(&error))?;
    Ok(Json(episodes))
}

async fn quick_story_rag_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<RagQuery>,
) -> Result<Json<QuickSearchOutput>, AppError> {
    let output = state
        .story_rag
        .quick_search(&slug, &query.query)
        .await
        .map_err(map_story_rag_error)?;
    Ok(Json(output))
}

async fn panorama_story_rag_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<RagQuery>,
) -> Result<Json<PanoramaSearchOutput>, AppError> {
    let output = state
        .story_rag
        .panorama_search(&slug, &query.query)
        .await
        .map_err(map_story_rag_error)?;
    Ok(Json(output))
}

async fn insight_story_rag_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    axum::extract::Query(query): axum::extract::Query<RagQuery>,
) -> Result<Json<InsightForgeOutput>, AppError> {
    let output = state
        .story_rag
        .insight_forge(&slug, &query.query)
        .await
        .map_err(map_story_rag_error)?;
    Ok(Json(output))
}

async fn get_active_simulation_session_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Option<SimulationSession>>, AppError> {
    let record = state
        .simulation
        .get_active_session(&slug)
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

async fn create_simulation_session_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<SimulationSessionBody>,
) -> Result<Json<SimulationSession>, AppError> {
    let record = state
        .simulation
        .create_session(CreateSessionRequest {
            project_slug: slug,
            session_id: body.session_id,
            timeline: body.timeline,
            timepoint_id: body.timepoint_id,
            title: body.title,
            characters: body
                .characters
                .into_iter()
                .map(|character| CreateCharacterRequest {
                    character_id: character.character_id,
                    display_name: character.display_name,
                    agenda: character.agenda,
                })
                .collect(),
        })
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

async fn get_simulation_session_handler(
    State(state): State<AppState>,
    AxumPath((slug, session_id)): AxumPath<(String, String)>,
) -> Result<Json<SimulationSession>, AppError> {
    let record = state
        .simulation
        .get_session(&slug, &session_id)
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

async fn get_simulation_swarm_round_handler(
    State(state): State<AppState>,
    AxumPath((slug, session_id, round)): AxumPath<(String, String, u32)>,
) -> Result<Json<Option<SwarmTurnRecord>>, AppError> {
    let record = state
        .simulation
        .get_swarm_round(&slug, &session_id, round)
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

async fn advance_simulation_session_handler(
    State(state): State<AppState>,
    AxumPath((slug, session_id)): AxumPath<(String, String)>,
    Json(body): Json<AdvanceSimulationBody>,
) -> Result<Json<SimulationSession>, AppError> {
    let mut system_directives = std::collections::BTreeMap::new();
    if let Some(value) = body.random_event_directive {
        system_directives.insert(SimulationRole::RandomEvent, value);
    }
    if let Some(value) = body.world_maintainer_directive {
        system_directives.insert(SimulationRole::WorldMaintainer, value);
    }
    if let Some(value) = body.kp_directive {
        system_directives.insert(SimulationRole::Kp, value);
    }
    if let Some(value) = body.project_auditor_directive {
        system_directives.insert(SimulationRole::ProjectAuditor, value);
    }
    let record = state
        .simulation
        .advance_round(
            &slug,
            &session_id,
            AdvanceRoundRequest {
                character_actions: body
                    .character_actions
                    .into_iter()
                    .map(|action| CharacterAction {
                        character_id: action.character_id,
                        summary: action.summary,
                    })
                    .collect(),
                system_directives,
                auditor_concludes_session: body.auditor_concludes_session,
            },
        )
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

async fn create_simulation_report_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<SimulationReportBody>,
) -> Result<Json<ReportRecord>, AppError> {
    let report = state
        .reports
        .create_simulation_report(
            &slug,
            CreateSimulationReportRequest {
                session_id: body.session_id,
                round: body.round,
                query: body.query,
            },
        )
        .await
        .map_err(map_report_error)?;
    Ok(Json(report))
}

async fn create_consistency_report_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<ConsistencyReportBody>,
) -> Result<Json<ReportRecord>, AppError> {
    let report = state
        .reports
        .create_consistency_report(
            &slug,
            CreateConsistencyReportRequest {
                session_id: body.session_id,
                round: body.round,
            },
        )
        .await
        .map_err(map_report_error)?;
    Ok(Json(report))
}

async fn create_branch_impact_report_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<BranchImpactReportBody>,
) -> Result<Json<ReportRecord>, AppError> {
    let report = state
        .reports
        .create_branch_impact_report(
            &slug,
            CreateBranchImpactReportRequest {
                branch_id: body.branch_id,
                query: body.query,
            },
        )
        .await
        .map_err(map_report_error)?;
    Ok(Json(report))
}

async fn create_writing_prewrite_report_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    Json(body): Json<WritingPrewriteReportBody>,
) -> Result<Json<ReportRecord>, AppError> {
    let report = state
        .reports
        .create_writing_prewrite_report(
            &slug,
            CreateWritingPrewriteReportRequest {
                chapter_id: body.chapter_id,
                query: body.query,
            },
        )
        .await
        .map_err(map_report_error)?;
    Ok(Json(report))
}

async fn list_reports_handler(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
) -> Result<Json<Vec<ReportSummary>>, AppError> {
    let reports = state
        .reports
        .list_reports(&slug)
        .await
        .map_err(map_report_error)?;
    Ok(Json(reports))
}

async fn get_report_handler(
    State(state): State<AppState>,
    AxumPath((slug, kind, id)): AxumPath<(String, String, String)>,
) -> Result<Json<ReportRecord>, AppError> {
    let report = state
        .reports
        .get_report(&slug, parse_report_kind(&kind)?, &id)
        .await
        .map_err(map_report_error)?;
    Ok(Json(report))
}

async fn create_interview_handler(
    State(state): State<AppState>,
    AxumPath((slug, session_id)): AxumPath<(String, String)>,
    Json(body): Json<InterviewBody>,
) -> Result<Json<InterviewRecord>, AppError> {
    let interview = state
        .reports
        .create_interview(
            &slug,
            &session_id,
            CreateInterviewRequest {
                agent_ids: body.agent_ids,
                questions: body.questions,
            },
        )
        .await
        .map_err(map_report_error)?;
    Ok(Json(interview))
}

async fn possess_character_handler(
    State(state): State<AppState>,
    AxumPath((slug, session_id)): AxumPath<(String, String)>,
    Json(body): Json<PossessBody>,
) -> Result<Json<SimulationSession>, AppError> {
    let record = state
        .simulation
        .possess_character(
            &slug,
            &session_id,
            PossessCharacterRequest {
                character_id: body.character_id,
                user_id: body.user_id,
            },
        )
        .await
        .map_err(map_simulation_error)?;
    Ok(Json(record))
}

fn parse_card_kind(value: &str) -> Result<CardKind, AppError> {
    match value {
        "character" => Ok(CardKind::Character),
        "rule" => Ok(CardKind::Rule),
        "world" => Ok(CardKind::World),
        _ => Err(AppError::BadRequest(format!("invalid card kind: {value}"))),
    }
}

fn parse_memory_scope(
    scope_kind: Option<&str>,
    scope_id: Option<&str>,
) -> Result<MemoryScope, AppError> {
    match scope_kind.unwrap_or("global") {
        "global" => Ok(MemoryScope::Global),
        "branch" => Ok(MemoryScope::Branch {
            branch: scope_id
                .ok_or_else(|| AppError::BadRequest("missing branch scope id".to_string()))?
                .to_string(),
        }),
        "chapter" => Ok(MemoryScope::Chapter {
            chapter: scope_id
                .ok_or_else(|| AppError::BadRequest("missing chapter scope id".to_string()))?
                .to_string(),
        }),
        "agent" => Ok(MemoryScope::Agent {
            agent: scope_id
                .ok_or_else(|| AppError::BadRequest("missing agent scope id".to_string()))?
                .to_string(),
        }),
        other => Err(AppError::BadRequest(format!(
            "invalid memory scope: {other}"
        ))),
    }
}

fn parse_memory_scope_path(scope_kind: &str, scope_id: &str) -> Result<MemoryScope, AppError> {
    match scope_kind {
        "global" => Ok(MemoryScope::Global),
        "branch" => Ok(MemoryScope::Branch {
            branch: scope_id.to_string(),
        }),
        "chapter" => Ok(MemoryScope::Chapter {
            chapter: scope_id.to_string(),
        }),
        "agent" => Ok(MemoryScope::Agent {
            agent: scope_id.to_string(),
        }),
        other => Err(AppError::BadRequest(format!(
            "invalid memory scope: {other}"
        ))),
    }
}

fn parse_report_kind(value: &str) -> Result<ReportKind, AppError> {
    match value {
        "simulation" => Ok(ReportKind::Simulation),
        "consistency" => Ok(ReportKind::Consistency),
        "branch-impact" => Ok(ReportKind::BranchImpact),
        "writing" => Ok(ReportKind::Writing),
        _ => Err(AppError::BadRequest(format!(
            "invalid report kind: {value}"
        ))),
    }
}

fn map_report_error(error: crate::report::ReportError) -> AppError {
    match error {
        crate::report::ReportError::ProjectNotFound(_)
        | crate::report::ReportError::NotFound(_) => AppError::NotFound,
        crate::report::ReportError::InvalidProjectSlug(value)
        | crate::report::ReportError::InvalidReportId(value) => AppError::BadRequest(value),
        crate::report::ReportError::Storage(_)
        | crate::report::ReportError::Rag(_)
        | crate::report::ReportError::Simulation(_)
        | crate::report::ReportError::Swarm(_)
        | crate::report::ReportError::Agents(_) => AppError::Internal,
    }
}

const fn map_story_graph_error(error: &crate::story_graph::StoryGraphError) -> AppError {
    match error {
        crate::story_graph::StoryGraphError::ProjectNotFound(_) => AppError::NotFound,
        crate::story_graph::StoryGraphError::Storage(_) => AppError::Internal,
    }
}

fn map_story_rag_error(error: crate::story_rag::StoryRagError) -> AppError {
    match error {
        crate::story_rag::StoryRagError::Graph(graph_error) => map_story_graph_error(&graph_error),
        crate::story_rag::StoryRagError::Storage(_) => AppError::Internal,
    }
}

fn map_agent_error(error: crate::agents::AgentAssetError) -> AppError {
    match error {
        crate::agents::AgentAssetError::ProjectNotFound(_)
        | crate::agents::AgentAssetError::NotFound(_) => AppError::NotFound,
        crate::agents::AgentAssetError::InvalidProjectSlug(value)
        | crate::agents::AgentAssetError::InvalidAgentId(value) => AppError::BadRequest(value),
        crate::agents::AgentAssetError::Storage(_) => AppError::Internal,
    }
}

fn map_card_error(error: crate::cards::CardError) -> AppError {
    match error {
        crate::cards::CardError::ProjectNotFound(_) | crate::cards::CardError::NotFound { .. } => {
            AppError::NotFound
        }
        crate::cards::CardError::AlreadyExists { id, .. } => {
            AppError::Conflict(format!("card already exists: {id}"))
        }
        crate::cards::CardError::InvalidProjectSlug(value)
        | crate::cards::CardError::InvalidCardId(value)
        | crate::cards::CardError::InvalidMarkdown(value) => AppError::BadRequest(value),
        crate::cards::CardError::Storage(_) => AppError::Internal,
    }
}

fn map_memory_error(error: crate::memory::MemoryError) -> AppError {
    match error {
        crate::memory::MemoryError::ProjectNotFound(_)
        | crate::memory::MemoryError::NotFound(_) => AppError::NotFound,
        crate::memory::MemoryError::AlreadyExists(key) => {
            AppError::Conflict(format!("memory entry already exists: {key}"))
        }
        crate::memory::MemoryError::InvalidProjectSlug(value)
        | crate::memory::MemoryError::InvalidKey(value)
        | crate::memory::MemoryError::InvalidTimeline(value)
        | crate::memory::MemoryError::InvalidTimepoint(value)
        | crate::memory::MemoryError::InvalidBranch(value)
        | crate::memory::MemoryError::InvalidChapter(value)
        | crate::memory::MemoryError::InvalidAgent(value) => AppError::BadRequest(value),
        crate::memory::MemoryError::InvalidDocument(value) => {
            AppError::BadRequest(value.to_string())
        }
        crate::memory::MemoryError::Storage(_) => AppError::Internal,
    }
}

fn map_timeline_error(error: crate::timeline::TimelineError) -> AppError {
    match error {
        crate::timeline::TimelineError::ProjectNotFound(_)
        | crate::timeline::TimelineError::BranchNotFound(_)
        | crate::timeline::TimelineError::TimepointNotFound(_)
        | crate::timeline::TimelineError::NotFound(_) => AppError::NotFound,
        crate::timeline::TimelineError::AlreadyExists(id) => {
            AppError::Conflict(format!("timeline artifact already exists: {id}"))
        }
        crate::timeline::TimelineError::InvalidProjectSlug(value)
        | crate::timeline::TimelineError::InvalidIdentifier(value)
        | crate::timeline::TimelineError::ProjectMismatch(value) => AppError::BadRequest(value),
        crate::timeline::TimelineError::Storage(_) => AppError::Internal,
    }
}

fn map_writing_error(error: crate::writing::WritingError) -> AppError {
    match error {
        crate::writing::WritingError::ProjectNotFound(_)
        | crate::writing::WritingError::ChapterNotFound(_) => AppError::NotFound,
        crate::writing::WritingError::ChapterAlreadyExists(id) => {
            AppError::Conflict(format!("chapter already exists: {id}"))
        }
        crate::writing::WritingError::HistoricalEditRejected(id) => {
            AppError::Conflict(format!("historical chapter edits require branching: {id}"))
        }
        crate::writing::WritingError::InvalidProjectSlug(value)
        | crate::writing::WritingError::InvalidChapterId(value)
        | crate::writing::WritingError::InvalidReviewer(value)
        | crate::writing::WritingError::InvalidBranchId(value)
        | crate::writing::WritingError::InvalidTimepointId(value)
        | crate::writing::WritingError::InvalidCurrentChapter(value)
        | crate::writing::WritingError::InvalidChapterDocument(value) => {
            AppError::BadRequest(value)
        }
        crate::writing::WritingError::Timeline(crate::timeline::TimelineError::AlreadyExists(
            id,
        )) => AppError::Conflict(format!("timeline artifact already exists: {id}")),
        crate::writing::WritingError::Timeline(error) => map_timeline_error(error),
        crate::writing::WritingError::Runtime(error) => AppError::from(error),
        crate::writing::WritingError::Storage(_) => AppError::Internal,
    }
}

fn map_simulation_error(error: crate::simulation::SimulationError) -> AppError {
    match error {
        crate::simulation::SimulationError::ProjectNotFound(_)
        | crate::simulation::SimulationError::SessionNotFound(_)
        | crate::simulation::SimulationError::CharacterNotFound(_) => AppError::NotFound,
        crate::simulation::SimulationError::SessionAlreadyExists(id) => {
            AppError::Conflict(format!("simulation session already exists: {id}"))
        }
        crate::simulation::SimulationError::SessionComplete(id) => {
            AppError::Conflict(format!("simulation session already complete: {id}"))
        }
        crate::simulation::SimulationError::InvalidProjectSlug(value)
        | crate::simulation::SimulationError::InvalidSessionId(value)
        | crate::simulation::SimulationError::InvalidTimeline(value)
        | crate::simulation::SimulationError::InvalidTimepoint(value)
        | crate::simulation::SimulationError::InvalidCharacterId(value)
        | crate::simulation::SimulationError::InvalidUserId(value)
        | crate::simulation::SimulationError::DuplicateCharacter(value)
        | crate::simulation::SimulationError::MissingCharacterAction(value) => {
            AppError::BadRequest(value)
        }
        crate::simulation::SimulationError::InvalidTitle(value) => {
            AppError::BadRequest(value.to_string())
        }
        crate::simulation::SimulationError::InvalidDirectiveRole(role) => {
            AppError::BadRequest(format!("invalid directive role: {role:?}"))
        }
        crate::simulation::SimulationError::Memory(error) => map_memory_error(error),
        crate::simulation::SimulationError::Swarm(error) => match error {
            crate::swarm::SwarmError::ProjectNotFound(_) => AppError::NotFound,
            crate::swarm::SwarmError::Storage(_) | crate::swarm::SwarmError::Rag(_) => {
                AppError::Internal
            }
        },
        crate::simulation::SimulationError::Runtime(_)
        | crate::simulation::SimulationError::Storage(_) => AppError::Internal,
    }
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
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "import".to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("resource not found")]
    NotFound,
    #[error("internal server error")]
    Internal,
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
}

impl AppError {
    const fn status_code(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
            Self::NotImplemented(_) => StatusCode::NOT_IMPLEMENTED,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
        }
    }

    const fn error_code(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Internal => "internal",
            Self::NotImplemented(_) => "not_implemented",
            Self::BadRequest(_) => "bad_request",
            Self::Conflict(_) => "conflict",
        }
    }

    fn message(&self) -> String {
        self.to_string()
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = Json(ErrorPayload {
            error: ErrorBody {
                code: self.error_code(),
                message: self.message(),
            },
        });

        (status, body).into_response()
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ErrorPayload {
    pub error: ErrorBody,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

impl From<runtime::AgentRuntimeError> for AppError {
    fn from(value: runtime::AgentRuntimeError) -> Self {
        match value {
            runtime::AgentRuntimeError::ProjectNotFound(_)
            | runtime::AgentRuntimeError::NotFound(_) => Self::NotFound,
            runtime::AgentRuntimeError::InvalidProjectSlug(_)
            | runtime::AgentRuntimeError::InvalidAgentId(_)
            | runtime::AgentRuntimeError::InvalidPath(_)
            | runtime::AgentRuntimeError::PathNotAllowed(_)
            | runtime::AgentRuntimeError::FileTooLarge(_)
            | runtime::AgentRuntimeError::UnsupportedPattern(_)
            | runtime::AgentRuntimeError::ReplaceTargetMissing(_)
            | runtime::AgentRuntimeError::CriticalAssetWouldBeEmpty(_) => {
                Self::BadRequest(value.to_string())
            }
            runtime::AgentRuntimeError::Storage(_) => Self::Internal,
        }
    }
}

impl fmt::Display for HealthPayload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.service, self.status)
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode},
    };
    use tempfile::tempdir;
    use tower::ServiceExt as _;

    use super::{ApplicationConfig, ErrorBody, ErrorPayload, HealthPayload, app};

    #[tokio::test]
    async fn health_route_returns_ok_payload() {
        let response = app(ApplicationConfig::default())
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers().get("x-request-id").is_some(),
            "request id should be attached"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should collect");
        let payload: HealthPayload =
            serde_json::from_slice(&body).expect("health payload should deserialize");

        assert_eq!(
            payload,
            HealthPayload {
                status: String::from("ok"),
                service: String::from("novelfabric-backend"),
            }
        );
    }

    #[tokio::test]
    async fn unknown_route_returns_not_found() {
        let response = app(ApplicationConfig::default())
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/missing")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should collect");
        assert!(
            body.is_empty(),
            "default 404 body should be empty at bootstrap"
        );
    }

    #[tokio::test]
    async fn runtime_routes_read_and_patch_within_project_scope() {
        let temp = tempdir().expect("tempdir should exist");
        tokio::fs::create_dir_all(temp.path().join("projects/http-project/writing/chapters"))
            .await
            .expect("project chapter dir should exist");
        tokio::fs::create_dir_all(
            temp.path()
                .join("projects/http-project/agents/project-auditor"),
        )
        .await
        .expect("agent dir should exist");
        tokio::fs::write(
            temp.path().join("projects/http-project/project.json"),
            r#"{"slug":"http-project","title":"HTTP Project","description":"runtime api"}"#,
        )
        .await
        .expect("project metadata should exist");
        tokio::fs::write(
            temp.path()
                .join("projects/http-project/writing/chapters/chapter-1.md"),
            "# Chapter 1

Original
",
        )
        .await
        .expect("chapter seed should exist");

        let router = app(ApplicationConfig {
            server: super::ServerConfig::default(),
            data_dir: temp.path().to_path_buf(),
        });

        let read_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/projects/http-project/runtime/read")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"path":"writing/chapters/chapter-1.md"}"#))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");
        assert_eq!(read_response.status(), StatusCode::OK);

        let patch_response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/projects/http-project/runtime/patch")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"agent_id":"project-auditor","operations":[{"type":"replace","path":"writing/chapters/chapter-1.md","old":"Original","new":"Revised"}]}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");
        assert_eq!(patch_response.status(), StatusCode::OK);

        let updated = tokio::fs::read_to_string(
            temp.path()
                .join("projects/http-project/writing/chapters/chapter-1.md"),
        )
        .await
        .expect("updated chapter should exist");
        assert!(updated.contains("Revised"));
        assert!(
            tokio::fs::try_exists(
                temp.path().join(
                    "projects/http-project/agents/project-auditor/audit/runtime-patch-log.md"
                )
            )
            .await
            .expect("audit existence should resolve")
        );
    }

    #[tokio::test]
    async fn knowledge_and_rag_routes_rebuild_and_search_project_text() {
        let temp = tempdir().expect("tempdir should exist");
        tokio::fs::create_dir_all(
            temp.path()
                .join("projects/knowledge-project/cards/characters"),
        )
        .await
        .expect("character dir should exist");
        tokio::fs::create_dir_all(
            temp.path()
                .join("projects/knowledge-project/writing/chapters"),
        )
        .await
        .expect("chapter dir should exist");
        tokio::fs::create_dir_all(
            temp.path()
                .join("projects/knowledge-project/memory/global/main/tp-0001/entries"),
        )
        .await
        .expect("memory dir should exist");
        tokio::fs::write(
            temp.path().join("projects/knowledge-project/project.json"),
            r#"{"slug":"knowledge-project","title":"Knowledge Project","description":"story graph api"}"#,
        )
        .await
        .expect("project metadata should exist");
        tokio::fs::write(
            temp.path()
                .join("projects/knowledge-project/cards/characters/aria.md"),
            "# Aria\n\nAria guards the moon vault.\n",
        )
        .await
        .expect("character card should exist");
        tokio::fs::write(
            temp.path()
                .join("projects/knowledge-project/writing/chapters/chapter-1.md"),
            "# Chapter 1\n\nThe moon vault opens under starlight.\n",
        )
        .await
        .expect("chapter should exist");
        tokio::fs::write(
            temp.path()
                .join("projects/knowledge-project/memory/global/main/tp-0001/entries/vault.md"),
            "# Vault memory\n\nAria remembers the moon vault oath.\n",
        )
        .await
        .expect("memory should exist");

        let router = app(ApplicationConfig {
            server: super::ServerConfig::default(),
            data_dir: temp.path().to_path_buf(),
        });

        let rebuild_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/projects/knowledge-project/knowledge/rebuild")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");
        assert_eq!(rebuild_response.status(), StatusCode::OK);

        let quick_response = router
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/projects/knowledge-project/rag/quick?query=vault")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");
        assert_eq!(quick_response.status(), StatusCode::OK);
        let body = to_bytes(quick_response.into_body(), usize::MAX)
            .await
            .expect("body should collect");
        let payload: serde_json::Value =
            serde_json::from_slice(&body).expect("quick payload should deserialize");
        assert_eq!(payload["query"], "vault");
        assert!(
            payload["hits"]
                .as_array()
                .is_some_and(|hits| !hits.is_empty()),
            "quick search should return text-backed hits"
        );
    }

    #[tokio::test]
    async fn llm_healthcheck_route_reports_missing_endpoint_without_calling_provider() {
        let temp = tempdir().expect("tempdir should exist");
        let router = app(ApplicationConfig {
            server: super::ServerConfig::default(),
            data_dir: temp.path().to_path_buf(),
        });

        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/config/llm-healthcheck")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"role_id":"default"}"#))
                    .expect("request should build"),
            )
            .await
            .expect("healthcheck should respond");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should collect");
        let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
        assert_eq!(payload["ok"], false);
        assert_eq!(payload["error_kind"], "missing_config");
        assert!(
            payload["error_message"]
                .as_str()
                .unwrap_or("")
                .contains("LLM endpoint")
        );
    }

    #[tokio::test]
    async fn llm_healthcheck_classifies_provider_status_errors() {
        assert_eq!(
            super::classify_llm_error(crate::llm::LlmError::ProviderStatus {
                status: StatusCode::UNAUTHORIZED,
                body: "bad api key".to_string(),
            })
            .1,
            "auth"
        );
        assert_eq!(
            super::classify_llm_error(crate::llm::LlmError::ProviderStatus {
                status: StatusCode::NOT_FOUND,
                body: "missing model".to_string(),
            })
            .1,
            "model_not_found"
        );
        assert_eq!(
            super::classify_llm_error(crate::llm::LlmError::ProviderStatus {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                body: "server failed".to_string(),
            })
            .1,
            "provider_5xx"
        );
        assert_eq!(
            super::classify_llm_error(crate::llm::LlmError::ProviderStatus {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                body: "model backend crashed".to_string(),
            })
            .1,
            "provider_5xx"
        );
    }

    #[tokio::test]
    async fn llm_healthcheck_classifies_timeout_http_errors() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let address = listener
            .local_addr()
            .expect("listener address should exist");
        let server = tokio::spawn(async move {
            if let Ok((_stream, _peer)) = listener.accept().await {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        });
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(20))
            .build()
            .expect("client should build");
        let error = client
            .post(format!("http://{address}/v1/chat/completions"))
            .body("{}")
            .send()
            .await
            .expect_err("request should time out");
        let (_status, kind, _message) =
            super::classify_llm_error(crate::llm::LlmError::Http(error));
        assert_eq!(kind, "timeout");
        server.abort();
    }

    #[tokio::test]
    async fn llm_healthcheck_for_unsaved_role_uses_default_model() {
        let temp = tempdir().expect("tempdir should exist");
        let router = app(ApplicationConfig {
            server: super::ServerConfig::default(),
            data_dir: temp.path().to_path_buf(),
        });

        let save_endpoint_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/api/config/llm-endpoint")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"provider":"local-test-provider","base_url":"http://127.0.0.1:9/v1","api_key":"test-key","api_style":"OpenAiChatCompletions"}"#,
                    ))
                    .expect("request should build"),
            )
            .await
            .expect("endpoint save should respond");
        assert_eq!(save_endpoint_response.status(), StatusCode::OK);

        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/config/llm-healthcheck")
                    .header(axum::http::header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"role_id":"kp"}"#))
                    .expect("request should build"),
            )
            .await
            .expect("healthcheck should respond");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should collect");
        let payload: serde_json::Value = serde_json::from_slice(&body).expect("json payload");
        assert_eq!(payload["ok"], false);
        assert_eq!(payload["role_id"], "kp");
        assert_eq!(payload["provider"], "local-test-provider");
        assert_eq!(payload["model"], crate::config::DEFAULT_LLM_MODEL);
        assert_eq!(payload["api_style"], "OpenAiChatCompletions");
    }

    #[test]
    fn app_error_payload_serializes_consistently() {
        let payload = ErrorPayload {
            error: ErrorBody {
                code: "not_implemented",
                message: "not implemented: project domain".to_string(),
            },
        };

        let serialized = serde_json::to_string(&payload).expect("payload should serialize");
        assert!(serialized.contains("not_implemented"));
    }
}
