use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{Storage, StorageError, validate_segment};

const PROJECTS_DIR: &str = "projects";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum CardKind {
    Character,
    Rule,
    World,
}

impl CardKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Character => "character",
            Self::Rule => "rule",
            Self::World => "world",
        }
    }

    const fn directory(self) -> &'static str {
        match self {
            Self::Character => "characters",
            Self::Rule => "rules",
            Self::World => "world",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CardRecord {
    pub project_slug: String,
    pub id: String,
    pub kind: CardKind,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateCardRequest {
    pub project_slug: String,
    pub id: String,
    pub kind: CardKind,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateCardRequest {
    pub project_slug: String,
    pub id: String,
    pub kind: CardKind,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct CardService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum CardError {
    #[error("invalid project slug: {0}")]
    InvalidProjectSlug(String),
    #[error("invalid card id: {0}")]
    InvalidCardId(String),
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("card already exists: {kind}:{id}")]
    AlreadyExists { kind: &'static str, id: String },
    #[error("card not found: {kind}:{id}")]
    NotFound { kind: &'static str, id: String },
    #[error("invalid card markdown: {0}")]
    InvalidMarkdown(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl CardService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn create(&self, request: CreateCardRequest) -> Result<CardRecord, CardError> {
        validate_project_slug(&request.project_slug)?;
        validate_card_id(&request.id)?;
        self.ensure_project_exists(&request.project_slug).await?;

        let path = card_path(&request.project_slug, request.kind, &request.id);
        if self.storage.exists(&path).await? {
            return Err(CardError::AlreadyExists {
                kind: request.kind.as_str(),
                id: request.id,
            });
        }

        let card = CardRecord {
            project_slug: request.project_slug,
            id: request.id,
            kind: request.kind,
            title: request.title,
            body: request.body,
        };
        self.write_card(&card).await?;
        Ok(card)
    }

    pub async fn get(
        &self,
        project_slug: &str,
        kind: CardKind,
        id: &str,
    ) -> Result<CardRecord, CardError> {
        validate_project_slug(project_slug)?;
        validate_card_id(id)?;
        self.ensure_project_exists(project_slug).await?;

        let path = card_path(project_slug, kind, id);
        if !self.storage.exists(&path).await? {
            return Err(CardError::NotFound {
                kind: kind.as_str(),
                id: id.to_string(),
            });
        }

        let content = self.storage.read_text(&path).await?;
        parse_card_markdown(project_slug, id, kind, &content)
    }

    pub async fn list(
        &self,
        project_slug: &str,
        kind: CardKind,
    ) -> Result<Vec<CardRecord>, CardError> {
        validate_project_slug(project_slug)?;
        self.ensure_project_exists(project_slug).await?;

        let paths = self
            .storage
            .list_files(&cards_dir(project_slug, kind))
            .await?;
        let mut cards = Vec::new();

        for path in paths {
            if path.extension().and_then(std::ffi::OsStr::to_str) != Some("md") {
                continue;
            }

            let id = path
                .file_stem()
                .and_then(std::ffi::OsStr::to_str)
                .ok_or_else(|| CardError::InvalidCardId(path.display().to_string()))?;
            cards.push(self.get(project_slug, kind, id).await?);
        }

        cards.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(cards)
    }

    pub async fn update(&self, request: UpdateCardRequest) -> Result<CardRecord, CardError> {
        validate_project_slug(&request.project_slug)?;
        validate_card_id(&request.id)?;
        self.ensure_project_exists(&request.project_slug).await?;

        let path = card_path(&request.project_slug, request.kind, &request.id);
        if !self.storage.exists(&path).await? {
            return Err(CardError::NotFound {
                kind: request.kind.as_str(),
                id: request.id,
            });
        }

        let card = CardRecord {
            project_slug: request.project_slug,
            id: request.id,
            kind: request.kind,
            title: request.title,
            body: request.body,
        };
        self.write_card(&card).await?;
        Ok(card)
    }

    async fn ensure_project_exists(&self, project_slug: &str) -> Result<(), CardError> {
        let metadata_path = project_root(project_slug).join("project.json");
        if self.storage.exists(&metadata_path).await? {
            Ok(())
        } else {
            Err(CardError::ProjectNotFound(project_slug.to_string()))
        }
    }

    async fn write_card(&self, card: &CardRecord) -> Result<(), CardError> {
        self.storage
            .write_text(
                &card_path(&card.project_slug, card.kind, &card.id),
                &serialize_card_markdown(card),
            )
            .await?;
        Ok(())
    }
}

#[must_use]
pub fn serialize_card_markdown(card: &CardRecord) -> String {
    format!(
        "---\ntype: {}\nid: {}\ntitle: {}\n---\n\n{}",
        card.kind.as_str(),
        card.id,
        encode_metadata_value(&card.title),
        card.body.trim_start_matches('\n')
    )
}

pub fn parse_card_markdown(
    project_slug: &str,
    expected_id: &str,
    expected_kind: CardKind,
    content: &str,
) -> Result<CardRecord, CardError> {
    let remainder = content
        .strip_prefix("---\n")
        .ok_or_else(|| CardError::InvalidMarkdown("missing front matter".to_string()))?;
    let (metadata, body) = remainder
        .split_once("\n---\n")
        .ok_or_else(|| CardError::InvalidMarkdown("unterminated front matter".to_string()))?;

    let mut kind = None;
    let mut id = None;
    let mut title = None;

    for line in metadata.lines() {
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| CardError::InvalidMarkdown(format!("invalid metadata line: {line}")))?;
        let value = value.trim_start();
        match key {
            "type" => kind = Some(parse_kind(value)?),
            "id" => id = Some(value.to_string()),
            "title" => title = Some(decode_metadata_value(value)),
            _ => {}
        }
    }

    let kind = kind.ok_or_else(|| CardError::InvalidMarkdown("missing type".to_string()))?;
    let id = id.ok_or_else(|| CardError::InvalidMarkdown("missing id".to_string()))?;
    let title = title.ok_or_else(|| CardError::InvalidMarkdown("missing title".to_string()))?;

    if kind != expected_kind {
        return Err(CardError::InvalidMarkdown(format!(
            "card type {} does not match expected {}",
            kind.as_str(),
            expected_kind.as_str()
        )));
    }
    if id != expected_id {
        return Err(CardError::InvalidMarkdown(format!(
            "card id {id} does not match expected {expected_id}"
        )));
    }

    Ok(CardRecord {
        project_slug: project_slug.to_string(),
        id,
        kind,
        title,
        body: body.trim_start_matches('\n').to_string(),
    })
}

fn parse_kind(value: &str) -> Result<CardKind, CardError> {
    match value {
        "character" => Ok(CardKind::Character),
        "rule" => Ok(CardKind::Rule),
        "world" => Ok(CardKind::World),
        _ => Err(CardError::InvalidMarkdown(format!(
            "unknown card type: {value}"
        ))),
    }
}

fn encode_metadata_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\n', "\\n")
}

fn decode_metadata_value(value: &str) -> String {
    let mut decoded = String::new();
    let mut escaped = false;

    for character in value.chars() {
        if escaped {
            if character == 'n' {
                decoded.push('\n');
            } else {
                decoded.push(character);
            }
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else {
            decoded.push(character);
        }
    }

    if escaped {
        decoded.push('\\');
    }

    decoded
}

fn validate_project_slug(slug: &str) -> Result<(), CardError> {
    validate_segment(slug).map_err(|_| CardError::InvalidProjectSlug(slug.to_string()))?;

    if !slug.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(CardError::InvalidProjectSlug(slug.to_string()));
    }

    Ok(())
}

fn validate_card_id(id: &str) -> Result<(), CardError> {
    validate_segment(id).map_err(|_| CardError::InvalidCardId(id.to_string()))?;

    if !id.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return Err(CardError::InvalidCardId(id.to_string()));
    }

    Ok(())
}

fn project_root(slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(slug)
}

fn cards_dir(project_slug: &str, kind: CardKind) -> PathBuf {
    project_root(project_slug)
        .join("cards")
        .join(kind.directory())
}

fn card_path(project_slug: &str, kind: CardKind, id: &str) -> PathBuf {
    cards_dir(project_slug, kind).join(format!("{id}.md"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use super::{
        CardError, CardKind, CardRecord, CardService, CreateCardRequest, UpdateCardRequest,
        parse_card_markdown, serialize_card_markdown,
    };
    use crate::{
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[test]
    fn serializes_card_as_human_editable_markdown() {
        let card = CardRecord {
            project_slug: "alpha".to_string(),
            id: "mara".to_string(),
            kind: CardKind::Character,
            title: "Mara: Keeper".to_string(),
            body: "# Mara\n\nKeeps the lighthouse.\n".to_string(),
        };

        let markdown = serialize_card_markdown(&card);

        assert!(
            markdown.starts_with("---\ntype: character\nid: mara\ntitle: Mara: Keeper\n---\n\n")
        );
        assert!(markdown.contains("# Mara"));

        let parsed = parse_card_markdown("alpha", "mara", CardKind::Character, &markdown)
            .expect("serialized markdown should parse");
        assert_eq!(parsed, card);
    }

    #[tokio::test]
    async fn create_persists_markdown_card_under_kind_directory() {
        let (service, temp_path) = card_service_with_project("alpha").await;

        let created = service
            .create(CreateCardRequest {
                project_slug: "alpha".to_string(),
                id: "mara".to_string(),
                kind: CardKind::Character,
                title: "Mara".to_string(),
                body: "Keeps the lighthouse.\n".to_string(),
            })
            .await
            .expect("card should create");

        assert_eq!(created.title, "Mara");
        let path = temp_path.join("projects/alpha/cards/characters/mara.md");
        assert!(path.exists());
        let persisted = std::fs::read_to_string(path).expect("card markdown should exist");
        assert!(persisted.contains("type: character"));
        assert!(persisted.contains("Keeps the lighthouse."));
    }

    #[tokio::test]
    async fn get_reloads_card_from_disk() {
        let (service, _temp_path) = card_service_with_project("alpha").await;
        service
            .create(CreateCardRequest {
                project_slug: "alpha".to_string(),
                id: "gravity".to_string(),
                kind: CardKind::Rule,
                title: "Gravity Rule".to_string(),
                body: "Magic has measurable pull.\n".to_string(),
            })
            .await
            .expect("card should create");

        let loaded = service
            .get("alpha", CardKind::Rule, "gravity")
            .await
            .expect("card should load");

        assert_eq!(loaded.kind, CardKind::Rule);
        assert_eq!(loaded.title, "Gravity Rule");
        assert_eq!(loaded.body, "Magic has measurable pull.\n");
    }

    #[tokio::test]
    async fn list_is_deterministic_by_card_id() {
        let (service, _temp_path) = card_service_with_project("alpha").await;

        for id in ["zeta", "alpha", "middle"] {
            service
                .create(CreateCardRequest {
                    project_slug: "alpha".to_string(),
                    id: id.to_string(),
                    kind: CardKind::World,
                    title: id.to_string(),
                    body: format!("# {id}\n"),
                })
                .await
                .expect("card should create");
        }

        let ids: Vec<String> = service
            .list("alpha", CardKind::World)
            .await
            .expect("cards should list")
            .into_iter()
            .map(|card| card.id)
            .collect();

        assert_eq!(ids, ["alpha", "middle", "zeta"]);
    }

    #[tokio::test]
    async fn update_overwrites_existing_markdown_card() {
        let (service, _temp_path) = card_service_with_project("alpha").await;
        service
            .create(CreateCardRequest {
                project_slug: "alpha".to_string(),
                id: "mara".to_string(),
                kind: CardKind::Character,
                title: "Mara".to_string(),
                body: "Old body.\n".to_string(),
            })
            .await
            .expect("card should create");

        let updated = service
            .update(UpdateCardRequest {
                project_slug: "alpha".to_string(),
                id: "mara".to_string(),
                kind: CardKind::Character,
                title: "Mara Revised".to_string(),
                body: "New body.\n".to_string(),
            })
            .await
            .expect("card should update");

        assert_eq!(updated.title, "Mara Revised");
        let loaded = service
            .get("alpha", CardKind::Character, "mara")
            .await
            .expect("updated card should load");
        assert_eq!(loaded.body, "New body.\n");
    }

    #[tokio::test]
    async fn update_missing_card_returns_not_found() {
        let (service, _temp_path) = card_service_with_project("alpha").await;

        let result = service
            .update(UpdateCardRequest {
                project_slug: "alpha".to_string(),
                id: "missing".to_string(),
                kind: CardKind::Character,
                title: "Missing".to_string(),
                body: String::new(),
            })
            .await;

        assert!(matches!(
            result,
            Err(CardError::NotFound { kind: "character", id }) if id == "missing"
        ));
    }

    async fn card_service_with_project(slug: &str) -> (CardService, std::path::PathBuf) {
        let temp = tempdir().expect("tempdir should exist");
        let temp_path = temp.keep();
        let storage = Arc::new(Storage::new(temp_path.clone()));
        let project_service = ProjectService::new(Arc::clone(&storage));
        project_service
            .create(CreateProjectRequest {
                slug: slug.to_string(),
                title: "Alpha".to_string(),
                description: "Test project".to_string(),
            })
            .await
            .expect("project should create");

        (CardService::new(storage), temp_path)
    }
}
