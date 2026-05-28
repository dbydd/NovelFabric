use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    cards::{CardError, CardKind, CardRecord, CardService, CreateCardRequest},
    config::LlmConfigService,
    llm::{ChatMessage, complete_chat},
    memory::{CreateMemoryEntryRequest, MemoryError, MemoryScope, MemoryService},
    storage::{Storage, StorageError, validate_segment},
    timeline::{CreateTimepointRequest, TimelineError, TimelineService},
};

const PROJECTS_DIR: &str = "projects";
const RAW_DIR: &str = "raw";
const NORMALIZED_DIR: &str = "normalized";
const CHAPTERS_DIR: &str = "chapters";
const REPORTS_DIR: &str = "reports";
const CHAPTER_HEADING_MIN_LENGTH: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportChapterRecord {
    pub id: String,
    pub ordinal: usize,
    pub title: String,
    pub file_name: String,
    pub line_start: usize,
    pub line_end: usize,
    pub character_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportRecord {
    pub project_slug: String,
    pub import_id: String,
    pub source_name: String,
    pub raw_file: String,
    pub normalized_file: String,
    pub report_file: String,
    pub chapter_count: usize,
    pub normalized_characters: usize,
    pub chapter_records: Vec<ImportChapterRecord>,
    pub card_ids: Vec<String>,
    pub memory_keys: Vec<String>,
    pub timepoint_ids: Vec<String>,
    pub extraction_status: String,
    pub extraction_message: String,
    pub llm_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportTxtRequest {
    pub project_slug: String,
    pub import_id: String,
    pub source_name: String,
    pub raw_bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ImportService {
    storage: Arc<Storage>,
    cards: CardService,
    memory: MemoryService,
    timeline: TimelineService,
}

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid import id: {0}")]
    InvalidImportId(String),
    #[error("invalid source name: {0}")]
    InvalidSourceName(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("import already exists: {0}")]
    AlreadyExists(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Cards(#[from] CardError),
    #[error(transparent)]
    Memory(#[from] MemoryError),
    #[error(transparent)]
    Timeline(#[from] TimelineError),
}

impl ImportService {
    #[must_use]
    pub fn new(storage: Arc<Storage>) -> Self {
        Self {
            cards: CardService::new(Arc::clone(&storage)),
            memory: MemoryService::new(Arc::clone(&storage)),
            timeline: TimelineService::new(Arc::clone(&storage)),
            storage,
        }
    }

    pub async fn import_txt(&self, request: ImportTxtRequest) -> Result<ImportRecord, ImportError> {
        // Import intentionally persists three layers of output:
        // 1. raw text bytes decoded lossily for traceability,
        // 2. normalized UTF-8 text used for deterministic processing,
        // 3. seeded chapter/card/memory/timeline artifacts that the rest of the product can edit.
        // This split makes import debuggable without forcing later features to parse the original txt again.
        validate_project_slug(&request.project_slug)?;
        validate_import_id(&request.import_id)?;
        validate_source_name(&request.source_name)?;
        self.ensure_project_exists(&request.project_slug).await?;

        let raw_file_name = format!("{}.txt", request.import_id);
        let normalized_file_name = format!("{}.txt", request.import_id);
        let report_file_name = format!("{}.md", request.import_id);
        let raw_path = import_root(&request.project_slug)
            .join(RAW_DIR)
            .join(&raw_file_name);
        let normalized_path = import_root(&request.project_slug)
            .join(NORMALIZED_DIR)
            .join(&normalized_file_name);
        let report_path = import_root(&request.project_slug)
            .join(REPORTS_DIR)
            .join(&report_file_name);

        for path in [&raw_path, &normalized_path, &report_path] {
            if self.storage.exists(path).await? {
                return Err(ImportError::AlreadyExists(request.import_id.clone()));
            }
        }

        let raw_text = decode_text_bytes(&request.raw_bytes);
        let normalized_text = normalize_text(&raw_text);
        let split = split_chapters(&normalized_text);

        self.storage.write_text(&raw_path, &raw_text).await?;
        self.storage
            .write_text(&normalized_path, &normalized_text)
            .await?;

        let mut chapter_records = Vec::with_capacity(split.chapters.len());
        for chapter in &split.chapters {
            let file_name = format!("{:04}-{}.md", chapter.ordinal, chapter.id);
            let body = render_chapter_markdown(chapter);
            self.storage
                .write_text(
                    &import_root(&request.project_slug)
                        .join(CHAPTERS_DIR)
                        .join(&request.import_id)
                        .join(&file_name),
                    &body,
                )
                .await?;
            chapter_records.push(ImportChapterRecord {
                id: chapter.id.clone(),
                ordinal: chapter.ordinal,
                title: chapter.title.clone(),
                file_name,
                line_start: chapter.line_start,
                line_end: chapter.line_end,
                character_count: chapter.text.chars().count(),
            });
        }

        let artifact_summary = self
            .seed_artifacts(
                &request.project_slug,
                &request.import_id,
                &request.source_name,
                &normalized_text,
                &split.chapters,
            )
            .await?;

        let report = render_report(
            &request.import_id,
            &request.source_name,
            &normalized_text,
            &chapter_records,
            &artifact_summary,
        );
        self.storage.write_text(&report_path, &report).await?;

        Ok(ImportRecord {
            project_slug: request.project_slug,
            import_id: request.import_id,
            source_name: request.source_name,
            raw_file: raw_file_name,
            normalized_file: normalized_file_name,
            report_file: report_file_name,
            chapter_count: chapter_records.len(),
            normalized_characters: normalized_text.chars().count(),
            chapter_records,
            card_ids: artifact_summary.card_ids,
            memory_keys: artifact_summary.memory_keys,
            timepoint_ids: artifact_summary.timepoint_ids,
            extraction_status: artifact_summary.extraction_status.as_str().to_string(),
            extraction_message: artifact_summary.extraction_message.clone(),
            llm_model: artifact_summary.llm_model.clone(),
        })
    }

    async fn ensure_project_exists(&self, project_slug: &str) -> Result<(), ImportError> {
        let metadata_path = project_root(project_slug).join("project.json");
        if self.storage.exists(&metadata_path).await? {
            Ok(())
        } else {
            Err(ImportError::ProjectNotFound(project_slug.to_string()))
        }
    }

    async fn seed_artifacts(
        &self,
        project_slug: &str,
        import_id: &str,
        source_name: &str,
        normalized_text: &str,
        chapters: &[SplitChapter],
    ) -> Result<ArtifactSummary, ImportError> {
        // Seeding is deliberately best-effort for timepoints and memory entries in places where the
        // imported text may be re-run or partially overlap with existing artifacts. The import report
        // still records the intended identifiers so downstream debugging can see what should exist.
        let mut summary = ArtifactSummary::default();

        let title = first_non_empty_line(normalized_text).unwrap_or(source_name);
        let summary_body = build_import_overview_body(import_id, source_name, chapters);
        let overview_card = self
            .upsert_card(
                CreateCardRequest {
                    project_slug: project_slug.to_string(),
                    id: format!("import-{import_id}-overview"),
                    kind: CardKind::World,
                    title: format!("Import Overview: {title}"),
                    body: summary_body,
                },
                &mut summary.card_ids,
            )
            .await?;
        let _ = overview_card;

        let extraction = self
            .extract_semantic_assets(normalized_text, chapters)
            .await;
        summary.extraction_status = extraction.status;
        summary.extraction_message = extraction.message;
        summary.llm_model = extraction.model;
        for asset in &extraction.assets.cards {
            self.upsert_card(
                CreateCardRequest {
                    project_slug: project_slug.to_string(),
                    id: asset.id.clone(),
                    kind: asset.kind,
                    title: asset.title.clone(),
                    body: asset.body.clone(),
                },
                &mut summary.card_ids,
            )
            .await?;
            if asset.kind == CardKind::Character {
                self.ensure_character_agent(project_slug, &asset.id, &asset.title, &asset.body)
                    .await?;
            }
        }
        for skill in &extraction.assets.skills {
            self.write_imported_agent_skill(project_slug, skill).await?;
        }

        for chapter in chapters {
            let timepoint_id = format!("{}-{}", import_id, chapter.id);
            let sequence = u64::try_from(chapter.ordinal).unwrap_or(u64::MAX);
            let _ = self
                .timeline
                .create_timepoint(CreateTimepointRequest {
                    project_slug: project_slug.to_string(),
                    id: timepoint_id.clone(),
                    sequence,
                    title: chapter.title.clone(),
                    summary: chapter.summary.clone(),
                    branch_id: None,
                })
                .await;
            summary.timepoint_ids.push(timepoint_id.clone());

            let memory_key = format!("{}-{}", import_id, chapter.id);
            let body = format!(
                "Imported from `{source_name}`.\n\n{}\n\nExcerpt:\n\n{}",
                chapter.summary,
                truncate_text(&chapter.text, 320)
            );
            let _ = self
                .memory
                .create(
                    project_slug,
                    CreateMemoryEntryRequest {
                        scope: MemoryScope::Chapter {
                            chapter: chapter.id.clone(),
                        },
                        key: memory_key.clone(),
                        title: chapter.title.clone(),
                        timeline: "imported-story".to_string(),
                        timepoint: format!("{:04}", chapter.ordinal),
                        body,
                    },
                )
                .await;
            summary.memory_keys.push(memory_key);
        }

        let global_memory_key = format!("import-{import_id}-summary");
        let _ = self
            .memory
            .create(
                project_slug,
                CreateMemoryEntryRequest {
                    scope: MemoryScope::Global,
                    key: global_memory_key.clone(),
                    title: format!("Import Summary {import_id}"),
                    timeline: "imported-story".to_string(),
                    timepoint: "0000".to_string(),
                    body: build_global_memory_body(source_name, chapters),
                },
            )
            .await;
        summary.memory_keys.push(global_memory_key);

        Ok(summary)
    }

    async fn extract_semantic_assets(
        &self,
        normalized_text: &str,
        chapters: &[SplitChapter],
    ) -> SemanticExtractionResult {
        let config = match LlmConfigService::new(Arc::clone(&self.storage))
            .load_resolved("import")
            .await
        {
            Ok(Some(config)) => config,
            Ok(None) => {
                return SemanticExtractionResult::failed(
                    "LLM semantic extraction skipped: no LLM endpoint/default model is configured. Configure and test LLM before importing for usable cards.",
                );
            }
            Err(error) => {
                return SemanticExtractionResult::failed(format!(
                    "LLM semantic extraction config error: {error}"
                ));
            }
        };
        let model = Some(config.model.clone());
        let prompt = build_semantic_extraction_prompt(normalized_text, chapters);
        let response = match complete_chat(
            &config,
            vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: "你是 NovelFabric 的拆书抽取器，只输出严格 JSON，不输出 markdown。"
                        .to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
        )
        .await
        {
            Ok(response) => response,
            Err(error) => {
                return SemanticExtractionResult::failed_with_model(
                    format!("LLM semantic extraction failed: {error}"),
                    model,
                );
            }
        };
        match parse_llm_semantic_assets(&response, chapters) {
            Some(assets) => SemanticExtractionResult {
                status: ExtractionStatus::LlmSucceeded,
                message: format!(
                    "LLM semantic extraction succeeded with {} card(s).",
                    assets.cards.len()
                ),
                model,
                assets,
            },
            None => SemanticExtractionResult::failed_with_model(
                "LLM semantic extraction returned invalid or empty JSON; semantic cards were not generated.",
                model,
            ),
        }
    }

    async fn ensure_character_agent(
        &self,
        project_slug: &str,
        agent_id: &str,
        character_name: &str,
        card_body: &str,
    ) -> Result<(), ImportError> {
        let root = project_root(project_slug).join("agents").join(agent_id);
        self.storage.ensure_dir(&root.join("skills")).await?;
        let soul_path = root.join("soul.md");
        if !self.storage.exists(&soul_path).await? {
            let soul = format!(
                "# {character_name}

## Role
从导入小说中提取的角色智能体。

## Source Character Card
{card_body}

## Behavior Contract
- 保持原文中体现的人物身份、处境、动机与知识边界。
- 推演时只能基于已导入章节、记忆、世界观与规则卡行动。
"
            );
            self.storage.write_text(&soul_path, &soul).await?;
        }
        let memory_path = root.join("memory.md");
        if !self.storage.exists(&memory_path).await? {
            self.storage
                .write_text(
                    &memory_path,
                    &format!(
                        "# {character_name} Memory

- 来源：导入拆书。
- 初始记忆以章节记忆与人物卡为准。
"
                    ),
                )
                .await?;
        }
        let skill_path = root.join("skills").join("character-decision.md");
        if !self.storage.exists(&skill_path).await? {
            self.storage
                .write_text(
                    &skill_path,
                    "---
intent: character-decision
target: simulation/logs
mode: append
scope: character
priority: preserve imported characterization and chapter evidence
consistency: ooc
---
# character-decision

## Contract
- 行动前引用已导入章节证据、角色 soul.md 与人物卡。
- 不得越过已知知识边界。
- 写入必须保留可审计的推演记录。
",
                )
                .await?;
        }
        self.storage
            .write_json(
                &root.join("profile.json"),
                &serde_json::json!({ "agent_id": agent_id, "source": "import", "display_name": character_name }),
            )
            .await?;
        Ok(())
    }

    async fn write_imported_agent_skill(
        &self,
        project_slug: &str,
        skill: &SemanticSkillAsset,
    ) -> Result<(), ImportError> {
        validate_segment(&skill.agent_id)
            .map_err(|_| ImportError::InvalidImportId(skill.agent_id.clone()))?;
        validate_segment(&skill.file_name)
            .map_err(|_| ImportError::InvalidSourceName(skill.file_name.clone()))?;
        let root = project_root(project_slug)
            .join("agents")
            .join(&skill.agent_id)
            .join("skills");
        self.storage.ensure_dir(&root).await?;
        let requested_path = root.join(&skill.file_name);
        let target_path = if self.storage.exists(&requested_path).await? {
            let existing = self.storage.read_text(&requested_path).await?;
            if is_generated_import_seed_skill(&existing) {
                requested_path
            } else {
                root.join(unique_imported_skill_file_name(&skill.file_name))
            }
        } else {
            requested_path
        };
        self.storage.write_text(&target_path, &skill.body).await?;
        Ok(())
    }

    async fn upsert_card(
        &self,
        request: CreateCardRequest,
        sink: &mut Vec<String>,
    ) -> Result<CardRecord, ImportError> {
        let id = request.id.clone();
        let created = match self.cards.create(request.clone()).await {
            Ok(card) => card,
            Err(CardError::AlreadyExists { .. }) => {
                self.cards
                    .get(&request.project_slug, request.kind, &id)
                    .await?
            }
            Err(error) => return Err(ImportError::Cards(error)),
        };
        sink.push(id);
        Ok(created)
    }
}

impl Default for ArtifactSummary {
    fn default() -> Self {
        Self {
            card_ids: Vec::new(),
            memory_keys: Vec::new(),
            timepoint_ids: Vec::new(),
            extraction_status: ExtractionStatus::LlmFailed,
            extraction_message: "LLM semantic extraction has not run.".to_string(),
            llm_model: None,
        }
    }
}

struct ArtifactSummary {
    card_ids: Vec<String>,
    memory_keys: Vec<String>,
    timepoint_ids: Vec<String>,
    extraction_status: ExtractionStatus,
    extraction_message: String,
    llm_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SplitDocument {
    chapters: Vec<SplitChapter>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SplitChapter {
    id: String,
    ordinal: usize,
    title: String,
    text: String,
    summary: String,
    line_start: usize,
    line_end: usize,
}

fn validate_project_slug(slug: &str) -> Result<(), ImportError> {
    validate_segment(slug).map_err(|_| ImportError::InvalidProjectSlug(slug.to_string()))?;
    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(ImportError::InvalidProjectSlug(slug.to_string()));
    }
    Ok(())
}

fn validate_import_id(import_id: &str) -> Result<(), ImportError> {
    validate_segment(import_id).map_err(|_| ImportError::InvalidImportId(import_id.to_string()))?;
    if !import_id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(ImportError::InvalidImportId(import_id.to_string()));
    }
    Ok(())
}

fn validate_source_name(source_name: &str) -> Result<(), ImportError> {
    if source_name.trim().is_empty() || source_name.contains('/') || source_name.contains('\\') {
        return Err(ImportError::InvalidSourceName(source_name.to_string()));
    }
    Ok(())
}

fn project_root(slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(slug)
}

fn import_root(project_slug: &str) -> PathBuf {
    project_root(project_slug).join("import")
}

fn decode_text_bytes(raw_bytes: &[u8]) -> String {
    if let Ok(text) = String::from_utf8(raw_bytes.to_vec()) {
        text
    } else {
        let (decoded, _, _) = GBK.decode(raw_bytes);
        decoded.into_owned()
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct LlmSemanticExtraction {
    #[serde(default)]
    characters: Vec<LlmSemanticCharacter>,
    #[serde(default, alias = "world_cards")]
    worldviews: Vec<LlmSemanticWorldview>,
    #[serde(default, alias = "rule_cards")]
    rules: Vec<LlmSemanticRule>,
    #[serde(default)]
    skills: Vec<LlmSemanticSkill>,
    #[serde(default)]
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct LlmSemanticCharacter {
    id: Option<String>,
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(alias = "role_summary")]
    summary: String,
    #[serde(default)]
    motivation: Option<String>,
    #[serde(default)]
    knowledge_boundary: Option<String>,
    #[serde(default)]
    evidence: Vec<LlmEvidence>,
    #[serde(default)]
    confidence: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct LlmSemanticWorldview {
    id: Option<String>,
    title: String,
    summary: String,
    #[serde(default)]
    evidence: Vec<LlmEvidence>,
    #[serde(default)]
    confidence: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct LlmSemanticRule {
    id: Option<String>,
    title: String,
    #[serde(default, alias = "rule")]
    summary: String,
    #[serde(default)]
    constraints: Vec<String>,
    #[serde(default)]
    evidence: Vec<LlmEvidence>,
    #[serde(default)]
    confidence: Option<f32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
enum LlmEvidence {
    Text(String),
    Structured {
        text: String,
        #[serde(default)]
        source_path: Option<String>,
        #[serde(default)]
        chapter: Option<String>,
        #[serde(default)]
        timepoint: Option<String>,
    },
}

impl LlmEvidence {
    fn render(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Structured {
                text,
                source_path,
                chapter,
                timepoint,
            } => {
                let mut parts = Vec::new();
                if let Some(path) = source_path
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    parts.push(format!("path: {path}"));
                }
                if let Some(chapter) = chapter.as_deref().filter(|value| !value.trim().is_empty()) {
                    parts.push(format!("chapter: {chapter}"));
                }
                if let Some(timepoint) = timepoint
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    parts.push(format!("timepoint: {timepoint}"));
                }
                if parts.is_empty() {
                    text.clone()
                } else {
                    format!("{} ({})", text, parts.join(", "))
                }
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LlmSemanticSkill {
    agent_id: String,
    file_name: String,
    #[serde(default)]
    intent: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    consistency: String,
    body: String,
}

fn build_semantic_extraction_prompt(text: &str, chapters: &[SplitChapter]) -> String {
    let chapter_outline = chapters
        .iter()
        .take(20)
        .map(|chapter| format!("{}: {}", chapter.title, truncate_text(&chapter.text, 260)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "请从小说文本中提取人物/剧情/角色/世界观/规则/技能，输出 JSON：{{\"characters\":[{{\"id\":\"ascii-kebab-id\",\"name\":\"姓名\",\"aliases\":[\"别名\"],\"role_summary\":\"身份、动机、处境\",\"motivation\":\"核心动机\",\"knowledge_boundary\":\"知识边界\",\"evidence\":[{{\"text\":\"原文证据\",\"source_path\":\"import/chapters/<import-id>/<chapter>.md\",\"chapter\":\"章节名\",\"timepoint\":\"0001\"}}],\"confidence\":0.0}}],\"world_cards\":[{{\"id\":\"ascii-kebab-id\",\"title\":\"设定名\",\"summary\":\"世界观设定\",\"evidence\":[{{\"text\":\"原文证据\",\"chapter\":\"章节名\"}}],\"confidence\":0.0}}],\"rule_cards\":[{{\"id\":\"ascii-kebab-id\",\"title\":\"规则名\",\"rule\":\"叙事/能力/制度规则\",\"constraints\":[\"约束\"],\"evidence\":[{{\"text\":\"原文证据\",\"chapter\":\"章节名\"}}],\"confidence\":0.0}}],\"skills\":[{{\"agent_id\":\"角色id\",\"file_name\":\"character-decision.md\",\"intent\":\"character-decision\",\"target\":\"simulation/logs\",\"mode\":\"append\",\"scope\":\"character\",\"consistency\":\"ooc\",\"body\":\"技能正文\"}}],\"warnings\":[\"低置信或冲突说明\"]}}。必须基于原文，不要乱码，不要编造；证据必须带章节或路径；低置信必须写 warnings。\n\n章节摘要：\n{chapter_outline}\n\n全文片段：\n{}",
        truncate_text(text, 12000)
    )
}

fn parse_llm_semantic_assets(response: &str, chapters: &[SplitChapter]) -> Option<SemanticAssets> {
    let json_text = extract_json_object(response)?;
    let extraction = serde_json::from_str::<LlmSemanticExtraction>(json_text).ok()?;
    let mut cards = Vec::new();
    let mut seen_ids = Vec::new();
    for character in extraction
        .characters
        .into_iter()
        .filter(|item| !item.name.trim().is_empty())
    {
        let id = sanitize_asset_id(character.id.as_deref().unwrap_or(&character.name));
        if seen_ids.contains(&id) {
            continue;
        }
        seen_ids.push(id.clone());
        cards.push(SemanticAssetCard {
            id,
            kind: CardKind::Character,
            title: character.name.clone(),
            body: render_llm_character_card(&character, chapters),
        });
    }
    for worldview in extraction
        .worldviews
        .into_iter()
        .filter(|item| !item.title.trim().is_empty())
    {
        let title = worldview.title.clone();
        cards.push(SemanticAssetCard {
            id: sanitize_asset_id(worldview.id.as_deref().unwrap_or(&title)),
            kind: CardKind::World,
            title: title.clone(),
            body: render_llm_worldview_card(&worldview, &title),
        });
    }
    for rule in extraction
        .rules
        .into_iter()
        .filter(|item| !item.title.trim().is_empty())
    {
        let title = rule.title.clone();
        cards.push(SemanticAssetCard {
            id: sanitize_asset_id(rule.id.as_deref().unwrap_or(&title)),
            kind: CardKind::Rule,
            title: title.clone(),
            body: render_llm_rule_card(&rule, &title),
        });
    }
    let mut skill_bodies = Vec::new();
    let mut skills = Vec::new();
    for skill in extraction.skills {
        if skill.agent_id.trim().is_empty()
            || skill.file_name.trim().is_empty()
            || skill.body.trim().is_empty()
        {
            continue;
        }
        let skill_body = render_imported_skill_body(&skill);
        skill_bodies.push(format!(
            "## Skill `{}` for `{}`\n- intent: {}\n- target: {}\n- mode: {}\n- scope: {}\n- consistency: {}\n\n{}",
            skill.file_name,
            skill.agent_id,
            empty_as_unset(&skill.intent),
            empty_as_unset(&skill.target),
            empty_as_unset(&skill.mode),
            empty_as_unset(&skill.scope),
            empty_as_unset(&skill.consistency),
            skill.body
        ));
        skills.push(SemanticSkillAsset {
            agent_id: sanitize_asset_id(&skill.agent_id),
            file_name: sanitize_skill_file_name(&skill.file_name),
            body: skill_body,
        });
    }
    let warnings = extraction
        .warnings
        .into_iter()
        .filter(|warning| !warning.trim().is_empty())
        .map(|warning| format!("- {warning}"))
        .collect::<Vec<_>>();
    if !skill_bodies.is_empty() || !warnings.is_empty() {
        let mut body = "# LLM 抽取质量与技能建议\n".to_string();
        if !warnings.is_empty() {
            body.push_str("\n## Warnings\n");
            body.push_str(&warnings.join("\n"));
            body.push('\n');
        }
        if !skill_bodies.is_empty() {
            body.push_str("\n## Suggested Skills\n");
            body.push_str(&skill_bodies.join("\n\n"));
            body.push('\n');
        }
        cards.push(SemanticAssetCard {
            id: "llm-extraction-quality-and-skills".to_string(),
            kind: CardKind::Rule,
            title: "LLM 抽取质量与技能建议".to_string(),
            body,
        });
    }
    (!cards.is_empty() || !skills.is_empty()).then_some(SemanticAssets { cards, skills })
}

fn render_llm_character_card(
    character: &LlmSemanticCharacter,
    chapters: &[SplitChapter],
) -> String {
    let evidence = render_evidence_list(&character.evidence);
    let aliases = render_optional_list(&character.aliases, "未提供别名。");
    let motivation = character
        .motivation
        .as_deref()
        .unwrap_or("未提供明确动机。");
    let knowledge_boundary = character
        .knowledge_boundary
        .as_deref()
        .unwrap_or("未提供明确知识边界；推演时必须回看章节记忆。提升可信度前不得补写未证实信息。");
    format!(
        "# {}\n\n## LLM 身份与动机提取\n{}\n\n## Aliases\n{}\n\n## Motivation\n{}\n\n## Knowledge Boundary\n{}\n\n## Confidence\n{}\n\n## 原文证据\n{}\n\n## 推演约束\n- 保持 LLM 基于原文提取的人物身份、动机、处境和知识边界。\n- 决策必须引用已导入章节、记忆、世界观或规则卡。\n\n## Source\nLLM semantic extraction from {} chapter(s).\n",
        character.name,
        character.summary,
        aliases,
        motivation,
        knowledge_boundary,
        render_confidence(character.confidence),
        evidence,
        chapters.len()
    )
}

fn render_llm_worldview_card(worldview: &LlmSemanticWorldview, title: &str) -> String {
    format!(
        "# {title}\n\n## LLM 世界观提取\n{}\n\n## Confidence\n{}\n\n## Evidence\n{}\n",
        worldview.summary,
        render_confidence(worldview.confidence),
        render_evidence_list(&worldview.evidence)
    )
}

fn render_llm_rule_card(rule: &LlmSemanticRule, title: &str) -> String {
    format!(
        "# {title}\n\n## LLM 规则提取\n{}\n\n## Constraints\n{}\n\n## Confidence\n{}\n\n## Evidence\n{}\n",
        rule.summary,
        render_optional_list(&rule.constraints, "未提供独立约束。"),
        render_confidence(rule.confidence),
        render_evidence_list(&rule.evidence)
    )
}

fn render_evidence_list(evidence: &[LlmEvidence]) -> String {
    if evidence.is_empty() {
        "- LLM 未提供逐条证据；请回看章节记忆。".to_string()
    } else {
        evidence
            .iter()
            .map(|item| format!("- {}", item.render()))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn render_optional_list(values: &[String], empty_message: &str) -> String {
    let rendered = values
        .iter()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("- {value}"))
        .collect::<Vec<_>>();
    if rendered.is_empty() {
        format!("- {empty_message}")
    } else {
        rendered.join("\n")
    }
}

fn render_confidence(confidence: Option<f32>) -> String {
    confidence.map_or_else(|| "not provided".to_string(), |value| format!("{value:.2}"))
}

fn empty_as_unset(value: &str) -> &str {
    if value.trim().is_empty() {
        "unset"
    } else {
        value
    }
}

fn render_imported_skill_body(skill: &LlmSemanticSkill) -> String {
    format!(
        "---\nintent: {}\ntarget: {}\nmode: {}\nscope: {}\nconsistency: {}\n---\n# {}\n\n{}\n",
        empty_as_unset(&skill.intent),
        empty_as_unset(&skill.target),
        empty_as_unset(&skill.mode),
        empty_as_unset(&skill.scope),
        empty_as_unset(&skill.consistency),
        skill.file_name.trim_end_matches(".md"),
        skill.body
    )
}

fn is_generated_import_seed_skill(body: &str) -> bool {
    body.contains("preserve imported characterization and chapter evidence")
        && body.contains("# character-decision")
}

fn unique_imported_skill_file_name(file_name: &str) -> String {
    let stem = file_name.trim_end_matches(".md").trim();
    let safe_stem = if stem.is_empty() {
        "imported-skill"
    } else {
        stem
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    format!("{safe_stem}.imported-{timestamp}.md")
}

fn sanitize_skill_file_name(value: &str) -> String {
    let mut file_name = value
        .trim()
        .replace(['/', '\\', ':'], "-")
        .trim_matches('-')
        .to_string();
    if file_name.is_empty() {
        file_name = "imported-skill.md".to_string();
    }
    if !Path::new(&file_name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        file_name.push_str(".md");
    }
    file_name
}

fn extract_json_object(response: &str) -> Option<&str> {
    let start = response.find('{')?;
    let end = response.rfind('}')?;
    (start <= end).then_some(&response[start..=end])
}

fn sanitize_asset_id(value: &str) -> String {
    let slug = slugify(value);
    if slug == "entity" {
        stable_entity_id(value)
    } else {
        slug
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticAssetCard {
    id: String,
    kind: CardKind,
    title: String,
    body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticSkillAsset {
    agent_id: String,
    file_name: String,
    body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ExtractionStatus {
    LlmSucceeded,
    LlmFailed,
}

impl ExtractionStatus {
    const fn as_str(&self) -> &'static str {
        match self {
            Self::LlmSucceeded => "llm_succeeded",
            Self::LlmFailed => "llm_failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticExtractionResult {
    status: ExtractionStatus,
    message: String,
    model: Option<String>,
    assets: SemanticAssets,
}

impl SemanticExtractionResult {
    fn failed(message: impl Into<String>) -> Self {
        Self::failed_with_model(message, None)
    }

    fn failed_with_model(message: impl Into<String>, model: Option<String>) -> Self {
        Self {
            status: ExtractionStatus::LlmFailed,
            message: message.into(),
            model,
            assets: SemanticAssets {
                cards: Vec::new(),
                skills: Vec::new(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticAssets {
    cards: Vec<SemanticAssetCard>,
    skills: Vec<SemanticSkillAsset>,
}

fn stable_entity_id(name: &str) -> String {
    let slug = slugify(name);
    if slug == "entity" {
        format!("entity-{:016x}", stable_hash(name))
    } else {
        slug
    }
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn normalize_text(input: &str) -> String {
    // The backend treats CRLF/CR variants and repeated blank lines as formatting noise.
    // Normalization intentionally preserves textual content while producing a stable string for
    // chapter splitting, hashing, previews, and import regression tests.
    let unified_newlines = input.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed_lines = unified_newlines
        .split('\n')
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    let mut normalized = String::with_capacity(trimmed_lines.len());
    let mut previous_blank = false;
    for line in trimmed_lines.lines() {
        let is_blank = line.trim().is_empty();
        if is_blank {
            if !previous_blank {
                normalized.push('\n');
            }
        } else {
            if !normalized.is_empty() && !normalized.ends_with('\n') {
                normalized.push('\n');
            }
            normalized.push_str(line);
            normalized.push('\n');
        }
        previous_blank = is_blank;
    }
    normalized.trim().to_string()
}

fn split_chapters(text: &str) -> SplitDocument {
    // Chapter splitting is intentionally heuristic rather than semantic.
    // We look for common Chinese "第X章/节" headings and otherwise fall back to a single chapter so
    // every import remains usable even when the source text has no recognizable structure.
    let lines = text.lines().collect::<Vec<_>>();
    let mut heading_indexes = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if is_chapter_heading(line) {
            heading_indexes.push(index);
        }
    }

    if heading_indexes.is_empty() {
        return SplitDocument {
            chapters: vec![build_fallback_chapter(text)],
        };
    }

    let mut chapters = Vec::with_capacity(heading_indexes.len());
    for (position, start_index) in heading_indexes.iter().enumerate() {
        let end_index = heading_indexes
            .get(position + 1)
            .copied()
            .unwrap_or(lines.len());
        let slice = &lines[*start_index..end_index];
        let title = slice[0].trim().to_string();
        let text = slice.join("\n").trim().to_string();
        chapters.push(SplitChapter {
            id: format!("chapter-{:04}", position + 1),
            ordinal: position + 1,
            title: title.clone(),
            summary: summarize_text(&text),
            text,
            line_start: start_index + 1,
            line_end: end_index,
        });
    }

    SplitDocument { chapters }
}

fn build_fallback_chapter(text: &str) -> SplitChapter {
    let title = first_non_empty_line(text).map_or_else(
        || "Imported Text".to_string(),
        |value| truncate_text(value, 48),
    );
    SplitChapter {
        id: "chapter-0001".to_string(),
        ordinal: 1,
        title,
        summary: summarize_text(text),
        text: text.trim().to_string(),
        line_start: 1,
        line_end: text.lines().count().max(1),
    }
}

fn is_chapter_heading(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.chars().count() < CHAPTER_HEADING_MIN_LENGTH {
        return false;
    }
    if !trimmed.starts_with('第') {
        return false;
    }
    let Some(rest) = trimmed.strip_prefix('第') else {
        return false;
    };
    let Some((marker, suffix)) = rest.split_once('章').or_else(|| rest.split_once('节')) else {
        return false;
    };
    let marker = marker.trim();
    if marker.is_empty() {
        return false;
    }
    if !marker.chars().all(is_heading_numeral) {
        return false;
    }
    suffix.trim().chars().count() <= 40
}

const fn is_heading_numeral(character: char) -> bool {
    character.is_ascii_digit()
        || matches!(
            character,
            '零' | '一'
                | '二'
                | '两'
                | '三'
                | '四'
                | '五'
                | '六'
                | '七'
                | '八'
                | '九'
                | '十'
                | '百'
                | '千'
                | '〇'
        )
}

fn render_chapter_markdown(chapter: &SplitChapter) -> String {
    format!(
        "# {}\n\n- Chapter ID: `{}`\n- Ordinal: {}\n- Lines: {}-{}\n\n{}\n",
        chapter.title,
        chapter.id,
        chapter.ordinal,
        chapter.line_start,
        chapter.line_end,
        chapter.text
    )
}

fn render_report(
    import_id: &str,
    source_name: &str,
    normalized_text: &str,
    chapter_records: &[ImportChapterRecord],
    artifacts: &ArtifactSummary,
) -> String {
    let chapter_lines = chapter_records
        .iter()
        .map(|chapter| {
            format!(
                "- {} (`{}`) lines {}-{}, {} chars",
                chapter.title,
                chapter.file_name,
                chapter.line_start,
                chapter.line_end,
                chapter.character_count
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "# Import Report: {import_id}\n\n## Source\n- Name: `{source_name}`\n- Normalized characters: {}\n- Chapters: {}\n\n## LLM semantic extraction\n- Status: {}\n- Model: {}\n- Message: {}\n\n## Chapters\n{}\n\n## Seeded artifacts\n- Cards: {}\n- Memory entries: {}\n- Timeline timepoints: {}\n\n## Preview\n\n{}\n",
        normalized_text.chars().count(),
        chapter_records.len(),
        artifacts.extraction_status.as_str(),
        artifacts.llm_model.as_deref().unwrap_or("not configured"),
        artifacts.extraction_message,
        chapter_lines,
        artifacts.card_ids.join(", "),
        artifacts.memory_keys.join(", "),
        artifacts.timepoint_ids.join(", "),
        truncate_text(normalized_text, 500)
    )
}

fn build_import_overview_body(
    import_id: &str,
    source_name: &str,
    chapters: &[SplitChapter],
) -> String {
    let mut body = format!(
        "# Import {}\n\nSource: `{}`\n\nDetected chapters: {}\n",
        import_id,
        source_name,
        chapters.len()
    );
    for chapter in chapters.iter().take(10) {
        let _ = writeln!(body, "- {}", chapter.title);
    }
    body
}

fn build_global_memory_body(source_name: &str, chapters: &[SplitChapter]) -> String {
    let mut body = format!(
        "Imported `{source_name}` with {} chapter(s).
",
        chapters.len()
    );
    for chapter in chapters.iter().take(8) {
        let _ = writeln!(body, "- {}: {}", chapter.title, chapter.summary);
    }
    body
}

fn summarize_text(text: &str) -> String {
    truncate_text(&text.split_whitespace().collect::<Vec<_>>().join(" "), 120)
}

fn first_non_empty_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

fn truncate_text(text: &str, limit: usize) -> String {
    let truncated = text.chars().take(limit).collect::<String>();
    if text.chars().count() > limit {
        format!("{truncated}...")
    } else {
        truncated
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
        "entity".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::Arc,
    };

    use tempfile::tempdir;

    use super::{ImportService, ImportTxtRequest, SemanticSkillAsset, split_chapters};
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    fn collect_files(root: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    files.extend(collect_files(&path));
                } else {
                    files.push(path);
                }
            }
        }
        files
    }

    #[test]
    fn chapter_split_falls_back_to_single_chapter_without_headings() {
        let split = split_chapters("开场白\n\n这里没有章节标题，只有连续正文。\n第二段继续。");

        assert_eq!(split.chapters.len(), 1);
        assert_eq!(split.chapters[0].ordinal, 1);
        assert!(split.chapters[0].text.contains("只有连续正文"));
    }

    #[tokio::test]
    async fn import_preserves_raw_source_and_normalizes_utf8_text() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "alpha-project".to_string(),
                title: "Alpha".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let source = b"\xb5\xda\xd2\xbb\xd5\xc2 \xbf\xaa\xb6\xcb\r\n\xd5\xfd\xce\xc4\r\n".to_vec();
        let record = imports
            .import_txt(ImportTxtRequest {
                project_slug: "alpha-project".to_string(),
                import_id: "sample-import".to_string(),
                source_name: "sample.txt".to_string(),
                raw_bytes: source.clone(),
            })
            .await
            .expect("import should succeed");

        assert_eq!(record.chapter_count, 1);

        let raw = tokio::fs::read_to_string(
            temp.path()
                .join("projects/alpha-project/import/raw/sample-import.txt"),
        )
        .await
        .expect("raw file should exist");
        assert!(!raw.contains('�'));
        assert!(raw.contains("第一章 开端"));

        let normalized = tokio::fs::read_to_string(
            temp.path()
                .join("projects/alpha-project/import/normalized/sample-import.txt"),
        )
        .await
        .expect("normalized file should exist");
        assert!(!normalized.contains('\r'));
        assert!(normalized.is_char_boundary(normalized.len()));
    }

    #[tokio::test]
    async fn fixture_import_writes_chapters_report_and_seed_artifacts() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "fixture-project".to_string(),
                title: "Fixture".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let fixture =
            std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../test_novel.txt"))
                .expect("fixture should read");
        let record = imports
            .import_txt(ImportTxtRequest {
                project_slug: "fixture-project".to_string(),
                import_id: "test-novel".to_string(),
                source_name: "test_novel.txt".to_string(),
                raw_bytes: fixture,
            })
            .await
            .expect("fixture import should succeed");

        assert!(record.chapter_count >= 1);
        assert!(!record.card_ids.is_empty());
        assert!(!record.memory_keys.is_empty());
        assert!(!record.timepoint_ids.is_empty());

        let report = tokio::fs::read_to_string(
            temp.path()
                .join("projects/fixture-project/import/reports/test-novel.md"),
        )
        .await
        .expect("report should exist");
        assert!(report.contains("Import Report: test-novel"));
        assert!(report.contains("Seeded artifacts"));

        let chapters_dir = temp
            .path()
            .join("projects/fixture-project/import/chapters/test-novel");
        let chapter_files = std::fs::read_dir(chapters_dir)
            .expect("chapter directory should exist")
            .count();
        assert_eq!(chapter_files, record.chapter_count);
    }
    #[tokio::test]
    async fn fixture_import_decodes_gbk_text_without_replacement_garbage_and_extracts_semantic_assets()
     {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "semantic-import".to_string(),
                title: "Semantic".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let fixture =
            std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../test_novel.txt"))
                .expect("fixture should read");
        let record = imports
            .import_txt(ImportTxtRequest {
                project_slug: "semantic-import".to_string(),
                import_id: "test-novel".to_string(),
                source_name: "test_novel.txt".to_string(),
                raw_bytes: fixture,
            })
            .await
            .expect("fixture import should succeed");

        assert!(
            record.chapter_count >= 10,
            "fixture must split at least ten chapters"
        );
        let normalized = tokio::fs::read_to_string(
            temp.path()
                .join("projects/semantic-import/import/normalized/test-novel.txt"),
        )
        .await
        .expect("normalized file should exist");
        assert!(normalized.contains("叶小伟"));
        assert!(normalized.contains("第1章 这是哪里"));
        assert!(!normalized.contains('�'));

        assert_eq!(record.extraction_status, "llm_failed");
        assert!(record.card_ids.iter().all(|id| !id.starts_with("entity-")));
        assert!(
            record
                .card_ids
                .iter()
                .all(|id| id == "import-test-novel-overview")
        );
        let character_dir = temp
            .path()
            .join("projects/semantic-import/cards/characters");
        let generated_character_cards = if character_dir.exists() {
            collect_files(&character_dir)
                .into_iter()
                .filter(|path| path.extension().is_some_and(|ext| ext == "md"))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        assert!(
            generated_character_cards.is_empty(),
            "LLM-required import must not create guessed character cards when LLM is unavailable"
        );

        let report = tokio::fs::read_to_string(
            temp.path()
                .join("projects/semantic-import/import/reports/test-novel.md"),
        )
        .await
        .expect("report should exist");
        assert!(report.contains("LLM semantic extraction"));
        assert!(report.contains("llm_failed"));
        assert!(
            report.contains("semantic cards were not generated")
                || report.contains("no LLM endpoint/default model")
        );
    }

    #[tokio::test]
    async fn invalid_llm_schema_reports_failure_without_semantic_cards() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("invalid schema listener should bind");
        let address = listener.local_addr().expect("invalid schema address");
        let server = tokio::spawn(async move {
            let (socket, _) = listener
                .accept()
                .await
                .expect("invalid schema server should accept one request");
            let mut buffer = [0_u8; 4096];
            let read = socket
                .readable()
                .await
                .and_then(|()| socket.try_read(&mut buffer));
            let request = String::from_utf8_lossy(&buffer[..read.expect("server should read")]);
            assert!(request.contains("/chat/completions"));
            let body = serde_json::json!({
                "choices": [{ "message": { "role": "assistant", "content": "{invalid semantic extraction json" } }]
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            socket
                .writable()
                .await
                .expect("server should become writable");
            let _ = socket
                .try_write(response.as_bytes())
                .expect("server should write");
        });

        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));
        let llm_config = crate::config::LlmConfigService::new(Arc::clone(&storage));
        llm_config
            .save_endpoint(crate::config::LlmEndpointConfig {
                provider: "invalid-schema-provider".to_string(),
                base_url: format!("http://{address}/v1"),
                api_key: "test-key".to_string(),
                api_style: crate::llm::LlmApiStyle::OpenAiChatCompletions,
            })
            .await
            .expect("endpoint should save");
        llm_config
            .save_role(
                "default",
                crate::config::LlmRoleConfig {
                    role_id: "default".to_string(),
                    model: "invalid-schema-writer".to_string(),
                    api_style: None,
                },
            )
            .await
            .expect("role should save");

        projects
            .create(CreateProjectRequest {
                slug: "invalid-schema-import".to_string(),
                title: "Invalid Schema".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        let record = imports
            .import_txt(ImportTxtRequest {
                project_slug: "invalid-schema-import".to_string(),
                import_id: "invalid-source".to_string(),
                source_name: "invalid.txt".to_string(),
                raw_bytes: "第1章 开端\n叶小伟醒来。".as_bytes().to_vec(),
            })
            .await
            .expect("import should still persist text artifacts");

        assert_eq!(record.extraction_status, "llm_failed");
        assert!(record.extraction_message.contains("invalid or empty JSON"));
        assert_eq!(record.llm_model.as_deref(), Some("invalid-schema-writer"));
        assert!(record.card_ids.iter().all(|id| !id.starts_with("entity-")));
        let character_dir = temp
            .path()
            .join("projects/invalid-schema-import/cards/characters");
        let generated_character_cards = if character_dir.exists() {
            collect_files(&character_dir)
        } else {
            Vec::new()
        };
        assert!(generated_character_cards.is_empty());
        server.await.expect("invalid schema server should finish");
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn import_uses_persisted_llm_settings_for_semantic_extraction_when_available() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock llm listener should bind");
        let address = listener.local_addr().expect("mock llm address");
        let server = tokio::spawn(async move {
            let (socket, _) = listener
                .accept()
                .await
                .expect("mock llm should accept one request");
            let mut buffer = [0_u8; 8192];
            let read = socket
                .readable()
                .await
                .and_then(|()| socket.try_read(&mut buffer));
            let request = String::from_utf8_lossy(&buffer[..read.expect("mock llm should read")]);
            assert!(request.contains("/chat/completions"));
            assert!(request.contains("请从小说文本中提取"));
            let extraction = serde_json::json!({
                "characters": [{
                    "id": "lin-qing",
                    "name": "林青",
                    "aliases": ["风暴醒来者"],
                    "role_summary": "LLM extracted protagonist with a clear motive.",
                    "motivation": "寻找失踪的姐姐。",
                    "knowledge_boundary": "只知道自己在风暴中醒来，不知道姐姐去向。",
                    "confidence": 0.91,
                    "evidence": [{
                        "text": "第一章 林青在风暴中醒来，并决定寻找失踪的姐姐。",
                        "source_path": "import/chapters/llm-source/0001-chapter-0001.md",
                        "chapter": "第1章 风暴",
                        "timepoint": "0001"
                    }]
                }],
                "world_cards": [{
                    "id": "storm-city",
                    "title": "风暴城",
                    "summary": "A city isolated by a supernatural storm.",
                    "confidence": 0.82,
                    "evidence": [{"text": "风暴中醒来", "chapter": "第1章 风暴"}]
                }],
                "rule_cards": [{
                    "id": "memory-rule",
                    "title": "记忆规则",
                    "rule": "Characters lose one memory whenever the bell rings.",
                    "constraints": ["钟声响起时必须先更新角色记忆。"],
                    "confidence": 0.77,
                    "evidence": [{"text": "钟声与记忆缺失相关。", "chapter": "第1章 风暴"}]
                }],
                "skills": [{
                    "agent_id": "lin-qing",
                    "file_name": "character-decision.md",
                    "intent": "character-decision",
                    "target": "simulation/logs",
                    "mode": "append",
                    "scope": "character",
                    "consistency": "ooc",
                    "body": "林青行动前必须检查姐姐线索与风暴城证据。"
                }],
                "warnings": ["姐姐失踪原因证据不足，需要后续章节确认。"]
            })
            .to_string();
            let body = serde_json::json!({
                "choices": [{ "message": { "role": "assistant", "content": extraction } }]
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            socket
                .writable()
                .await
                .expect("mock llm should become writable");
            let _ = socket
                .try_write(response.as_bytes())
                .expect("mock llm should write response");
        });

        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let imports = ImportService::new(Arc::clone(&storage));
        let llm_config = crate::config::LlmConfigService::new(Arc::clone(&storage));
        llm_config
            .save_endpoint(crate::config::LlmEndpointConfig {
                provider: "mock".to_string(),
                base_url: format!("http://{address}/v1"),
                api_key: "test-key".to_string(),
                api_style: crate::llm::LlmApiStyle::OpenAiChatCompletions,
            })
            .await
            .expect("llm endpoint should save");
        llm_config
            .save_role(
                "default",
                crate::config::LlmRoleConfig {
                    role_id: "default".to_string(),
                    model: "generic-writer".to_string(),
                    api_style: None,
                },
            )
            .await
            .expect("llm role should save");

        projects
            .create(CreateProjectRequest {
                slug: "llm-import".to_string(),
                title: "LLM Import".to_string(),
                description: "Project".to_string(),
            })
            .await
            .expect("project create should succeed");

        imports
            .import_txt(ImportTxtRequest {
                project_slug: "llm-import".to_string(),
                import_id: "llm-source".to_string(),
                source_name: "llm.txt".to_string(),
                raw_bytes: "第1章 风暴\n林青在风暴中醒来，并决定寻找失踪的姐姐。"
                    .as_bytes()
                    .to_vec(),
            })
            .await
            .expect("import should succeed");

        let character_card = tokio::fs::read_to_string(
            temp.path()
                .join("projects/llm-import/cards/characters/lin-qing.md"),
        )
        .await
        .expect("llm character card should exist");
        assert!(character_card.contains("LLM extracted protagonist"));
        assert!(character_card.contains("第一章 林青"));
        assert!(character_card.contains("Confidence\n0.91"));
        assert!(character_card.contains("Knowledge Boundary"));
        assert!(character_card.contains("path: import/chapters/llm-source/0001-chapter-0001.md"));
        let quality_card = tokio::fs::read_to_string(
            temp.path()
                .join("projects/llm-import/cards/rules/llm-extraction-quality-and-skills.md"),
        )
        .await
        .expect("quality and skill suggestion card should exist");
        assert!(quality_card.contains("姐姐失踪原因证据不足"));
        assert!(quality_card.contains("林青行动前必须检查姐姐线索"));
        assert!(quality_card.contains("intent: character-decision"));
        let actual_skill = tokio::fs::read_to_string(
            temp.path()
                .join("projects/llm-import/agents/lin-qing/skills/character-decision.md"),
        )
        .await
        .expect("generated skill should be written into the actual agent skill file");
        assert!(actual_skill.contains("intent: character-decision"));
        assert!(actual_skill.contains("target: simulation/logs"));
        assert!(actual_skill.contains("林青行动前必须检查姐姐线索"));
        server.await.expect("mock llm server should finish");
    }

    #[tokio::test]
    async fn imported_character_agent_seeding_is_non_destructive_for_existing_files() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let imports = ImportService::new(Arc::clone(&storage));
        let root = PathBuf::from("projects/character-preserve/agents/lin-qing");
        storage
            .ensure_dir(&root.join("skills"))
            .await
            .expect("agent dir should be created");
        storage
            .write_text(&root.join("soul.md"), "manual soul")
            .await
            .expect("existing soul should be written");
        storage
            .write_text(&root.join("memory.md"), "manual memory")
            .await
            .expect("existing memory should be written");
        storage
            .write_text(&root.join("skills/character-decision.md"), "manual skill")
            .await
            .expect("existing skill should be written");

        imports
            .ensure_character_agent("character-preserve", "lin-qing", "林青", "manual card body")
            .await
            .expect("ensure_character_agent should preserve existing assets");

        assert_eq!(
            storage
                .read_text(&root.join("soul.md"))
                .await
                .expect("soul should remain readable"),
            "manual soul"
        );
        assert_eq!(
            storage
                .read_text(&root.join("memory.md"))
                .await
                .expect("memory should remain readable"),
            "manual memory"
        );
        assert_eq!(
            storage
                .read_text(&root.join("skills/character-decision.md"))
                .await
                .expect("skill should remain readable"),
            "manual skill"
        );
    }

    #[tokio::test]
    async fn imported_llm_skill_does_not_overwrite_existing_agent_skill() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let imports = ImportService::new(Arc::clone(&storage));
        storage
            .ensure_dir(&PathBuf::from(
                "projects/skill-preserve/agents/lin-qing/skills",
            ))
            .await
            .expect("skills dir should be created");
        let existing_path =
            PathBuf::from("projects/skill-preserve/agents/lin-qing/skills/character-decision.md");
        storage
            .write_text(&existing_path, "manual skill contract")
            .await
            .expect("existing skill should be written");

        imports
            .write_imported_agent_skill(
                "skill-preserve",
                &SemanticSkillAsset {
                    agent_id: "lin-qing".to_string(),
                    file_name: "character-decision.md".to_string(),
                    body: "llm generated skill contract".to_string(),
                },
            )
            .await
            .expect("imported skill should be saved without overwriting");

        let preserved = storage
            .read_text(&existing_path)
            .await
            .expect("existing skill should remain readable");
        assert_eq!(preserved, "manual skill contract");
        let skill_dir = temp
            .path()
            .join("projects/skill-preserve/agents/lin-qing/skills");
        let generated = collect_files(&skill_dir)
            .into_iter()
            .find(|path| {
                path.to_string_lossy()
                    .contains("character-decision.imported-")
            })
            .expect("imported skill should use a collision-safe generated file name");
        let generated_body = tokio::fs::read_to_string(generated)
            .await
            .expect("generated skill should be readable");
        assert_eq!(generated_body, "llm generated skill contract");
    }
}
