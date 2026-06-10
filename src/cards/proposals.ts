import { CommandFailure } from "../errors.js";
import { actorHasCapability, readCapabilityManifest } from "../workspace/capabilities.js";
import {
  contentHash,
  globWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";
import type { KnowledgeCitation, NovelFabricContextPack } from "../knowledge/index.js";

export type CardKind = "character" | "scene" | "world" | "rule";

export type CardSummary = {
  readonly path: string;
  readonly kind: CardKind;
  readonly title: string;
  readonly hash: string;
  readonly bytes: number;
  readonly protected: boolean;
};

export type CardsListRequest = {
  readonly workspacePath: string;
  readonly kind?: CardKind;
};

export type CardsListResult = {
  readonly kind: CardKind | "all";
  readonly cards: readonly CardSummary[];
  readonly cardCount: number;
};

export type CardsReadRequest = {
  readonly workspacePath: string;
  readonly path: string;
};

export type CardsReadResult = CardSummary & {
  readonly content: string;
};

export type CardsProposeRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly contextPackPath?: string;
  readonly content?: string;
  readonly citations?: readonly string[];
  readonly kind?: CardKind;
  readonly title?: string;
  readonly targetPath?: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type CardsProposeResult = {
  readonly proposalPath: string;
  readonly proposalHash: string;
  readonly cardCount: number;
  readonly citationCount: number;
  readonly write: ProposalWriteSummary;
};

export type CardsValidateRequest = {
  readonly workspacePath: string;
  readonly proposalPath: string;
};

export type CardsValidateResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly ProposalValidationIssue[];
  readonly cardCount: number;
};

export type CardsApplyRequest = {
  readonly workspacePath: string;
  readonly proposalPath: string;
  readonly actor: string;
  readonly reason?: string;
};

export type CardsApplyResult = {
  readonly proposalPath: string;
  readonly applied: readonly CardApplyWrite[];
  readonly appliedCount: number;
};

export type CardApplyWrite = ProposalWriteSummary & {
  readonly kind: CardKind;
  readonly title: string;
};

export type ProposalValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type CardProposalArtifact = {
  readonly kind: "novelfabric.cards.proposal";
  readonly version: 1;
  readonly actor: string;
  readonly createdAt: string;
  readonly sourceContextPack: string | null;
  readonly cards: readonly ProposedCard[];
};

export type ProposedCard = {
  readonly kind: CardKind;
  readonly title: string;
  readonly targetPath: string;
  readonly content: string;
  readonly citations: readonly KnowledgeCitation[];
};

type ProposalWriteSummary = Pick<WorkspaceFileWriteResult, "path" | "hash" | "bytes" | "auditPath">;

const CARD_DIRECTORIES = {
  character: "cards/characters",
  scene: "cards/scenes",
  world: "cards/world",
  rule: "cards/rules"
} as const satisfies Record<CardKind, string>;

const CARD_PROPOSE_CAPABILITY = "cards.propose";
const CARD_APPLY_CAPABILITY = "cards.apply";

export async function listCards(request: CardsListRequest): Promise<CardsListResult> {
  const kinds = request.kind === undefined ? cardKinds() : [request.kind];
  const cards: CardSummary[] = [];
  for (const kind of kinds) {
    const glob = await globWorkspaceFiles({
      workspacePath: request.workspacePath,
      base: CARD_DIRECTORIES[kind],
      pattern: "**/*.md"
    }).catch((error: unknown) => {
      if (
        isCommandFailureCode(error, "file_not_found") ||
        isCommandFailureCode(error, "not_a_directory")
      ) {
        return { matches: [] } as const;
      }
      throw error;
    });
    for (const match of glob.matches) {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: match.path
      });
      cards.push(summaryFromRead(read, kind));
    }
  }
  return {
    kind: request.kind ?? "all",
    cards: cards.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN")),
    cardCount: cards.length
  };
}

export async function readCard(request: CardsReadRequest): Promise<CardsReadResult> {
  const kind = cardKindForPath(request.path);
  if (kind === null) {
    throw new CommandFailure(
      "invalid_card_path",
      `Card path '${request.path}' must be under cards/.`
    );
  }
  const read = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.path
  });
  return { ...summaryFromRead(read, kind), content: read.content };
}

