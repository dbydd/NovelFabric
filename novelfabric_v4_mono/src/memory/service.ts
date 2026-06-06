import { CommandFailure } from "../errors.js";
import { actorHasCapability, readCapabilityManifest } from "../workspace/capabilities.js";
import {
  appendWorkspaceFile,
  contentHash,
  globWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";
import type { KnowledgeCitation } from "../knowledge/index.js";

export type MemoryRecallRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly profile: string;
  readonly query: string;
  readonly limit?: number;
};

export type MemoryRecallResult = {
  readonly actor: string;
  readonly profile: string;
  readonly query: string;
  readonly results: readonly MemoryRecallHit[];
  readonly resultCount: number;
};

export type MemoryRecallHit = {
  readonly path: string;
  readonly score: number;
  readonly lineRange: { readonly start: number; readonly end: number };
  readonly excerpt: string;
  readonly hash: string;
};

export type MemoryAppendRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly profile: string;
  readonly content: string;
  readonly reason?: string;
};

export type MemoryAppendResult = ProposalWriteSummary & {
  readonly actor: string;
  readonly profile: string;
};

export type MemoryProposeSharedRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly content: string;
  readonly citations: readonly string[];
  readonly outputPath?: string;
  readonly reason?: string;
};

export type MemoryProposeSharedResult = {
  readonly proposalPath: string;
  readonly proposalHash: string;
  readonly citationCount: number;
  readonly write: ProposalWriteSummary;
};

export type MemoryApplyProposalRequest = {
  readonly workspacePath: string;
  readonly proposalPath: string;
  readonly actor: string;
  readonly targetPath?: string;
  readonly reason?: string;
};

export type MemoryApplyProposalResult = {
  readonly proposalPath: string;
  readonly targetPath: string;
  readonly write: ProposalWriteSummary;
};

export type MemoryValidateProposalRequest = {
  readonly workspacePath: string;
  readonly proposalPath: string;
};

export type MemoryValidateProposalResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly MemoryValidationIssue[];
};

export type MemoryValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type SharedMemoryProposalArtifact = {
  readonly kind: "novelfabric.memory.shared-proposal";
  readonly version: 1;
  readonly actor: string;
  readonly createdAt: string;
  readonly content: string;
  readonly citations: readonly KnowledgeCitation[];
};

type ProposalWriteSummary = Pick<WorkspaceFileWriteResult, "path" | "hash" | "bytes" | "auditPath">;

const MEMORY_RECALL_CAPABILITIES = ["memory.recall", "project.manage"] as const;
const MEMORY_APPEND_CAPABILITIES = ["memory.write_own", "project.manage"] as const;
const MEMORY_PROPOSE_SHARED_CAPABILITIES = ["memory.propose_shared", "project.manage"] as const;
const MEMORY_APPLY_SHARED_CAPABILITIES = ["memory.apply_shared", "project.manage"] as const;
const SHARED_MEMORY_PATH = "memory/global/shared.md";

export async function recallMemory(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
  await requireAnyCapability(request.workspacePath, request.actor, MEMORY_RECALL_CAPABILITIES);
  const queryTerms = tokenize(request.query);
  const candidates = await memorySearchPaths(request.workspacePath, request.profile);
  const hits: MemoryRecallHit[] = [];
  for (const sourcePath of candidates) {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: sourcePath
    });
    const lines = read.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const score = scoreText(line, queryTerms);
      if (score <= 0) continue;
      const start = Math.max(1, index + 1 - 1);
      const end = Math.min(lines.length, index + 1 + 1);
      hits.push({
        path: read.path,
        score,
        lineRange: { start, end },
        excerpt: lines.slice(start - 1, end).join("\n"),
        hash: read.hash
      });
    }
  }
  const limit = normalizeLimit(request.limit, 10);
  return {
    actor: request.actor,
    profile: request.profile,
    query: request.query,
    results: hits
      .sort(
        (left, right) =>
          right.score - left.score || left.path.localeCompare(right.path, "zh-Hans-CN")
      )
      .slice(0, limit),
    resultCount: Math.min(hits.length, limit)
  };
}

export async function appendMemory(request: MemoryAppendRequest): Promise<MemoryAppendResult> {
  await requireOwnMemoryCapability(request.workspacePath, request.actor, request.profile);
  const targetPath = `memory/agents/${safePathSegment(request.profile)}.md`;
  const entry = formatMemoryEntry(request.actor, request.content);
  const write = await appendWorkspaceFile({
    workspacePath: request.workspacePath,
    path: targetPath,
    content: entry,
    actor: request.actor,
    reason: request.reason ?? "memory append"
  });
  return { ...summarizeWrite(write), actor: request.actor, profile: request.profile };
}

