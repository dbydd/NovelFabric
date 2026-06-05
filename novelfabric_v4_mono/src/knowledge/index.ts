import { CommandFailure } from "../errors.js";
import {
  contentHash,
  globWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";

export type KnowledgeSourceKind = "markdown" | "json" | "jsonl" | "text" | "toml";

export type KnowledgeSource = {
  readonly path: string;
  readonly kind: KnowledgeSourceKind;
  readonly title: string;
  readonly hash: string;
  readonly bytes: number;
  readonly lineCount: number;
  readonly protected: boolean;
};

export type KnowledgeSourcesListRequest = {
  readonly workspacePath: string;
};

export type KnowledgeSourcesListResult = {
  readonly sources: readonly KnowledgeSource[];
  readonly sourceCount: number;
};

export type KnowledgeRebuildRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly reason?: string;
};

export type KnowledgeRebuildResult = {
  readonly sourceCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly episodeCount: number;
  readonly writes: readonly KnowledgeWriteSummary[];
};

export type KnowledgeWriteSummary = Pick<
  WorkspaceFileWriteResult,
  "path" | "hash" | "bytes" | "auditPath"
>;

export type KnowledgeValidateRequest = {
  readonly workspacePath: string;
};

export type KnowledgeValidateResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly KnowledgeValidationIssue[];
};

export type KnowledgeValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type KnowledgeGraphNodeKind = "document" | "episode" | "entity";

export type KnowledgeGraphNode = {
  readonly id: string;
  readonly kind: KnowledgeGraphNodeKind;
  readonly label: string;
  readonly sourcePath?: string;
  readonly hash?: string;
  readonly citation?: KnowledgeCitation;
};

export type KnowledgeGraphEdgeKind = "contains" | "mentions" | "co_occurs";

export type KnowledgeGraphEdge = {
  readonly id: string;
  readonly kind: KnowledgeGraphEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly sourcePath: string;
  readonly citation: KnowledgeCitation;
};

export type KnowledgeGraphEpisode = {
  readonly id: string;
  readonly sourcePath: string;
  readonly title: string;
  readonly ordinal: number;
  readonly charRange: SourceRange;
  readonly lineRange: SourceRange;
  readonly hash: string;
  readonly excerpt: string;
  readonly citation: KnowledgeCitation;
};

export type KnowledgeCitation = {
  readonly sourcePath: string;
  readonly hash: string;
  readonly lineRange: SourceRange;
  readonly excerpt: string;
};

export type SourceRange = {
  readonly start: number;
  readonly end: number;
};

export type KnowledgeGraphNodesResult = {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly nodeCount: number;
};

export type KnowledgeGraphEdgesResult = {
  readonly edges: readonly KnowledgeGraphEdge[];
  readonly edgeCount: number;
};

export type KnowledgeGraphEpisodesResult = {
  readonly episodes: readonly KnowledgeGraphEpisode[];
  readonly episodeCount: number;
};

export type RecallMode = "quick" | "panorama" | "insight";

export type RecallRequest = {
  readonly workspacePath: string;
  readonly query: string;
  readonly mode: RecallMode;
  readonly timeline?: string;
  readonly limit?: number;
};

export type RecallResult = {
  readonly mode: RecallMode;
  readonly query: string;
  readonly expandedQuery: readonly string[];
  readonly timeline?: string;
  readonly results: readonly RecallHit[];
  readonly citations: readonly KnowledgeCitation[];
  readonly insights?: readonly RecallInsight[];
};

export type RecallHit = {
  readonly sourcePath: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly citation: KnowledgeCitation;
};

export type RecallInsight = {
  readonly code: string;
  readonly message: string;
  readonly citations: readonly KnowledgeCitation[];
};

export type ContextPackBuildRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly kind: string;
  readonly query?: string;
  readonly agent?: string;
  readonly session?: string;
  readonly timeline?: string;
  readonly outputPath?: string;
  readonly limit?: number;
  readonly reason?: string;
};

export type ContextPackBuildResult = {
  readonly outputPath: string;
  readonly outputHash: string;
  readonly citationCount: number;
  readonly sourceCount: number;
  readonly write: KnowledgeWriteSummary;
};

export type ContextPackValidateRequest = {
  readonly workspacePath: string;
  readonly path: string;
};

export type ContextPackValidateResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly KnowledgeValidationIssue[];
};

export type NovelFabricContextPack = {
  readonly kind: "novelfabric.context-pack";
  readonly version: 1;
  readonly packKind: string;
  readonly query: string;
  readonly agent: string | null;
  readonly session: string | null;
  readonly timeline: string | null;
  readonly citations: readonly KnowledgeCitation[];
  readonly recall: {
    readonly quick: readonly RecallHit[];
    readonly panorama: readonly RecallHit[];
    readonly insight: readonly RecallInsight[];
  };
  readonly sources: readonly KnowledgeSource[];
};

