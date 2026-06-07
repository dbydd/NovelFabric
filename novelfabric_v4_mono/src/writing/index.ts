import {
  assertSourceAnchorsGrounded,
  readCitationEvidence,
  readCompletedAgentTaskDomainOutput,
  requireMarkdownOutput,
  requireWorkflowOutputKind
} from "../agent-runtime/materialization.js";
import { CommandFailure } from "../errors.js";
import { actorHasCapability, readCapabilityManifest } from "../workspace/capabilities.js";
import {
  contentHash,
  globWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";

export type WritingContextPackRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly session: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type WritingContextPackResult = {
  readonly outputPath: string;
  readonly outputHash: string;
  readonly citationCount: number;
  readonly write: ArtifactWriteSummary;
};

export type WritingDraftRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly contextPackPath: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type WritingDraftResult = {
  readonly taskPath: string;
  readonly taskHash: string;
  readonly expectedDraftPath: string;
  readonly write: ArtifactWriteSummary;
};

export type WritingApplyDraftRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly draftPath: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type WritingApplyDraftResult = {
  readonly chapterPath: string;
  readonly chapterHash: string;
  readonly sourceDraftPath: string;
  readonly write: ArtifactWriteSummary;
};

export type WritingReviewRequest = {
  readonly workspacePath: string;
  readonly chapterPath: string;
};

export type WritingMaterializeFromAgentTaskRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly actor: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type WritingMaterializeFromAgentTaskResult = {
  readonly draftPath: string;
  readonly sourceTaskResultPath: string;
  readonly write: ArtifactWriteSummary;
};

export type WritingReviewResult = ValidationResult & {
  readonly chapterPath: string;
  readonly chapterHash?: string;
  readonly wordCount?: number;
};

export type WritingExportRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly format: "markdown";
  readonly outputPath?: string;
  readonly reason?: string;
};

export type WritingExportResult = {
  readonly exportPath: string;
  readonly exportHash: string;
  readonly chapterCount: number;
  readonly write: ArtifactWriteSummary;
};

export type ArtifactWriteSummary = Pick<
  WorkspaceFileWriteResult,
  "path" | "hash" | "bytes" | "auditPath"
>;

export type ValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type ValidationResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly ValidationIssue[];
};

export type ArtifactCitation = {
  readonly path: string;
  readonly hash?: string;
  readonly excerpt?: string;
};

export type NovelFabricWritingContextPack = {
  readonly kind: "novelfabric.writing.context-pack";
  readonly version: 1;
  readonly session: string;
  readonly citations: readonly ArtifactCitation[];
  readonly sourceExcerpt: string;
  readonly relevantEntities: readonly string[];
  readonly chapterPaths: readonly string[];
  readonly reportPaths: readonly string[];
  readonly simulationPaths: readonly string[];
};

export type NovelFabricWritingTask = {
  readonly kind: "novelfabric.writing.task";
  readonly version: 1;
  readonly taskId: string;
  readonly actor: string;
  readonly contextPackPath: string;
  readonly expectedDraftPath: string;
  readonly status: "pending-pi-runtime";
  readonly instructions: readonly string[];
  readonly requiredCapabilities: readonly string[];
};

export type NovelFabricWritingDraft = {
  readonly kind: "novelfabric.writing.draft";
  readonly version: 1;
  readonly title: string;
  readonly markdown: string;
  readonly citations: readonly ArtifactCitation[];
};

const WRITING_DRAFT_CAPABILITY = "writing.draft";
const WRITING_APPLY_CAPABILITY = "writing.apply";
const WRITING_EXPORT_CAPABILITY = "writing.export";