export async function proposeCards(request: CardsProposeRequest): Promise<CardsProposeResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [CARD_PROPOSE_CAPABILITY]);
  const contextPack =
    request.contextPackPath === undefined
      ? null
      : await readContextPack(request.workspacePath, request.contextPackPath);
  const citations = await resolveCitations({
    workspacePath: request.workspacePath,
    contextPack,
    explicitCitationPaths: request.citations ?? []
  });
  if (citations.length === 0) {
    throw new CommandFailure(
      "proposal_missing_citation",
      "Card proposals require at least one citation from --context-pack or --citation."
    );
  }

  const proposalCards = [singleProposedCard(request, contextPack, citations)];
  const proposal: CardProposalArtifact = {
    kind: "novelfabric.cards.proposal",
    version: 1,
    actor: request.actor,
    createdAt: new Date().toISOString(),
    sourceContextPack: request.contextPackPath ?? null,
    cards: proposalCards
  };
  const serialized = stableJson(proposal);
  const outputPath = request.outputPath ?? `proposals/cards/card-${shortHash(serialized)}.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: serialized,
    actor: request.actor,
    reason: request.reason ?? "cards propose",
    authorizedCapability: CARD_PROPOSE_CAPABILITY
  });
  return {
    proposalPath: write.path,
    proposalHash: contentHash(serialized),
    cardCount: proposal.cards.length,
    citationCount: citations.length,
    write: summarizeWrite(write)
  };
}

export async function validateCardProposal(
  request: CardsValidateRequest
): Promise<CardsValidateResult> {
  const issues: ProposalValidationIssue[] = [];
  const checked = [request.proposalPath];
  const proposal = await readCardProposal(request.workspacePath, request.proposalPath, issues);
  if (proposal === null) return { valid: false, checked, issues, cardCount: 0 };
  for (const card of proposal.cards) {
    const targetKind = cardKindForPath(card.targetPath);
    if (targetKind === null || targetKind !== card.kind) {
      issues.push({
        severity: "error",
        code: "invalid_card_target",
        path: card.targetPath,
        message: `Card target '${card.targetPath}' does not match card kind '${card.kind}'.`
      });
    }
    if (card.citations.length === 0) {
      issues.push({
        severity: "error",
        code: "proposal_missing_citation",
        path: card.targetPath,
        message: "Card proposal entries require at least one citation."
      });
    }
    await validateCitations(request.workspacePath, card.citations, checked, issues);
  }
  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues,
    cardCount: proposal.cards.length
  };
}

export async function applyCardProposal(request: CardsApplyRequest): Promise<CardsApplyResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [CARD_APPLY_CAPABILITY]);
  const validation = await validateCardProposal({
    workspacePath: request.workspacePath,
    proposalPath: request.proposalPath
  });
  if (!validation.valid) {
    throw new CommandFailure(
      "invalid_card_proposal",
      `Card proposal '${request.proposalPath}' failed validation.`
    );
  }
  const proposal = await readCardProposal(request.workspacePath, request.proposalPath, []);
  if (proposal === null) {
    throw new CommandFailure(
      "invalid_card_proposal",
      `Card proposal '${request.proposalPath}' is invalid.`
    );
  }
  const applied: CardApplyWrite[] = [];
  for (const card of proposal.cards) {
    const write = await writeWorkspaceFile({
      workspacePath: request.workspacePath,
      path: card.targetPath,
      content: card.content,
      actor: request.actor,
      reason: request.reason ?? `cards apply ${request.proposalPath}`,
      authorizedCapability: CARD_APPLY_CAPABILITY
    });
    applied.push({ ...summarizeWrite(write), kind: card.kind, title: card.title });
  }
  return { proposalPath: request.proposalPath, applied, appliedCount: applied.length };
}

function singleProposedCard(
  request: CardsProposeRequest,
  contextPack: NovelFabricContextPack | null,
  citations: readonly KnowledgeCitation[]
): ProposedCard {
  const cardKind = request.kind ?? cardKindFromContextPack(contextPack) ?? "world";
  const title = normalizeTitle(
    request.title ?? titleFromContextPack(contextPack) ?? "Workspace Card"
  );
  const targetPath =
    request.targetPath ?? `${CARD_DIRECTORIES[cardKind]}/${safePathSegment(title)}.md`;
  assertCardTarget(targetPath, cardKind);
  const content = request.content ?? deterministicCardContent(cardKind, title, citations);
  return { kind: cardKind, title, targetPath, content, citations };
}

function summaryFromRead(read: WorkspaceFileReadResult, kind: CardKind): CardSummary {
  return {
    path: read.path,
    kind,
    title: markdownTitle(read.content) ?? titleFromPath(read.path),
    hash: read.hash,
    bytes: read.bytes,
    protected: read.protected
  };
}

async function readContextPack(
  workspacePath: string,
  contextPackPath: string
): Promise<NovelFabricContextPack> {
  const read = await readWorkspaceFile({ workspacePath, path: contextPackPath });
  const parsed = parseJson(read.content, contextPackPath);
  if (!isContextPack(parsed)) {
    throw new CommandFailure(
      "invalid_context_pack",
      `Context pack '${contextPackPath}' has an invalid shape.`
    );
  }
  return parsed;
}

async function readCardProposal(
  workspacePath: string,
  proposalPath: string,
  issues: ProposalValidationIssue[]
): Promise<CardProposalArtifact | null> {
  try {
    const read = await readWorkspaceFile({ workspacePath, path: proposalPath });
    const parsed = parseJson(read.content, proposalPath);
    if (!isCardProposal(parsed)) {
      issues.push({
        severity: "error",
        code: "invalid_card_proposal_shape",
        path: proposalPath,
        message: "Card proposal artifact has an invalid shape."
      });
      return null;
    }
    return parsed;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "card_proposal_unreadable",
      path: proposalPath,
      message: error instanceof Error ? error.message : `Cannot read '${proposalPath}'.`
    });
    return null;
  }
}

async function resolveCitations(request: {
  readonly workspacePath: string;
  readonly contextPack: NovelFabricContextPack | null;
  readonly explicitCitationPaths: readonly string[];
}): Promise<readonly KnowledgeCitation[]> {
  const citations = new Map<string, KnowledgeCitation>();
  for (const citation of request.contextPack?.citations ?? []) {
    citations.set(citationKey(citation), citation);
  }
  for (const sourcePath of request.explicitCitationPaths) {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: sourcePath
    });
    const lines = read.content.split(/\r?\n/);
    const excerptLines = lines.slice(0, 3);
    const citation: KnowledgeCitation = {
      sourcePath: read.path,
      hash: read.hash,
      lineRange: { start: 1, end: Math.max(1, excerptLines.length) },
      excerpt: excerptLines.join("\n").slice(0, 500)
    };
    citations.set(citationKey(citation), citation);
  }
  return [...citations.values()];
}

async function validateCitations(
  workspacePath: string,
  citations: readonly KnowledgeCitation[],
  checked: string[],
  issues: ProposalValidationIssue[]
): Promise<void> {
  for (const citation of citations) {
    checked.push(citation.sourcePath);
    try {
      const current = await readWorkspaceFile({ workspacePath, path: citation.sourcePath });
      if (current.hash !== citation.hash) {
        issues.push({
          severity: "error",
          code: "citation_hash_mismatch",
          path: citation.sourcePath,
          message: `Citation source '${citation.sourcePath}' changed after proposal creation.`
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "citation_source_missing",
        path: citation.sourcePath,
        message:
          error instanceof Error
            ? error.message
            : `Citation source '${citation.sourcePath}' is unavailable.`
      });
    }
  }
}

async function requireAnyCapability(
  workspacePath: string,
  actor: string,
  capabilities: readonly string[]
): Promise<void> {
  const manifest = await readCapabilityManifest(workspacePath);
  if (capabilities.some((capability) => actorHasCapability(manifest, actor, capability))) return;
  throw new CommandFailure(
    "capability_denied",
    `Actor '${actor}' does not have any required capability: ${capabilities.join(", ")}.`,
    3
  );
}

function assertCardTarget(targetPath: string, kind: CardKind): void {
  const targetKind = cardKindForPath(targetPath);
  if (targetKind !== kind) {
    throw new CommandFailure(
      "invalid_card_target",
      `Card target '${targetPath}' must be under '${CARD_DIRECTORIES[kind]}'.`
    );
  }
}

function deterministicCardContent(
  kind: CardKind,
  title: string,
  citations: readonly KnowledgeCitation[]
): string {
  const citationLines = citations.map(
    (citation) =>
      `- ${citation.sourcePath}:${citation.lineRange.start.toString()}-${citation.lineRange.end.toString()}`
  );
  const excerpt = citations[0]?.excerpt.trim() ?? "";
  return (
    [
      `# ${title}`,
      "",
      `- card_kind: ${kind}`,
      "- status: proposed",
      "",
      "## Evidence",
      ...citationLines,
      "",
      "## Notes",
      excerpt
    ]
      .join("\n")
      .trimEnd() + "\n"
  );
}