export async function proposeSharedMemory(
  request: MemoryProposeSharedRequest
): Promise<MemoryProposeSharedResult> {
  await requireAnyCapability(
    request.workspacePath,
    request.actor,
    MEMORY_PROPOSE_SHARED_CAPABILITIES
  );
  const citations = await citationsFromPaths(request.workspacePath, request.citations);
  if (citations.length === 0) {
    throw new CommandFailure(
      "proposal_missing_citation",
      "Shared memory proposals require at least one --citation."
    );
  }
  const proposal: SharedMemoryProposalArtifact = {
    kind: "novelfabric.memory.shared-proposal",
    version: 1,
    actor: request.actor,
    createdAt: new Date().toISOString(),
    content: request.content,
    citations
  };
  const serialized = stableJson(proposal);
  const outputPath = request.outputPath ?? `proposals/memory/shared-${shortHash(serialized)}.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: serialized,
    actor: request.actor,
    reason: request.reason ?? "memory propose shared"
  });
  return {
    proposalPath: write.path,
    proposalHash: contentHash(serialized),
    citationCount: citations.length,
    write: summarizeWrite(write)
  };
}

export async function validateSharedMemoryProposal(
  request: MemoryValidateProposalRequest
): Promise<MemoryValidateProposalResult> {
  const issues: MemoryValidationIssue[] = [];
  const checked = [request.proposalPath];
  const proposal = await readSharedMemoryProposal(
    request.workspacePath,
    request.proposalPath,
    issues
  );
  if (proposal === null) return { valid: false, checked, issues };
  if (proposal.content.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "empty_memory_proposal",
      path: request.proposalPath,
      message: "Shared memory proposal content must not be empty."
    });
  }
  if (proposal.citations.length === 0) {
    issues.push({
      severity: "error",
      code: "proposal_missing_citation",
      path: request.proposalPath,
      message: "Shared memory proposals require citations."
    });
  }
  await validateCitations(request.workspacePath, proposal.citations, checked, issues);
  return { valid: issues.every((issue) => issue.severity !== "error"), checked, issues };
}

export async function applySharedMemoryProposal(
  request: MemoryApplyProposalRequest
): Promise<MemoryApplyProposalResult> {
  await requireAnyCapability(
    request.workspacePath,
    request.actor,
    MEMORY_APPLY_SHARED_CAPABILITIES
  );
  const validation = await validateSharedMemoryProposal({
    workspacePath: request.workspacePath,
    proposalPath: request.proposalPath
  });
  if (!validation.valid) {
    throw new CommandFailure(
      "invalid_memory_proposal",
      `Shared memory proposal '${request.proposalPath}' failed validation.`
    );
  }
  const proposal = await readSharedMemoryProposal(request.workspacePath, request.proposalPath, []);
  if (proposal === null) {
    throw new CommandFailure(
      "invalid_memory_proposal",
      `Shared memory proposal '${request.proposalPath}' is invalid.`
    );
  }
  const targetPath = request.targetPath ?? SHARED_MEMORY_PATH;
  if (!targetPath.startsWith("memory/global/") || !targetPath.endsWith(".md")) {
    throw new CommandFailure(
      "invalid_memory_target",
      `Shared memory target '${targetPath}' must be under memory/global/.`
    );
  }
  const write = await appendWorkspaceFile({
    workspacePath: request.workspacePath,
    path: targetPath,
    content: formatSharedMemoryEntry(proposal),
    actor: request.actor,
    reason: request.reason ?? `memory apply proposal ${request.proposalPath}`
  });
  return {
    proposalPath: request.proposalPath,
    targetPath: write.path,
    write: summarizeWrite(write)
  };
}

async function memorySearchPaths(
  workspacePath: string,
  profile: string
): Promise<readonly string[]> {
  const paths = new Set<string>();
  for (const base of ["memory/global", "memory/branches", "memory/chapters"]) {
    await addGlobbedMemoryPaths(workspacePath, base, paths);
  }
  await addGlobbedMemoryPaths(workspacePath, `memory/agents/${safePathSegment(profile)}`, paths);
  await addOptionalMemoryPath(workspacePath, `memory/agents/${safePathSegment(profile)}.md`, paths);
  return [...paths].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

async function addGlobbedMemoryPaths(
  workspacePath: string,
  base: string,
  paths: Set<string>
): Promise<void> {
  const glob = await globWorkspaceFiles({ workspacePath, base, pattern: "**/*.md" }).catch(
    (error: unknown) => {
      if (
        isCommandFailureCode(error, "file_not_found") ||
        isCommandFailureCode(error, "not_a_directory")
      ) {
        return { matches: [] } as const;
      }
      throw error;
    }
  );
  for (const match of glob.matches) {
    if (match.kind === "file") paths.add(match.path);
  }
}

async function addOptionalMemoryPath(
  workspacePath: string,
  sourcePath: string,
  paths: Set<string>
): Promise<void> {
  try {
    const read = await readWorkspaceFile({ workspacePath, path: sourcePath });
    paths.add(read.path);
  } catch (error) {
    if (!isCommandFailureCode(error, "file_not_found")) throw error;
  }
}

async function citationsFromPaths(
  workspacePath: string,
  sourcePaths: readonly string[]
): Promise<readonly KnowledgeCitation[]> {
  const citations: KnowledgeCitation[] = [];
  for (const sourcePath of sourcePaths) {
    const read = await readWorkspaceFile({ workspacePath, path: sourcePath });
    const lines = read.content.split(/\r?\n/);
    const excerptLines = lines.slice(0, 3);
    citations.push({
      sourcePath: read.path,
      hash: read.hash,
      lineRange: { start: 1, end: Math.max(1, excerptLines.length) },
      excerpt: excerptLines.join("\n").slice(0, 500)
    });
  }
  return citations;
}

async function validateCitations(
  workspacePath: string,
  citations: readonly KnowledgeCitation[],
  checked: string[],
  issues: MemoryValidationIssue[]
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

async function readSharedMemoryProposal(
  workspacePath: string,
  proposalPath: string,
  issues: MemoryValidationIssue[]
): Promise<SharedMemoryProposalArtifact | null> {
  try {
    const read = await readWorkspaceFile({ workspacePath, path: proposalPath });
    const parsed = parseJson(read.content, proposalPath);
    if (!isSharedMemoryProposal(parsed)) {
      issues.push({
        severity: "error",
        code: "invalid_memory_proposal_shape",
        path: proposalPath,
        message: "Shared memory proposal artifact has an invalid shape."
      });
      return null;
    }
    return parsed;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "memory_proposal_unreadable",
      path: proposalPath,
      message: error instanceof Error ? error.message : `Cannot read '${proposalPath}'.`
    });
    return null;
  }
}

async function requireOwnMemoryCapability(
  workspacePath: string,
  actor: string,
  profile: string
): Promise<void> {
  if (actor !== profile) {
    await requireAnyCapability(workspacePath, actor, ["project.manage"]);
    return;
  }
  await requireAnyCapability(workspacePath, actor, MEMORY_APPEND_CAPABILITIES);
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

function formatMemoryEntry(actor: string, content: string): string {
  const body = content.trimEnd();
  if (body.length === 0) {
    throw new CommandFailure("empty_memory_entry", "Memory append content must not be empty.");
  }
  return `\n## ${new Date().toISOString()} ${actor}\n\n${body}\n`;
}

function formatSharedMemoryEntry(proposal: SharedMemoryProposalArtifact): string {
  const citationLines = proposal.citations.map(
    (citation) =>
      `- ${citation.sourcePath}:${citation.lineRange.start.toString()}-${citation.lineRange.end.toString()}`
  );
  return [
    "",
    `## ${new Date().toISOString()} shared memory`,
    "",
    proposal.content.trimEnd(),
    "",
    "### Citations",
    ...citationLines,
    ""
  ].join("\n");
}

function tokenize(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 0);
}

function scoreText(text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const lowered = text.toLowerCase();
  return terms.reduce((score, term) => score + (lowered.includes(term) ? 1 : 0), 0);
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), 100);
}

function safePathSegment(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe.length === 0 ? "memory" : safe;
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

function isSharedMemoryProposal(value: unknown): value is SharedMemoryProposalArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.memory.shared-proposal" &&
    value["version"] === 1 &&
    typeof value["actor"] === "string" &&
    typeof value["createdAt"] === "string" &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandFailureCode(error: unknown, code: string): boolean {
  return error instanceof CommandFailure && error.code === code;
}