type SourceDocument = KnowledgeSource & {
  readonly content: string;
};

type KnowledgeIndexManifest = {
  readonly kind: "novelfabric.knowledge.index";
  readonly version: 1;
  readonly sourceCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly episodeCount: number;
  readonly artifacts: {
    readonly sources: string;
    readonly nodes: string;
    readonly edges: string;
    readonly episodes: string;
  };
};

type KnowledgeSourcesArtifact = {
  readonly kind: "novelfabric.knowledge.sources";
  readonly version: 1;
  readonly sources: readonly KnowledgeSource[];
};

type KnowledgeGraphNodesArtifact = {
  readonly kind: "novelfabric.knowledge.graph.nodes";
  readonly version: 1;
  readonly nodes: readonly KnowledgeGraphNode[];
};

type KnowledgeGraphEdgesArtifact = {
  readonly kind: "novelfabric.knowledge.graph.edges";
  readonly version: 1;
  readonly edges: readonly KnowledgeGraphEdge[];
};

type KnowledgeGraphEpisodesArtifact = {
  readonly kind: "novelfabric.knowledge.graph.episodes";
  readonly version: 1;
  readonly episodes: readonly KnowledgeGraphEpisode[];
};

type HeadingSpan = {
  readonly line: number;
  readonly charStart: number;
  readonly title: string;
};

const SOURCE_SINGLE_PATHS = ["project.md", "project.json", "AGENTS.md"] as const;
const SOURCE_DIRECTORIES = [
  "agents",
  "cards",
  "imports/source",
  "imports/normalized",
  "imports/chapters",
  "memory",
  "timeline",
  "simulation",
  "reports",
  "writing"
] as const;
const SOURCE_EXTENSIONS = new Set([".md", ".txt", ".json", ".jsonl", ".toml"]);
const SOURCES_ARTIFACT_PATH = "knowledge/indexes/sources.json";
const MANIFEST_ARTIFACT_PATH = "knowledge/indexes/manifest.json";
const NODES_ARTIFACT_PATH = "knowledge/graph/nodes.json";
const EDGES_ARTIFACT_PATH = "knowledge/graph/edges.json";
const EPISODES_ARTIFACT_PATH = "knowledge/graph/episodes.json";
const CONTEXT_PACK_DEFAULT_LIMIT = 8;
const RECALL_DEFAULT_LIMIT = 8;
const EXCERPT_CHARS = 360;
const MAX_ENTITY_COUNT_PER_EPISODE = 12;
const CHINESE_STOP_TERMS = new Set([
  "这个",
  "那个",
  "没有",
  "应该",
  "当前",
  "可以",
  "因为",
  "所以",
  "其中",
  "这里",
  "进行"
]);
const LATIN_STOP_TERMS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "json",
  "true",
  "false",
  "null"
]);

export async function listKnowledgeSources(
  request: KnowledgeSourcesListRequest
): Promise<KnowledgeSourcesListResult> {
  const paths = await discoverKnowledgeSourcePaths(request.workspacePath);
  const sources = await Promise.all(
    paths.map(async (sourcePath): Promise<KnowledgeSource | null> => {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: sourcePath
      });
      if (read.content.trim().length === 0) return null;
      return {
        path: read.path,
        kind: sourceKindForPath(read.path),
        title: titleForDocument(read.path, read.content),
        hash: read.hash,
        bytes: read.bytes,
        lineCount: countLines(read.content),
        protected: read.protected
      };
    })
  );
  const nonEmptySources = sources
    .filter((source): source is KnowledgeSource => source !== null)
    .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
  return { sources: nonEmptySources, sourceCount: nonEmptySources.length };
}