export async function buildWritingContextPack(
  request: WritingContextPackRequest
): Promise<WritingContextPackResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [WRITING_DRAFT_CAPABILITY]);
  const chapterPaths = await listMarkdownPaths(request.workspacePath, "writing/chapters");
  const reportPaths = await listMarkdownPaths(request.workspacePath, "reports");
  const simulationPaths = await listJsonLikePaths(request.workspacePath, "simulation");
  const citationPaths = [...chapterPaths, ...reportPaths, ...simulationPaths].slice(0, 40);
  const sourceExcerpts: string[] = [];
  const relevantEntityCandidates: string[] = [];
  const citations = await Promise.all(
    citationPaths.map(async (citationPath): Promise<ArtifactCitation> => {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: citationPath
      });
      collectSourceAnchorsFromArtifact(read.content, sourceExcerpts, relevantEntityCandidates);
      return {
        path: read.path,
        hash: read.hash,
        excerpt: structuredCitationExcerpt(read.content)
      };
    })
  );
  const sourceExcerpt = (
    sourceExcerpts.length > 0 ? sourceExcerpts : citations.map((citation) => citation.excerpt ?? "")
  )
    .filter((item) => item.length > 0)
    .join("\n")
    .slice(0, 500);
  const pack: NovelFabricWritingContextPack = {
    kind: "novelfabric.writing.context-pack",
    version: 1,
    session: request.session,
    citations,
    sourceExcerpt,
    relevantEntities:
      relevantEntityCandidates.length > 0
        ? [...new Set(relevantEntityCandidates)]
        : extractAnchors(sourceExcerpt.length > 0 ? sourceExcerpt : request.session),
    chapterPaths,
    reportPaths,
    simulationPaths
  };
  const outputPath =
    request.outputPath ?? `writing/context-packs/${safePathSegment(request.session)}.json`;
  const content = stableJson(pack);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "writing context-pack",
    authorizedCapability: WRITING_DRAFT_CAPABILITY
  });
  return {
    outputPath: write.path,
    outputHash: contentHash(content),
    citationCount: citations.length,
    write: summarizeWrite(write)
  };
}

export async function createWritingDraftTask(
  request: WritingDraftRequest
): Promise<WritingDraftResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [WRITING_DRAFT_CAPABILITY]);
  const contextPack = await readRequiredJsonArtifact(
    request.workspacePath,
    request.contextPackPath
  );
  if (!isWritingContextPack(contextPack)) {
    throw new CommandFailure(
      "invalid_writing_context_pack",
      "Writing draft requires a novelfabric.writing.context-pack artifact."
    );
  }
  const taskId = `writing-draft-${safePathSegment(contextPack.session)}-${shortHash(request.contextPackPath)}`;
  const expectedDraftPath =
    request.outputPath ??
    `writing/drafts/${safePathSegment(contextPack.session)}-${shortHash(taskId)}.json`;
  const task: NovelFabricWritingTask = {
    kind: "novelfabric.writing.task",
    version: 1,
    taskId,
    actor: request.actor,
    contextPackPath: request.contextPackPath,
    expectedDraftPath,
    status: "pending-pi-runtime",
    instructions: [
      "Use the NovelFabric wrapped pi runtime to produce a chapter draft artifact.",
      "Return a novelfabric.writing.draft JSON file with markdown and citations.",
      "Do not write chapters directly; run writing apply-draft after validation."
    ],
    requiredCapabilities: [WRITING_DRAFT_CAPABILITY]
  };
  const content = stableJson(task);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: `writing/drafts/tasks/${taskId}.json`,
    content,
    actor: request.actor,
    reason: request.reason ?? "writing draft task create",
    authorizedCapability: WRITING_DRAFT_CAPABILITY
  });
  return {
    taskPath: write.path,
    taskHash: contentHash(content),
    expectedDraftPath,
    write: summarizeWrite(write)
  };
}

export async function applyWritingDraft(
  request: WritingApplyDraftRequest
): Promise<WritingApplyDraftResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [WRITING_APPLY_CAPABILITY]);
  const validation = await validateDraftArtifact(request.workspacePath, request.draftPath);
  if (!validation.valid) {
    throw new CommandFailure("invalid_writing_draft", "Writing draft failed validation.");
  }
  const draft = await readRequiredJsonArtifact(request.workspacePath, request.draftPath);
  if (!isWritingDraft(draft)) {
    throw new CommandFailure("invalid_writing_draft", "Writing draft has an invalid shape.");
  }
  const outputPath =
    request.outputPath ??
    `writing/chapters/${safePathSegment(draft.title)}-${shortHash(draft.markdown)}.md`;
  const content = `${draft.markdown.trimEnd()}\n\n---\nsource_draft: ${request.draftPath}\n`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "writing apply-draft",
    authorizedCapability: WRITING_APPLY_CAPABILITY
  });
  return {
    chapterPath: write.path,
    chapterHash: contentHash(content),
    sourceDraftPath: request.draftPath,
    write: summarizeWrite(write)
  };
}

