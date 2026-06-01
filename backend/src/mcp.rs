use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::external_swarm::{
    ExternalSwarmError, ExternalSwarmInferenceRequest, ExternalSwarmService,
};

const JSONRPC_VERSION: &str = "2.0";
const SERVER_NAME: &str = "novelfabric";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const TOOL_EXTERNAL_SWARM_INFER: &str = "external_swarm_infer";
const TOOL_EXTERNAL_SWARM_GET: &str = "external_swarm_get";

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcErrorPayload>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct JsonRpcErrorPayload {
    pub code: i64,
    pub message: String,
}

pub async fn handle_json_rpc(
    service: &ExternalSwarmService,
    body: Value,
) -> Option<JsonRpcResponse> {
    let request = match serde_json::from_value::<JsonRpcRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            return Some(error_response(
                None,
                -32_700,
                format!("invalid JSON-RPC request: {error}"),
            ));
        }
    };

    // JSON-RPC notifications have no id and intentionally produce no response.
    if request.id.is_none() && request.method.starts_with("notifications/") {
        return None;
    }

    if request
        .jsonrpc
        .as_deref()
        .is_some_and(|value| value != JSONRPC_VERSION)
    {
        return Some(error_response(
            request.id,
            -32_600,
            "jsonrpc must be \"2.0\"".to_string(),
        ));
    }

    let id = request.id.clone();
    match request.method.as_str() {
        "initialize" => Some(ok_response(id, initialize_result())),
        "ping" => Some(ok_response(id, json!({}))),
        "tools/list" => Some(ok_response(id, tools_list_result())),
        "tools/call" => Some(handle_tools_call(service, request).await),
        other => Some(error_response(
            id,
            -32_601,
            format!("method not found: {other}"),
        )),
    }
}

async fn handle_tools_call(
    service: &ExternalSwarmService,
    request: JsonRpcRequest,
) -> JsonRpcResponse {
    let id = request.id.clone();
    let name = request
        .params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let arguments = request
        .params
        .get("arguments")
        .cloned()
        .unwrap_or(Value::Null);
    match name {
        TOOL_EXTERNAL_SWARM_INFER => {
            match serde_json::from_value::<ExternalSwarmInferenceRequest>(arguments) {
                Ok(inference_request) => match service.create_or_get(inference_request).await {
                    Ok(response) => ok_response(id, tool_result(&json!(response))),
                    Err(error) => error_response(id, -32_003, external_error_message(error)),
                },
                Err(error) => {
                    error_response(id, -32_602, format!("invalid tool arguments: {error}"))
                }
            }
        }
        TOOL_EXTERNAL_SWARM_GET => {
            let inference_id = arguments
                .get("inference_id")
                .and_then(Value::as_str)
                .unwrap_or("");
            if inference_id.is_empty() {
                return error_response(
                    id,
                    -32_602,
                    "invalid tool arguments: inference_id is required".to_string(),
                );
            }
            match service.get(inference_id).await {
                Ok(Some(response)) => ok_response(id, tool_result(&json!(response))),
                Ok(None) => {
                    error_response(id, -32_004, format!("inference not found: {inference_id}"))
                }
                Err(error) => error_response(id, -32_003, external_error_message(error)),
            }
        }
        _ => error_response(id, -32_602, format!("unknown tool: {name}")),
    }
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION
        }
    })
}

fn tools_list_result() -> Value {
    json!({
        "tools": [
            {
                "name": TOOL_EXTERNAL_SWARM_INFER,
                "description": "Run NovelFabric's generic external StorySwarm inference over caller-provided source items. This is a generic tool; callers express business meaning through domain, items, questions, and metadata.",
                "inputSchema": external_swarm_infer_schema()
            },
            {
                "name": TOOL_EXTERNAL_SWARM_GET,
                "description": "Read a previously persisted NovelFabric external swarm inference by id.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "inference_id": { "type": "string", "minLength": 1 }
                    },
                    "required": ["inference_id"],
                    "additionalProperties": false
                }
            }
        ]
    })
}

