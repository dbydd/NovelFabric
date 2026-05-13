#![forbid(unsafe_code)]

pub mod agents;
pub mod cards;
pub mod import;
pub mod llm;
pub mod memory;
pub mod project;
pub mod simulation;
pub mod storage;
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
    agents::{AgentAssetRecord, AgentAssetService, AgentSummary, UpdateAgentAssetRequest},
    cards::{CardKind, CardRecord, CardService, CreateCardRequest, UpdateCardRequest},
    import::{ImportRecord, ImportService, ImportTxtRequest},
    memory::{
        CreateMemoryEntryRequest, MemoryEntry, MemoryEntrySummary, MemoryScope, MemoryService,
        UpdateMemoryEntryRequest,
    },
    project::{CreateProjectRequest, ProjectRecord, ProjectService},
    simulation::{
        AdvanceRoundRequest, CharacterAction, CreateCharacterRequest, CreateSessionRequest,
        PossessCharacterRequest, SimulationRole, SimulationService, SimulationSession,
    },
    storage::Storage,
    timeline::{
        BranchRecord, CreateBranchRequest, CreateTimepointRequest, TimelineService,
        TimepointRecord, UpdateBranchRequest,
    },
    writing::{
        BranchHistoricalChapterRequest, ChapterRecord, ChapterSummary, CreateChapterRequest,
        CreateReviewNoteRequest, UpdateChapterRequest, WritingBranchRecord, WritingService,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApplicationConfig {
    pub server: ServerConfig,
    pub data_dir: PathBuf,
}

impl ApplicationConfig {
    #[must_use]
    pub fn from_env() -> Self {
        let bind_address = std::env::var("NOVELFABRIC_BACKEND_BIND_ADDRESS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| ServerConfig::default().bind_address);

        let data_dir = std::env::var("NOVELFABRIC_DATA_DIR")
            .ok()
            .map_or_else(|| PathBuf::from("data"), PathBuf::from);

        Self {
            server: ServerConfig { bind_address },
            data_dir,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
    pub agents: AgentAssetService,
    pub cards: CardService,
    pub memory: MemoryService,
    pub timeline: TimelineService,
    pub simulation: SimulationService,
    pub writing: WritingService,
}

impl AppState {
    #[must_use]
    pub fn new(config: ApplicationConfig) -> Self {
        let storage = Arc::new(Storage::new(config.data_dir.clone()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));
        let agents = AgentAssetService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let memory = MemoryService::new(Arc::clone(&storage));
        let timeline = TimelineService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        Self {
            config,
            storage,
            projects,
            imports,
            agents,
            cards,
            memory,
            timeline,
            simulation,
            writing,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthPayload {
    pub status: String,
    pub service: String,
}

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
        .route("/api/projects/{slug}", get(get_project_handler))
        .route("/api/projects/{slug}/import", post(import_txt_handler))
        .route("/api/projects/{slug}/agents", get(list_agents_handler))
        .route(
            "/api/projects/{slug}/agents/{agent_id}",
            get(get_agent_handler).put(update_agent_handler),
        )
        .route(
            "/api/projects/{slug}/cards",
            get(list_cards_handler).post(create_card_handler),
        )
        .route(
            "/api/projects/{slug}/cards/{kind}/{card_id}",
            get(get_card_handler).put(update_card_handler),
        )
        .route(
            "/api/projects/{slug}/memory",
            get(list_memory_handler).post(create_memory_handler),
        )
        .route(
            "/api/projects/{slug}/memory/{scope_kind}/{scope_id}/{timeline}/{timepoint}/{key}",
            get(get_memory_handler).put(update_memory_handler),
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
            "/api/projects/{slug}/simulation/sessions/{session_id}/advance",
            post(advance_simulation_session_handler),
        )
        .route(
            "/api/projects/{slug}/simulation/sessions/{session_id}/possess",
            post(possess_character_handler),
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
        crate::simulation::SimulationError::Storage(_) => AppError::Internal,
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