export async function rebuildKnowledgeIndex(
  request: KnowledgeRebuildRequest
): Promise<KnowledgeRebuildResult> {
  const documents = await readKnowledgeDocuments(request.workspacePath);
  const graph = buildKnowledgeGraph(documents);
  const sourcesArtifact: KnowledgeSourcesArtifact = {
    kind: "novelfabric.knowledge.sources",
    version: 1,
    sources: documents.map(sourceFromDocument)
  };
  const nodesArtifact: KnowledgeGraphNodesArtifact = {
    kind: "novelfabric.knowledge.graph.nodes",
    version: 1,
    nodes: graph.nodes
  };
  const edgesArtifact: KnowledgeGraphEdgesArtifact = {
    kind: "novelfabric.knowledge.graph.edges",
    version: 1,
    edges: graph.edges
  };
  const episodesArtifact: KnowledgeGraphEpisodesArtifact = {
    kind: "novelfabric.knowledge.graph.episodes",
    version: 1,
    episodes: graph.episodes
  };
  const manifest: KnowledgeIndexManifest = {
    kind: "novelfabric.knowledge.index",
    version: 1,
    sourceCount: documents.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    episodeCount: graph.episodes.length,
    artifacts: {
      sources: SOURCES_ARTIFACT_PATH,
      nodes: NODES_ARTIFACT_PATH,
      edges: EDGES_ARTIFACT_PATH,
      episodes: EPISODES_ARTIFACT_PATH
    }
  };

  const writes: KnowledgeWriteSummary[] = [];
  for (const artifact of [
    {
      path: SOURCES_ARTIFACT_PATH,
      content: stableJson(sourcesArtifact),
      reason: "knowledge rebuild sources"
    },
    {
      path: NODES_ARTIFACT_PATH,
      content: stableJson(nodesArtifact),
      reason: "knowledge rebuild nodes"
    },
    {
      path: EDGES_ARTIFACT_PATH,
      content: stableJson(edgesArtifact),
      reason: "knowledge rebuild edges"
    },
    {
      path: EPISODES_ARTIFACT_PATH,
      content: stableJson(episodesArtifact),
      reason: "knowledge rebuild episodes"
    },
    {
      path: MANIFEST_ARTIFACT_PATH,
      content: stableJson(manifest),
      reason: "knowledge rebuild manifest"
    }
  ] as const) {
    const write = await writeWorkspaceFile({
      workspacePath: request.workspacePath,
      path: artifact.path,
      content: artifact.content,
      actor: request.actor,
      reason: request.reason ?? artifact.reason
    });
    writes.push(summarizeWrite(write));
  }

  return {
    sourceCount: documents.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    episodeCount: graph.episodes.length,
    writes
  };
}

export async function validateKnowledgeIndex(
  request: KnowledgeValidateRequest
): Promise<KnowledgeValidateResult> {
  const checked = [
    SOURCES_ARTIFACT_PATH,
    NODES_ARTIFACT_PATH,
    EDGES_ARTIFACT_PATH,
    EPISODES_ARTIFACT_PATH,
    MANIFEST_ARTIFACT_PATH
  ];
  const issues: KnowledgeValidationIssue[] = [];
  const sourcesArtifact = await readJsonArtifact(
    request.workspacePath,
    SOURCES_ARTIFACT_PATH,
    issues
  );
  await readJsonArtifact(request.workspacePath, NODES_ARTIFACT_PATH, issues);
  await readJsonArtifact(request.workspacePath, EDGES_ARTIFACT_PATH, issues);
  await readJsonArtifact(request.workspacePath, EPISODES_ARTIFACT_PATH, issues);
  await readJsonArtifact(request.workspacePath, MANIFEST_ARTIFACT_PATH, issues);

  if (isKnowledgeSourcesArtifact(sourcesArtifact)) {
    for (const source of sourcesArtifact.sources) {
      try {
        const read = await readWorkspaceFile({
          workspacePath: request.workspacePath,
          path: source.path
        });
        if (read.hash !== source.hash) {
          issues.push({
            severity: "error",
            code: "knowledge_source_hash_mismatch",
            path: source.path,
            message: `Source '${source.path}' changed after the knowledge index was rebuilt.`
          });
        }
      } catch (error) {
        issues.push({
          severity: "error",
          code: "knowledge_source_missing",
          path: source.path,
          message:
            error instanceof Error ? error.message : `Source '${source.path}' is unavailable.`
        });
      }
    }
  } else if (sourcesArtifact !== null) {
    issues.push({
      severity: "error",
      code: "invalid_knowledge_sources_artifact",
      path: SOURCES_ARTIFACT_PATH,
      message: "Knowledge sources artifact has an invalid shape."
    });
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues
  };
}

export async function readKnowledgeGraphNodes(
  request: KnowledgeValidateRequest
): Promise<KnowledgeGraphNodesResult> {
  const artifact = await readRequiredJsonArtifact(request.workspacePath, NODES_ARTIFACT_PATH);
  if (!isKnowledgeGraphNodesArtifact(artifact)) {
    throw new CommandFailure(
      "invalid_knowledge_nodes_artifact",
      `Knowledge nodes artifact '${NODES_ARTIFACT_PATH}' has an invalid shape.`
    );
  }
  return { nodes: artifact.nodes, nodeCount: artifact.nodes.length };
}

export async function readKnowledgeGraphEdges(
  request: KnowledgeValidateRequest
): Promise<KnowledgeGraphEdgesResult> {
  const artifact = await readRequiredJsonArtifact(request.workspacePath, EDGES_ARTIFACT_PATH);
  if (!isKnowledgeGraphEdgesArtifact(artifact)) {
    throw new CommandFailure(
      "invalid_knowledge_edges_artifact",
      `Knowledge edges artifact '${EDGES_ARTIFACT_PATH}' has an invalid shape.`
    );
  }
  return { edges: artifact.edges, edgeCount: artifact.edges.length };
}

