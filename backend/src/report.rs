use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    agent_output::{AgentRoundAction, ConsistencyStatus},
    agents::{AgentAssetError, AgentAssetService},
    simulation::{SimulationError, SimulationService},
    storage::{Storage, StorageError, validate_segment},
    story_rag::{StoryRagError, StoryRagHit, StoryRagService},
    swarm::{SwarmError, SwarmTurnRecord},
};

const PROJECTS_DIR: &str = "projects";
const REPORTS_DIR: &str = "reports";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReportKind {
    Simulation,
    Consistency,
    BranchImpact,
    Writing,
}

impl ReportKind {
    #[must_use]
    pub const fn as_dir(&self) -> &'static str {
        match self {
            Self::Simulation => "simulation",
            Self::Consistency => "consistency",
            Self::BranchImpact => "branch-impact",
            Self::Writing => "writing",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportSummary {
    pub id: String,
    pub kind: ReportKind,
    pub title: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportRecord {
    pub id: String,
    pub kind: ReportKind,
    pub title: String,
    pub path: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateSimulationReportRequest {
    pub session_id: String,
    pub round: u32,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateInterviewRequest {
    pub agent_ids: Vec<String>,
    pub questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateConsistencyReportRequest {
    pub session_id: String,
    pub round: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateBranchImpactReportRequest {
    pub branch_id: String,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateWritingPrewriteReportRequest {
    pub chapter_id: String,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InterviewRecord {
    pub id: String,
    pub session_id: String,
    pub path: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct ReportService {
    storage: Arc<Storage>,
    rag: StoryRagService,
    simulation: SimulationService,
    agents: AgentAssetService,
}

#[derive(Debug, Error)]
pub enum ReportError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid report id: {0}")]
    InvalidReportId(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("report not found: {0}")]
    NotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Rag(#[from] StoryRagError),
    #[error(transparent)]
    Simulation(#[from] SimulationError),
    #[error(transparent)]
    Swarm(#[from] SwarmError),
    #[error(transparent)]
    Agents(#[from] AgentAssetError),
}

impl ReportService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        let rag = StoryRagService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let agents = AgentAssetService::new(Arc::clone(&storage));
        Self {
            storage,
            rag,
            simulation,
            agents,
        }
    }

    pub async fn create_simulation_report(
        &self,
        project_slug: &str,
        request: CreateSimulationReportRequest,
    ) -> Result<ReportRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(&request.session_id)
            .map_err(|_| ReportError::InvalidReportId(request.session_id.clone()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let session = self
            .simulation
            .get_session(project_slug, &request.session_id)
            .await?;
        let round_entries = session
            .logs
            .iter()
            .filter(|entry| entry.round == request.round)
            .cloned()
            .collect::<Vec<_>>();
        let swarm = self
            .simulation
            .get_swarm_round(project_slug, &request.session_id, request.round)
            .await?;
        let query = request.query.unwrap_or_else(|| {
            build_report_query(&session.title, &session.timepoint_id, &round_entries)
        });
        let insight = self.rag.insight_forge(project_slug, &query).await?;
        let mut facts = insight.facts.clone();
        if facts.is_empty() {
            facts = round_entries
                .iter()
                .map(|entry| StoryRagHit {
                    fact: entry.summary.clone(),
                    source_path: format!("simulation/logs/{}.md", session.session_id),
                    timeline: Some(session.timeline.clone()),
                    timepoint: Some(session.timepoint_id.clone()),
                    score: 1.0,
                })
                .collect();
        }

        let id = format!("{}-round-{:04}", request.session_id, request.round);
        let title = format!("{} round {} report", session.title, request.round);
        let system_result_excerpts = if let Some(record) = swarm.as_ref() {
            self.collect_system_result_excerpts(project_slug, record)
                .await?
        } else {
            Vec::new()
        };
        let body = render_simulation_report(
            &title,
            &session.session_id,
            request.round,
            &session.timeline,
            &session.timepoint_id,
            &round_entries,
            swarm.as_ref(),
            &facts,
            &insight.relationship_chains,
            &insight.risk_notes,
            &system_result_excerpts,
        );
        let relative = report_path(project_slug, &ReportKind::Simulation, &id);
        self.storage.write_text(&relative, &body).await?;

        Ok(ReportRecord {
            id,
            kind: ReportKind::Simulation,
            title,
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }

    pub async fn create_consistency_report(
        &self,
        project_slug: &str,
        request: CreateConsistencyReportRequest,
    ) -> Result<ReportRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(&request.session_id)
            .map_err(|_| ReportError::InvalidReportId(request.session_id.clone()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let session = self
            .simulation
            .get_session(project_slug, &request.session_id)
            .await?;
        let swarm = self
            .simulation
            .get_swarm_round(project_slug, &request.session_id, request.round)
            .await?;
        let id = format!(
            "{}-round-{:04}-consistency",
            request.session_id, request.round
        );
        let title = format!(
            "{} round {} consistency audit",
            session.title, request.round
        );
        let system_result_excerpts = if let Some(record) = swarm.as_ref() {
            self.collect_system_result_excerpts(project_slug, record)
                .await?
        } else {
            Vec::new()
        };
        let body = render_consistency_report(
            &title,
            &session.session_id,
            request.round,
            swarm.as_ref(),
            &system_result_excerpts,
        );
        let relative = report_path(project_slug, &ReportKind::Consistency, &id);
        self.storage.write_text(&relative, &body).await?;
        Ok(ReportRecord {
            id,
            kind: ReportKind::Consistency,
            title,
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }

    pub async fn create_branch_impact_report(
        &self,
        project_slug: &str,
        request: CreateBranchImpactReportRequest,
    ) -> Result<ReportRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(&request.branch_id)
            .map_err(|_| ReportError::InvalidReportId(request.branch_id.clone()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let query = request.query.unwrap_or_else(|| request.branch_id.clone());
        let insight = self.rag.insight_forge(project_slug, &query).await?;
        let branch_path = project_root(project_slug)
            .join("timeline/branches")
            .join(format!("{}.json", request.branch_id));
        let branch_text = if self.storage.exists(&branch_path).await? {
            self.storage.read_text(&branch_path).await?
        } else {
            format!("branch `{}` has no branch metadata yet", request.branch_id)
        };
        let system_result_excerpts = match self.simulation.get_active_session(project_slug).await? {
            Some(session) => match self
                .simulation
                .get_swarm_round(project_slug, &session.session_id, session.round)
                .await?
            {
                Some(record) => {
                    self.collect_system_result_excerpts(project_slug, &record)
                        .await?
                }
                None => Vec::new(),
            },
            None => Vec::new(),
        };
        let id = format!("{}-impact", request.branch_id);
        let title = format!("Branch {} impact analysis", request.branch_id);
        let body = render_branch_impact_report(
            &title,
            &request.branch_id,
            &branch_text,
            &insight.facts,
            &insight.risk_notes,
            &system_result_excerpts,
        );
        let relative = report_path(project_slug, &ReportKind::BranchImpact, &id);
        self.storage.write_text(&relative, &body).await?;
        Ok(ReportRecord {
            id,
            kind: ReportKind::BranchImpact,
            title,
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }

    pub async fn create_writing_prewrite_report(
        &self,
        project_slug: &str,
        request: CreateWritingPrewriteReportRequest,
    ) -> Result<ReportRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(&request.chapter_id)
            .map_err(|_| ReportError::InvalidReportId(request.chapter_id.clone()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let chapter_path = project_root(project_slug)
            .join("writing/chapters")
            .join(format!("{}.md", request.chapter_id));
        let chapter_text = if self.storage.exists(&chapter_path).await? {
            self.storage.read_text(&chapter_path).await?
        } else {
            String::new()
        };
        let query = request.query.unwrap_or_else(|| {
            if chapter_text.trim().is_empty() {
                request.chapter_id.clone()
            } else {
                first_nonempty_line(&chapter_text)
            }
        });
        let insight = self.rag.insight_forge(project_slug, &query).await?;
        let system_result_excerpts = match self.simulation.get_active_session(project_slug).await? {
            Some(session) => match self
                .simulation
                .get_swarm_round(project_slug, &session.session_id, session.round)
                .await?
            {
                Some(record) => {
                    self.collect_system_result_excerpts(project_slug, &record)
                        .await?
                }
                None => Vec::new(),
            },
            None => Vec::new(),
        };
        let id = format!("{}-prewrite", request.chapter_id);
        let title = format!("Chapter {} prewrite report", request.chapter_id);
        let body = render_writing_prewrite_report(
            &title,
            &request.chapter_id,
            &chapter_text,
            &insight.facts,
            &insight.relationship_chains,
            &insight.risk_notes,
            &system_result_excerpts,
        );
        let relative = report_path(project_slug, &ReportKind::Writing, &id);
        self.storage.write_text(&relative, &body).await?;
        Ok(ReportRecord {
            id,
            kind: ReportKind::Writing,
            title,
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }

    pub async fn create_interview(
        &self,
        project_slug: &str,
        session_id: &str,
        request: CreateInterviewRequest,
    ) -> Result<InterviewRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(session_id)
            .map_err(|_| ReportError::InvalidReportId(session_id.to_string()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;

        let session = self
            .simulation
            .get_session(project_slug, session_id)
            .await?;
        let round = session.round;
        let swarm = self
            .simulation
            .get_swarm_round(project_slug, session_id, round)
            .await?;
        let log_excerpt = session
            .logs
            .iter()
            .rev()
            .take(8)
            .cloned()
            .collect::<Vec<_>>();
        let timestamp = format!("round-{round:04}");
        let id = format!("interview-{timestamp}");
        let mut body = format!(
            "# Interview Record\n\n- session: `{session_id}`\n- round: `{round}`\n- timeline: `{}`\n- timepoint: `{}`\n\n",
            session.timeline, session.timepoint_id
        );

        for agent_id in &request.agent_ids {
            let facts = self.rag.quick_search(project_slug, agent_id).await?.hits;
            let (soul, memory) = if is_system_agent(agent_id) {
                (
                    format!("# {agent_id}\n\n## Role\nSystem simulation agent."),
                    format!("# {agent_id} Memory\n\n- Uses session and swarm evidence."),
                )
            } else {
                let agent = self.agents.get(project_slug, agent_id).await?;
                (agent.soul, agent.memory)
            };
            let _ = writeln!(body, "## Agent: {agent_id}");
            let _ = writeln!(body, "- soul heading: {}", first_heading(&soul));
            let _ = writeln!(body, "- memory heading: {}", first_heading(&memory));
            if let Some(swarm_record) = swarm.as_ref() {
                if let Some(context) = swarm_record
                    .contexts
                    .iter()
                    .find(|context| context.agent_id == *agent_id)
                {
                    let _ = writeln!(body, "- latest intent: {}", context.intent);
                    let _ = writeln!(body, "- latest reasoning: {}", context.reasoning_summary);
                }
            }
            for question in &request.questions {
                let answer = build_interview_answer(agent_id, question, &facts, &log_excerpt);
                let _ = writeln!(body, "\n### Q: {question}\n{answer}");
            }
            body.push_str("\n#### Evidence\n");
            if facts.is_empty() {
                let _ = writeln!(body, "- `simulation/logs/{session_id}.md`");
            } else {
                for fact in facts.iter().take(6) {
                    let _ = writeln!(body, "- `{}` :: {}", fact.source_path, fact.fact);
                }
            }
            body.push('\n');
        }

        let relative = interview_path(project_slug, session_id, &id);
        self.storage.write_text(&relative, &body).await?;
        Ok(InterviewRecord {
            id,
            session_id: session_id.to_string(),
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }

    async fn collect_system_result_excerpts(
        &self,
        project_slug: &str,
        record: &SwarmTurnRecord,
    ) -> Result<Vec<String>, ReportError> {
        let mut excerpts = Vec::new();
        for output in &record.outputs {
            for action in &output.actions {
                let path = match action {
                    AgentRoundAction::AppendProjectText { path, .. }
                    | AgentRoundAction::ReplaceProjectSection { path, .. }
                    | AgentRoundAction::AppendProjectSection { path, .. } => path,
                    AgentRoundAction::AppendAudit { .. }
                    | AgentRoundAction::AppendMemory { .. } => continue,
                };
                let relative = project_root(project_slug).join(path);
                if self.storage.exists(&relative).await? {
                    let text = self.storage.read_text(&relative).await?;
                    excerpts.push(format!("{} :: {}", path, first_nonempty_line(&text)));
                }
            }
        }
        excerpts.sort();
        excerpts.dedup();
        Ok(excerpts)
    }

    pub async fn list_reports(
        &self,
        project_slug: &str,
    ) -> Result<Vec<ReportSummary>, ReportError> {
        validate_project_slug(project_slug)?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let mut reports = Vec::new();
        for kind in [
            ReportKind::Simulation,
            ReportKind::Consistency,
            ReportKind::BranchImpact,
            ReportKind::Writing,
        ] {
            let root = reports_root(project_slug).join(kind.as_dir());
            for file in self.storage.list_files(&root).await? {
                if file.extension().and_then(std::ffi::OsStr::to_str) != Some("md") {
                    continue;
                }
                let id = file
                    .file_stem()
                    .and_then(std::ffi::OsStr::to_str)
                    .unwrap_or("report")
                    .to_string();
                let relative = storage_relative_path(self.storage.as_ref(), &file)?;
                let body = self.storage.read_text(&relative).await?;
                reports.push(ReportSummary {
                    id,
                    kind: kind.clone(),
                    title: first_heading(&body),
                    path: display_project_relative(project_slug, &relative),
                });
            }
        }
        reports.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(reports)
    }

    pub async fn get_report(
        &self,
        project_slug: &str,
        kind: ReportKind,
        id: &str,
    ) -> Result<ReportRecord, ReportError> {
        validate_project_slug(project_slug)?;
        validate_segment(id).map_err(|_| ReportError::InvalidReportId(id.to_string()))?;
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        let relative = report_path(project_slug, &kind, id);
        if !self.storage.exists(&relative).await? {
            return Err(ReportError::NotFound(id.to_string()));
        }
        let body = self.storage.read_text(&relative).await?;
        Ok(ReportRecord {
            id: id.to_string(),
            kind,
            title: first_heading(&body),
            path: display_project_relative(project_slug, &relative),
            body,
        })
    }
}

fn render_consistency_report(
    title: &str,
    session_id: &str,
    round: u32,
    swarm: Option<&SwarmTurnRecord>,
    system_result_excerpts: &[String],
) -> String {
    let mut out = format!(
        "# 一致性审计报告：{title}\n\n## 输入范围\n- session: `{session_id}`\n- round: `{round}`\n\n"
    );
    out.push_str("## OOC / 世界观 / 时间线 / 规则检查\n");
    if let Some(record) = swarm {
        for context in &record.contexts {
            let _ = writeln!(
                out,
                "- `{}`: OOC={:?} WORLD={:?} TIMELINE={:?} RULES={:?} ({})",
                context.agent_id,
                context.consistency_checks.ooc,
                context.consistency_checks.world,
                context.consistency_checks.timeline,
                context.consistency_checks.rules,
                context.intent
            );
        }
    } else {
        out.push_str("- WARN: missing StorySwarm round artifact.\n");
    }
    out.push_str("\n## 系统角色落盘结果\n");
    for item in system_result_excerpts {
        let _ = writeln!(out, "- {item}");
    }
    if system_result_excerpts.is_empty() {
        out.push_str("- 暂无系统角色落盘摘要。\n");
    }
    out.push_str("\n## 风险结论\n- 优先修复 WARN/BLOCK 项，再进入下一时间点。\n\n## 引用\n");
    if let Some(record) = swarm {
        for context in &record.contexts {
            for evidence in &context.evidence {
                let _ = writeln!(out, "- `{evidence}`");
            }
        }
    }
    let _ = writeln!(out, "- `simulation/swarm/{session_id}/round-{round:04}.md`");
    out
}

fn render_branch_impact_report(
    title: &str,
    branch_id: &str,
    branch_text: &str,
    facts: &[StoryRagHit],
    risk_notes: &[String],
    system_result_excerpts: &[String],
) -> String {
    let mut out = format!(
        "# 分支影响分析：{title}\n\n## 输入范围\n- branch: `{branch_id}`\n\n## 分支元数据\n```json\n{}\n```\n\n",
        branch_text.trim()
    );
    out.push_str("## 受影响事实\n");
    for fact in facts.iter().take(8) {
        let _ = writeln!(out, "- {}（{}）", fact.fact, fact.source_path);
    }
    if facts.is_empty() {
        out.push_str("- 暂无 StoryRAG 命中，需人工补充 branch 关联事实。\n");
    }
    out.push_str("\n## 系统角色落盘结果\n");
    for item in system_result_excerpts {
        let _ = writeln!(out, "- {item}");
    }
    if system_result_excerpts.is_empty() {
        out.push_str("- 暂无系统角色落盘摘要。\n");
    }
    out.push_str("\n## 时间线与回滚风险\n");
    for note in risk_notes.iter().take(8) {
        let _ = writeln!(out, "- {note}");
    }
    out.push_str("- 分支续写不得直接改写源分支历史时间点。\n\n## 续写建议\n- 先确认 branch origin timepoint，再决定是否生成新 timepoint。\n\n## 引用\n");
    let _ = writeln!(out, "- `timeline/branches/{branch_id}.json`");
    for fact in facts.iter().take(8) {
        let _ = writeln!(out, "- `{}`", fact.source_path);
    }
    out
}

fn render_writing_prewrite_report(
    title: &str,
    chapter_id: &str,
    chapter_text: &str,
    facts: &[StoryRagHit],
    chains: &[String],
    risk_notes: &[String],
    system_result_excerpts: &[String],
) -> String {
    let mut out = format!(
        "# 续写预备报告：{title}\n\n## 输入范围\n- chapter: `{chapter_id}`\n\n## 当前章节摘要\n{}\n\n",
        first_nonempty_line(chapter_text)
    );
    out.push_str("## 关键可引用事实\n");
    for fact in facts.iter().take(8) {
        let _ = writeln!(out, "- {}（{}）", fact.fact, fact.source_path);
    }
    if facts.is_empty() {
        out.push_str("- 暂无可引用事实，建议先补充卡片/记忆/章节文本。\n");
    }
    out.push_str("\n## 伏笔/关系链\n");
    for chain in chains.iter().take(8) {
        let _ = writeln!(out, "- {chain}");
    }
    out.push_str("\n## 系统角色落盘结果\n");
    for item in system_result_excerpts {
        let _ = writeln!(out, "- {item}");
    }
    if system_result_excerpts.is_empty() {
        out.push_str("- 暂无系统角色落盘摘要。\n");
    }
    out.push_str("\n## 一致性风险\n");
    for note in risk_notes.iter().take(8) {
        let _ = writeln!(out, "- {note}");
    }
    out.push_str("\n## 续写建议\n- 延续引用事实与已落盘章节，不新增无来源关键设定。\n- 如需改写历史章节，先创建 timeline / writing branch。\n\n## 引用\n");
    let _ = writeln!(out, "- `writing/chapters/{chapter_id}.md`");
    for fact in facts.iter().take(8) {
        let _ = writeln!(out, "- `{}`", fact.source_path);
    }
    out
}

fn first_nonempty_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or("暂无正文。")
        .to_string()
}

fn build_interview_answer(
    agent_id: &str,
    question: &str,
    facts: &[StoryRagHit],
    logs: &[crate::simulation::SessionLogEntry],
) -> String {
    let evidence_line = facts.first().map_or_else(
        || "本回答主要依据最近 session log。".to_string(),
        |fact| {
            format!(
                "本回答优先依据 `{}` 中的事实：{}",
                fact.source_path, fact.fact
            )
        },
    );
    let recent_action = logs
        .iter()
        .find(|entry| entry.actor_id == agent_id)
        .map_or_else(
            || "本轮没有单独记录到该 agent 的直接行动。".to_string(),
            |entry| format!("最近行动记录：{}", entry.summary),
        );
    format!(
        "针对问题“{question}”，{evidence_line} {recent_action} 因此回答保持在这些已落盘依据之内，不扩展无来源设定。"
    )
}

fn is_system_agent(agent_id: &str) -> bool {
    matches!(
        agent_id,
        "kp" | "world-maintainer" | "project-auditor" | "random-event" | "author" | "reviewer"
    )
}

fn interview_path(project_slug: &str, session_id: &str, id: &str) -> PathBuf {
    project_root(project_slug)
        .join("simulation/sessions")
        .join(session_id)
        .join("interviews")
        .join(format!("{id}.md"))
}

fn build_report_query(
    title: &str,
    timepoint_id: &str,
    entries: &[crate::simulation::SessionLogEntry],
) -> String {
    let mut query = format!("{title} {timepoint_id}");
    for entry in entries.iter().take(6) {
        query.push(' ');
        query.push_str(&entry.summary);
    }
    query
}

#[allow(clippy::too_many_arguments)]
fn render_simulation_report(
    title: &str,
    session_id: &str,
    round: u32,
    timeline: &str,
    timepoint_id: &str,
    entries: &[crate::simulation::SessionLogEntry],
    swarm: Option<&SwarmTurnRecord>,
    facts: &[StoryRagHit],
    chains: &[String],
    risk_notes: &[String],
    system_result_excerpts: &[String],
) -> String {
    let mut out = format!("# 推演报告：{title}\n\n");
    let _ = writeln!(
        out,
        "## 输入范围\n- session: `{session_id}`\n- round: `{round}`\n- timeline: `{timeline}`\n- timepoint: `{timepoint_id}`\n"
    );

    out.push_str("## 本轮关键事实\n");
    for fact in facts.iter().take(8) {
        let _ = writeln!(out, "- {}（{}）", fact.fact, fact.source_path);
    }
    if facts.is_empty() {
        out.push_str("- 暂无可引用事实。\n");
    }
    out.push('\n');

    out.push_str("## 因果链\n");
    for chain in chains.iter().take(8) {
        let _ = writeln!(out, "- {chain}");
    }
    if chains.is_empty() {
        out.push_str("- 暂无显式关系链。\n");
    }
    out.push('\n');

    out.push_str("## 角色态度变化\n");
    for entry in entries
        .iter()
        .filter(|entry| entry.role == crate::simulation::SimulationRole::Character)
    {
        let _ = writeln!(out, "- {}：{}", entry.actor_id, entry.summary);
    }
    out.push('\n');

    out.push_str("## 世界观/规则影响\n");
    for entry in entries.iter().filter(|entry| {
        matches!(
            entry.role,
            crate::simulation::SimulationRole::WorldMaintainer
                | crate::simulation::SimulationRole::Kp
        )
    }) {
        let _ = writeln!(out, "- {}：{}", entry.actor_id, entry.summary);
    }
    out.push('\n');

    out.push_str(
        "## 系统角色落盘结果
",
    );
    for item in system_result_excerpts {
        let _ = writeln!(out, "- {item}");
    }
    if system_result_excerpts.is_empty() {
        out.push_str(
            "- 暂无系统角色落盘摘要。
",
        );
    }
    out.push('\n');

    out.push_str("## 时间线与分支风险\n");
    for note in risk_notes.iter().take(6) {
        let _ = writeln!(out, "- {note}");
    }
    if let Some(swarm) = swarm {
        for context in &swarm.contexts {
            if context.consistency_checks.timeline != ConsistencyStatus::Pass {
                let _ = writeln!(
                    out,
                    "- {} timeline check: {:?}",
                    context.agent_id, context.consistency_checks.timeline
                );
            }
        }
    }
    out.push('\n');

    out.push_str("## 续写建议\n");
    out.push_str("- 延续已落盘推演事实，不直接改写历史时间点。\n");
    out.push_str("- 优先处理 WARN/BLOCK 一致性项，再进入下一章节或下一时间点。\n");
    if let Some(last) = entries.last() {
        let _ = writeln!(out, "- 下一段可从 `{}` 的结果继续推进。", last.actor_id);
    }
    out.push('\n');

    out.push_str("## 引用\n");
    let mut seen = std::collections::BTreeSet::new();
    for fact in facts {
        if seen.insert(fact.source_path.clone()) {
            let _ = writeln!(out, "- `{}`", fact.source_path);
        }
    }
    if seen.is_empty() {
        let _ = writeln!(out, "- `simulation/logs/{session_id}.md`");
    }
    out
}

fn first_heading(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map_or_else(|| "Untitled report".to_string(), ToString::to_string)
}

fn validate_project_slug(slug: &str) -> Result<(), ReportError> {
    validate_segment(slug).map_err(|_| ReportError::InvalidProjectSlug(slug.to_string()))?;
    if slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        Ok(())
    } else {
        Err(ReportError::InvalidProjectSlug(slug.to_string()))
    }
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn reports_root(project_slug: &str) -> PathBuf {
    project_root(project_slug).join(REPORTS_DIR)
}

fn report_path(project_slug: &str, kind: &ReportKind, id: &str) -> PathBuf {
    reports_root(project_slug)
        .join(kind.as_dir())
        .join(format!("{id}.md"))
}

async fn ensure_project_exists(storage: &Storage, project_slug: &str) -> Result<(), ReportError> {
    if storage.exists(&project_root(project_slug)).await? {
        Ok(())
    } else {
        Err(ReportError::ProjectNotFound(project_slug.to_string()))
    }
}

fn storage_relative_path(storage: &Storage, path: &Path) -> Result<PathBuf, ReportError> {
    path.strip_prefix(storage.root())
        .map(Path::to_path_buf)
        .map_err(|_| ReportError::Storage(StorageError::PathEscapesRoot))
}

fn display_project_relative(project_slug: &str, path: &Path) -> String {
    path.strip_prefix(project_root(project_slug))
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{
        CreateBranchImpactReportRequest, CreateConsistencyReportRequest, CreateInterviewRequest,
        CreateSimulationReportRequest, CreateWritingPrewriteReportRequest, ReportKind,
        ReportService,
    };
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

    #[tokio::test]
    async fn creates_interview_record_with_evidence() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let reports = ReportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "interview-project".to_string(),
                title: "Interview Project".to_string(),
                description: "interview".to_string(),
            })
            .await
            .expect("project");
        cards
            .create(CreateCardRequest {
                project_slug: "interview-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Aria protects the vault.".to_string(),
            })
            .await
            .expect("card");
        writing
            .create_chapter(
                "interview-project",
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
                project_slug: "interview-project".to_string(),
                session_id: "session-001".to_string(),
                timeline: "main".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Vault Session".to_string(),
                characters: vec![CreateCharacterRequest {
                    character_id: "aria".to_string(),
                    display_name: "Aria".to_string(),
                    agenda: "Protect vault".to_string(),
                }],
            })
            .await
            .expect("session");
        simulation
            .advance_round(
                "interview-project",
                "session-001",
                AdvanceRoundRequest {
                    character_actions: vec![CharacterAction {
                        character_id: "aria".to_string(),
                        summary: "Aria protects the vault gate.".to_string(),
                    }],
                    system_directives: BTreeMap::from([(
                        SimulationRole::Kp,
                        "KP confirms the vault rule applies.".to_string(),
                    )]),
                    auditor_concludes_session: false,
                },
            )
            .await
            .expect("advance");

        let interview = reports
            .create_interview(
                "interview-project",
                "session-001",
                CreateInterviewRequest {
                    agent_ids: vec!["aria".to_string(), "kp".to_string()],
                    questions: vec!["你为什么这样行动？".to_string()],
                },
            )
            .await
            .expect("interview");
        assert!(interview.body.contains("## Agent: aria"));
        assert!(interview.body.contains("#### Evidence"));
        assert!(tokio::fs::try_exists(Path::new(temp.path()).join("projects/interview-project/simulation/sessions/session-001/interviews/interview-round-0001.md")).await.expect("interview exists"));
    }

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn creates_consistency_branch_and_prewrite_reports() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let timeline = crate::timeline::TimelineService::new(Arc::clone(&storage));
        let reports = ReportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "extra-report-project".to_string(),
                title: "Extra Report Project".to_string(),
                description: "reports".to_string(),
            })
            .await
            .expect("project");
        cards
            .create(CreateCardRequest {
                project_slug: "extra-report-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Aria protects the vault.".to_string(),
            })
            .await
            .expect("card");
        writing
            .create_chapter(
                "extra-report-project",
                CreateChapterRequest {
                    id: "chapter-001".to_string(),
                    title: "Chapter 1".to_string(),
                    body: "Aria enters the vault and hears an oath.".to_string(),
                },
            )
            .await
            .expect("chapter");
        timeline
            .create_timepoint(crate::timeline::CreateTimepointRequest {
                project_slug: "extra-report-project".to_string(),
                id: "tp-origin".to_string(),
                sequence: 1,
                title: "Origin".to_string(),
                summary: "Origin timepoint".to_string(),
                branch_id: None,
            })
            .await
            .expect("tp");
        timeline
            .create_branch(crate::timeline::CreateBranchRequest {
                project_slug: "extra-report-project".to_string(),
                id: "branch-a".to_string(),
                title: "Branch A".to_string(),
                description: "branch desc".to_string(),
                origin_timepoint_id: "tp-origin".to_string(),
            })
            .await
            .expect("branch");

        simulation
            .create_session(CreateSessionRequest {
                project_slug: "extra-report-project".to_string(),
                session_id: "session-001".to_string(),
                timeline: "main".to_string(),
                timepoint_id: "tp-origin".to_string(),
                title: "Vault Session".to_string(),
                characters: vec![CreateCharacterRequest {
                    character_id: "aria".to_string(),
                    display_name: "Aria".to_string(),
                    agenda: "Protect vault".to_string(),
                }],
            })
            .await
            .expect("session");
        simulation
            .advance_round(
                "extra-report-project",
                "session-001",
                AdvanceRoundRequest {
                    character_actions: vec![CharacterAction {
                        character_id: "aria".to_string(),
                        summary: "Aria protects the vault gate.".to_string(),
                    }],
                    system_directives: BTreeMap::from([(
                        SimulationRole::ProjectAuditor,
                        "Project auditor sees no branch drift yet.".to_string(),
                    )]),
                    auditor_concludes_session: false,
                },
            )
            .await
            .expect("advance");

        let consistency = reports
            .create_consistency_report(
                "extra-report-project",
                CreateConsistencyReportRequest {
                    session_id: "session-001".to_string(),
                    round: 1,
                },
            )
            .await
            .expect("consistency");
        assert!(consistency.body.contains("一致性审计报告"));
        assert!(consistency.body.contains("## 系统角色落盘结果"));

        let branch = reports
            .create_branch_impact_report(
                "extra-report-project",
                CreateBranchImpactReportRequest {
                    branch_id: "branch-a".to_string(),
                    query: Some("Aria".to_string()),
                },
            )
            .await
            .expect("branch");
        assert!(branch.body.contains("分支影响分析"));
        assert!(branch.body.contains("## 系统角色落盘结果"));

        let prewrite = reports
            .create_writing_prewrite_report(
                "extra-report-project",
                CreateWritingPrewriteReportRequest {
                    chapter_id: "chapter-001".to_string(),
                    query: Some("vault".to_string()),
                },
            )
            .await
            .expect("prewrite");
        assert!(prewrite.body.contains("续写预备报告"));
        assert!(prewrite.body.contains("## 系统角色落盘结果"));
    }

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn creates_text_backed_simulation_report_with_citations() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let writing = WritingService::new(Arc::clone(&storage));
        let simulation = SimulationService::new(Arc::clone(&storage));
        let reports = ReportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "report-project".to_string(),
                title: "Report Project".to_string(),
                description: "report".to_string(),
            })
            .await
            .expect("project");
        cards
            .create(CreateCardRequest {
                project_slug: "report-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Aria protects the vault.".to_string(),
            })
            .await
            .expect("card");
        writing
            .create_chapter(
                "report-project",
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
                project_slug: "report-project".to_string(),
                session_id: "session-001".to_string(),
                timeline: "main".to_string(),
                timepoint_id: "tp-0001".to_string(),
                title: "Vault Session".to_string(),
                characters: vec![CreateCharacterRequest {
                    character_id: "aria".to_string(),
                    display_name: "Aria".to_string(),
                    agenda: "Protect vault".to_string(),
                }],
            })
            .await
            .expect("session");
        simulation
            .advance_round(
                "report-project",
                "session-001",
                AdvanceRoundRequest {
                    character_actions: vec![CharacterAction {
                        character_id: "aria".to_string(),
                        summary: "Aria protects the vault gate.".to_string(),
                    }],
                    system_directives: BTreeMap::from([(
                        SimulationRole::Kp,
                        "KP confirms the vault rule applies.".to_string(),
                    )]),
                    auditor_concludes_session: false,
                },
            )
            .await
            .expect("advance");

        let report = reports
            .create_simulation_report(
                "report-project",
                CreateSimulationReportRequest {
                    session_id: "session-001".to_string(),
                    round: 1,
                    query: Some("Aria".to_string()),
                },
            )
            .await
            .expect("report");
        assert_eq!(report.kind, ReportKind::Simulation);
        assert!(report.body.contains("## 系统角色落盘结果"));
        assert!(report.body.contains("## 引用"));
        assert!(
            report.body.contains("cards/characters") || report.body.contains("simulation/logs")
        );
        assert!(
            tokio::fs::try_exists(
                Path::new(temp.path())
                    .join("projects/report-project/reports/simulation/session-001-round-0001.md")
            )
            .await
            .expect("report exists")
        );

        let listed = reports.list_reports("report-project").await.expect("list");
        assert_eq!(listed.len(), 1);
        let loaded = reports
            .get_report(
                "report-project",
                ReportKind::Simulation,
                "session-001-round-0001",
            )
            .await
            .expect("load");
        assert_eq!(loaded.id, report.id);
    }
}
