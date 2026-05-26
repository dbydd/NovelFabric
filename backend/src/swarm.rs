use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    agent_output::{AgentRoundAction, AgentRoundOutput, ConsistencyChecks, ConsistencyStatus},
    simulation::{SessionLogEntry, SimulationRole, SimulationSession},
    storage::{Storage, StorageError},
    story_rag::{StoryRagError, StoryRagHit, StoryRagService},
};

const PROJECTS_DIR: &str = "projects";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwarmTurnContext {
    pub project_slug: String,
    pub session_id: String,
    pub round: u32,
    pub timeline: String,
    pub timepoint_id: String,
    pub recent_logs: Vec<SessionLogEntry>,
    pub rag_hits: Vec<StoryRagHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwarmTurnRecord {
    pub session_id: String,
    pub round: u32,
    pub timepoint_id: String,
    pub contexts: Vec<SwarmAgentTurnContext>,
    pub outputs: Vec<AgentRoundOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwarmAgentTurnContext {
    pub agent_id: String,
    pub role: SimulationRole,
    pub intent: String,
    pub reasoning_summary: String,
    pub evidence: Vec<String>,
    pub consistency_checks: ConsistencyChecks,
    pub rag_hits: Vec<StoryRagHit>,
}

#[derive(Debug, Clone)]
pub struct SwarmService {
    storage: Arc<Storage>,
    rag: StoryRagService,
}

#[derive(Debug, Error)]
pub enum SwarmError {
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Rag(#[from] StoryRagError),
}

impl SwarmService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        let rag = StoryRagService::new(Arc::clone(&storage));
        Self { storage, rag }
    }

    pub async fn build_turn_record(
        &self,
        session: &SimulationSession,
    ) -> Result<SwarmTurnRecord, SwarmError> {
        ensure_project_exists(self.storage.as_ref(), &session.project_slug).await?;
        let latest_round_entries: Vec<_> = session
            .logs
            .iter()
            .filter(|entry| entry.round == session.round)
            .cloned()
            .collect();
        let shared_context = self
            .build_shared_context(session, latest_round_entries.clone())
            .await?;

        let mut contexts = Vec::new();
        let mut outputs = Vec::new();
        for agent in &session.agents {
            let agent_assets = self
                .load_agent_inputs(&session.project_slug, agent.agent_id.as_str())
                .await?;
            let intent = match agent.role {
                SimulationRole::Character => "character_decision",
                SimulationRole::RandomEvent => "random_event",
                SimulationRole::WorldMaintainer => "world_update",
                SimulationRole::Kp => "kp_adjudicate",
                SimulationRole::ProjectAuditor => "project_audit",
            }
            .to_string();
            let mut evidence = shared_context
                .rag_hits
                .iter()
                .take(4)
                .map(|hit| hit.source_path.clone())
                .collect::<Vec<_>>();
            evidence.extend(agent_assets.evidence_paths());
            evidence.sort();
            evidence.dedup();
            let consistency_checks = build_consistency_checks(
                &shared_context.rag_hits,
                &latest_round_entries,
                &agent_assets,
            );
            let actions = build_runtime_actions(
                agent.agent_id.as_str(),
                session,
                &agent_assets,
                &round_memory_path(agent.agent_id.as_str(), session.round),
                audit_path(agent.agent_id.as_str(), session.round),
            );
            outputs.push(AgentRoundOutput {
                agent_id: agent.agent_id.clone(),
                role: agent.role,
                intent: intent.clone(),
                reasoning_summary: build_reasoning_summary(
                    agent.agent_id.as_str(),
                    &latest_round_entries,
                    &agent_assets,
                ),
                evidence: evidence.clone(),
                actions,
                consistency_checks: consistency_checks.clone(),
            });
            contexts.push(SwarmAgentTurnContext {
                agent_id: agent.agent_id.clone(),
                role: agent.role,
                intent,
                reasoning_summary: build_reasoning_summary(
                    agent.agent_id.as_str(),
                    &latest_round_entries,
                    &agent_assets,
                ),
                evidence,
                consistency_checks,
                rag_hits: shared_context.rag_hits.iter().take(6).cloned().collect(),
            });
        }

        Ok(SwarmTurnRecord {
            session_id: session.session_id.clone(),
            round: session.round,
            timepoint_id: session.timepoint_id.clone(),
            contexts,
            outputs,
        })
    }

    pub async fn persist_turn_record(
        &self,
        project_slug: &str,
        record: &SwarmTurnRecord,
    ) -> Result<(), SwarmError> {
        self.storage
            .write_json(
                &swarm_round_path(project_slug, &record.session_id, record.round),
                record,
            )
            .await?;
        self.storage
            .write_text(
                &swarm_round_audit_path(project_slug, &record.session_id, record.round),
                &render_turn_audit(record),
            )
            .await?;
        Ok(())
    }

    pub async fn get_turn_record(
        &self,
        project_slug: &str,
        session_id: &str,
        round: u32,
    ) -> Result<Option<SwarmTurnRecord>, SwarmError> {
        let path = swarm_round_path(project_slug, session_id, round);
        if !self.storage.exists(&path).await? {
            return Ok(None);
        }
        let text = self.storage.read_text(&path).await?;
        Ok(Some(
            serde_json::from_str(&text).map_err(StorageError::Json)?,
        ))
    }

    async fn build_shared_context(
        &self,
        session: &SimulationSession,
        recent_logs: Vec<SessionLogEntry>,
    ) -> Result<SwarmTurnContext, SwarmError> {
        let query = build_round_query(session, &recent_logs);
        let mut hits = self
            .rag
            .quick_search(&session.project_slug, &query)
            .await?
            .hits;
        if hits.is_empty() {
            for character in &session.characters {
                let mut fallback = self
                    .rag
                    .quick_search(&session.project_slug, &character.display_name)
                    .await?
                    .hits;
                hits.append(&mut fallback);
                if !hits.is_empty() {
                    break;
                }
            }
        }
        if hits.is_empty() {
            for entry in recent_logs.iter().rev() {
                let mut fallback = self
                    .rag
                    .quick_search(&session.project_slug, &first_query_token(&entry.summary))
                    .await?
                    .hits;
                hits.append(&mut fallback);
                if !hits.is_empty() {
                    break;
                }
            }
        }
        dedupe_hits(&mut hits);
        if hits.is_empty() {
            hits = recent_logs
                .iter()
                .rev()
                .take(6)
                .map(|entry| StoryRagHit {
                    fact: entry.summary.clone(),
                    source_path: format!("simulation/logs/{}.md", session.session_id),
                    timeline: Some(session.timeline.clone()),
                    timepoint: Some(session.timepoint_id.clone()),
                    score: 1.0,
                })
                .collect();
        }
        Ok(SwarmTurnContext {
            project_slug: session.project_slug.clone(),
            session_id: session.session_id.clone(),
            round: session.round,
            timeline: session.timeline.clone(),
            timepoint_id: session.timepoint_id.clone(),
            recent_logs,
            rag_hits: hits,
        })
    }
}

#[derive(Debug, Clone, Default)]
struct AgentPlanningInputs {
    soul_headline: String,
    memory_headline: String,
    skills: Vec<String>,
    target_hint: Option<String>,
    mode_hint: Option<String>,
    priority_hint: Option<String>,
    consistency_hint: Option<String>,
    scope_hint: Option<String>,
    section_hint: Option<String>,
}

impl AgentPlanningInputs {
    fn evidence_paths(&self) -> Vec<String> {
        let mut paths = vec![];
        if !self.soul_headline.is_empty() {
            paths.push("agents/soul.md".to_string());
        }
        if !self.memory_headline.is_empty() {
            paths.push("agents/memory.md".to_string());
        }
        if !self.skills.is_empty() {
            paths.push("agents/skills".to_string());
        }
        paths
    }
}

impl SwarmService {
    async fn load_agent_inputs(
        &self,
        project_slug: &str,
        agent_id: &str,
    ) -> Result<AgentPlanningInputs, SwarmError> {
        let agent_root = project_root(project_slug).join("agents").join(agent_id);
        let soul = self.read_optional_text(&agent_root.join("soul.md")).await?;
        let memory = self
            .read_optional_text(&agent_root.join("memory.md"))
            .await?;
        let skills_path = agent_root.join("skills");
        let skills = if self.storage.exists(&skills_path).await? {
            self.storage
                .list_files(&skills_path)
                .await?
                .into_iter()
                .filter_map(|file| {
                    file.file_name()
                        .and_then(std::ffi::OsStr::to_str)
                        .map(ToString::to_string)
                })
                .collect()
        } else {
            Vec::new()
        };
        let (target_hint, mode_hint, priority_hint, consistency_hint, scope_hint, section_hint) =
            self.load_skill_metadata(&skills_path).await?;
        Ok(AgentPlanningInputs {
            soul_headline: first_heading_or_empty(&soul),
            memory_headline: first_heading_or_empty(&memory),
            skills,
            target_hint,
            mode_hint,
            priority_hint,
            consistency_hint,
            scope_hint,
            section_hint,
        })
    }

    async fn read_optional_text(&self, path: &Path) -> Result<String, SwarmError> {
        if self.storage.exists(path).await? {
            Ok(self.storage.read_text(path).await?)
        } else {
            Ok(String::new())
        }
    }

    async fn load_skill_metadata(
        &self,
        skills_path: &Path,
    ) -> Result<
        (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
        SwarmError,
    > {
        let mut target_hint = None;
        let mut mode_hint = None;
        let mut priority_hint = None;
        let mut consistency_hint = None;
        let mut scope_hint = None;
        let mut section_hint = None;
        if !self.storage.exists(skills_path).await? {
            return Ok((None, None, None, None, None, None));
        }
        for file in self.storage.list_files(skills_path).await? {
            let relative = file
                .strip_prefix(self.storage.root())
                .map(Path::to_path_buf)
                .map_err(|_| SwarmError::Storage(StorageError::PathEscapesRoot))?;
            let text = self.storage.read_text(&relative).await?;
            for line in text.lines().take(8) {
                let trimmed = line.trim();
                if let Some(value) = trimmed.strip_prefix("target:") {
                    target_hint = Some(value.trim().to_string());
                }
                if let Some(value) = trimmed.strip_prefix("mode:") {
                    mode_hint = Some(value.trim().to_string());
                }
                if let Some(value) = trimmed.strip_prefix("priority:") {
                    priority_hint = Some(value.trim().to_string());
                }
                if let Some(value) = trimmed.strip_prefix("consistency:") {
                    consistency_hint = Some(value.trim().to_string());
                }
                if let Some(value) = trimmed.strip_prefix("scope:") {
                    scope_hint = Some(value.trim().to_string());
                }
                if let Some(value) = trimmed.strip_prefix("section:") {
                    section_hint = Some(value.trim().to_string());
                }
            }
        }
        Ok((
            target_hint,
            mode_hint,
            priority_hint,
            consistency_hint,
            scope_hint,
            section_hint,
        ))
    }
}

fn first_heading_or_empty(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .unwrap_or("")
        .to_string()
}

fn build_round_query(session: &SimulationSession, recent_logs: &[SessionLogEntry]) -> String {
    let mut tokens = vec![session.title.clone(), session.timepoint_id.clone()];
    tokens.extend(
        session
            .characters
            .iter()
            .map(|character| character.display_name.clone()),
    );
    tokens.extend(
        recent_logs
            .iter()
            .rev()
            .take(3)
            .map(|entry| entry.summary.clone()),
    );
    tokens.join(" ")
}

fn first_query_token(text: &str) -> String {
    text.split(|character: char| {
        character.is_whitespace() || [',', '，', '.', '。', ':', '：'].contains(&character)
    })
    .map(str::trim)
    .find(|token| !token.is_empty())
    .unwrap_or(text)
    .to_string()
}

fn dedupe_hits(hits: &mut Vec<StoryRagHit>) {
    let mut seen = std::collections::BTreeSet::new();
    hits.retain(|hit| seen.insert((hit.source_path.clone(), hit.fact.clone())));
}

fn build_reasoning_summary(
    agent_id: &str,
    recent_logs: &[SessionLogEntry],
    inputs: &AgentPlanningInputs,
) -> String {
    if let Some(entry) = recent_logs
        .iter()
        .rev()
        .find(|entry| entry.actor_id == agent_id)
    {
        format!(
            "Latest structured action for {agent_id}: {} | soul={} | memory={} | skills={} | scope={}",
            entry.summary,
            inputs.soul_headline,
            inputs.memory_headline,
            inputs.skills.join(","),
            inputs.scope_hint.as_deref().unwrap_or("default")
        )
    } else {
        format!(
            "{agent_id} has no direct action in the latest round and relies on shared context. soul={} memory={} skills={} scope={}",
            inputs.soul_headline,
            inputs.memory_headline,
            inputs.skills.join(","),
            inputs.scope_hint.as_deref().unwrap_or("default")
        )
    }
}

fn build_consistency_checks(
    rag_hits: &[StoryRagHit],
    recent_logs: &[SessionLogEntry],
    inputs: &AgentPlanningInputs,
) -> ConsistencyChecks {
    let timeline = if rag_hits.iter().any(|hit| {
        hit.timeline
            .as_deref()
            .is_some_and(|timeline| timeline != "main" && timeline != "simulation")
    }) {
        ConsistencyStatus::Warn
    } else {
        ConsistencyStatus::Pass
    };
    let world = if rag_hits.is_empty() {
        ConsistencyStatus::Warn
    } else {
        ConsistencyStatus::Pass
    };
    let rules = if recent_logs
        .iter()
        .any(|entry| entry.role == SimulationRole::Kp)
    {
        ConsistencyStatus::Pass
    } else {
        ConsistencyStatus::Warn
    };
    let ooc = if recent_logs
        .iter()
        .any(|entry| entry.role == SimulationRole::Character && entry.summary.trim().is_empty())
    {
        ConsistencyStatus::Warn
    } else {
        ConsistencyStatus::Pass
    };
    let mut checks = ConsistencyChecks {
        ooc,
        world,
        timeline,
        rules,
    };
    if let Some(hint) = inputs.consistency_hint.as_deref() {
        match hint {
            "rules" => checks.rules = ConsistencyStatus::Warn,
            "world" => checks.world = ConsistencyStatus::Warn,
            "timeline" => checks.timeline = ConsistencyStatus::Warn,
            "ooc" => checks.ooc = ConsistencyStatus::Warn,
            _ => {}
        }
    }
    checks
}

fn has_skill(inputs: &AgentPlanningInputs, skill_name: &str) -> bool {
    inputs.skills.iter().any(|skill| skill == skill_name)
}

fn target_hint_path(hint: &str, memory_path: &str) -> Option<String> {
    match hint {
        "memory" => Some(memory_path.to_string()),
        "world" => Some("cards/world/current-world-state.md".to_string()),
        "rules" => Some("cards/rules/runtime-kp-rulings.md".to_string()),
        "history" => Some("history/project-audit-log.md".to_string()),
        "events" => Some("simulation/random-events.md".to_string()),
        _ => None,
    }
}

fn resolve_primary_target(
    role: SimulationRole,
    inputs: &AgentPlanningInputs,
    memory_path: &str,
) -> String {
    if let Some(hint) = inputs
        .target_hint
        .as_deref()
        .and_then(|hint| target_hint_path(hint, memory_path))
    {
        return hint;
    }
    if has_skill(inputs, "memory-summarize.md") || has_skill(inputs, "character-decision.md") {
        return memory_path.to_string();
    }
    if has_skill(inputs, "world-update.md") {
        return "cards/world/current-world-state.md".to_string();
    }
    if has_skill(inputs, "kp-adjudicate.md") {
        return "cards/rules/runtime-kp-rulings.md".to_string();
    }
    if has_skill(inputs, "project-audit.md") {
        return "history/project-audit-log.md".to_string();
    }

    match role {
        SimulationRole::Character => memory_path.to_string(),
        SimulationRole::WorldMaintainer => "cards/world/current-world-state.md".to_string(),
        SimulationRole::Kp => "cards/rules/runtime-kp-rulings.md".to_string(),
        SimulationRole::ProjectAuditor => "history/project-audit-log.md".to_string(),
        SimulationRole::RandomEvent => "simulation/random-events.md".to_string(),
    }
}

const fn default_section_for_role(role: SimulationRole) -> Option<&'static str> {
    match role {
        SimulationRole::Character => None,
        SimulationRole::WorldMaintainer => Some("World Updates"),
        SimulationRole::Kp => Some("KP Rulings"),
        SimulationRole::ProjectAuditor => Some("Audit Trail"),
        SimulationRole::RandomEvent => Some("Random Events"),
    }
}

fn build_runtime_actions(
    agent_id: &str,
    session: &SimulationSession,
    inputs: &AgentPlanningInputs,
    memory_path: &str,
    audit_path: String,
) -> Vec<AgentRoundAction> {
    let role = session
        .agents
        .iter()
        .find(|agent| agent.agent_id == agent_id)
        .map_or(SimulationRole::ProjectAuditor, |agent| agent.role);
    let role_note = match role {
        SimulationRole::Character => "character decision persisted",
        SimulationRole::RandomEvent => "random event note persisted",
        SimulationRole::WorldMaintainer => "world maintenance note persisted",
        SimulationRole::Kp => "kp ruling persisted",
        SimulationRole::ProjectAuditor => "project audit note persisted",
    };
    let mut actions = vec![AgentRoundAction::AppendAudit {
        path: audit_path,
        content: format!(
            "- round {} session {} :: {} | priority={} | soul={} | skills={}\n",
            session.round,
            session.session_id,
            role_note,
            inputs.priority_hint.as_deref().unwrap_or("normal"),
            inputs.soul_headline,
            inputs.skills.join(",")
        ),
    }];
    let primary_target = resolve_primary_target(role, inputs, memory_path);
    let role_key = match role {
        SimulationRole::Character => "character",
        SimulationRole::RandomEvent => "random-event",
        SimulationRole::WorldMaintainer => "world-maintainer",
        SimulationRole::Kp => "kp",
        SimulationRole::ProjectAuditor => "project-auditor",
    };
    let primary_content = format!(
        "- round: {}\n- timepoint: {}\n- role: {}\n- summary: {}\n- memory: {}\n- skills: {}\n",
        session.round,
        session.timepoint_id,
        role_key,
        role_note,
        inputs.memory_headline,
        inputs.skills.join(",")
    );
    if inputs.mode_hint.as_deref() == Some("append_memory") || primary_target == memory_path {
        actions.push(AgentRoundAction::AppendMemory {
            path: primary_target,
            content: primary_content,
        });
    } else if inputs.mode_hint.as_deref() == Some("replace_section") {
        let section = inputs.section_hint.as_deref().unwrap_or("Runtime Notes");
        let old = format!("## {section}\n");
        let new = format!("## {section}\n{primary_content}");
        actions.push(AgentRoundAction::ReplaceProjectSection {
            path: primary_target,
            old,
            new,
        });
    } else if inputs.mode_hint.as_deref() == Some("append_section") {
        let section = inputs.section_hint.as_deref().unwrap_or("Runtime Notes");
        let marker = format!("## {section}\n");
        actions.push(AgentRoundAction::AppendProjectSection {
            path: primary_target,
            marker,
            content: primary_content,
        });
    } else if let Some(section) = default_section_for_role(role) {
        let marker = format!("## {section}\n");
        actions.push(AgentRoundAction::AppendProjectSection {
            path: primary_target,
            marker,
            content: primary_content,
        });
    } else {
        actions.push(AgentRoundAction::AppendProjectText {
            path: primary_target,
            content: primary_content,
        });
    }
    actions
}

fn round_memory_path(agent_id: &str, _round: u32) -> String {
    format!("agents/{agent_id}/memory.md")
}

fn audit_path(agent_id: &str, round: u32) -> String {
    let _ = round;
    format!("agents/{agent_id}/audit/runtime-round-log.md")
}

fn render_turn_audit(record: &SwarmTurnRecord) -> String {
    let mut out = format!(
        "# StorySwarm Round Audit\n\n- session: {}\n- round: {}\n- timepoint: {}\n\n",
        record.session_id, record.round, record.timepoint_id
    );
    for context in &record.contexts {
        let _ = writeln!(
            out,
            "## {} ({:?})\n- intent: {}\n- reasoning: {}\n- checks: OOC={:?} WORLD={:?} TIMELINE={:?} RULES={:?}",
            context.agent_id,
            context.role,
            context.intent,
            context.reasoning_summary,
            context.consistency_checks.ooc,
            context.consistency_checks.world,
            context.consistency_checks.timeline,
            context.consistency_checks.rules
        );
        if !context.evidence.is_empty() {
            out.push_str("- evidence:\n");
            for item in &context.evidence {
                let _ = writeln!(out, "  - {item}");
            }
        }
        if !context.rag_hits.is_empty() {
            out.push_str("- rag hits:\n");
            for hit in &context.rag_hits {
                let _ = writeln!(out, "  - {} :: {}", hit.source_path, hit.fact);
            }
        }
        if let Some(output) = record
            .outputs
            .iter()
            .find(|output| output.agent_id == context.agent_id)
        {
            out.push_str("- runtime plan:\n");
            for action in &output.actions {
                match action {
                    AgentRoundAction::AppendAudit { path, .. } => {
                        let _ = writeln!(out, "  - append_audit -> {path}");
                    }
                    AgentRoundAction::AppendMemory { path, .. } => {
                        let _ = writeln!(out, "  - append_memory -> {path}");
                    }
                    AgentRoundAction::AppendProjectText { path, .. } => {
                        let _ = writeln!(out, "  - append_project_text -> {path}");
                    }
                    AgentRoundAction::ReplaceProjectSection { path, old, .. } => {
                        let _ = writeln!(out, "  - replace_section -> {} [{}]", path, old.trim());
                    }
                    AgentRoundAction::AppendProjectSection { path, marker, .. } => {
                        let _ = writeln!(out, "  - append_section -> {} [{}]", path, marker.trim());
                    }
                }
            }
        }
        out.push('\n');
    }
    out
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn swarm_round_path(project_slug: &str, session_id: &str, round: u32) -> PathBuf {
    project_root(project_slug)
        .join("simulation/swarm")
        .join(session_id)
        .join(format!("round-{round:04}.json"))
}

fn swarm_round_audit_path(project_slug: &str, session_id: &str, round: u32) -> PathBuf {
    project_root(project_slug)
        .join("simulation/swarm")
        .join(session_id)
        .join(format!("round-{round:04}.md"))
}

async fn ensure_project_exists(storage: &Storage, project_slug: &str) -> Result<(), SwarmError> {
    if storage.exists(&project_root(project_slug)).await? {
        Ok(())
    } else {
        Err(SwarmError::ProjectNotFound(project_slug.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::SwarmService;
    use crate::{
        cards::{CardKind, CardService, CreateCardRequest},
        project::{CreateProjectRequest, ProjectService},
        simulation::{
            AdvanceRoundRequest, CharacterAction, CreateCharacterRequest, CreateSessionRequest,
            SimulationRole, SimulationService,
        },
        storage::Storage,
        writing::{CreateChapterRequest, WritingService},
    };

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn builds_and_persists_swarm_turn_record() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let swarm = SwarmService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "swarm-project".to_string(),
                title: "Swarm Project".to_string(),
                description: "story swarm".to_string(),
            })
            .await
            .expect("project");
        cards
            .create(CreateCardRequest {
                project_slug: "swarm-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Aria protects the vault.".to_string(),
            })
            .await
            .expect("card");
        writing
            .create_chapter(
                "swarm-project",
                CreateChapterRequest {
                    id: "chapter-001".to_string(),
                    title: "Chapter 1".to_string(),
                    body: "Aria enters the vault.".to_string(),
                },
            )
            .await
            .expect("chapter");

        simulation
            .create_session(CreateSessionRequest {
                project_slug: "swarm-project".to_string(),
                session_id: "session-001".to_string(),
                timeline: "main".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Vault session".to_string(),
                characters: vec![CreateCharacterRequest {
                    character_id: "aria".to_string(),
                    display_name: "Aria".to_string(),
                    agenda: "Protect the vault".to_string(),
                }],
            })
            .await
            .expect("session");
        let session = simulation
            .advance_round(
                "swarm-project",
                "session-001",
                AdvanceRoundRequest {
                    character_actions: vec![CharacterAction {
                        character_id: "aria".to_string(),
                        summary: "Aria blocks the gate.".to_string(),
                    }],
                    system_directives: BTreeMap::from([(
                        SimulationRole::RandomEvent,
                        "A vault echo reveals an old oath.".to_string(),
                    )]),
                    auditor_concludes_session: false,
                },
            )
            .await
            .expect("advance");

        storage
            .write_text(
                Path::new("projects/swarm-project/agents/aria/soul.md"),
                "# Aria Soul\n\n## Role\nProtect the vault.",
            )
            .await
            .expect("soul");
        storage
            .write_text(
                Path::new("projects/swarm-project/agents/aria/memory.md"),
                "# Aria Memory\n\n- remembers the oath.",
            )
            .await
            .expect("memory");
        storage
            .write_text(
                Path::new("projects/swarm-project/agents/aria/skills/character-decision.md"),
                "# character-decision",
            )
            .await
            .expect("skill");

        let record = swarm.build_turn_record(&session).await.expect("record");
        assert!(!record.contexts.is_empty());
        assert!(record.contexts.iter().any(|ctx| !ctx.rag_hits.is_empty()));
        assert!(
            record
                .outputs
                .iter()
                .any(|output| output.reasoning_summary.contains("Aria Soul"))
        );
        assert!(
            record
                .outputs
                .iter()
                .any(|output| output.reasoning_summary.contains("character-decision"))
        );

        swarm
            .persist_turn_record("swarm-project", &record)
            .await
            .expect("persist");
        assert!(
            tokio::fs::try_exists(
                Path::new(temp.path())
                    .join("projects/swarm-project/simulation/swarm/session-001/round-0001.json")
            )
            .await
            .expect("json exists")
        );
        assert!(
            tokio::fs::try_exists(
                Path::new(temp.path())
                    .join("projects/swarm-project/simulation/swarm/session-001/round-0001.md")
            )
            .await
            .expect("md exists")
        );
    }
}