export async function readKnowledgeGraphEpisodes(
  request: KnowledgeValidateRequest
): Promise<KnowledgeGraphEpisodesResult> {
  const artifact = await readRequiredJsonArtifact(request.workspacePath, EPISODES_ARTIFACT_PATH);
  if (!isKnowledgeGraphEpisodesArtifact(artifact)) {
    throw new CommandFailure(
      "invalid_knowledge_episodes_artifact",
      `Knowledge episodes artifact '${EPISODES_ARTIFACT_PATH}' has an invalid shape.`
    );
  }
  return { episodes: artifact.episodes, episodeCount: artifact.episodes.length };
}

export async function recallKnowledge(request: RecallRequest): Promise<RecallResult> {
  const normalizedQuery = request.query.trim();
  if (normalizedQuery.length === 0) {
    throw new CommandFailure("invalid_recall_query", "Recall query must not be empty.");
  }

  const limit = normalizePositiveLimit(request.limit, RECALL_DEFAULT_LIMIT);
  const expandedQuery = expandQueryTerms(normalizedQuery);
  const documents = await readKnowledgeDocuments(request.workspacePath);
  const hits = documents
    .map((document) => scoreDocument(document, expandedQuery))
    .filter((hit): hit is RecallHit => hit !== null)
    .sort(compareRecallHits)
    .slice(0, limit);
  const panoramaHits =
    request.mode === "panorama" ? prioritizeTimelineHits(hits, request.timeline) : hits;
  const citations = uniqueCitations(
    (request.mode === "panorama" ? panoramaHits : hits).map((hit) => hit.citation)
  );
  const insights =
    request.mode === "insight" ? buildRecallInsights(documents, hits, expandedQuery) : undefined;

  return {
    mode: request.mode,
    query: normalizedQuery,
    expandedQuery,
    ...(request.timeline === undefined ? {} : { timeline: request.timeline }),
    results: request.mode === "panorama" ? panoramaHits : hits,
    citations,
    ...(insights === undefined ? {} : { insights })
  };
}

export async function buildContextPack(
  request: ContextPackBuildRequest
): Promise<ContextPackBuildResult> {
  const query = contextPackQuery(request);
  const limit = normalizePositiveLimit(request.limit, CONTEXT_PACK_DEFAULT_LIMIT);
  const quick = await recallKnowledge({
    workspacePath: request.workspacePath,
    query,
    mode: "quick",
    limit
  });
  const panorama = await recallKnowledge({
    workspacePath: request.workspacePath,
    query,
    mode: "panorama",
    ...(request.timeline === undefined ? {} : { timeline: request.timeline }),
    limit
  });
  const insight = await recallKnowledge({
    workspacePath: request.workspacePath,
    query,
    mode: "insight",
    limit
  });
  const citationPaths = new Set(
    [...quick.citations, ...panorama.citations, ...insight.citations].map(
      (citation) => citation.sourcePath
    )
  );
  const sources = (
    await listKnowledgeSources({ workspacePath: request.workspacePath })
  ).sources.filter((source) => citationPaths.has(source.path));
  const pack: NovelFabricContextPack = {
    kind: "novelfabric.context-pack",
    version: 1,
    packKind: request.kind,
    query,
    agent: request.agent ?? null,
    session: request.session ?? null,
    timeline: request.timeline ?? null,
    citations: uniqueCitations([...quick.citations, ...panorama.citations, ...insight.citations]),
    recall: {
      quick: quick.results,
      panorama: panorama.results,
      insight: insight.insights ?? []
    },
    sources
  };
  const outputPath =
    request.outputPath ??
    `knowledge/context-packs/${safePathSegment(request.kind)}-${shortHash(query)}.json`;
  const content = stableJson(pack);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "context-pack build"
  });
  return {
    outputPath: write.path,
    outputHash: contentHash(content),
    citationCount: pack.citations.length,
    sourceCount: pack.sources.length,
    write: summarizeWrite(write)
  };
}

export async function validateContextPack(
  request: ContextPackValidateRequest
): Promise<ContextPackValidateResult> {
  const issues: KnowledgeValidationIssue[] = [];
  const checked = [request.path];
  const artifact = await readJsonArtifact(request.workspacePath, request.path, issues);
  if (!isNovelFabricContextPack(artifact)) {
    issues.push({
      severity: "error",
      code: "invalid_context_pack",
      path: request.path,
      message: "Context pack artifact has an invalid shape."
    });
    return { valid: false, checked, issues };
  }

  for (const citation of artifact.citations) {
    checked.push(citation.sourcePath);
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: citation.sourcePath
      });
      if (read.hash !== citation.hash) {
        issues.push({
          severity: "error",
          code: "context_pack_source_hash_mismatch",
          path: citation.sourcePath,
          message: `Citation source '${citation.sourcePath}' changed after the context pack was built.`
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "context_pack_source_missing",
        path: citation.sourcePath,
        message:
          error instanceof Error
            ? error.message
            : `Citation source '${citation.sourcePath}' is unavailable.`
      });
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues
  };
}

