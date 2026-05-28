use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    agent_output::{
        AgentRoundAction, AgentRoundOutput, ConsistencyChecks, ConsistencyStatus,
        SkillInvocationEvidence,
    },
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
            evidence.extend(agent_assets.evidence_paths(agent.agent_id.as_str()));
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
            let skill_invocations = build_skill_invocation_evidence(
                &agent_assets,
                &actions,
                &evidence,
                &consistency_checks,
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
                skill_invocations,
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
pub struct SkillMetadata {
    pub file_name: String,
    pub intent: Option<String>,
    pub target: Option<String>,
    pub mode: Option<String>,
    pub scope: Option<String>,
    pub consistency: Option<String>,
    pub priority: Option<String>,
    pub section_hint: Option<String>,
}

fn parse_yaml_frontmatter(text: &str) -> Vec<(String, String)> {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("---") else {
        return Vec::new();
    };
    let Some(end) = rest.find("\n---") else {
        return Vec::new();
    };
    let frontmatter = &rest[..end];
    frontmatter
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let colon = line.find(':')?;
            if colon == 0 {
                return None;
            }
            let key = line[..colon].trim().to_lowercase();
            let value = line[colon + 1..].trim().to_string();
            Some((key, value))
        })
        .collect()
}

fn extract_skill_metadata(file_name: &str, content: &str) -> SkillMetadata {
    let pairs = parse_yaml_frontmatter(content);
    let mut meta = SkillMetadata {
        file_name: file_name.to_string(),
        intent: None,
        target: None,
        mode: None,
        scope: None,
        consistency: None,
        priority: None,
        section_hint: None,
    };
    for (key, value) in pairs {
        match key.as_str() {
            "intent" => meta.intent = Some(value),
            "target" => meta.target = Some(value),
            "mode" => meta.mode = Some(value),
            "scope" => meta.scope = Some(value),
            "consistency" => meta.consistency = Some(value),
            "priority" => meta.priority = Some(value),
            "section" => meta.section_hint = Some(value),
            _ => {}
        }
    }
    meta
}

fn render_skill_invocation(meta: &SkillMetadata) -> String {
    let mut parts = Vec::new();
    parts.push(format!("skill: {}", meta.file_name));
    if let Some(intent) = &meta.intent {
        parts.push(format!("  intent: {intent}"));
    }
    if let Some(target) = &meta.target {
        parts.push(format!("  target: {target}"));
    }
    if let Some(mode) = &meta.mode {
        parts.push(format!("  mode: {mode}"));
    }
    if let Some(scope) = &meta.scope {
        parts.push(format!("  scope: {scope}"));
    }
    if let Some(consistency) = &meta.consistency {
        parts.push(format!("  consistency: {consistency}"));
    }
    parts.join("\n")
}

#[derive(Debug, Clone, Default)]
struct AgentPlanningInputs {
    soul_headline: String,
    memory_headline: String,
    skills: Vec<String>,
    skill_invocations: Vec<SkillMetadata>,
}

impl AgentPlanningInputs {
    fn evidence_paths(&self, agent_id: &str) -> Vec<String> {
        let mut paths = vec![];
        if !self.soul_headline.is_empty() {
            paths.push(format!("agents/{agent_id}/soul.md"));
        }
        if !self.memory_headline.is_empty() {
            paths.push(format!("agents/{agent_id}/memory.md"));
        }
        for skill in &self.skill_invocations {
            paths.push(format!("agents/{agent_id}/skills/{}", skill.file_name));
        }
        paths
    }

    fn target_hint(&self) -> Option<String> {
        self.skill_invocations
            .iter()
            .find_map(|skill| skill.target.clone())
    }

    fn mode_hint(&self) -> Option<String> {
        self.skill_invocations
            .iter()
            .find_map(|skill| skill.mode.clone())
    }

    fn scope_hint(&self) -> Option<String> {
        self.skill_invocations
            .iter()
            .find_map(|skill| skill.scope.clone())
    }

    fn section_hint(&self) -> Option<String> {
        self.skill_invocations
            .iter()
            .find_map(|skill| skill.section_hint.clone())
    }

    fn priority_hint(&self) -> Option<String> {
        self.skill_invocations
            .iter()
            .find_map(|skill| skill.priority.clone())
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
        let skill_invocations = self.load_skill_invocations(&skills_path).await?;
        Ok(AgentPlanningInputs {
            soul_headline: first_heading_or_empty(&soul),
            memory_headline: first_heading_or_empty(&memory),
            skills,
            skill_invocations,
        })
    }