function cardKindForPath(pathValue: string): CardKind | null {
  const normalized = normalizeWorkspacePath(pathValue);
  for (const kind of cardKinds()) {
    if (normalized.startsWith(`${CARD_DIRECTORIES[kind]}/`) && normalized.endsWith(".md")) {
      return kind;
    }
  }
  return null;
}

function cardKindFromContextPack(contextPack: NovelFabricContextPack | null): CardKind | null {
  const packKind = contextPack?.packKind.toLowerCase();
  if (packKind === undefined) return null;
  if (packKind.includes("character")) return "character";
  if (packKind.includes("scene")) return "scene";
  if (packKind.includes("rule")) return "rule";
  if (packKind.includes("world")) return "world";
  return null;
}

function titleFromContextPack(contextPack: NovelFabricContextPack | null): string | null {
  const query = contextPack?.query.trim();
  if (query === undefined || query.length === 0) return null;
  return query.split(/\s+/).slice(0, 8).join(" ");
}

function markdownTitle(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match !== null) return match[1]?.trim() ?? null;
  }
  return null;
}

function titleFromPath(pathValue: string): string {
  return pathValue.split("/").at(-1)?.replace(/\.md$/i, "") ?? pathValue;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "Workspace Card";
  return trimmed.slice(0, 120);
}

