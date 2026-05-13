use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    memory::{CreateMemoryEntryRequest, MemoryError, MemoryScope, MemoryService},
    storage::{Storage, StorageError, validate_segment},
};

const PROJECTS_DIR: &str = "projects";
const ACTIVE_SESSION_FILE: &str = "simulation/active-session.txt";
const SESSION_FILE_EXTENSION: &str = "json";
const LOG_FILE_EXTENSION: &str = "md";

const AGENT_MEMORY_TIMELINE: &str = "simulation";

const SYSTEM_ROLE_ORDER: [SimulationRole; 4] = [
    SimulationRole::RandomEvent,
    SimulationRole::WorldMaintainer,
    SimulationRole::Kp,
    SimulationRole::ProjectAuditor,
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum SimulationRole {
    Character,
    RandomEvent,
    WorldMaintainer,
    Kp,
    ProjectAuditor,
}

impl SimulationRole {
    #[must_use]
    pub const fn as_agent_id(self) -> &'static str {
        match self {
            Self::Character => "character",
            Self::RandomEvent => "random-event",
            Self::WorldMaintainer => "world-maintainer",
            Self::Kp => "kp",
            Self::ProjectAuditor => "project-auditor",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CharacterState {
    pub character_id: String,
    pub display_name: String,
    pub agenda: String,
    pub controller: CharacterController,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CharacterController {
    Agent,
    UserPossessed { user_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentState {
    pub agent_id: String,
    pub role: SimulationRole,
    pub round_memory_key: Option<String>,
    pub last_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionLogEntry {
    pub round: u32,
    pub turn: u32,
    pub actor_id: String,
    pub role: SimulationRole,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SimulationSession {
    pub project_slug: String,
    pub session_id: String,
    pub timeline: String,
    pub timepoint_id: String,
    pub title: String,
    pub round: u32,
    pub next_turn: u32,
    pub is_complete: bool,
    pub active_character_id: Option<String>,
    pub characters: Vec<CharacterState>,
    pub agents: Vec<AgentState>,
    pub logs: Vec<SessionLogEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateSessionRequest {
    pub project_slug: String,
    pub session_id: String,
    pub timeline: String,
    pub timepoint_id: String,
    pub title: String,
    pub characters: Vec<CreateCharacterRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateCharacterRequest {
    pub character_id: String,
    pub display_name: String,
    pub agenda: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdvanceRoundRequest {
    pub character_actions: Vec<CharacterAction>,
    pub system_directives: BTreeMap<SimulationRole, String>,
    pub auditor_concludes_session: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CharacterAction {
    pub character_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PossessCharacterRequest {
    pub character_id: String,
    pub user_id: String,
}

#[derive(Debug, Clone)]
pub struct SimulationService {
    storage: Arc<Storage>,
    memory: MemoryService,
}

#[derive(Debug, Error)]
pub enum SimulationError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid session id: {0}")]
    InvalidSessionId(String),
    #[error("invalid timeline segment: {0}")]
    InvalidTimeline(String),
    #[error("invalid timepoint segment: {0}")]
    InvalidTimepoint(String),
    #[error("invalid title: {0}")]
    InvalidTitle(&'static str),
    #[error("invalid character id: {0}")]
    InvalidCharacterId(String),
    #[error("invalid user id: {0}")]
    InvalidUserId(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("session already exists: {0}")]
    SessionAlreadyExists(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("character not found: {0}")]
    CharacterNotFound(String),
    #[error("duplicate character id: {0}")]
    DuplicateCharacter(String),
    #[error("missing character action: {0}")]
    MissingCharacterAction(String),
    #[error("invalid directive for role: {0:?}")]
    InvalidDirectiveRole(SimulationRole),
    #[error("session already complete: {0}")]
    SessionComplete(String),
    #[error(transparent)]
    Memory(#[from] MemoryError),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl SimulationService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        let memory = MemoryService::new(Arc::clone(&storage));
        Self { storage, memory }
    }

    #[must_use]
    pub const fn with_memory(storage: Arc<Storage>, memory: MemoryService) -> Self {
        Self { storage, memory }
    }

    pub async fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<SimulationSession, SimulationError> {
        validate_project_slug(&request.project_slug)?;
        validate_session_id(&request.session_id)?;
        validate_segment(&request.timeline)
            .map_err(|_| SimulationError::InvalidTimeline(request.timeline.clone()))?;
        validate_segment(&request.timepoint_id)
            .map_err(|_| SimulationError::InvalidTimepoint(request.timepoint_id.clone()))?;
        validate_title(&request.title)?;
        ensure_project_exists(self.storage.as_ref(), &request.project_slug).await?;

        let mut seen_character_ids = BTreeSet::new();
        let mut characters = Vec::with_capacity(request.characters.len());
        for character in request.characters {
            validate_character_id(&character.character_id)?;
            if !seen_character_ids.insert(character.character_id.clone()) {
                return Err(SimulationError::DuplicateCharacter(character.character_id));
            }
            characters.push(CharacterState {
                character_id: character.character_id,
                display_name: character.display_name,
                agenda: character.agenda,
                controller: CharacterController::Agent,
            });
        }
        characters.sort_by(|left, right| left.character_id.cmp(&right.character_id));

        let session_path = session_metadata_path(&request.project_slug, &request.session_id);
        if self.storage.exists(&session_path).await? {
            return Err(SimulationError::SessionAlreadyExists(request.session_id));
        }

        let agents = build_agent_states(&characters);
        let session = SimulationSession {
            project_slug: request.project_slug.clone(),
            session_id: request.session_id.clone(),
            timeline: request.timeline,
            timepoint_id: request.timepoint_id,
            title: request.title,
            round: 0,
            next_turn: 1,
            is_complete: false,
            active_character_id: None,
            characters,
            agents,
            logs: Vec::new(),
        };

        self.persist_session(&session).await?;
        self.write_active_session(&request.project_slug, &request.session_id)
            .await?;
        self.persist_log(&session).await?;

        Ok(session)
    }

    pub async fn get_active_session(
        &self,
        project_slug: &str,
    ) -> Result<Option<SimulationSession>, SimulationError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let active_path = active_session_path(project_slug);
        if !self.storage.exists(&active_path).await? {
            return Ok(None);
        }
        let session_id = self.storage.read_text(&active_path).await?;
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Ok(None);
        }
        Ok(Some(self.get_session(project_slug, session_id).await?))
    }

    pub async fn get_session(
        &self,
        project_slug: &str,
        session_id: &str,
    ) -> Result<SimulationSession, SimulationError> {
        validate_project_slug(project_slug)?;
        validate_session_id(session_id)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let path = session_metadata_path(project_slug, session_id);
        if !self.storage.exists(&path).await? {
            return Err(SimulationError::SessionNotFound(session_id.to_string()));
        }

        let text = self.storage.read_text(&path).await?;
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn advance_round(
        &self,
        project_slug: &str,
        session_id: &str,
        request: AdvanceRoundRequest,
    ) -> Result<SimulationSession, SimulationError> {
        // Round advancement encodes the product's core TRPG turn contract:
        // character decisions resolve first, then system roles run in deterministic order.
        // Keeping this ordering stable is more important than sophistication, because writing,
        // memory, and acceptance tests all depend on replayable log order.
        validate_project_slug(project_slug)?;
        validate_session_id(session_id)?;

        let mut session = self.get_session(project_slug, session_id).await?;
        if session.is_complete {
            return Err(SimulationError::SessionComplete(session_id.to_string()));
        }

        let next_round = session.round + 1;
        let mut actions_by_character = BTreeMap::new();
        for action in request.character_actions {
            validate_character_id(&action.character_id)?;
            actions_by_character.insert(action.character_id, action.summary);
        }

        for role in request.system_directives.keys() {
            if *role == SimulationRole::Character {
                return Err(SimulationError::InvalidDirectiveRole(*role));
            }
        }

        let mut new_entries = Vec::new();
        for character in &session.characters {
            let summary = actions_by_character
                .remove(&character.character_id)
                .ok_or_else(|| {
                    SimulationError::MissingCharacterAction(character.character_id.clone())
                })?;
            new_entries.push(SessionLogEntry {
                round: next_round,
                turn: session.next_turn,
                actor_id: character.character_id.clone(),
                role: SimulationRole::Character,
                summary,
            });
            session.next_turn += 1;
        }

        for role in SYSTEM_ROLE_ORDER {
            let summary = request
                .system_directives
                .get(&role)
                .cloned()
                .unwrap_or_else(|| default_system_summary(role, next_round));
            new_entries.push(SessionLogEntry {
                round: next_round,
                turn: session.next_turn,
                actor_id: role.as_agent_id().to_string(),
                role,
                summary,
            });
            session.next_turn += 1;
        }

        session.round = next_round;
        session.logs.extend(new_entries);
        session.is_complete = request.auditor_concludes_session;
        session.active_character_id = None;

        session = self
            .update_agent_states(project_slug, session, next_round)
            .await?;
        self.persist_log(&session).await?;
        if session.is_complete {
            self.write_active_session(project_slug, "").await?;
        } else {
            self.write_active_session(project_slug, session_id).await?;
        }

        Ok(session)
    }

    pub async fn possess_character(
        &self,
        project_slug: &str,
        session_id: &str,
        request: PossessCharacterRequest,
    ) -> Result<SimulationSession, SimulationError> {
        validate_project_slug(project_slug)?;
        validate_session_id(session_id)?;
        validate_character_id(&request.character_id)?;
        validate_user_id(&request.user_id)?;

        let mut session = self.get_session(project_slug, session_id).await?;
        let mut found = false;
        for character in &mut session.characters {
            if character.character_id == request.character_id {
                character.controller = CharacterController::UserPossessed {
                    user_id: request.user_id.clone(),
                };
                found = true;
            }
        }
        if !found {
            return Err(SimulationError::CharacterNotFound(request.character_id));
        }
        session.active_character_id = Some(request.character_id);

        self.persist_session(&session).await?;
        Ok(session)
    }

    pub async fn release_character(
        &self,
        project_slug: &str,
        session_id: &str,
        character_id: &str,
    ) -> Result<SimulationSession, SimulationError> {
        validate_project_slug(project_slug)?;
        validate_session_id(session_id)?;
        validate_character_id(character_id)?;

        let mut session = self.get_session(project_slug, session_id).await?;
        let mut found = false;
        for character in &mut session.characters {
            if character.character_id == character_id {
                character.controller = CharacterController::Agent;
                found = true;
            }
        }
        if !found {
            return Err(SimulationError::CharacterNotFound(character_id.to_string()));
        }
        if session.active_character_id.as_deref() == Some(character_id) {
            session.active_character_id = None;
        }

        self.persist_session(&session).await?;
        Ok(session)
    }

    async fn update_agent_states(
        &self,
        project_slug: &str,
        mut session: SimulationSession,
        round: u32,
    ) -> Result<SimulationSession, SimulationError> {
        // Each agent receives a persisted memory artifact for the round it just observed.
        // Character agents only receive their own action summary, while system agents receive the
        // full round transcript. That asymmetry is intentional and enforces the privacy model used
        // by the browser-facing simulation UI.
        let latest_round_entries: Vec<_> = session
            .logs
            .iter()
            .filter(|entry| entry.round == round)
            .cloned()
            .collect();
        let timepoint = format!("{}-round-{:04}", session.timepoint_id, round);

        let mut memory_keys = BTreeMap::new();
        for agent in &session.agents {
            let body = render_agent_memory_body(agent, &session, &latest_round_entries);
            let key = format!(
                "{}-session-{}-round-{:04}",
                agent.agent_id, session.session_id, round
            );
            self.memory
                .create(
                    project_slug,
                    CreateMemoryEntryRequest {
                        scope: MemoryScope::Agent {
                            agent: agent.agent_id.clone(),
                        },
                        key: key.clone(),
                        title: format!("{} round {}", agent.agent_id, round),
                        timeline: AGENT_MEMORY_TIMELINE.to_string(),
                        timepoint: timepoint.clone(),
                        body,
                    },
                )
                .await?;
            memory_keys.insert(agent.agent_id.clone(), key);
        }

        let mut updated_agents = session.agents.clone();
        for agent in &mut updated_agents {
            agent.round_memory_key = memory_keys.get(&agent.agent_id).cloned();
            agent.last_output = latest_round_entries
                .iter()
                .rev()
                .find(|entry| entry.actor_id == agent.agent_id)
                .map(|entry| entry.summary.clone());
        }

        session.agents = updated_agents;
        self.persist_session(&session).await?;
        Ok(session)
    }

    async fn persist_session(&self, session: &SimulationSession) -> Result<(), SimulationError> {
        self.storage
            .write_json(
                &session_metadata_path(&session.project_slug, &session.session_id),
                session,
            )
            .await?;
        Ok(())
    }

    async fn persist_log(&self, session: &SimulationSession) -> Result<(), SimulationError> {
        self.storage
            .write_text(
                &session_log_path(&session.project_slug, &session.session_id),
                &render_session_log(session),
            )
            .await?;
        Ok(())
    }

    async fn write_active_session(
        &self,
        project_slug: &str,
        session_id: &str,
    ) -> Result<(), SimulationError> {
        self.storage
            .write_text(&active_session_path(project_slug), session_id)
            .await?;
        Ok(())
    }
}

impl From<serde_json::Error> for SimulationError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

fn build_agent_states(characters: &[CharacterState]) -> Vec<AgentState> {
    let mut states = Vec::with_capacity(characters.len() + SYSTEM_ROLE_ORDER.len());
    for character in characters {
        states.push(AgentState {
            agent_id: character.character_id.clone(),
            role: SimulationRole::Character,
            round_memory_key: None,
            last_output: None,
        });
    }
    for role in SYSTEM_ROLE_ORDER {
        states.push(AgentState {
            agent_id: role.as_agent_id().to_string(),
            role,
            round_memory_key: None,
            last_output: None,
        });
    }
    states.sort_by(|left, right| left.agent_id.cmp(&right.agent_id));
    states
}

fn default_system_summary(role: SimulationRole, round: u32) -> String {
    match role {
        SimulationRole::Character => format!("Character action resolved for round {round}."),
        SimulationRole::RandomEvent => format!("Random event remains stable in round {round}."),
        SimulationRole::WorldMaintainer => {
            format!("World state maintained without drift in round {round}.")
        }
        SimulationRole::Kp => format!("KP adjudicates all declared actions in round {round}."),
        SimulationRole::ProjectAuditor => {
            format!("Project auditor keeps the session open after round {round}.")
        }
    }
}

fn render_round_summary(session: &SimulationSession, entries: &[SessionLogEntry]) -> String {
    let mut summary = format!(
        "Session {} round {} for timepoint {}.\n",
        session.session_id, session.round, session.timepoint_id
    );
    for entry in entries {
        let _ = writeln!(
            summary,
            "- [{}] {}: {}",
            entry.role.as_agent_id(),
            entry.actor_id,
            entry.summary
        );
    }
    summary
}

fn render_agent_memory_body(
    agent: &AgentState,
    session: &SimulationSession,
    entries: &[SessionLogEntry],
) -> String {
    // The rendered markdown becomes an auditable memory file under `memory/agents/...`.
    // Keeping it human-readable matters because the product treats these files as editable project
    // resources rather than opaque machine state.
    let visible_entries = match agent.role {
        SimulationRole::Character => entries
            .iter()
            .filter(|entry| entry.actor_id == agent.agent_id)
            .map(|entry| format!("- self: {}", entry.summary))
            .collect::<Vec<_>>(),
        _ => entries
            .iter()
            .map(|entry| {
                format!(
                    "- {} ({}): {}",
                    entry.actor_id,
                    entry.role.as_agent_id(),
                    entry.summary
                )
            })
            .collect::<Vec<_>>(),
    };

    let round_summary = match agent.role {
        SimulationRole::Character => format!(
            "Session {} round {} for timepoint {}.\n- [character] {} acts with agenda: {}\n",
            session.session_id,
            session.round,
            session.timepoint_id,
            agent.agent_id,
            session
                .characters
                .iter()
                .find(|character| character.character_id == agent.agent_id)
                .map_or("", |character| character.agenda.as_str())
        ),
        _ => render_round_summary(session, entries),
    };

    format!(
        "# Agent Memory\n\n## Agent\n{}\n\n## Round Summary\n{}\n\n## Visible Entries\n{}\n",
        agent.agent_id,
        round_summary.trim_end(),
        visible_entries.join("\n")
    )
}

fn render_session_log(session: &SimulationSession) -> String {
    let mut output = format!(
        "# Session {}\n\n- project: {}\n- timeline: {}\n- timepoint: {}\n- title: {}\n- round: {}\n- status: {}\n\n",
        session.session_id,
        session.project_slug,
        session.timeline,
        session.timepoint_id,
        session.title,
        session.round,
        if session.is_complete {
            "complete"
        } else {
            "active"
        }
    );

    output.push_str("## Characters\n");
    for character in &session.characters {
        let controller = match &character.controller {
            CharacterController::Agent => "agent".to_string(),
            CharacterController::UserPossessed { user_id } => format!("user:{user_id}"),
        };
        let _ = writeln!(
            output,
            "- {} ({}) [{}]",
            character.display_name, character.character_id, controller
        );
    }
    output.push('\n');

    let mut rounds: BTreeMap<u32, Vec<&SessionLogEntry>> = BTreeMap::new();
    for entry in &session.logs {
        rounds.entry(entry.round).or_default().push(entry);
    }

    for (round, entries) in rounds {
        let _ = writeln!(output, "## Round {round}");
        for entry in entries {
            let _ = writeln!(
                output,
                "{}. **{}** ({}) — {}",
                entry.turn,
                entry.actor_id,
                entry.role.as_agent_id(),
                entry.summary
            );
        }
        output.push('\n');
    }

    output
}

fn validate_project_slug(slug: &str) -> Result<(), SimulationError> {
    validate_segment(slug).map_err(|_| SimulationError::InvalidProjectSlug(slug.to_string()))?;
    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(SimulationError::InvalidProjectSlug(slug.to_string()));
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), SimulationError> {
    validate_identifier(session_id)
        .map_err(|_| SimulationError::InvalidSessionId(session_id.to_string()))
}

fn validate_character_id(character_id: &str) -> Result<(), SimulationError> {
    validate_identifier(character_id)
        .map_err(|_| SimulationError::InvalidCharacterId(character_id.to_string()))
}

fn validate_user_id(user_id: &str) -> Result<(), SimulationError> {
    validate_identifier(user_id).map_err(|_| SimulationError::InvalidUserId(user_id.to_string()))
}

fn validate_identifier(identifier: &str) -> Result<(), StorageError> {
    validate_segment(identifier)?;
    if identifier.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        Ok(())
    } else {
        Err(StorageError::InvalidPathSegment(identifier.to_string()))
    }
}

fn validate_title(title: &str) -> Result<(), SimulationError> {
    if title.trim().is_empty() {
        Err(SimulationError::InvalidTitle("title must not be empty"))
    } else {
        Ok(())
    }
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn simulation_root(project_slug: &str) -> PathBuf {
    project_root(project_slug).join("simulation")
}

fn active_session_path(project_slug: &str) -> PathBuf {
    project_root(project_slug).join(ACTIVE_SESSION_FILE)
}

fn session_metadata_path(project_slug: &str, session_id: &str) -> PathBuf {
    simulation_root(project_slug)
        .join("sessions")
        .join(format!("{session_id}.{SESSION_FILE_EXTENSION}"))
}

fn session_log_path(project_slug: &str, session_id: &str) -> PathBuf {
    simulation_root(project_slug)
        .join("logs")
        .join(format!("{session_id}.{LOG_FILE_EXTENSION}"))
}

async fn ensure_project_exists(
    storage: &Storage,
    project_slug: &str,
) -> Result<(), SimulationError> {
    if storage.exists(&project_root(project_slug)).await? {
        Ok(())
    } else {
        Err(SimulationError::ProjectNotFound(project_slug.to_string()))
    }
}

#[cfg(test)]
mod tests {
    async fn bootstrap_memory_session(
        storage: &Arc<Storage>,
    ) -> (MemoryService, SimulationService) {
        let projects = ProjectService::new(Arc::clone(storage));
        let memory = MemoryService::new(Arc::clone(storage));
        let service = SimulationService::with_memory(Arc::clone(storage), memory.clone());

        projects
            .create(CreateProjectRequest {
                slug: "memory-project".to_string(),
                title: "Memory".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        service
            .create_session(CreateSessionRequest {
                project_slug: "memory-project".to_string(),
                session_id: "session-0001".to_string(),
                timeline: "mainline".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Memory Session".to_string(),
                characters: vec![
                    CreateCharacterRequest {
                        character_id: "aria".to_string(),
                        display_name: "Aria".to_string(),
                        agenda: "Protect the vault".to_string(),
                    },
                    CreateCharacterRequest {
                        character_id: "borin".to_string(),
                        display_name: "Borin".to_string(),
                        agenda: "Track the infiltrator".to_string(),
                    },
                ],
            })
            .await
            .expect("session create should succeed");

        (memory, service)
    }

    fn round_request() -> AdvanceRoundRequest {
        AdvanceRoundRequest {
            character_actions: vec![
                CharacterAction {
                    character_id: "aria".to_string(),
                    summary: "Aria studies the vault sigils.".to_string(),
                },
                CharacterAction {
                    character_id: "borin".to_string(),
                    summary: "Borin marks every exit.".to_string(),
                },
            ],
            system_directives: BTreeMap::new(),
            auditor_concludes_session: false,
        }
    }

    fn memory_key(session: &super::SimulationSession, agent_id: &str) -> String {
        session
            .agents
            .iter()
            .find(|agent| agent.agent_id == agent_id)
            .and_then(|agent| agent.round_memory_key.clone())
            .expect("agent memory key should be recorded")
    }

    use std::{collections::BTreeMap, path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{
        AdvanceRoundRequest, CharacterAction, CharacterController, CreateCharacterRequest,
        CreateSessionRequest, PossessCharacterRequest, SimulationRole, SimulationService,
    };
    use crate::{
        memory::{MemoryScope, MemoryService},
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn session_lifecycle_and_active_pointer_persist() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = SimulationService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let created = service
            .create_session(CreateSessionRequest {
                project_slug: "alpha-project".to_string(),
                session_id: "session-0001".to_string(),
                timeline: "mainline".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Opening Session".to_string(),
                characters: vec![
                    CreateCharacterRequest {
                        character_id: "aria".to_string(),
                        display_name: "Aria".to_string(),
                        agenda: "Protect the archive".to_string(),
                    },
                    CreateCharacterRequest {
                        character_id: "borin".to_string(),
                        display_name: "Borin".to_string(),
                        agenda: "Expose the saboteur".to_string(),
                    },
                ],
            })
            .await
            .expect("session create should succeed");

        assert_eq!(created.round, 0);
        let active = tokio::fs::read_to_string(temp.path().join(Path::new(
            "projects/alpha-project/simulation/active-session.txt",
        )))
        .await
        .expect("active session file should exist");
        assert_eq!(active, "session-0001");

        let completed = service
            .advance_round(
                "alpha-project",
                "session-0001",
                AdvanceRoundRequest {
                    character_actions: vec![
                        CharacterAction {
                            character_id: "aria".to_string(),
                            summary: "Aria seals the archive doors.".to_string(),
                        },
                        CharacterAction {
                            character_id: "borin".to_string(),
                            summary: "Borin questions the lantern keeper.".to_string(),
                        },
                    ],
                    system_directives: BTreeMap::from([
                        (
                            SimulationRole::RandomEvent,
                            "A tremor rattles the old shelves.".to_string(),
                        ),
                        (
                            SimulationRole::Kp,
                            "KP rules the tremor reveals a hidden map.".to_string(),
                        ),
                    ]),
                    auditor_concludes_session: true,
                },
            )
            .await
            .expect("round advance should succeed");

        assert!(completed.is_complete);
        let active = tokio::fs::read_to_string(temp.path().join(Path::new(
            "projects/alpha-project/simulation/active-session.txt",
        )))
        .await
        .expect("active session file should exist");
        assert!(active.is_empty());
    }

    #[tokio::test]
    async fn round_order_and_logs_are_deterministic() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = SimulationService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "order-project".to_string(),
                title: "Order".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        service
            .create_session(CreateSessionRequest {
                project_slug: "order-project".to_string(),
                session_id: "session-0001".to_string(),
                timeline: "mainline".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Ordered Session".to_string(),
                characters: vec![
                    CreateCharacterRequest {
                        character_id: "borin".to_string(),
                        display_name: "Borin".to_string(),
                        agenda: "Second by id".to_string(),
                    },
                    CreateCharacterRequest {
                        character_id: "aria".to_string(),
                        display_name: "Aria".to_string(),
                        agenda: "First by id".to_string(),
                    },
                ],
            })
            .await
            .expect("session create should succeed");

        let session = service
            .advance_round(
                "order-project",
                "session-0001",
                AdvanceRoundRequest {
                    character_actions: vec![
                        CharacterAction {
                            character_id: "borin".to_string(),
                            summary: "Borin acts second.".to_string(),
                        },
                        CharacterAction {
                            character_id: "aria".to_string(),
                            summary: "Aria acts first.".to_string(),
                        },
                    ],
                    system_directives: BTreeMap::from([(
                        SimulationRole::ProjectAuditor,
                        "Project auditor keeps the timepoint open.".to_string(),
                    )]),
                    auditor_concludes_session: false,
                },
            )
            .await
            .expect("round advance should succeed");

        let order: Vec<_> = session
            .logs
            .iter()
            .map(|entry| entry.actor_id.as_str())
            .collect();
        assert_eq!(
            order,
            vec![
                "aria",
                "borin",
                "random-event",
                "world-maintainer",
                "kp",
                "project-auditor",
            ]
        );

        let persisted = tokio::fs::read_to_string(temp.path().join(Path::new(
            "projects/order-project/simulation/logs/session-0001.md",
        )))
        .await
        .expect("session log should persist");
        assert!(persisted.contains("1. **aria** (character) — Aria acts first."));
        assert!(persisted.contains(
            "6. **project-auditor** (project-auditor) — Project auditor keeps the timepoint open."
        ));
    }

    #[tokio::test]
    async fn possession_persists_across_reload() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let service = SimulationService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "possession-project".to_string(),
                title: "Possession".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        service
            .create_session(CreateSessionRequest {
                project_slug: "possession-project".to_string(),
                session_id: "session-0001".to_string(),
                timeline: "mainline".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Possession Session".to_string(),
                characters: vec![CreateCharacterRequest {
                    character_id: "aria".to_string(),
                    display_name: "Aria".to_string(),
                    agenda: "Keep watch".to_string(),
                }],
            })
            .await
            .expect("session create should succeed");

        service
            .possess_character(
                "possession-project",
                "session-0001",
                PossessCharacterRequest {
                    character_id: "aria".to_string(),
                    user_id: "user-007".to_string(),
                },
            )
            .await
            .expect("possession should succeed");

        let reloaded = service
            .get_session("possession-project", "session-0001")
            .await
            .expect("session should reload");
        assert_eq!(reloaded.active_character_id.as_deref(), Some("aria"));
        assert!(matches!(
            reloaded.characters[0].controller,
            CharacterController::UserPossessed { ref user_id } if user_id == "user-007"
        ));
    }

    #[tokio::test]
    async fn agent_memory_is_separated_by_agent_scope() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let (memory, service) = bootstrap_memory_session(&storage).await;

        let session = service
            .advance_round("memory-project", "session-0001", round_request())
            .await
            .expect("round advance should succeed");

        let aria_key = memory_key(&session, "aria");
        let kp_key = memory_key(&session, "kp");

        let aria_memory = memory
            .get(
                "memory-project",
                &MemoryScope::Agent {
                    agent: "aria".to_string(),
                },
                "simulation",
                "tp-0001-round-0001",
                &aria_key,
            )
            .await
            .expect("aria memory should load");
        let kp_memory = memory
            .get(
                "memory-project",
                &MemoryScope::Agent {
                    agent: "kp".to_string(),
                },
                "simulation",
                "tp-0001-round-0001",
                &kp_key,
            )
            .await
            .expect("kp memory should load");

        assert!(
            aria_memory
                .body
                .contains("- self: Aria studies the vault sigils.")
        );
        assert!(!aria_memory.body.contains("Borin marks every exit."));
        assert!(
            kp_memory
                .body
                .contains("- aria (character): Aria studies the vault sigils.")
        );
        assert!(
            kp_memory
                .body
                .contains("- borin (character): Borin marks every exit.")
        );
    }
}