fn external_swarm_infer_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "client_request_id": { "type": "string" },
            "domain": { "type": "string", "minLength": 1 },
            "title": { "type": "string", "minLength": 1 },
            "summary": { "type": "string", "minLength": 1 },
            "items": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "title": { "type": "string", "minLength": 1 },
                        "content": { "type": "string", "minLength": 1 },
                        "published_at": { "type": "string" },
                        "source": { "type": "string" },
                        "url": { "type": "string" },
                        "metadata": { "type": "object", "additionalProperties": true }
                    },
                    "required": ["title", "content"],
                    "additionalProperties": false
                }
            },
            "questions": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 1 }
            },
            "rounds": { "type": "integer", "minimum": 1, "maximum": 3 }
        },
        "required": ["domain", "title", "summary", "items", "questions"],
        "additionalProperties": false
    })
}

fn tool_result(value: &Value) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
            }
        ],
        "structuredContent": value,
        "isError": false
    })
}

const fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        result: Some(result),
        error: None,
    }
}

const fn error_response(id: Option<Value>, code: i64, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: JSONRPC_VERSION,
        id,
        result: None,
        error: Some(JsonRpcErrorPayload { code, message }),
    }
}

fn external_error_message(error: ExternalSwarmError) -> String {
    match error {
        ExternalSwarmError::InvalidRequest(message) => format!("invalid request: {message}"),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Arc};

    use tempfile::tempdir;

    use super::*;
    use crate::{external_swarm::ExternalSwarmItem, storage::Storage};

    #[tokio::test]
    async fn lists_generic_external_swarm_tools() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ExternalSwarmService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let response = handle_json_rpc(
            &service,
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        )
        .await
        .expect("tools/list should respond");
        let tools = response.result.expect("result should exist")["tools"]
            .as_array()
            .expect("tools should be array")
            .iter()
            .map(|tool| tool["name"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(tools.contains(&TOOL_EXTERNAL_SWARM_INFER.to_string()));
        assert!(tools.contains(&TOOL_EXTERNAL_SWARM_GET.to_string()));
    }

    #[tokio::test]
    async fn tools_call_runs_external_swarm_inference() {
        let temp = tempdir().expect("tempdir should exist");
        let service = ExternalSwarmService::new(Arc::new(Storage::new(temp.path().to_path_buf())));
        let arguments = serde_json::to_value(sample_request()).expect("request serializes");
        let response = handle_json_rpc(
            &service,
            json!({
                "jsonrpc":"2.0",
                "id":"call-1",
                "method":"tools/call",
                "params": {"name": TOOL_EXTERNAL_SWARM_INFER, "arguments": arguments}
            }),
        )
        .await
        .expect("tools/call should respond");

        assert!(response.error.is_none());
        let result = response.result.expect("result should exist");
        assert_eq!(result["structuredContent"]["item_count"], 5);
        assert_eq!(
            result["structuredContent"]["artifact_paths"]["input_items"]
                .as_array()
                .expect("input items should be array")
                .len(),
            5
        );
    }

    fn sample_request() -> ExternalSwarmInferenceRequest {
        ExternalSwarmInferenceRequest {
            client_request_id: Some("mcp-test-001".to_string()),
            domain: "market-impact".to_string(),
            title: "MCP test inference".to_string(),
            summary: "MCP caller-provided source items.".to_string(),
            items: (0..5)
                .map(|index| ExternalSwarmItem {
                    id: Some(format!("item-{index}")),
                    title: format!("Headline {index}"),
                    content: format!("Source body {index}"),
                    published_at: Some("2026-06-01T00:00:00Z".to_string()),
                    source: Some("unit-test".to_string()),
                    url: None,
                    metadata: BTreeMap::new(),
                })
                .collect(),
            questions: vec!["What changes?".to_string()],
            rounds: 1,
        }
    }
}
