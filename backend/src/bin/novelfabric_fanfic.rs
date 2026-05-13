#![forbid(unsafe_code)]

use std::{path::PathBuf, sync::Arc};

use novelfabric_backend::{
    cards::{CardKind, CardService, CreateCardRequest},
    llm::{ChatMessage, LlmApiStyle, LlmConfig, complete_chat},
    project::{CreateProjectRequest, ProjectService},
    storage::Storage,
    timeline::{CreateTimepointRequest, TimelineService},
    writing::{CreateChapterRequest, UpdateChapterRequest, WritingService},
};

struct Services {
    projects: ProjectService,
    cards: CardService,
    timeline: TimelineService,
    writing: WritingService,
}

struct RunConfig {
    novel_path: String,
    project_slug: String,
    llm: LlmConfig,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = read_run_config()?;
    let services = build_services();
    ensure_project(&services, &config.project_slug).await?;

    let text = tokio::fs::read_to_string(&config.novel_path).await?;
    let excerpt = text.lines().take(220).collect::<Vec<_>>().join("\n");
    let outline = generate_outline(&config.llm, &excerpt).await?;
    persist_context(&services, &config.project_slug, &outline).await?;
    let chapter = generate_fanfic(&config.llm, &excerpt, &outline).await?;
    persist_chapter(&services, &config.project_slug, &chapter).await?;

    println!("PROJECT={}", config.project_slug);
    println!("CHAPTER_ID=chapter-fanfic-001");
    println!("--- OUTLINE ---\n{outline}");
    println!("--- FANFIC ---\n{chapter}");
    Ok(())
}

fn read_run_config() -> Result<RunConfig, std::env::VarError> {
    Ok(RunConfig {
        novel_path: std::env::var("NOVELFABRIC_TEST_NOVEL")?,
        project_slug: std::env::var("NOVELFABRIC_TEST_PROJECT")
            .unwrap_or_else(|_| "fanfic-test-project".to_string()),
        llm: LlmConfig {
            base_url: std::env::var("NOVELFABRIC_LLM_BASE_URL")?,
            api_key: std::env::var("NOVELFABRIC_LLM_API_KEY")?,
            model: std::env::var("NOVELFABRIC_LLM_MODEL")?,
            api_style: match std::env::var("NOVELFABRIC_LLM_API_STYLE")
                .unwrap_or_else(|_| "responses".to_string())
                .as_str()
            {
                "anthropic" => LlmApiStyle::AnthropicMessages,
                "chat" => LlmApiStyle::OpenAiChatCompletions,
                _ => LlmApiStyle::OpenAiResponses,
            },
        },
    })
}

fn build_services() -> Services {
    let data_dir =
        PathBuf::from(std::env::var("NOVELFABRIC_DATA_DIR").unwrap_or_else(|_| "data".to_string()));
    let storage = Arc::new(Storage::new(data_dir));
    Services {
        projects: ProjectService::new(Arc::clone(&storage)),
        cards: CardService::new(Arc::clone(&storage)),
        timeline: TimelineService::new(Arc::clone(&storage)),
        writing: WritingService::new(storage),
    }
}

async fn ensure_project(
    services: &Services,
    project_slug: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if services.projects.get(project_slug).await.is_err() {
        services
            .projects
            .create(CreateProjectRequest {
                slug: project_slug.to_string(),
                title: "Fanfic Test Project".to_string(),
                description: "Real novel test run".to_string(),
            })
            .await?;
    }
    Ok(())
}

async fn generate_outline(
    config: &LlmConfig,
    excerpt: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    Ok(complete_chat(config, vec![
        ChatMessage { role: "system".to_string(), content: "你是一个小说拆解与同人创作助手。严格基于输入文本，提炼前十章内的重要背景、人物、冲突与时间推进。输出中文 markdown。".to_string() },
        ChatMessage { role: "user".to_string(), content: format!("以下是原著开头摘录，请总结到原著第十章进度前应把握的背景、势力、时代氛围、关键冲突，并给出一个适合同人的原创主角设定。\n\n{excerpt}") },
    ]).await?)
}

async fn persist_context(
    services: &Services,
    project_slug: &str,
    outline: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if services
        .cards
        .get(project_slug, CardKind::Character, "original-protagonist")
        .await
        .is_err()
    {
        services
            .cards
            .create(CreateCardRequest {
                project_slug: project_slug.to_string(),
                id: "original-protagonist".to_string(),
                kind: CardKind::Character,
                title: "原创主角".to_string(),
                body: outline.to_string(),
            })
            .await?;
    }

    if services
        .timeline
        .get_timepoint(project_slug, "tp-origin")
        .await
        .is_err()
    {
        services
            .timeline
            .create_timepoint(CreateTimepointRequest {
                project_slug: project_slug.to_string(),
                id: "tp-origin".to_string(),
                sequence: 1,
                title: "原著前十章进度锚点".to_string(),
                summary: "将同人剧情推进到原著第十章附近，不剧透后续主线。".to_string(),
                branch_id: None,
            })
            .await?;
    }
    Ok(())
}

async fn generate_fanfic(
    config: &LlmConfig,
    excerpt: &str,
    outline: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    Ok(complete_chat(config, vec![
        ChatMessage { role: "system".to_string(), content: "你是严谨的中文历史穿越同人作者。请在不破坏原著前十章主要进度的前提下，写一章原创同人。要求：1) 原创角色为主视角；2) 与原著世界观兼容；3) 文风自然；4) 不使用解释性大纲口吻；5) 直接输出正文 markdown。".to_string() },
        ChatMessage { role: "user".to_string(), content: format!("原著测试小说片段如下：\n\n{excerpt}\n\n参考摘要与原创主角设定如下：\n\n{outline}\n\n请写一章同人，把剧情推进到不超过原著第十章的进度范围。") },
    ]).await?)
}

async fn persist_chapter(
    services: &Services,
    project_slug: &str,
    chapter: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let chapter_id = "chapter-fanfic-001";
    if services
        .writing
        .get_chapter(project_slug, chapter_id)
        .await
        .is_err()
    {
        services
            .writing
            .create_chapter(
                project_slug,
                CreateChapterRequest {
                    id: chapter_id.to_string(),
                    title: "同人试写：雪线之南".to_string(),
                    body: chapter.to_string(),
                },
            )
            .await?;
    } else {
        services
            .writing
            .update_chapter(
                project_slug,
                chapter_id,
                UpdateChapterRequest {
                    title: "同人试写：雪线之南".to_string(),
                    body: chapter.to_string(),
                },
            )
            .await?;
    }
    Ok(())
}
