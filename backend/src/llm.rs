use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LlmApiStyle {
    OpenAiResponses,
    OpenAiChatCompletions,
    AnthropicMessages,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub api_style: LlmApiStyle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Choice {
    message: ChatMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesRequest {
    model: String,
    input: Vec<ResponsesInputMessage>,
    temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesInputMessage {
    role: String,
    content: Vec<ResponsesContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesContentPart {
    #[serde(rename = "type")]
    part_type: String,
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesApiResponse {
    output: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicMessagesRequest {
    model: String,
    system: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: Vec<AnthropicContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicContentPart {
    #[serde(rename = "type")]
    part_type: String,
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicMessagesResponse {
    content: Vec<AnthropicContentPart>,
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("provider rejected request: {status} {body}")]
    ProviderStatus {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("no assistant choice returned")]
    EmptyChoice,
}

pub async fn complete_chat(
    config: &LlmConfig,
    messages: Vec<ChatMessage>,
) -> Result<String, LlmError> {
    let client = reqwest::Client::new();
    let mut attempts = 0_u8;
    loop {
        attempts += 1;
        let result = send_once(&client, config, &messages).await;
        match result {
            Ok(content) => return Ok(content),
            Err(error) if attempts < 3 && should_retry(&error) => {
                tokio::time::sleep(std::time::Duration::from_secs(u64::from(attempts) * 2)).await;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn send_once(
    client: &reqwest::Client,
    config: &LlmConfig,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    match config.api_style {
        LlmApiStyle::OpenAiResponses => send_openai_responses(client, config, messages).await,
        LlmApiStyle::OpenAiChatCompletions => send_openai_chat(client, config, messages).await,
        LlmApiStyle::AnthropicMessages => send_anthropic_messages(client, config, messages).await,
    }
}

async fn send_openai_chat(
    client: &reqwest::Client,
    config: &LlmConfig,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let body = ChatCompletionRequest {
        model: config.model.clone(),
        messages: messages.to_vec(),
        temperature: 0.8,
    };
    let response_text = post_json(
        client,
        &format!("{}/chat/completions", config.base_url.trim_end_matches('/')),
        reqwest::header::HeaderMap::new(),
        &config.api_key,
        &body,
    )
    .await?;
    let response = serde_json::from_str::<ChatCompletionResponse>(&response_text)?;
    response
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .ok_or(LlmError::EmptyChoice)
}

async fn send_openai_responses(
    client: &reqwest::Client,
    config: &LlmConfig,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let body = ResponsesRequest {
        model: config.model.clone(),
        input: messages
            .iter()
            .map(|message| ResponsesInputMessage {
                role: message.role.clone(),
                content: vec![ResponsesContentPart {
                    part_type: "input_text".to_string(),
                    text: message.content.clone(),
                }],
            })
            .collect(),
        temperature: 0.8,
    };
    let response_text = post_json(
        client,
        &format!("{}/responses", config.base_url.trim_end_matches('/')),
        reqwest::header::HeaderMap::new(),
        &config.api_key,
        &body,
    )
    .await?;
    let response = serde_json::from_str::<ResponsesApiResponse>(&response_text)?;
    extract_responses_text(&response).ok_or(LlmError::EmptyChoice)
}

async fn send_anthropic_messages(
    client: &reqwest::Client,
    config: &LlmConfig,
    messages: &[ChatMessage],
) -> Result<String, LlmError> {
    let (system, conversation) = split_system_messages(messages);
    let body = AnthropicMessagesRequest {
        model: config.model.clone(),
        system,
        messages: conversation,
        max_tokens: 4000,
        temperature: 0.8,
    };
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::HeaderName::from_static("x-api-key"),
        reqwest::header::HeaderValue::from_str(&config.api_key).map_err(|error| {
            LlmError::Json(serde_json::Error::io(std::io::Error::other(
                error.to_string(),
            )))
        })?,
    );
    headers.insert(
        reqwest::header::HeaderName::from_static("anthropic-version"),
        reqwest::header::HeaderValue::from_static("2023-06-01"),
    );
    let response_text = post_json(
        client,
        &format!("{}/messages", config.base_url.trim_end_matches('/')),
        headers,
        "",
        &body,
    )
    .await?;
    let response = serde_json::from_str::<AnthropicMessagesResponse>(&response_text)?;
    response
        .content
        .into_iter()
        .find(|part| part.part_type == "text")
        .map(|part| part.text)
        .ok_or(LlmError::EmptyChoice)
}

async fn post_json<T: Serialize>(
    client: &reqwest::Client,
    url: &str,
    extra_headers: reqwest::header::HeaderMap,
    bearer_key: &str,
    body: &T,
) -> Result<String, LlmError> {
    let mut request = client.post(url).json(body).headers(extra_headers);
    if !bearer_key.is_empty() {
        request = request.bearer_auth(bearer_key);
    }
    let raw_response = request.send().await?;
    let status = raw_response.status();
    let response_text = raw_response.text().await?;
    if !status.is_success() {
        return Err(LlmError::ProviderStatus {
            status,
            body: response_text,
        });
    }
    Ok(response_text)
}

fn extract_responses_text(response: &ResponsesApiResponse) -> Option<String> {
    let mut text = String::new();
    for item in &response.output {
        let Some(content_items) = item.get("content").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for content in content_items {
            let content_type = content
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if (content_type == "output_text" || content_type == "text")
                && let Some(value) = content.get("text").and_then(serde_json::Value::as_str)
            {
                text.push_str(value);
            }
        }
    }
    (!text.is_empty()).then_some(text)
}

fn split_system_messages(messages: &[ChatMessage]) -> (String, Vec<AnthropicMessage>) {
    let mut system_parts = Vec::new();
    let mut conversation = Vec::new();
    for message in messages {
        if message.role == "system" {
            system_parts.push(message.content.clone());
        } else {
            conversation.push(AnthropicMessage {
                role: if message.role == "assistant" {
                    "assistant".to_string()
                } else {
                    "user".to_string()
                },
                content: vec![AnthropicContentPart {
                    part_type: "text".to_string(),
                    text: message.content.clone(),
                }],
            });
        }
    }
    (system_parts.join("\n\n"), conversation)
}

fn should_retry(error: &LlmError) -> bool {
    match error {
        LlmError::Http(reqwest_error) => reqwest_error.is_timeout() || reqwest_error.is_connect(),
        LlmError::ProviderStatus { status, .. } => {
            status.is_server_error() || *status == reqwest::StatusCode::TOO_MANY_REQUESTS
        }
        LlmError::Json(_) | LlmError::EmptyChoice => false,
    }
}
