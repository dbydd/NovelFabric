use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::storage::{Storage, StorageError};

const PROJECTS_DIR: &str = "projects";
const KNOWLEDGE_DIR: &str = "knowledge";
const GRAPH_DIR: &str = "graph";
const CHUNKS_DIR: &str = "chunks";
const INDEXES_DIR: &str = "indexes";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphNode {
    pub id: String,
    pub name: String,
    pub labels: Vec<String>,
    pub summary: String,
    pub source_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: String,
    pub fact: String,
    pub valid_at: Option<String>,
    pub invalid_at: Option<String>,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphEpisode {
    pub id: String,
    pub timeline: String,
    pub timepoint: String,
    pub source_path: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphChunk {
    pub id: String,
    pub source_path: String,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphManifest {
    pub node_count: usize,
    pub edge_count: usize,
    pub episode_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoryGraphRebuildOutput {
    pub node_count: usize,
    pub edge_count: usize,
    pub episode_count: usize,
    pub chunk_count: usize,
}

#[derive(Debug, Clone)]
pub struct StoryGraphService {
    storage: Arc<Storage>,
}

#[derive(Debug, Error)]
pub enum StoryGraphError {
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

impl StoryGraphService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub async fn rebuild(
        &self,
        project_slug: &str,
    ) -> Result<StoryGraphRebuildOutput, StoryGraphError> {
        ensure_project_exists(self.storage.as_ref(), project_slug).await?;
        ensure_knowledge_dirs(self.storage.as_ref(), project_slug).await?;

        let mut nodes: Vec<StoryGraphNode> = Vec::new();
        let mut edges: Vec<StoryGraphEdge> = Vec::new();
        let mut episodes: Vec<StoryGraphEpisode> = Vec::new();
        let mut chunks: Vec<StoryGraphChunk> = Vec::new();

        self.collect_card_nodes(project_slug, "characters", "Character", &mut nodes)
            .await?;
        self.collect_card_nodes(project_slug, "rules", "Rule", &mut nodes)
            .await?;
        self.collect_card_nodes(project_slug, "world", "WorldState", &mut nodes)
            .await?;
        self.collect_chapter_nodes_and_chunks(project_slug, &mut nodes, &mut chunks)
            .await?;
        self.collect_memory_episodes(project_slug, &mut episodes)
            .await?;
        self.collect_simulation_episodes(project_slug, &mut episodes)
            .await?;
        self.collect_timepoint_episodes(project_slug, &mut episodes)
            .await?;
        build_derived_edges(&nodes, &episodes, &chunks, &mut edges);

        let manifest = StoryGraphManifest {
            node_count: nodes.len(),
            edge_count: edges.len(),
            episode_count: episodes.len(),
            chunk_count: chunks.len(),
        };

        self.storage
            .write_text(
                &knowledge_graph_path(project_slug, "nodes.jsonl"),
                &render_jsonl(&nodes)?,
            )
            .await?;
        self.storage
            .write_text(
                &knowledge_graph_path(project_slug, "edges.jsonl"),
                &render_jsonl(&edges)?,
            )
            .await?;
        self.storage
            .write_text(
                &knowledge_graph_path(project_slug, "episodes.jsonl"),
                &render_jsonl(&episodes)?,
            )
            .await?;
        self.storage
            .write_text(
                &knowledge_chunks_path(project_slug, "chunks.jsonl"),
                &render_jsonl(&chunks)?,
            )
            .await?;
        self.storage
            .write_json(
                &knowledge_indexes_path(project_slug, "manifest.json"),
                &manifest,
            )
            .await?;
        self.storage
            .write_json(
                &knowledge_root(project_slug).join("ontology.json"),
                &default_ontology(),
            )
            .await?;

        Ok(StoryGraphRebuildOutput {
            node_count: manifest.node_count,
            edge_count: manifest.edge_count,
            episode_count: manifest.episode_count,
            chunk_count: manifest.chunk_count,
        })
    }

    pub async fn load_nodes(
        &self,
        project_slug: &str,
    ) -> Result<Vec<StoryGraphNode>, StoryGraphError> {
        self.load_jsonl(&knowledge_graph_path(project_slug, "nodes.jsonl"))
            .await
    }

    pub async fn load_edges(
        &self,
        project_slug: &str,
    ) -> Result<Vec<StoryGraphEdge>, StoryGraphError> {
        self.load_jsonl(&knowledge_graph_path(project_slug, "edges.jsonl"))
            .await
    }

    pub async fn load_episodes(
        &self,
        project_slug: &str,
    ) -> Result<Vec<StoryGraphEpisode>, StoryGraphError> {
        self.load_jsonl(&knowledge_graph_path(project_slug, "episodes.jsonl"))
            .await
    }

    pub async fn load_chunks(
        &self,
        project_slug: &str,
    ) -> Result<Vec<StoryGraphChunk>, StoryGraphError> {
        self.load_jsonl(&knowledge_chunks_path(project_slug, "chunks.jsonl"))
            .await
    }

    async fn load_jsonl<T>(&self, path: &Path) -> Result<Vec<T>, StoryGraphError>
    where
        T: for<'de> Deserialize<'de>,
    {
        if !self.storage.exists(path).await? {
            return Ok(Vec::new());
        }
        let text = self.storage.read_text(path).await?;
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).map_err(StorageError::Json))
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoryGraphError::Storage)
    }

    async fn collect_card_nodes(
        &self,
        project_slug: &str,
        subdir: &str,
        label: &str,
        nodes: &mut Vec<StoryGraphNode>,
    ) -> Result<(), StoryGraphError> {
        let card_dir = project_root(project_slug).join("cards").join(subdir);
        for file in self.storage.list_files(&card_dir).await? {
            if !is_markdown_file(&file) {
                continue;
            }
            let storage_path = storage_relative_path(self.storage.as_ref(), &file)?;
            let source_path = display_project_relative(project_slug, &file);
            let text = self.storage.read_text(&storage_path).await?;
            let stem = file_stem_string(&file);
            nodes.push(StoryGraphNode {
                id: format!("{}:{}", label.to_ascii_lowercase(), stem),
                name: first_heading(&text).unwrap_or_else(|| stem.clone()),
                labels: vec![label.to_string()],
                summary: first_non_heading_paragraph(&text),
                source_paths: vec![source_path],
            });
        }
        Ok(())
    }

    async fn collect_chapter_nodes_and_chunks(
        &self,
        project_slug: &str,
        nodes: &mut Vec<StoryGraphNode>,
        chunks: &mut Vec<StoryGraphChunk>,
    ) -> Result<(), StoryGraphError> {
        let chapter_dir = project_root(project_slug).join("writing/chapters");
        for file in self.storage.list_files(&chapter_dir).await? {
            if !is_markdown_file(&file) {
                continue;
            }
            let storage_path = storage_relative_path(self.storage.as_ref(), &file)?;
            let source_path = display_project_relative(project_slug, &file);
            let text = self.storage.read_text(&storage_path).await?;
            let stem = file_stem_string(&file);
            nodes.push(StoryGraphNode {
                id: format!("chapter:{stem}"),
                name: first_heading(&text).unwrap_or_else(|| stem.clone()),
                labels: vec!["Chapter".to_string()],
                summary: first_non_heading_paragraph(&text),
                source_paths: vec![source_path.clone()],
            });
            chunks.push(StoryGraphChunk {
                id: format!("chunk:{stem}:0"),
                source_path,
                kind: "chapter".to_string(),
                text,
            });
        }
        Ok(())
    }

    async fn collect_memory_episodes(
        &self,
        project_slug: &str,
        episodes: &mut Vec<StoryGraphEpisode>,
    ) -> Result<(), StoryGraphError> {
        let memory_root = project_root(project_slug).join("memory");
        let mut files = self.storage.list_recursive_files(&memory_root).await?;
        files.sort();
        for file in files {
            if !is_markdown_file(&file) {
                continue;
            }
            let storage_path = storage_relative_path(self.storage.as_ref(), &file)?;
            let source_path = display_project_relative(project_slug, &file);
            let text = self.storage.read_text(&storage_path).await?;
            let (timeline, timepoint) = infer_timeline_timepoint_from_path(&source_path);
            episodes.push(StoryGraphEpisode {
                id: format!("episode:{}", episode_key_from_path(&source_path)),
                timeline,
                timepoint,
                source_path,
                summary: first_non_heading_paragraph(&text),
            });
        }
        Ok(())
    }

    async fn collect_simulation_episodes(
        &self,
        project_slug: &str,
        episodes: &mut Vec<StoryGraphEpisode>,
    ) -> Result<(), StoryGraphError> {
        let logs_root = project_root(project_slug).join("simulation/logs");
        for file in self.storage.list_files(&logs_root).await? {
            if !is_markdown_file(&file) {
                continue;
            }
            let storage_path = storage_relative_path(self.storage.as_ref(), &file)?;
            let source_path = display_project_relative(project_slug, &file);
            let text = self.storage.read_text(&storage_path).await?;
            episodes.push(StoryGraphEpisode {
                id: format!("episode:{}", episode_key_from_path(&source_path)),
                timeline: "simulation".to_string(),
                timepoint: "session-log".to_string(),
                source_path,
                summary: first_non_heading_paragraph(&text),
            });
        }
        Ok(())
    }

    async fn collect_timepoint_episodes(
        &self,
        project_slug: &str,
        episodes: &mut Vec<StoryGraphEpisode>,
    ) -> Result<(), StoryGraphError> {
        let timepoint_root = project_root(project_slug).join("timeline/timepoints");
        for file in self.storage.list_files(&timepoint_root).await? {
            if file.extension().and_then(std::ffi::OsStr::to_str) != Some("json") {
                continue;
            }
            let storage_path = storage_relative_path(self.storage.as_ref(), &file)?;
            let source_path = display_project_relative(project_slug, &file);
            let text = self.storage.read_text(&storage_path).await?;
            let value: serde_json::Value =
                serde_json::from_str(&text).map_err(StorageError::Json)?;
            let timeline = value
                .get("timeline")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("main")
                .to_string();
            let timepoint = value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .or_else(|| {
                    value
                        .get("timepoint_id")
                        .and_then(serde_json::Value::as_str)
                })
                .unwrap_or("unknown")
                .to_string();
            let summary = value
                .get("title")
                .and_then(serde_json::Value::as_str)
                .or_else(|| value.get("summary").and_then(serde_json::Value::as_str))
                .unwrap_or("timeline timepoint")
                .to_string();
            episodes.push(StoryGraphEpisode {
                id: format!("episode:{}", episode_key_from_path(&source_path)),
                timeline,
                timepoint,
                source_path,
                summary,
            });
        }
        Ok(())
    }
}

fn build_derived_edges(
    nodes: &[StoryGraphNode],
    episodes: &[StoryGraphEpisode],
    chunks: &[StoryGraphChunk],
    edges: &mut Vec<StoryGraphEdge>,
) {
    let entity_nodes: Vec<_> = nodes
        .iter()
        .filter(|node| !node.labels.iter().any(|label| label == "Chapter"))
        .collect();
    let mut edge_index = 1_usize;

    for chunk in chunks {
        let lowered = chunk.text.to_lowercase();
        let target = chunk
            .id
            .strip_prefix("chunk:")
            .and_then(|value| value.strip_suffix(":0"))
            .map(|stem| format!("chapter:{stem}"));
        let Some(target) = target else { continue };
        for node in &entity_nodes {
            if lowered.contains(&node.name.to_lowercase()) {
                edges.push(StoryGraphEdge {
                    id: format!("edge:{edge_index:04}"),
                    source: node.id.clone(),
                    target: target.clone(),
                    relation: "MENTIONED_IN".to_string(),
                    fact: format!("{} is mentioned in {}", node.name, chunk.source_path),
                    valid_at: None,
                    invalid_at: None,
                    source_path: chunk.source_path.clone(),
                });
                edge_index += 1;
            }
        }
    }

    for episode in episodes {
        let lowered = episode.summary.to_lowercase();
        for node in &entity_nodes {
            if lowered.contains(&node.name.to_lowercase()) {
                edges.push(StoryGraphEdge {
                    id: format!("edge:{edge_index:04}"),
                    source: node.id.clone(),
                    target: node.id.clone(),
                    relation: "VALID_IN_TIMELINE".to_string(),
                    fact: format!(
                        "{} appears in {} / {}",
                        node.name, episode.timeline, episode.timepoint
                    ),
                    valid_at: Some(format!("{}/{}", episode.timeline, episode.timepoint)),
                    invalid_at: None,
                    source_path: episode.source_path.clone(),
                });
                edge_index += 1;
            }
        }
    }
}

fn default_ontology() -> BTreeMap<&'static str, Vec<&'static str>> {
    BTreeMap::from([
        (
            "node_labels",
            vec![
                "Character",
                "Faction",
                "Location",
                "Item",
                "Event",
                "Secret",
                "Rule",
                "WorldState",
                "Chapter",
                "TimelineBranch",
            ],
        ),
        (
            "relations",
            vec![
                "KNOWS",
                "HIDES_FROM",
                "ALLIED_WITH",
                "OPPOSES",
                "LOVES",
                "HATES",
                "OWES",
                "LOCATED_AT",
                "CAUSED",
                "PREVENTS",
                "REQUIRES",
                "CONSTRAINS",
                "MENTIONED_IN",
                "VALID_IN_TIMELINE",
                "BRANCHES_FROM",
            ],
        ),
    ])
}

fn render_jsonl<T: Serialize>(items: &[T]) -> Result<String, StoryGraphError> {
    items
        .iter()
        .map(|item| serde_json::to_string(item).map_err(StorageError::Json))
        .collect::<Result<Vec<_>, _>>()
        .map(|lines| {
            if lines.is_empty() {
                String::new()
            } else {
                format!("{}\n", lines.join("\n"))
            }
        })
        .map_err(StoryGraphError::Storage)
}

fn first_heading(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn first_non_heading_paragraph(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or("No summary available.")
        .to_string()
}

fn infer_timeline_timepoint_from_path(source_path: &str) -> (String, String) {
    let segments: Vec<_> = source_path.split('/').collect();
    if let Some(position) = segments.iter().position(|segment| *segment == "entries") {
        let timeline = segments
            .get(position.saturating_sub(2))
            .copied()
            .unwrap_or("memory")
            .to_string();
        let timepoint = segments
            .get(position.saturating_sub(1))
            .copied()
            .unwrap_or("entry")
            .to_string();
        return (timeline, timepoint);
    }
    ("memory".to_string(), "entry".to_string())
}

fn episode_key_from_path(path: &str) -> String {
    path.replace('/', ":").replace('.', "-")
}

fn file_stem_string(path: &Path) -> String {
    path.file_stem()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("unknown")
        .to_string()
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

fn project_root(project_slug: &str) -> PathBuf {
    Path::new(PROJECTS_DIR).join(project_slug)
}

fn knowledge_root(project_slug: &str) -> PathBuf {
    project_root(project_slug).join(KNOWLEDGE_DIR)
}

fn knowledge_graph_path(project_slug: &str, file_name: &str) -> PathBuf {
    knowledge_root(project_slug).join(GRAPH_DIR).join(file_name)
}

fn knowledge_chunks_path(project_slug: &str, file_name: &str) -> PathBuf {
    knowledge_root(project_slug)
        .join(CHUNKS_DIR)
        .join(file_name)
}

fn knowledge_indexes_path(project_slug: &str, file_name: &str) -> PathBuf {
    knowledge_root(project_slug)
        .join(INDEXES_DIR)
        .join(file_name)
}

async fn ensure_knowledge_dirs(
    storage: &Storage,
    project_slug: &str,
) -> Result<(), StoryGraphError> {
    for path in [
        knowledge_root(project_slug),
        knowledge_root(project_slug).join(GRAPH_DIR),
        knowledge_root(project_slug).join(CHUNKS_DIR),
        knowledge_root(project_slug).join(INDEXES_DIR),
    ] {
        storage.ensure_dir(&path).await?;
    }
    Ok(())
}

async fn ensure_project_exists(
    storage: &Storage,
    project_slug: &str,
) -> Result<(), StoryGraphError> {
    let metadata_path = project_root(project_slug).join("project.json");
    if storage.exists(&metadata_path).await? {
        Ok(())
    } else {
        Err(StoryGraphError::ProjectNotFound(project_slug.to_string()))
    }
}

fn display_project_relative(project_slug: &str, path: &Path) -> String {
    let marker = format!("projects/{project_slug}/");
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized.find(&marker).map_or_else(
        || normalized.clone(),
        |position| normalized[(position + marker.len())..].to_string(),
    )
}

fn storage_relative_path(storage: &Storage, path: &Path) -> Result<PathBuf, StoryGraphError> {
    path.strip_prefix(storage.root())
        .map(Path::to_path_buf)
        .map_err(|_| StoryGraphError::Storage(StorageError::PathEscapesRoot))
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::StoryGraphService;
    use crate::{
        cards::{CardKind, CardService, CreateCardRequest},
        memory::{CreateMemoryEntryRequest, MemoryScope, MemoryService},
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
    };

    #[tokio::test]
    async fn rebuild_writes_expected_storygraph_artifacts() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let memory = MemoryService::new(Arc::clone(&storage));
        let graph = StoryGraphService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "graph-project".to_string(),
                title: "Graph Project".to_string(),
                description: "story graph".to_string(),
            })
            .await
            .expect("project create should succeed");

        cards
            .create(CreateCardRequest {
                project_slug: "graph-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "守护密库的角色。".to_string(),
            })
            .await
            .expect("character card should create");

        storage
            .write_text(
                Path::new("projects/graph-project/writing/chapters/chapter-001.md"),
                "# Chapter 1\n\nAria enters the vault.\n",
            )
            .await
            .expect("chapter write should succeed");

        memory
            .create(
                "graph-project",
                CreateMemoryEntryRequest {
                    scope: MemoryScope::Global,
                    key: "entry-001".to_string(),
                    title: "Vault rumor".to_string(),
                    timeline: "main".to_string(),
                    timepoint: "tp-0001".to_string(),
                    body: "Aria heard a rumor about the vault.".to_string(),
                },
            )
            .await
            .expect("memory create should succeed");

        storage
            .write_text(
                Path::new("projects/graph-project/simulation/logs/session-0001.md"),
                "# Session\n\nAria acts first.\n",
            )
            .await
            .expect("simulation log write should succeed");

        storage
            .write_json(
                Path::new("projects/graph-project/timeline/timepoints/tp-0001.json"),
                &serde_json::json!({
                    "id": "tp-0001",
                    "timeline": "main",
                    "title": "Opening"
                }),
            )
            .await
            .expect("timepoint write should succeed");

        let output = graph
            .rebuild("graph-project")
            .await
            .expect("rebuild should succeed");

        assert!(output.node_count >= 2);
        assert!(output.edge_count >= 1);
        assert!(output.episode_count >= 3);

        let nodes = storage
            .read_text(Path::new(
                "projects/graph-project/knowledge/graph/nodes.jsonl",
            ))
            .await
            .expect("nodes should exist");
        assert!(nodes.contains("\"Character\""));
        assert!(nodes.contains("cards/characters/aria.md"));

        let episodes = storage
            .read_text(Path::new(
                "projects/graph-project/knowledge/graph/episodes.jsonl",
            ))
            .await
            .expect("episodes should exist");
        assert!(episodes.contains("memory/global/entries/main/tp-0001/entry-001.md"));

        let manifest = storage
            .read_text(Path::new(
                "projects/graph-project/knowledge/indexes/manifest.json",
            ))
            .await
            .expect("manifest should exist");
        assert!(manifest.contains("node_count"));
    }
}
