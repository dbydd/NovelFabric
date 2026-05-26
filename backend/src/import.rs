use std::{
    collections::HashMap,
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    cards::{CardError, CardKind, CardRecord, CardService, CreateCardRequest},
    config::LlmSettingsService,
    llm::{ChatMessage, LlmConfig, complete_chat},
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

        let assets = self
            .extract_semantic_assets(normalized_text, chapters)
            .await
            .unwrap_or_else(|| extract_semantic_assets(normalized_text, chapters));
        for asset in &assets.cards {
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
    ) -> Option<SemanticAssets> {
        let settings = LlmSettingsService::new(Arc::clone(&self.storage))
            .load()
            .await
            .ok()
            .flatten()?;
        let config = LlmConfig {
            base_url: settings.base_url,
            api_key: settings.api_key,
            model: settings.model,
            api_style: settings.api_style,
        };
        let prompt = build_semantic_extraction_prompt(normalized_text, chapters);
        let response = complete_chat(
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
        .ok()?;
        parse_llm_semantic_assets(&response, chapters)
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
        let soul = format!(
            "# {character_name}\n\n## Role\n从导入小说中提取的角色智能体。\n\n## Source Character Card\n{card_body}\n\n## Behavior Contract\n- 保持原文中体现的人物身份、处境、动机与知识边界。\n- 推演时只能基于已导入章节、记忆、世界观与规则卡行动。\n"
        );
        self.storage
            .write_text(&root.join("soul.md"), &soul)
            .await?;
        self.storage
            .write_text(
                &root.join("memory.md"),
                &format!("# {character_name} Memory\n\n- 来源：导入拆书。\n- 初始记忆以章节记忆与人物卡为准。\n"),
            )
            .await?;
        self.storage
            .write_text(
                &root.join("skills").join("character-decision.md"),
                "# character-decision\n\nIntent: character-decision\nTarget: simulation/logs\nMode: append\nScope: character\nPriority: preserve imported characterization and chapter evidence.\nConsistency: OOC checks must compare against soul.md and source card.\n",
            )
            .await?;
        self.storage
            .write_json(
                &root.join("profile.json"),
                &serde_json::json!({ "agent_id": agent_id, "source": "import", "display_name": character_name }),
            )
            .await?;
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

#[derive(Debug, Clone, Default)]
struct ArtifactSummary {
    card_ids: Vec<String>,
    memory_keys: Vec<String>,
    timepoint_ids: Vec<String>,
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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LlmSemanticExtraction {
    #[serde(default)]
    characters: Vec<LlmSemanticCharacter>,
    #[serde(default)]
    worldviews: Vec<LlmSemanticWorldview>,
    #[serde(default)]
    rules: Vec<LlmSemanticRule>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LlmSemanticCharacter {
    id: Option<String>,
    name: String,
    summary: String,
    #[serde(default)]
    evidence: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LlmSemanticWorldview {
    id: Option<String>,
    title: String,
    summary: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
struct LlmSemanticRule {
    id: Option<String>,
    title: String,
    summary: String,
}

fn build_semantic_extraction_prompt(text: &str, chapters: &[SplitChapter]) -> String {
    let chapter_outline = chapters
        .iter()
        .take(20)
        .map(|chapter| format!("{}: {}", chapter.title, truncate_text(&chapter.text, 260)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "请从小说文本中提取人物/剧情/角色/世界观/规则，输出 JSON：{{\"characters\":[{{\"id\":\"ascii-kebab-id\",\"name\":\"姓名\",\"summary\":\"身份、动机、处境\",\"evidence\":[\"原文证据\"]}}],\"worldviews\":[{{\"id\":\"ascii-kebab-id\",\"title\":\"设定名\",\"summary\":\"世界观设定\"}}],\"rules\":[{{\"id\":\"ascii-kebab-id\",\"title\":\"规则名\",\"summary\":\"叙事/能力/制度规则\"}}]}}。必须基于原文，不要乱码，不要编造。\n\n章节摘要：\n{chapter_outline}\n\n全文片段：\n{}",
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
        let title = worldview.title;
        cards.push(SemanticAssetCard {
            id: sanitize_asset_id(worldview.id.as_deref().unwrap_or(&title)),
            kind: CardKind::World,
            title: title.clone(),
            body: format!(
                "# {title}

## LLM 世界观提取
{}
",
                worldview.summary
            ),
        });
    }
    for rule in extraction
        .rules
        .into_iter()
        .filter(|item| !item.title.trim().is_empty())
    {
        let title = rule.title;
        cards.push(SemanticAssetCard {
            id: sanitize_asset_id(rule.id.as_deref().unwrap_or(&title)),
            kind: CardKind::Rule,
            title: title.clone(),
            body: format!(
                "# {title}

## LLM 规则提取
{}
",
                rule.summary
            ),
        });
    }
    (!cards.is_empty()).then_some(SemanticAssets { cards })
}

fn render_llm_character_card(
    character: &LlmSemanticCharacter,
    chapters: &[SplitChapter],
) -> String {
    let evidence = if character.evidence.is_empty() {
        "- LLM 未提供逐条证据；请回看章节记忆。".to_string()
    } else {
        character
            .evidence
            .iter()
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "# {}\n\n## LLM 身份与动机提取\n{}\n\n## 原文证据\n{}\n\n## 推演约束\n- 保持 LLM 基于原文提取的人物身份、动机、处境和知识边界。\n- 决策必须引用已导入章节、记忆、世界观或规则卡。\n\n## Source\nLLM semantic extraction from {} chapter(s).\n",
        character.name,
        character.summary,
        evidence,
        chapters.len()
    )
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SemanticAssets {
    cards: Vec<SemanticAssetCard>,
}

fn extract_semantic_assets(text: &str, chapters: &[SplitChapter]) -> SemanticAssets {
    let mut cards = Vec::new();
    let mut seen_ids = Vec::new();
    for name in ranked_character_names(text).into_iter().take(10) {
        let id = stable_entity_id(&name);
        if seen_ids.contains(&id) {
            continue;
        }
        seen_ids.push(id.clone());
        cards.push(SemanticAssetCard {
            id,
            kind: CardKind::Character,
            title: name.clone(),
            body: build_character_card_body(&name, text, chapters),
        });
    }
    cards.push(SemanticAssetCard {
        id: "imported-worldview".to_string(),
        kind: CardKind::World,
        title: "导入世界观".to_string(),
        body: build_worldview_card_body(chapters),
    });
    cards.push(SemanticAssetCard {
        id: "imported-narrative-rules".to_string(),
        kind: CardKind::Rule,
        title: "导入叙事规则".to_string(),
        body: build_rule_card_body(),
    });
    SemanticAssets { cards }
}

fn ranked_character_names(text: &str) -> Vec<String> {
    let mut ranked = discover_name_candidates(text)
        .into_iter()
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| right.0.chars().count().cmp(&left.0.chars().count()))
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.into_iter().map(|(name, _)| name).collect()
}

fn discover_name_candidates(text: &str) -> HashMap<String, usize> {
    let mut candidates = HashMap::new();
    let mut current = String::new();
    for character in text.chars() {
        if is_cjk_character(character) {
            current.push(character);
        } else {
            collect_name_candidates(&mut candidates, &current);
            current.clear();
        }
    }
    collect_name_candidates(&mut candidates, &current);
    candidates
}

fn collect_name_candidates(candidates: &mut HashMap<String, usize>, run: &str) {
    let chars = run.chars().collect::<Vec<_>>();
    for len in 2..=3 {
        if chars.len() < len {
            continue;
        }
        for window in chars.windows(len) {
            let candidate = window.iter().collect::<String>();
            if is_plausible_name_candidate(&candidate) {
                candidates
                    .entry(candidate)
                    .and_modify(|count| *count += 1)
                    .or_insert(1);
            }
        }
    }
}

fn is_plausible_name_candidate(candidate: &str) -> bool {
    let chars = candidate.chars().collect::<Vec<_>>();
    let Some(first) = chars.first() else {
        return false;
    };
    if COMMON_NON_NAME_PREFIXES.contains(first) {
        return false;
    }
    !COMMON_NON_NAME_WORDS.contains(&candidate)
}

const COMMON_NON_NAME_PREFIXES: &[char] = &[
    '这', '那', '他', '她', '它', '你', '我', '们', '的', '了', '在', '和', '与', '是', '有', '不',
    '就', '都', '又', '再', '很', '也', '被', '把', '从', '到', '对', '为', '以', '但', '而', '或',
];

const COMMON_NON_NAME_WORDS: &[&str] = &[
    "第一", "第二", "第三", "第四", "第五", "第六", "第七", "第八", "第九", "第十", "一个", "这个",
    "那个", "自己", "什么", "没有", "不是", "可以", "已经", "因为", "所以", "时候", "地方", "事情",
    "东西", "声音", "眼前", "起来", "知道", "看着", "说道", "突然", "开始", "继续", "世界", "系统",
    "章节",
];

fn is_cjk_character(character: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&character)
}

fn build_character_card_body(name: &str, text: &str, chapters: &[SplitChapter]) -> String {
    let mentions = chapters
        .iter()
        .filter(|chapter| chapter.text.contains(name))
        .map(|chapter| {
            format!(
                "- {}: {}",
                chapter.title,
                extract_sentence_about(&chapter.text, name)
            )
        })
        .take(8)
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# {name}\n\n## 身份与处境\n从导入章节中识别出的角色，具体身份、动机与处境以原文证据为准。\n\n## 原文证据\n{mentions}\n\n## 推演约束\n- 不得获得未在已导入章节或记忆中出现的新知识。\n- 行动需要符合身份、时代环境与已经落盘的章节事实。\n\n## Source\nImported novel semantic extraction from {} chapter(s); total mentions: {}.\n",
        chapters.len(),
        text.matches(name).count(),
    )
}

fn extract_sentence_about(text: &str, name: &str) -> String {
    text.split(['。', '！', '？', '\n'])
        .map(str::trim)
        .find(|sentence| sentence.contains(name))
        .map_or_else(
            || "出现于本章。".to_string(),
            |sentence| truncate_text(sentence, 140),
        )
}

fn build_worldview_card_body(chapters: &[SplitChapter]) -> String {
    let chapter_outline = chapters
        .iter()
        .take(12)
        .map(|chapter| format!("- {}: {}", chapter.title, chapter.summary))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "# 导入世界观\n\n## 时间与环境\n从导入章节、记忆与后续 LLM 抽取中持续维护世界观设定。\n\n## 剧情索引\n{chapter_outline}\n"
    )
}

fn build_rule_card_body() -> String {
    "# 导入叙事规则\n\n- 推演必须优先尊重已导入章节事实。\n- 角色知识边界来自章节、人物卡、memory 与 timeline。\n- 新剧情必须经过 random-event -> world-maintainer -> kp -> project-auditor 的系统角色链路。\n".to_string()
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
        "# Import Report: {import_id}\n\n## Source\n- Name: `{source_name}`\n- Normalized characters: {}\n- Chapters: {}\n\n## Chapters\n{}\n\n## Seeded artifacts\n- Cards: {}\n- Memory entries: {}\n- Timeline timepoints: {}\n\n## Preview\n\n{}\n",
        normalized_text.chars().count(),
        chapter_records.len(),
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

    use super::{ImportService, ImportTxtRequest, split_chapters};
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    async fn read_text_file_containing(root: &Path, needle: &str) -> String {
        for path in collect_files(root) {
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                if content.contains(needle) {
                    return content;
                }
            }
        }
        panic!("no text file under {} contained {needle}", root.display());
    }

    fn count_files_named(root: &Path, file_name: &str) -> usize {
        collect_files(root)
            .into_iter()
            .filter(|path| path.file_name().is_some_and(|name| name == file_name))
            .count()
    }

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

        let character_card = read_text_file_containing(
            &temp
                .path()
                .join("projects/semantic-import/cards/characters"),
            "叶小伟",
        )
        .await;
        assert!(character_card.contains("叶小伟"));
        assert!(!character_card.contains("Heuristic type"));

        let soul = read_text_file_containing(
            &temp.path().join("projects/semantic-import/agents"),
            "叶小伟",
        )
        .await;
        assert!(soul.contains("叶小伟"));
        let skill_count = count_files_named(
            &temp.path().join("projects/semantic-import/agents"),
            "character-decision.md",
        );
        assert!(skill_count > 0, "character decision skill should exist");
    }

    #[tokio::test]
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
                    "summary": "LLM extracted protagonist with a clear motive.",
                    "evidence": ["第一章 林青在风暴中醒来，并决定寻找失踪的姐姐。"]
                }],
                "worldviews": [{
                    "id": "storm-city",
                    "title": "风暴城",
                    "summary": "A city isolated by a supernatural storm."
                }],
                "rules": [{
                    "id": "memory-rule",
                    "title": "记忆规则",
                    "summary": "Characters lose one memory whenever the bell rings."
                }]
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
        crate::config::LlmSettingsService::new(Arc::clone(&storage))
            .save(crate::config::LlmSettings {
                provider: "mock".to_string(),
                base_url: format!("http://{address}/v1"),
                api_key: "test-key".to_string(),
                model: "generic-writer".to_string(),
                api_style: crate::llm::LlmApiStyle::OpenAiChatCompletions,
            })
            .await
            .expect("llm config should save");

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
        assert!(
            temp.path()
                .join("projects/llm-import/agents/lin-qing/skills/character-decision.md")
                .exists()
        );
        server.await.expect("mock llm server should finish");
    }
}