    async fn read_optional_text(&self, path: &Path) -> Result<String, SwarmError> {
        if self.storage.exists(path).await? {
            Ok(self.storage.read_text(path).await?)
        } else {
            Ok(String::new())
        }
    }

    async fn load_skill_invocations(
        &self,
        skills_path: &Path,
    ) -> Result<Vec<SkillMetadata>, SwarmError> {
        if !self.storage.exists(skills_path).await? {
            return Ok(Vec::new());
        }
        let mut invocations = Vec::new();
        for file in self.storage.list_files(skills_path).await? {
            let relative = file
                .strip_prefix(self.storage.root())
                .map(Path::to_path_buf)
                .map_err(|_| SwarmError::Storage(StorageError::PathEscapesRoot))?;
            let file_name = relative
                .file_name()
                .and_then(std::ffi::OsStr::to_str)
                .unwrap_or("")
                .to_string();
            let text = self.storage.read_text(&relative).await?;
            let meta = extract_skill_metadata(&file_name, &text);
            invocations.push(meta);
        }
        Ok(invocations)
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
    let skill_lines = if inputs.skill_invocations.is_empty() {
        String::new()
    } else {
        let mut lines: Vec<String> = inputs
            .skill_invocations
            .iter()
            .map(render_skill_invocation)
            .collect();
        lines.insert(0, "--- invoked skills ---".to_string());
        lines.push("---".to_string());
        lines.join("\n")
    };
    if let Some(entry) = recent_logs
        .iter()
        .rev()
        .find(|entry| entry.actor_id == agent_id)
    {
        format!(
            "Latest structured action for {agent_id}: {} | soul={} | memory={} | skills={} | scope={}\n{skill_lines}",
            entry.summary,
            inputs.soul_headline,
            inputs.memory_headline,
            inputs.skills.join(","),
            inputs.scope_hint().as_deref().unwrap_or("default")
        )
    } else {
        format!(
            "{agent_id} has no direct action in the latest round and relies on shared context. soul={} memory={} skills={} scope={}\n{skill_lines}",
            inputs.soul_headline,
            inputs.memory_headline,
            inputs.skills.join(","),
            inputs.scope_hint().as_deref().unwrap_or("default")
        )
    }
}

fn build_consistency_checks(
    rag_hits: &[StoryRagHit],
    recent_logs: &[SessionLogEntry],
    _inputs: &AgentPlanningInputs,
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
    ConsistencyChecks {
        ooc,
        world,
        timeline,
        rules,
    }
}

fn has_skill(inputs: &AgentPlanningInputs, skill_name: &str) -> bool {
    inputs.skills.iter().any(|skill| skill == skill_name)
}

fn target_hint_path(hint: &str, memory_path: &str) -> Option<String> {
    match hint.trim().to_ascii_lowercase().as_str() {
        "memory" | "agent/memory" | "agents/memory" => Some(memory_path.to_string()),
        "world" | "cards/world" => Some("cards/world/current-world-state.md".to_string()),
        "rules" | "cards/rules" => Some("cards/rules/runtime-kp-rulings.md".to_string()),
        "history" | "audit" | "simulation/audit" => {
            Some("history/project-audit-log.md".to_string())
        }
        "events" | "simulation/random-events" => Some("simulation/random-events.md".to_string()),
        "simulation/logs" => Some("simulation/logs/skill-runtime.md".to_string()),
        "writing/chapters" => Some("writing/chapters/skill-runtime.md".to_string()),
        "writing/audit" => Some("writing/audit/review-checks.md".to_string()),
        _ => None,
    }
}

fn resolve_primary_target(
    role: SimulationRole,
    inputs: &AgentPlanningInputs,
    memory_path: &str,
) -> String {
    if let Some(hint) = inputs
        .target_hint()
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
            inputs.priority_hint().as_deref().unwrap_or("normal"),
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
    let mode_hint = inputs.mode_hint().unwrap_or_default().to_ascii_lowercase();
    let section_hint = inputs
        .section_hint()
        .or_else(|| default_section_for_role(role).map(str::to_string))
        .unwrap_or_else(|| "Runtime Notes".to_string());
    if mode_hint == "append_memory" || primary_target == memory_path {
        actions.push(AgentRoundAction::AppendMemory {
            path: primary_target,
            content: primary_content,
        });
    } else if mode_hint == "replace_section" {
        let old = format!("## {section_hint}\n");
        let new = format!("## {section_hint}\n{primary_content}");
        actions.push(AgentRoundAction::ReplaceProjectSection {
            path: primary_target,
            old,
            new,
        });
    } else if matches!(mode_hint.as_str(), "append" | "append_section" | "upsert") {
        let marker = format!("## {section_hint}\n");
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

fn action_kind_and_path(action: &AgentRoundAction) -> (&'static str, &str) {
    match action {
        AgentRoundAction::AppendAudit { path, .. } => ("append_audit", path),
        AgentRoundAction::AppendMemory { path, .. } => ("append_memory", path),
        AgentRoundAction::AppendProjectText { path, .. } => ("append_project_text", path),
        AgentRoundAction::ReplaceProjectSection { path, .. } => ("replace_project_section", path),
        AgentRoundAction::AppendProjectSection { path, .. } => ("append_project_section", path),
    }
}

fn status_from_checks(checks: &ConsistencyChecks) -> (&'static str, Option<String>) {
    let warnings = [
        ("ooc", &checks.ooc),
        ("world", &checks.world),
        ("timeline", &checks.timeline),
        ("rules", &checks.rules),
    ]
    .into_iter()
    .filter_map(|(name, status)| match status {
        ConsistencyStatus::Block => Some(format!("{name}=BLOCK")),
        ConsistencyStatus::Warn => Some(format!("{name}=WARN")),
        ConsistencyStatus::Pass => None,
    })
    .collect::<Vec<_>>();
    if warnings.iter().any(|item| item.ends_with("BLOCK")) {
        ("BLOCK", Some(warnings.join(", ")))
    } else if warnings.is_empty() {
        ("PASS", None)
    } else {
        ("WARN", Some(warnings.join(", ")))
    }
}

fn missing_skill_contract_fields(skill: &SkillMetadata) -> Vec<&'static str> {
    let mut missing = Vec::new();
    if skill.intent.as_deref().is_none_or(str::is_empty) {
        missing.push("intent");
    }
    if skill.target.as_deref().is_none_or(str::is_empty) {
        missing.push("target");
    }
    if skill.mode.as_deref().is_none_or(str::is_empty) {
        missing.push("mode");
    }
    if skill.scope.as_deref().is_none_or(str::is_empty) {
        missing.push("scope");
    }
    if skill.consistency.as_deref().is_none_or(str::is_empty) {
        missing.push("consistency");
    }
    missing
}

fn skill_schema_warn_reason(skill: &SkillMetadata) -> Option<String> {
    let missing = missing_skill_contract_fields(skill);
    if missing.is_empty() {
        None
    } else {
        Some(format!(
            "invalid skill frontmatter: missing {}; repair this agent's skills/{} in Settings Agent assets before trusting this invocation",
            missing.join(", "),
            skill.file_name
        ))
    }
}

fn merge_warn_reasons(left: Option<String>, right: Option<String>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => Some(format!("{left}; {right}")),
        (Some(reason), None) | (None, Some(reason)) => Some(reason),
        (None, None) => None,
    }
}

fn build_skill_invocation_evidence(
    inputs: &AgentPlanningInputs,
    actions: &[AgentRoundAction],
    evidence_paths: &[String],
    checks: &ConsistencyChecks,
) -> Vec<SkillInvocationEvidence> {
    let selected = actions
        .iter()
        .find(|action| !matches!(action, AgentRoundAction::AppendAudit { .. }))
        .or_else(|| actions.first());
    let selected = selected.map(action_kind_and_path);
    let (check_status, check_warn_reason) = status_from_checks(checks);
    inputs
        .skill_invocations
        .iter()
        .map(|skill| {
            let schema_warn_reason = skill_schema_warn_reason(skill);
            let status = if schema_warn_reason.is_some() && check_status == "PASS" {
                "WARN"
            } else {
                check_status
            };
            SkillInvocationEvidence {
                skill_file: skill.file_name.clone(),
                intent: skill.intent.clone(),
                target: skill.target.clone(),
                mode: skill.mode.clone(),
                scope: skill.scope.clone(),
                consistency: skill.consistency.clone(),
                selected_action: selected.map(|(kind, _)| kind.to_string()),
                selected_path: selected.map(|(_, path)| path.to_string()),
                evidence_paths: evidence_paths.to_vec(),
                status: status.to_string(),
                warn_reason: merge_warn_reasons(schema_warn_reason, check_warn_reason.clone()),
            }
        })
        .collect()
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
            if !output.skill_invocations.is_empty() {
                out.push_str("- skill invocation evidence:\n");
                for invocation in &output.skill_invocations {
                    let action = invocation.selected_action.as_deref().unwrap_or("none");
                    let path = invocation.selected_path.as_deref().unwrap_or("none");
                    let _ = writeln!(
                        out,
                        "  - {} intent={} target={} mode={} status={} selected={} -> {}",
                        invocation.skill_file,
                        invocation.intent.as_deref().unwrap_or("unset"),
                        invocation.target.as_deref().unwrap_or("unset"),
                        invocation.mode.as_deref().unwrap_or("unset"),
                        invocation.status,
                        action,
                        path
                    );
                    if let Some(reason) = &invocation.warn_reason {
                        let _ = writeln!(out, "    warn: {reason}");
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

    use super::{
        AgentPlanningInputs, SkillMetadata, SwarmService, SwarmTurnRecord,
        build_consistency_checks, build_runtime_actions, build_skill_invocation_evidence,
        extract_skill_metadata, resolve_primary_target, target_hint_path,
    };
    use crate::agent_output::{AgentRoundAction, ConsistencyStatus};
    use crate::{
        cards::{CardKind, CardService, CreateCardRequest},
        project::{CreateProjectRequest, ProjectService},
        simulation::{
            AdvanceRoundRequest, CharacterAction, CreateCharacterRequest, CreateSessionRequest,
            SessionLogEntry, SimulationRole, SimulationService,
        },
        storage::Storage,
        story_rag::StoryRagHit,
        writing::{CreateChapterRequest, WritingService},
    };

    #[test]
    fn parses_frontmatter_and_maps_targets() {
        let metadata = extract_skill_metadata(
            "world-update.md",
            "---\nIntent: world_update\nTarget: cards/world\nMode: upsert\nScope: world\nConsistency: setting\nSection: World Updates\n---\n# world-update\n",
        );
        assert_eq!(metadata.intent.as_deref(), Some("world_update"));
        assert_eq!(metadata.target.as_deref(), Some("cards/world"));
        assert_eq!(metadata.mode.as_deref(), Some("upsert"));
        assert_eq!(metadata.section_hint.as_deref(), Some("World Updates"));
        assert_eq!(
            target_hint_path("simulation/logs", "agents/aria/memory.md").as_deref(),
            Some("simulation/logs/skill-runtime.md")
        );
        assert_eq!(
            target_hint_path("cards/rules", "agents/aria/memory.md").as_deref(),
            Some("cards/rules/runtime-kp-rulings.md")
        );
        assert_eq!(
            target_hint_path("memory", "agents/aria/memory.md").as_deref(),
            Some("agents/aria/memory.md")
        );
    }

    #[test]
    fn consistency_contract_dimension_does_not_warn_by_itself() {
        let checks = build_consistency_checks(
            &[StoryRagHit {
                fact: "The rule card constrains the ruling.".to_string(),
                source_path: "cards/rules/runtime-kp-rulings.md".to_string(),
                timeline: Some("main".to_string()),
                timepoint: Some("tp-0001".to_string()),
                score: 1.0,
            }],
            &[SessionLogEntry {
                round: 1,
                turn: 1,
                actor_id: "kp".to_string(),
                role: SimulationRole::Kp,
                summary: "KP applies the rule card.".to_string(),
            }],
            &AgentPlanningInputs {
                soul_headline: "KP".to_string(),
                memory_headline: "KP Memory".to_string(),
                skills: vec!["kp-adjudicate.md".to_string()],
                skill_invocations: vec![SkillMetadata {
                    file_name: "kp-adjudicate.md".to_string(),
                    intent: Some("kp_adjudicate".to_string()),
                    target: Some("simulation/logs".to_string()),
                    mode: Some("append".to_string()),
                    scope: Some("project".to_string()),
                    consistency: Some("rules".to_string()),
                    priority: None,
                    section_hint: None,
                }],
            },
        );

        assert_eq!(checks.rules, ConsistencyStatus::Pass);
        assert_eq!(checks.world, ConsistencyStatus::Pass);
    }

    #[test]
    fn invalid_skill_frontmatter_produces_repair_warning_evidence() {
        let evidence = build_skill_invocation_evidence(
            &AgentPlanningInputs {
                soul_headline: "KP".to_string(),
                memory_headline: "KP Memory".to_string(),
                skills: vec!["broken-skill.md".to_string()],
                skill_invocations: vec![SkillMetadata {
                    file_name: "broken-skill.md".to_string(),
                    intent: Some("kp_adjudicate".to_string()),
                    target: None,
                    mode: None,
                    scope: None,
                    consistency: None,
                    priority: None,
                    section_hint: None,
                }],
            },
            &[AgentRoundAction::AppendProjectSection {
                path: "simulation/logs/skill-runtime.md".to_string(),
                marker: "## KP Rulings\n".to_string(),
                content: "- ruling\n".to_string(),
            }],
            &["agents/kp/skills/broken-skill.md".to_string()],
            &crate::agent_output::ConsistencyChecks {
                ooc: ConsistencyStatus::Pass,
                world: ConsistencyStatus::Pass,
                timeline: ConsistencyStatus::Pass,
                rules: ConsistencyStatus::Pass,
            },
        );

        let invocation = evidence.first().expect("warning evidence should exist");
        assert_eq!(invocation.status, "WARN");
        let reason = invocation
            .warn_reason
            .as_deref()
            .expect("repair reason should be visible");
        assert!(reason.contains("invalid skill frontmatter"));
        assert!(reason.contains("missing target, mode, scope, consistency"));
        assert!(reason.contains("Settings Agent assets"));
    }

    #[test]
    fn deserializes_legacy_swarm_turn_record_without_skill_invocations() {
        let json = r#"
        {
          "session_id": "session-001",
          "round": 1,
          "timepoint_id": "tp-0001",
          "contexts": [],
          "outputs": [
            {
              "agent_id": "kp",
              "role": "kp",
              "intent": "kp_adjudicate",
              "reasoning_summary": "legacy persisted swarm output",
              "evidence": [],
              "actions": [],
              "consistency_checks": {
                "ooc": "PASS",
                "world": "PASS",
                "timeline": "PASS",
                "rules": "PASS"
              }
            }
          ]
        }
        "#;

        let record: SwarmTurnRecord =
            serde_json::from_str(json).expect("legacy swarm turn should deserialize");
        assert_eq!(record.outputs.len(), 1);
        assert!(record.outputs[0].skill_invocations.is_empty());
    }

    #[test]
    fn frontmatter_target_and_mode_drive_runtime_actions() {
        let session = crate::simulation::SimulationSession {
            project_slug: "swarm-project".to_string(),
            session_id: "session-001".to_string(),
            timeline: "main".to_string(),
            timepoint_id: "tp-0001".to_string(),
            title: "Vault session".to_string(),
            round: 1,
            next_turn: 1,
            is_complete: false,
            active_character_id: None,
            characters: vec![],
            agents: vec![crate::simulation::AgentState {
                agent_id: "world-maintainer".to_string(),
                role: SimulationRole::WorldMaintainer,
                round_memory_key: None,
                last_output: None,
            }],
            logs: vec![],
        };
        let inputs = AgentPlanningInputs {
            soul_headline: "World Maintainer".to_string(),
            memory_headline: "World memory".to_string(),
            skills: vec!["world-update.md".to_string()],
            skill_invocations: vec![SkillMetadata {
                file_name: "world-update.md".to_string(),
                intent: Some("world_update".to_string()),
                target: Some("cards/world".to_string()),
                mode: Some("upsert".to_string()),
                scope: Some("world".to_string()),
                consistency: Some("setting".to_string()),
                priority: Some("high".to_string()),
                section_hint: Some("World Updates".to_string()),
            }],
        };

        assert_eq!(
            resolve_primary_target(
                SimulationRole::WorldMaintainer,
                &inputs,
                "agents/world-maintainer/memory.md"
            ),
            "cards/world/current-world-state.md"
        );
        let actions = build_runtime_actions(
            "world-maintainer",
            &session,
            &inputs,
            "agents/world-maintainer/memory.md",
            "agents/world-maintainer/audit/runtime-round-log.md".to_string(),
        );
        assert!(actions.iter().any(|action| matches!(
            action,
            AgentRoundAction::AppendProjectSection { path, marker, .. }
                if path == "cards/world/current-world-state.md" && marker == "## World Updates\n"
        )));
    }

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
                "---\nintent: character-decision\ntarget: simulation/logs\nmode: append\nscope: character\nconsistency: ooc\n---\n# character-decision",
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
        let aria_output = record
            .outputs
            .iter()
            .find(|output| output.agent_id == "aria")
            .expect("aria output should exist");
        let invocation = aria_output
            .skill_invocations
            .iter()
            .find(|item| item.skill_file == "character-decision.md")
            .expect("character skill invocation evidence should be serialized");
        assert_eq!(invocation.intent.as_deref(), Some("character-decision"));
        assert_eq!(invocation.target.as_deref(), Some("simulation/logs"));
        assert_eq!(invocation.mode.as_deref(), Some("append"));
        assert_eq!(
            invocation.selected_action.as_deref(),
            Some("append_project_section")
        );
        assert_eq!(
            invocation.selected_path.as_deref(),
            Some("simulation/logs/skill-runtime.md")
        );
        assert!(
            invocation
                .evidence_paths
                .iter()
                .any(|path| path == "agents/aria/skills/character-decision.md")
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
