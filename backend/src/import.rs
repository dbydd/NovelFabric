use std::{
    collections::BTreeSet,
    fmt::Write as _,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    cards::{CardError, CardKind, CardRecord, CardService, CreateCardRequest},
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

        let raw_text = String::from_utf8_lossy(&request.raw_bytes).into_owned();
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

        let entities = extract_entities(normalized_text);
        for (index, entity) in entities.iter().take(12).enumerate() {
            let kind = classify_entity_kind(entity);
            let card_id = format!("import-{import_id}-{:02}-{}", index + 1, slugify(entity));
            let body = build_entity_card_body(entity, chapters, kind);
            self.upsert_card(
                CreateCardRequest {
                    project_slug: project_slug.to_string(),
                    id: card_id,
                    kind,
                    title: entity.clone(),
                    body,
                },
                &mut summary.card_ids,
            )
            .await?;
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

fn build_entity_card_body(entity: &str, chapters: &[SplitChapter], kind: CardKind) -> String {
    let chapter_mentions = chapters
        .iter()
        .filter(|chapter| chapter.text.contains(entity))
        .map(|chapter| chapter.title.as_str())
        .take(5)
        .collect::<Vec<_>>();
    let label = match kind {
        CardKind::Character => "Character",
        CardKind::Rule => "Rule/Institution",
        CardKind::World => "World Detail",
    };
    format!(
        "# {entity}\n\n- Heuristic type: {label}\n- Mentioned in: {}\n\nImported from deterministic txt analysis. Review and edit as needed.\n",
        if chapter_mentions.is_empty() {
            "unknown".to_string()
        } else {
            chapter_mentions.join(", ")
        }
    )
}

fn build_global_memory_body(source_name: &str, chapters: &[SplitChapter]) -> String {
    let mut body = format!(
        "Imported `{source_name}` with {} chapter(s).\n",
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

fn extract_entities(text: &str) -> Vec<String> {
    let mut entities = BTreeSet::new();
    let mut current = String::new();
    for character in text.chars() {
        if is_entity_character(character) {
            current.push(character);
        } else {
            push_entity_candidate(&mut entities, &mut current);
        }
    }
    push_entity_candidate(&mut entities, &mut current);
    entities.into_iter().collect()
}

fn push_entity_candidate(entities: &mut BTreeSet<String>, current: &mut String) {
    let candidate = current.trim();
    let length = candidate.chars().count();
    if (2..=8).contains(&length)
        && candidate
            .chars()
            .any(|character| !character.is_ascii_digit())
    {
        entities.insert(candidate.to_string());
    }
    current.clear();
}

const fn is_entity_character(character: char) -> bool {
    matches!(character, '\u{4E00}'..='\u{9FFF}')
        || character.is_ascii_alphanumeric()
        || character == '·'
}

fn classify_entity_kind(entity: &str) -> CardKind {
    if entity.ends_with('军')
        || entity.ends_with('国')
        || entity.ends_with('省')
        || entity.ends_with('市')
    {
        CardKind::World
    } else if entity.contains('党') || entity.contains('军') || entity.contains("政府") {
        CardKind::Rule
    } else {
        CardKind::Character
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
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::{ImportService, ImportTxtRequest, split_chapters};
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

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

        let source = b"\xff\xfe\r\n\xe7\xac\xac\xe4\xb8\x80\xe7\xab\xa0 \xe5\xbc\x80\xe7\xab\xaf\r\n\xe6\xad\xa3\xe6\x96\x87\r\n".to_vec();
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
        assert!(raw.contains('�'));
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
}
