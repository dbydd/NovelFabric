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
    #[serde(default)]
    pub skill_invocations: Vec<SkillInvocationEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillInvocationEvidence {
    pub skill_file: String,
    pub intent: Option<String>,
    pub target: Option<String>,
    pub mode: Option<String>,
    pub scope: Option<String>,
    pub consistency: Option<String>,
    pub selected_action: Option<String>,
    pub selected_path: Option<String>,
    pub evidence_paths: Vec<String>,
    pub status: String,
    pub warn_reason: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::AgentRoundOutput;

    #[test]
    fn deserializes_legacy_output_without_skill_invocations() {
        let json = serde_json::json!({
            "agent_id": "kp",
            "role": "kp",
            "intent": "kp_adjudicate",
            "reasoning_summary": "legacy persisted swarm output",
            "evidence": ["cards/rules/runtime-kp-rulings.md"],
            "actions": [
                {
                    "type": "append_project_section",
                    "path": "cards/rules/runtime-kp-rulings.md",
                    "marker": "## KP Rulings\n",
                    "content": "- legacy ruling\n"
                }
            ],
            "consistency_checks": {
                "ooc": "PASS",
                "world": "PASS",
                "timeline": "PASS",
                "rules": "PASS"
            }
        })
        .to_string();

        let output: AgentRoundOutput =
            serde_json::from_str(&json).expect("legacy output should deserialize");
        assert!(output.skill_invocations.is_empty());
    }
}