async function discoverKnowledgeSourcePaths(workspacePath: string): Promise<readonly string[]> {
  const paths = new Set<string>();
  for (const sourcePath of SOURCE_SINGLE_PATHS) {
    try {
      const read = await readWorkspaceFile({ workspacePath, path: sourcePath });
      if (isIndexablePath(read.path)) paths.add(read.path);
    } catch (error) {
      if (!isCommandFailureCode(error, "file_not_found")) throw error;
    }
  }

  for (const directory of SOURCE_DIRECTORIES) {
    try {
      const result = await globWorkspaceFiles({ workspacePath, base: directory, pattern: "**/*" });
      for (const match of result.matches) {
        if (match.kind === "file" && isIndexablePath(match.path)) paths.add(match.path);
      }
    } catch (error) {
      if (
        !isCommandFailureCode(error, "file_not_found") &&
        !isCommandFailureCode(error, "not_a_directory")
      ) {
        throw error;
      }
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

async function readKnowledgeDocuments(workspacePath: string): Promise<readonly SourceDocument[]> {
  const sourceList = await listKnowledgeSources({ workspacePath });
  return Promise.all(
    sourceList.sources.map(async (source): Promise<SourceDocument> => {
      const read = await readWorkspaceFile({ workspacePath, path: source.path });
      return { ...source, content: read.content };
    })
  );
}

function sourceFromDocument(document: SourceDocument): KnowledgeSource {
  return {
    path: document.path,
    kind: document.kind,
    title: document.title,
    hash: document.hash,
    bytes: document.bytes,
    lineCount: document.lineCount,
    protected: document.protected
  };
}

function buildKnowledgeGraph(documents: readonly SourceDocument[]): {
  readonly nodes: readonly KnowledgeGraphNode[];
  readonly edges: readonly KnowledgeGraphEdge[];
  readonly episodes: readonly KnowledgeGraphEpisode[];
} {
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  const episodes: KnowledgeGraphEpisode[] = [];

  for (const document of documents) {
    const documentId = documentNodeId(document.path);
    nodes.set(documentId, {
      id: documentId,
      kind: "document",
      label: document.title,
      sourcePath: document.path,
      hash: document.hash
    });

    const documentEpisodes = buildEpisodesForDocument(document);
    for (const episode of documentEpisodes) {
      episodes.push(episode);
      nodes.set(episode.id, {
        id: episode.id,
        kind: "episode",
        label: episode.title,
        sourcePath: document.path,
        hash: episode.hash,
        citation: episode.citation
      });
      const containsEdge: KnowledgeGraphEdge = {
        id: edgeId(documentId, episode.id, "contains", episode.citation.lineRange.start),
        kind: "contains",
        from: documentId,
        to: episode.id,
        sourcePath: document.path,
        citation: episode.citation
      };
      edges.set(containsEdge.id, containsEdge);

      const entityLabels = extractEntities(episode.excerpt);
      for (const label of entityLabels) {
        const entityId = entityNodeId(label);
        nodes.set(entityId, { id: entityId, kind: "entity", label });
        const mentionsEdge: KnowledgeGraphEdge = {
          id: edgeId(episode.id, entityId, "mentions", episode.citation.lineRange.start),
          kind: "mentions",
          from: episode.id,
          to: entityId,
          sourcePath: document.path,
          citation: episode.citation
        };
        edges.set(mentionsEdge.id, mentionsEdge);
      }

      for (const pair of adjacentPairs(entityLabels.slice(0, 5))) {
        const firstId = entityNodeId(pair[0]);
        const secondId = entityNodeId(pair[1]);
        const coOccursEdge: KnowledgeGraphEdge = {
          id: edgeId(firstId, secondId, "co_occurs", episode.citation.lineRange.start),
          kind: "co_occurs",
          from: firstId,
          to: secondId,
          sourcePath: document.path,
          citation: episode.citation
        };
        edges.set(coOccursEdge.id, coOccursEdge);
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id, "en-US")),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id, "en-US")),
    episodes: episodes.sort((left, right) => {
      const pathCompare = left.sourcePath.localeCompare(right.sourcePath, "zh-Hans-CN");
      return pathCompare === 0 ? left.ordinal - right.ordinal : pathCompare;
    })
  };
}

function buildEpisodesForDocument(document: SourceDocument): readonly KnowledgeGraphEpisode[] {
  const headings = findHeadings(document.content);
  const spans = headings.length === 0 ? fallbackHeadingSpans(document) : headings;
  return spans.map((span, index) => {
    const next = spans[index + 1];
    const start = span.charStart;
    const end = next === undefined ? document.content.length : next.charStart;
    const content = document.content.slice(start, end).trim();
    const lineStart = span.line;
    const lineEnd =
      next === undefined ? countLines(document.content) : Math.max(lineStart, next.line - 1);
    const excerpt = makeExcerpt(content);
    const citation: KnowledgeCitation = {
      sourcePath: document.path,
      hash: document.hash,
      lineRange: { start: lineStart, end: lineEnd },
      excerpt
    };
    return {
      id: episodeNodeId(document.path, start, end, span.title),
      sourcePath: document.path,
      title: span.title,
      ordinal: index + 1,
      charRange: { start, end },
      lineRange: { start: lineStart, end: lineEnd },
      hash: contentHash(content),
      excerpt,
      citation
    };
  });
}

function findHeadings(content: string): readonly HeadingSpan[] {
  const headings: HeadingSpan[] = [];
  let offset = 0;
  let lineNumber = 1;
  for (const line of content.split(/\n/)) {
    const trimmed = line.trim();
    const markdown = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    const chineseChapter =
      /^(序章|楔子|尾声|第[一二三四五六七八九十百千万零〇0-9]+[章节卷部幕回集].*)$/.exec(trimmed);
    const title = markdown?.[2] ?? chineseChapter?.[1];
    if (title !== undefined && title.trim().length > 0) {
      headings.push({ line: lineNumber, charStart: offset, title: title.trim() });
    }
    offset += line.length + 1;
    lineNumber += 1;
  }
  return headings;
}

function fallbackHeadingSpans(document: SourceDocument): readonly HeadingSpan[] {
  return [{ line: 1, charStart: 0, title: document.title }];
}

function scoreDocument(
  document: SourceDocument,
  expandedQuery: readonly string[]
): RecallHit | null {
  const lowerContent = document.content.toLocaleLowerCase();
  const matchedTerms = expandedQuery.filter((term) =>
    lowerContent.includes(term.toLocaleLowerCase())
  );
  if (matchedTerms.length === 0) return null;
  const earliest = Math.min(
    ...matchedTerms.map((term) => {
      const index = lowerContent.indexOf(term.toLocaleLowerCase());
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    })
  );
  const excerptStart = Math.max(0, earliest - 80);
  const excerptEnd = Math.min(document.content.length, excerptStart + EXCERPT_CHARS);
  const lineRange = lineRangeForCharRange(document.content, excerptStart, excerptEnd);
  const citation: KnowledgeCitation = {
    sourcePath: document.path,
    hash: document.hash,
    lineRange,
    excerpt: makeExcerpt(document.content.slice(excerptStart, excerptEnd))
  };
  const density = matchedTerms.reduce(
    (sum, term) => sum + countOccurrences(lowerContent, term.toLocaleLowerCase()),
    0
  );
  return {
    sourcePath: document.path,
    score: density * 10 + matchedTerms.length,
    matchedTerms,
    citation
  };
}

function prioritizeTimelineHits(
  hits: readonly RecallHit[],
  timeline: string | undefined
): readonly RecallHit[] {
  const normalizedTimeline = timeline ?? "main";
  return [...hits].sort((left, right) => {
    const leftTimeline =
      left.sourcePath.includes(`timeline/${normalizedTimeline}`) ||
      left.sourcePath.includes("timeline/");
    const rightTimeline =
      right.sourcePath.includes(`timeline/${normalizedTimeline}`) ||
      right.sourcePath.includes("timeline/");
    if (leftTimeline !== rightTimeline) return leftTimeline ? -1 : 1;
    return compareRecallHits(left, right);
  });
}

function buildRecallInsights(
  documents: readonly SourceDocument[],
  hits: readonly RecallHit[],
  expandedQuery: readonly string[]
): readonly RecallInsight[] {
  const hitCitations = hits.slice(0, 3).map((hit) => hit.citation);
  const matchedPaths = new Set(hits.map((hit) => hit.sourcePath));
  const recurringTerms = expandedQuery.filter(
    (term) => hits.filter((hit) => hit.matchedTerms.includes(term)).length > 1
  );
  return [
    {
      code: "source_diversity",
      message: `${matchedPaths.size.toString()} of ${documents.length.toString()} indexed sources matched the deterministic query expansion.`,
      citations: hitCitations
    },
    {
      code: "recurring_terms",
      message:
        recurringTerms.length === 0
          ? "No query term recurred across multiple sources."
          : `Recurring query terms: ${recurringTerms.join(", ")}.`,
      citations: hitCitations
    }
  ];
}

function contextPackQuery(request: ContextPackBuildRequest): string {
  const pieces = [
    request.query,
    request.kind,
    request.agent,
    request.session,
    request.timeline
  ].filter((piece): piece is string => piece !== undefined && piece.trim().length > 0);
  if (pieces.length === 0) {
    throw new CommandFailure(
      "invalid_context_pack_input",
      "Context pack build requires a non-empty kind or query."
    );
  }
  return pieces.join(" ");
}

function expandQueryTerms(query: string): readonly string[] {
  const rawTerms = extractSearchTerms(query);
  const expanded = new Set<string>(rawTerms);
  for (const term of rawTerms) {
    if (/^[\p{Script=Han}]{3,}$/u.test(term)) {
      for (let index = 0; index < term.length - 1; index += 1) {
        expanded.add(term.slice(index, index + 2));
      }
    }
    if (term.includes("-")) {
      for (const part of term.split("-")) {
        if (part.length >= 2) expanded.add(part);
      }
    }
  }
  return [...expanded].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function extractSearchTerms(text: string): readonly string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/[\p{Script=Han}]{2,}|[A-Za-z0-9_-]{2,}/gu)) {
    const raw = match[0];
    const normalized = /^[\p{Script=Han}]+$/u.test(raw) ? raw : raw.toLocaleLowerCase();
    if (isUsefulTerm(normalized)) terms.add(normalized);
  }
  return [...terms];
}