function safePathSegment(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe.length === 0 ? "card" : safe;
}

function shortHash(value: string): string {
  return contentHash(value).slice("sha256:".length, "sha256:".length + 12);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(content: string, sourcePath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_artifact",
      error instanceof Error
        ? `Invalid JSON in '${sourcePath}': ${error.message}`
        : `Invalid JSON in '${sourcePath}'.`
    );
  }
}

function summarizeWrite(write: WorkspaceFileWriteResult): ProposalWriteSummary {
  return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
}

function citationKey(citation: KnowledgeCitation): string {
  return `${citation.sourcePath}@${citation.hash}:${citation.lineRange.start.toString()}-${citation.lineRange.end.toString()}`;
}

function cardKinds(): readonly CardKind[] {
  return ["character", "scene", "world", "rule"];
}

function normalizeWorkspacePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isContextPack(value: unknown): value is NovelFabricContextPack {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.context-pack" &&
    value["version"] === 1 &&
    typeof value["packKind"] === "string" &&
    typeof value["query"] === "string" &&
    Array.isArray(value["citations"]) &&
    value["citations"].every(isKnowledgeCitation)
  );
}

function isCardProposal(value: unknown): value is CardProposalArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.cards.proposal" &&
    value["version"] === 1 &&
    typeof value["actor"] === "string" &&
    typeof value["createdAt"] === "string" &&
    Array.isArray(value["cards"]) &&
    value["cards"].every(isProposedCard)
  );
}

function isProposedCard(value: unknown): value is ProposedCard {
  return (
    isRecord(value) &&
    isCardKind(value["kind"]) &&
    typeof value["title"] === "string" &&
    typeof value["targetPath"] === "string" &&
    typeof value["content"] === "string" &&
    Array.isArray(value["citations"]) &&
    value["citations"].every(isKnowledgeCitation)
  );
}

function isKnowledgeCitation(value: unknown): value is KnowledgeCitation {
  return (
    isRecord(value) &&
    typeof value["sourcePath"] === "string" &&
    typeof value["hash"] === "string" &&
    isRecord(value["lineRange"]) &&
    typeof value["lineRange"]["start"] === "number" &&
    typeof value["lineRange"]["end"] === "number" &&
    typeof value["excerpt"] === "string"
  );
}

function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && cardKinds().includes(value as CardKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandFailureCode(error: unknown, code: string): boolean {
  return error instanceof CommandFailure && error.code === code;
}