export async function materializeWritingDraftFromAgentTask(
  request: WritingMaterializeFromAgentTaskRequest
): Promise<WritingMaterializeFromAgentTaskResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [WRITING_DRAFT_CAPABILITY]);
  const output = await readCompletedAgentTaskDomainOutput({
    workspacePath: request.workspacePath,
    taskId: request.taskId
  });
  requireWorkflowOutputKind(output, "novelfabric.workflow.writing-output");
  const citationEvidence = await readCitationEvidence(request.workspacePath, output.citations);
  assertSourceAnchorsGrounded(output.sourceAnchors, citationEvidence, output.resultPath);
  const markdown = requireMarkdownOutput(output, "Writing draft markdown");
  const draft: NovelFabricWritingDraft = {
    kind: "novelfabric.writing.draft",
    version: 1,
    title: output.title ?? `Draft ${shortHash(output.resultHash)}`,
    markdown: `${markdown}\n\n## Source anchors\n${output.sourceAnchors.map((anchor) => `- ${anchor}`).join("\n")}`,
    citations: [{ path: output.resultPath, hash: output.resultHash }, ...citationEvidence]
  };
  const draftPath =
    request.outputPath ??
    `writing/drafts/${safePathSegment(draft.title)}-${shortHash(output.resultHash)}.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: draftPath,
    content: stableJson(draft),
    actor: request.actor,
    reason: request.reason ?? "writing materialize from agent task",
    authorizedCapability: WRITING_DRAFT_CAPABILITY
  });
  return {
    draftPath: write.path,
    sourceTaskResultPath: output.resultPath,
    write: summarizeWrite(write)
  };
}

export async function validateWritingDraftArtifact(
  workspacePath: string,
  draftPath: string
): Promise<ValidationResult> {
  return validateDraftArtifact(workspacePath, draftPath);
}

export async function reviewChapter(request: WritingReviewRequest): Promise<WritingReviewResult> {
  const issues: ValidationIssue[] = [];
  const checked = [request.chapterPath];
  let read;
  try {
    read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: request.chapterPath
    });
  } catch (error) {
    issues.push({
      severity: "error",
      code: "chapter_unreadable",
      path: request.chapterPath,
      message: error instanceof Error ? error.message : `Could not read '${request.chapterPath}'.`
    });
    return { valid: false, checked, issues, chapterPath: request.chapterPath };
  }
  const trimmed = read.content.trim();
  if (trimmed.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_chapter",
      path: read.path,
      message: "Chapter content is empty."
    });
  }
  if (!trimmed.startsWith("#")) {
    issues.push({
      severity: "warning",
      code: "missing_markdown_title",
      path: read.path,
      message: "Chapter does not start with a Markdown heading."
    });
  }
  const wordCount = countWords(read.content);
  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues,
    chapterPath: read.path,
    chapterHash: read.hash,
    wordCount
  };
}

export async function exportWriting(request: WritingExportRequest): Promise<WritingExportResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [WRITING_EXPORT_CAPABILITY]);
  const chapterPaths = await listMarkdownPaths(request.workspacePath, "writing/chapters");
  const chapters = await Promise.all(
    chapterPaths.map(async (chapterPath) =>
      readWorkspaceFile({ workspacePath: request.workspacePath, path: chapterPath })
    )
  );
  const content = chapters
    .map(
      (chapter) =>
        `${chapter.content.trimEnd()}\n\n<!-- source: ${chapter.path}; hash: ${chapter.hash} -->`
    )
    .join("\n\n")
    .concat(chapters.length === 0 ? "" : "\n");
  const outputPath = request.outputPath ?? "writing/exports/novel.md";
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "writing export",
    authorizedCapability: WRITING_EXPORT_CAPABILITY
  });
  return {
    exportPath: write.path,
    exportHash: contentHash(content),
    chapterCount: chapters.length,
    write: summarizeWrite(write)
  };
}

async function validateDraftArtifact(
  workspacePath: string,
  draftPath: string
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const checked = [draftPath];
  const draft = await readJsonArtifact(workspacePath, draftPath, issues);
  if (!isWritingDraft(draft)) {
    issues.push({
      severity: "error",
      code: "invalid_writing_draft",
      path: draftPath,
      message: "Draft artifact must be novelfabric.writing.draft version 1."
    });
    return { valid: false, checked, issues };
  }
  if (draft.markdown.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "empty_draft_markdown",
      path: draftPath,
      message: "Draft markdown is empty."
    });
  }
  for (const citation of draft.citations) {
    checked.push(citation.path);
    try {
      const read = await readWorkspaceFile({ workspacePath, path: citation.path });
      if (citation.hash !== undefined && citation.hash !== read.hash) {
        issues.push({
          severity: "error",
          code: "citation_hash_mismatch",
          path: citation.path,
          message: `Citation hash for '${citation.path}' does not match current workspace content.`
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "citation_unreadable",
        path: citation.path,
        message:
          error instanceof Error ? error.message : `Could not read citation '${citation.path}'.`
      });
    }
  }
  return { valid: issues.every((issue) => issue.severity !== "error"), checked, issues };
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

async function listMarkdownPaths(workspacePath: string, base: string): Promise<readonly string[]> {
  const glob = await globWorkspaceFiles({ workspacePath, base, pattern: "**/*.md" });
  return glob.matches.filter((match) => match.kind === "file").map((match) => match.path);
}

async function listJsonLikePaths(workspacePath: string, base: string): Promise<readonly string[]> {
  const glob = await globWorkspaceFiles({ workspacePath, base, pattern: "**/*.{json,jsonl,md}" });
  return glob.matches.filter((match) => match.kind === "file").map((match) => match.path);
}

async function readJsonArtifact(
  workspacePath: string,
  artifactPath: string,
  issues: ValidationIssue[]
): Promise<unknown> {
  try {
    return await readRequiredJsonArtifact(workspacePath, artifactPath);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "artifact_unreadable",
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

function isWritingContextPack(value: unknown): value is NovelFabricWritingContextPack {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.writing.context-pack" &&
    value["version"] === 1 &&
    typeof value["session"] === "string" &&
    Array.isArray(value["citations"]) &&
    value["citations"].every(isArtifactCitation) &&
    typeof value["sourceExcerpt"] === "string" &&
    Array.isArray(value["relevantEntities"]) &&
    value["relevantEntities"].every((item) => typeof item === "string") &&
    Array.isArray(value["chapterPaths"]) &&
    value["chapterPaths"].every((item) => typeof item === "string") &&
    Array.isArray(value["reportPaths"]) &&
    value["reportPaths"].every((item) => typeof item === "string") &&
    Array.isArray(value["simulationPaths"]) &&
    value["simulationPaths"].every((item) => typeof item === "string")
  );
}

function isWritingDraft(value: unknown): value is NovelFabricWritingDraft {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.writing.draft" &&
    value["version"] === 1 &&
    typeof value["title"] === "string" &&
    typeof value["markdown"] === "string" &&
    Array.isArray(value["citations"]) &&
    value["citations"].every(isArtifactCitation)
  );
}

function isArtifactCitation(value: unknown): value is ArtifactCitation {
  return (
    isRecord(value) &&
    typeof value["path"] === "string" &&
    (value["hash"] === undefined || typeof value["hash"] === "string") &&
    (value["excerpt"] === undefined || typeof value["excerpt"] === "string")
  );
}

function collectSourceAnchorsFromArtifact(
  content: string,
  sourceExcerpts: string[],
  relevantEntities: string[]
): void {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    const sourceExcerpt = record["sourceExcerpt"];
    if (typeof sourceExcerpt === "string" && sourceExcerpt.trim().length > 0) {
      sourceExcerpts.push(sourceExcerpt.trim());
    }
    const entities = record["relevantEntities"];
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (typeof entity === "string" && entity.trim().length >= 2) {
          relevantEntities.push(entity.trim());
        }
      }
    }
  } catch {
    // Non-JSON artifacts still contribute through citation excerpts.
  }
}

function extractAnchors(content: string): readonly string[] {
  const chapterAnchors = content.match(/第[一二三四五六七八九十百千0-9]+章/gu) ?? [];
  const phraseAnchors = content
    .split(/[\n，。,.!?！？；;：:]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && item.length <= 24);
  return [...new Set([...chapterAnchors, ...phraseAnchors])];
}

function structuredCitationExcerpt(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed) && typeof parsed["sourceExcerpt"] === "string") {
      const structuredExcerpt = excerpt(parsed["sourceExcerpt"]);
      if (structuredExcerpt.length > 0) return structuredExcerpt;
    }
  } catch {
    // Non-JSON artifacts use the plain text excerpt below.
  }
  return excerpt(content);
}

function excerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 240);
}

function countWords(content: string): number {
  const latinWords = content.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkCharacters = content.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  return latinWords + cjkCharacters;
}

function summarizeWrite(write: WorkspaceFileWriteResult): ArtifactWriteSummary {
  return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
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
  return segment.length === 0 ? "artifact" : segment.slice(0, 80);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