function extractEntities(text: string): readonly string[] {
  const entities = new Set<string>();
  for (const match of text.matchAll(/[\p{Script=Han}]{2,8}|\b[A-Z][A-Za-z0-9_-]{2,}\b/gu)) {
    const raw = match[0];
    const normalized = /^[\p{Script=Han}]+$/u.test(raw) ? raw : raw.trim();
    if (isUsefulTerm(normalized)) entities.add(normalized);
    if (entities.size >= MAX_ENTITY_COUNT_PER_EPISODE) break;
  }
  return [...entities].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function isUsefulTerm(term: string): boolean {
  if (term.length < 2) return false;
  if (CHINESE_STOP_TERMS.has(term)) return false;
  if (LATIN_STOP_TERMS.has(term.toLocaleLowerCase())) return false;
  return true;
}

function lineRangeForCharRange(content: string, start: number, end: number): SourceRange {
  let line = 1;
  let startLine = 1;
  let endLine = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (index === start) startLine = line;
    if (index === end) {
      endLine = line;
      break;
    }
    if (content[index] === "\n") line += 1;
    endLine = line;
  }
  return { start: startLine, end: Math.max(startLine, endLine) };
}

function compareRecallHits(left: RecallHit, right: RecallHit): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.sourcePath.localeCompare(right.sourcePath, "zh-Hans-CN");
}

