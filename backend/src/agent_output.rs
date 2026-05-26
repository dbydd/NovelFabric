use serde::{Deserialize, Serialize};

use crate::simulation::SimulationRole;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRoundOutput {
    pub agent_id: String,
    pub role: SimulationRole,
    pub intent: String,
    pub reasoning_summary: String,
    pub evidence: Vec<String>,
    pub actions: Vec<AgentRoundAction>,
    pub consistency_checks: ConsistencyChecks,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentRoundAction {
    AppendAudit {
        path: String,
        content: String,
    },
    AppendMemory {
        path: String,
        content: String,
    },
    AppendProjectText {
        path: String,
        content: String,
    },
    ReplaceProjectSection {
        path: String,
        old: String,
        new: String,
    },
    AppendProjectSection {
        path: String,
        marker: String,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConsistencyChecks {
    pub ooc: ConsistencyStatus,
    pub world: ConsistencyStatus,
    pub timeline: ConsistencyStatus,
    pub rules: ConsistencyStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConsistencyStatus {
    Pass,
    Warn,
    Block,
}
