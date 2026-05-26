use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    storage::{Storage, StorageError},
    story_graph::{
        StoryGraphChunk, StoryGraphEdge, StoryGraphEpisode, StoryGraphNode, StoryGraphService,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StoryRagHit {
    pub fact: String,
    pub source_path: String,
    pub timeline: Option<String>,
    pub timepoint: Option<String>,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuickSearchOutput {
    pub query: String,
    pub hits: Vec<StoryRagHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PanoramaSearchOutput {
    pub query: String,
    pub active_facts: Vec<StoryRagHit>,
    pub historical_facts: Vec<StoryRagHit>,
    pub nodes: Vec<StoryGraphNode>,
    pub edges: Vec<StoryGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InsightForgeOutput {
    pub query: String,
    pub sub_queries: Vec<String>,
    pub facts: Vec<StoryRagHit>,
    pub relationship_chains: Vec<String>,
    pub risk_notes: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct StoryRagService {
    graph: StoryGraphService,
}

#[derive(Debug, Error)]
pub enum StoryRagError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Graph(#[from] crate::story_graph::StoryGraphError),
}

impl StoryRagService {
    #[must_use]
    pub const fn new(storage: Arc<Storage>) -> Self {
        Self {
            graph: StoryGraphService::new(storage),
        }
    }

    pub async fn quick_search(
        &self,
        project_slug: &str,
        query: &str,
    ) -> Result<QuickSearchOutput, StoryRagError> {
        let hits = self.collect_hits(project_slug, query).await?;
        Ok(QuickSearchOutput {
            query: query.to_string(),
            hits,
        })
    }

    pub async fn panorama_search(
        &self,
        project_slug: &str,
        query: &str,
    ) -> Result<PanoramaSearchOutput, StoryRagError> {
        let nodes = self.graph.load_nodes(project_slug).await?;
        let edges = self.graph.load_edges(project_slug).await?;
        let hits = self.collect_hits(project_slug, query).await?;
        let (active_facts, historical_facts): (Vec<_>, Vec<_>) = hits
            .into_iter()
            .partition(|hit| is_active_fact(hit.timeline.as_deref(), hit.timepoint.as_deref()));
        Ok(PanoramaSearchOutput {
            query: query.to_string(),
            active_facts,
            historical_facts,
            nodes: filter_nodes_by_query(nodes, query),
            edges: filter_edges_by_query(edges, query),
        })
    }

    pub async fn insight_forge(
        &self,
        project_slug: &str,
        query: &str,
    ) -> Result<InsightForgeOutput, StoryRagError> {
        let sub_queries = vec![
            query.to_string(),
            format!("{query} 角色"),
            format!("{query} 规则"),
            format!("{query} 世界观"),
            format!("{query} 时间线"),
            format!("{query} 记忆"),
        ];

        let mut facts = Vec::new();
        for sub_query in &sub_queries {
            facts.extend(self.collect_hits(project_slug, sub_query).await?);
        }
        dedupe_hits(&mut facts);

        let panorama = self.panorama_search(project_slug, query).await?;
        let relationship_chains = build_relationship_chains(&panorama.edges);
        let risk_notes = build_risk_notes(&panorama.active_facts, &panorama.historical_facts);

        Ok(InsightForgeOutput {
            query: query.to_string(),
            sub_queries,
            facts,
            relationship_chains,
            risk_notes,
        })
    }

    async fn collect_hits(
        &self,
        project_slug: &str,
        query: &str,
    ) -> Result<Vec<StoryRagHit>, StoryRagError> {
        let lowered_query = query.to_lowercase();
        let nodes = self.graph.load_nodes(project_slug).await?;
        let episodes = self.graph.load_episodes(project_slug).await?;
        let chunks = self.graph.load_chunks(project_slug).await?;

        let mut hits = Vec::new();
        hits.extend(
            nodes
                .iter()
                .filter_map(|node| node_hit(node, &lowered_query)),
        );
        hits.extend(
            episodes
                .into_iter()
                .filter_map(|episode| episode_hit(episode, &lowered_query)),
        );
        hits.extend(
            chunks
                .into_iter()
                .filter_map(|chunk| chunk_hit(chunk, &lowered_query)),
        );
        hits.sort_by(|left, right| right.score.total_cmp(&left.score));
        hits.truncate(12);
        Ok(hits)
    }
}

fn node_hit(node: &StoryGraphNode, lowered_query: &str) -> Option<StoryRagHit> {
    let haystack = format!(
        "{} {} {}",
        node.name,
        node.summary,
        node.source_paths.join(" ")
    );
    let score = score_match(&haystack, lowered_query)?;
    Some(StoryRagHit {
        fact: format!("{}: {}", node.name, node.summary),
        source_path: node.source_paths.first().cloned().unwrap_or_default(),
        timeline: None,
        timepoint: None,
        score,
    })
}

fn episode_hit(episode: StoryGraphEpisode, lowered_query: &str) -> Option<StoryRagHit> {
    let haystack = format!(
        "{} {} {}",
        episode.summary, episode.source_path, episode.timepoint
    );
    let score = score_match(&haystack, lowered_query)?;
    Some(StoryRagHit {
        fact: episode.summary,
        source_path: episode.source_path,
        timeline: Some(episode.timeline),
        timepoint: Some(episode.timepoint),
        score,
    })
}

fn chunk_hit(chunk: StoryGraphChunk, lowered_query: &str) -> Option<StoryRagHit> {
    let score = score_match(&chunk.text, lowered_query)?;
    Some(StoryRagHit {
        fact: first_chunk_line(&chunk.text),
        source_path: chunk.source_path,
        timeline: None,
        timepoint: None,
        score,
    })
}

fn score_match(haystack: &str, lowered_query: &str) -> Option<f32> {
    let lowered = haystack.to_lowercase();
    if lowered.contains(lowered_query) {
        let count = lowered.matches(lowered_query).count();
        let count_u16 = u16::try_from(count).unwrap_or(u16::MAX);
        let len_u16 = u16::try_from(lowered.len().max(1)).unwrap_or(u16::MAX);
        Some((1.0 + f32::from(count_u16)) / f32::from(len_u16) * 100.0)
    } else {
        None
    }
}

fn filter_nodes_by_query(nodes: Vec<StoryGraphNode>, query: &str) -> Vec<StoryGraphNode> {
    let lowered_query = query.to_lowercase();
    nodes
        .into_iter()
        .filter(|node| {
            let haystack = format!("{} {}", node.name, node.summary).to_lowercase();
            haystack.contains(&lowered_query)
        })
        .collect()
}

fn filter_edges_by_query(edges: Vec<StoryGraphEdge>, query: &str) -> Vec<StoryGraphEdge> {
    let lowered_query = query.to_lowercase();
    edges
        .into_iter()
        .filter(|edge| {
            let haystack = format!("{} {} {}", edge.fact, edge.source, edge.target).to_lowercase();
            haystack.contains(&lowered_query)
        })
        .collect()
}

fn dedupe_hits(hits: &mut Vec<StoryRagHit>) {
    let mut seen = std::collections::BTreeSet::new();
    hits.retain(|hit| seen.insert((hit.source_path.clone(), hit.fact.clone())));
}

fn build_relationship_chains(edges: &[StoryGraphEdge]) -> Vec<String> {
    if edges.is_empty() {
        return vec!["No explicit relationship chain found yet.".to_string()];
    }
    edges
        .iter()
        .map(|edge| format!("{} -[{}]-> {}", edge.source, edge.relation, edge.target))
        .collect()
}

fn build_risk_notes(active_facts: &[StoryRagHit], historical_facts: &[StoryRagHit]) -> Vec<String> {
    let mut notes = Vec::new();
    if active_facts.is_empty() {
        notes.push("No active facts matched the query; decision context may be thin.".to_string());
    }
    if !historical_facts.is_empty() {
        notes.push(
            "Historical facts also matched; branch/timepoint drift should be checked.".to_string(),
        );
    }
    if notes.is_empty() {
        notes.push(
            "Matched facts are currently active with no obvious historical conflict.".to_string(),
        );
    }
    notes
}

fn is_active_fact(timeline: Option<&str>, timepoint: Option<&str>) -> bool {
    !matches!(timeline, Some("simulation")) && !matches!(timepoint, Some("entry" | "session-log"))
}

fn first_chunk_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("No fact available.")
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use tempfile::tempdir;

    use super::StoryRagService;
    use crate::{
        cards::{CardKind, CardService, CreateCardRequest},
        memory::{CreateMemoryEntryRequest, MemoryScope, MemoryService},
        project::{CreateProjectRequest, ProjectService},
        storage::Storage,
        story_graph::StoryGraphService,
    };

    #[tokio::test]
    async fn quick_panorama_and_insight_return_structured_hits() {
        let temp = tempdir().expect("tempdir should exist");
        let storage = Arc::new(Storage::new(temp.path().to_path_buf()));
        let projects = ProjectService::new(Arc::clone(&storage));
        let cards = CardService::new(Arc::clone(&storage));
        let memory = MemoryService::new(Arc::clone(&storage));
        let graph = StoryGraphService::new(Arc::clone(&storage));
        let rag = StoryRagService::new(Arc::clone(&storage));

        projects
            .create(CreateProjectRequest {
                slug: "rag-project".to_string(),
                title: "RAG Project".to_string(),
                description: "story rag".to_string(),
            })
            .await
            .expect("project create should succeed");

        cards
            .create(CreateCardRequest {
                project_slug: "rag-project".to_string(),
                id: "aria".to_string(),
                kind: CardKind::Character,
                title: "Aria".to_string(),
                body: "Aria protects the vault and distrusts outsiders.".to_string(),
            })
            .await
            .expect("card create should succeed");

        memory
            .create(
                "rag-project",
                CreateMemoryEntryRequest {
                    scope: MemoryScope::Global,
                    key: "entry-001".to_string(),
                    title: "Vault event".to_string(),
                    timeline: "main".to_string(),
                    timepoint: "tp-0001".to_string(),
                    body: "Aria heard that the vault seals are weakening.".to_string(),
                },
            )
            .await
            .expect("memory create should succeed");

        storage
            .write_text(
                Path::new("projects/rag-project/writing/chapters/chapter-001.md"),
                "# Chapter 1\n\nAria inspects the vault seal.\n",
            )
            .await
            .expect("chapter write should succeed");

        graph
            .rebuild("rag-project")
            .await
            .expect("graph rebuild should succeed");

        let quick = rag
            .quick_search("rag-project", "vault")
            .await
            .expect("quick search should succeed");
        assert!(!quick.hits.is_empty());
        assert!(
            quick
                .hits
                .iter()
                .any(|hit| hit.source_path.contains("writing/chapters"))
        );

        let panorama = rag
            .panorama_search("rag-project", "Aria")
            .await
            .expect("panorama search should succeed");
        assert!(!panorama.nodes.is_empty());

        let insight = rag
            .insight_forge("rag-project", "vault")
            .await
            .expect("insight forge should succeed");
        assert!(!insight.sub_queries.is_empty());
        assert!(!insight.facts.is_empty());
    }
}