function uniqueCitations(citations: readonly KnowledgeCitation[]): readonly KnowledgeCitation[] {
  const seen = new Set<string>();
  const unique: KnowledgeCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.sourcePath}:${citation.lineRange.start.toString()}:${citation.lineRange.end.toString()}:${citation.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  return unique;
}

function adjacentPairs(values: readonly string[]): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  for (let index = 0; index < values.length - 1; index += 1) {
    const first = values[index];
    const second = values[index + 1];
    if (first !== undefined && second !== undefined) pairs.push([first, second]);
  }
  return pairs;
}

function isIndexablePath(sourcePath: string): boolean {
  if (sourcePath.endsWith("/.gitkeep") || sourcePath === ".gitkeep") return false;
  if (sourcePath.startsWith("knowledge/")) return false;
  if (sourcePath.startsWith(".novelfabric/")) return false;
  const extension = extensionForPath(sourcePath);
  return SOURCE_EXTENSIONS.has(extension);
}

function sourceKindForPath(sourcePath: string): KnowledgeSourceKind {
  const extension = extensionForPath(sourcePath);
  if (extension === ".md") return "markdown";
  if (extension === ".json") return "json";
  if (extension === ".jsonl") return "jsonl";
  if (extension === ".toml") return "toml";
  return "text";
}

function titleForDocument(sourcePath: string, content: string): string {
  if (sourcePath.endsWith(".json")) {
    const jsonTitle = titleFromJson(content);
    if (jsonTitle !== null) return jsonTitle;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^#{1,6}\s+/, "");
    if (trimmed.length > 0) return trimmed.slice(0, 80);
  }
  return sourcePath.split("/").at(-1) ?? sourcePath;
}

function titleFromJson(content: string): string | null {
  try {
    const value: unknown = JSON.parse(content);
    if (isRecord(value)) {
      const title = value["title"] ?? value["name"] ?? value["projectName"];
      if (typeof title === "string" && title.trim().length > 0) return title.trim().slice(0, 80);
    }
  } catch {
    return null;
  }
  return null;
}

function makeExcerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\n/).length;
}

function countOccurrences(content: string, term: string): number {
  if (term.length === 0) return 0;
  let count = 0;
  let index = content.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

function extensionForPath(sourcePath: string): string {
  const lastSegment = sourcePath.split("/").at(-1) ?? sourcePath;
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex === -1 ? "" : lastSegment.slice(dotIndex).toLocaleLowerCase();
}

function normalizePositiveLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CommandFailure("invalid_limit", "Limit must be an integer from 1 to 100.");
  }
  return limit;
}

function documentNodeId(sourcePath: string): string {
  return `doc:${shortHash(sourcePath)}`;
}

function episodeNodeId(sourcePath: string, start: number, end: number, title: string): string {
  return `episode:${shortHash(`${sourcePath}:${start.toString()}:${end.toString()}:${title}`)}`;
}

function entityNodeId(label: string): string {
  return `entity:${shortHash(label)}`;
}

function edgeId(from: string, to: string, kind: KnowledgeGraphEdgeKind, line: number): string {
  return `edge:${shortHash(`${from}:${to}:${kind}:${line.toString()}`)}`;
}

function shortHash(value: string): string {
  return contentHash(value).slice("sha256:".length, "sha256:".length + 16);
}

function safePathSegment(value: string): string {
  const segment = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment.length === 0 ? "context" : segment.slice(0, 80);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function summarizeWrite(write: WorkspaceFileWriteResult): KnowledgeWriteSummary {
  return {
    path: write.path,
    hash: write.hash,
    bytes: write.bytes,
    auditPath: write.auditPath
  };
}

async function readJsonArtifact(
  workspacePath: string,
  artifactPath: string,
  issues: KnowledgeValidationIssue[]
): Promise<unknown> {
  try {
    return await readRequiredJsonArtifact(workspacePath, artifactPath);
  } catch (error) {
    issues.push({
      severity: "error",
      code: isCommandFailureCode(error, "file_not_found")
        ? "knowledge_artifact_missing"
        : "knowledge_artifact_invalid",
      path: artifactPath,
      message: error instanceof Error ? error.message : `Could not read '${artifactPath}'.`
    });
    return null;
  }
}

async function readRequiredJsonArtifact(
  workspacePath: string,
  artifactPath: string
): Promise<unknown> {
  const read = await readWorkspaceFile({ workspacePath, path: artifactPath });
  try {
    return JSON.parse(read.content) as unknown;
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_artifact",
      error instanceof Error ? error.message : `Artifact '${artifactPath}' is not valid JSON.`
    );
  }
}

function isKnowledgeSourcesArtifact(value: unknown): value is KnowledgeSourcesArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.knowledge.sources" &&
    value["version"] === 1 &&
    Array.isArray(value["sources"]) &&
    value["sources"].every(isKnowledgeSource)
  );
}

function isKnowledgeGraphNodesArtifact(value: unknown): value is KnowledgeGraphNodesArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.knowledge.graph.nodes" &&
    value["version"] === 1 &&
    Array.isArray(value["nodes"]) &&
    value["nodes"].every(isKnowledgeGraphNode)
  );
}

function isKnowledgeGraphEdgesArtifact(value: unknown): value is KnowledgeGraphEdgesArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.knowledge.graph.edges" &&
    value["version"] === 1 &&
    Array.isArray(value["edges"]) &&
    value["edges"].every(isKnowledgeGraphEdge)
  );
}

function isKnowledgeGraphEpisodesArtifact(value: unknown): value is KnowledgeGraphEpisodesArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.knowledge.graph.episodes" &&
    value["version"] === 1 &&
    Array.isArray(value["episodes"]) &&
    value["episodes"].every(isKnowledgeGraphEpisode)
  );
}

function isNovelFabricContextPack(value: unknown): value is NovelFabricContextPack {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.context-pack" &&
    value["version"] === 1 &&
    typeof value["packKind"] === "string" &&
    typeof value["query"] === "string" &&
    Array.isArray(value["citations"]) &&
    value["citations"].every(isKnowledgeCitation) &&
    Array.isArray(value["sources"]) &&
    value["sources"].every(isKnowledgeSource) &&
    isRecord(value["recall"])
  );
}

function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    typeof value["kind"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["hash"] === "string" &&
    typeof value["bytes"] === "number" &&
    typeof value["lineCount"] === "number" &&
    typeof value["protected"] === "boolean"
  );
}

function isKnowledgeGraphNode(value: unknown): value is KnowledgeGraphNode {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["kind"] === "string" &&
    typeof value["label"] === "string"
  );
}

function isKnowledgeGraphEdge(value: unknown): value is KnowledgeGraphEdge {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["kind"] === "string" &&
    typeof value["from"] === "string" &&
    typeof value["to"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    isKnowledgeCitation(value["citation"])
  );
}

function isKnowledgeGraphEpisode(value: unknown): value is KnowledgeGraphEpisode {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["title"] === "string" &&
    typeof value["ordinal"] === "number" &&
    typeof value["hash"] === "string" &&
    typeof value["excerpt"] === "string" &&
    isKnowledgeCitation(value["citation"])
  );
}

function isKnowledgeCitation(value: unknown): value is KnowledgeCitation {
  return (
    isRecord(value) &&
    typeof value["sourcePath"] === "string" &&
    typeof value["hash"] === "string" &&
    isSourceRange(value["lineRange"]) &&
    typeof value["excerpt"] === "string"
  );
}

function isSourceRange(value: unknown): value is SourceRange {
  return isRecord(value) && typeof value["start"] === "number" && typeof value["end"] === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandFailureCode(error: unknown, code: string): boolean {
  return error instanceof CommandFailure && error.code === code;
}
