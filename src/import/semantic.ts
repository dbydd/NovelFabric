import {
  readCompletedAgentTaskDomainOutput,
  readCitationEvidence,
  requireWorkflowOutputKind
} from "../agent-runtime/materialization.js";
import { createAgentTask, type AgentTaskCreateResult } from "../agent-runtime/tasks.js";
import { CommandFailure } from "../errors.js";
import type { JsonObject } from "../output.js";
import {
  contentHash,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";

export type SemanticImportChapter = {
  readonly title: string;
  readonly summary: string;
  readonly sourceAnchors: readonly string[];
};

export type SemanticImportCharacter = {
  readonly name: string;
  readonly summary: string;
  readonly sourceAnchors: readonly string[];
};

export type SemanticImportEvent = {
  readonly title: string;
  readonly summary: string;
  readonly sourceAnchors: readonly string[];
};

export type SemanticImportCardSeed = {
  readonly kind: "character" | "scene" | "world" | "plot" | "other";
  readonly title: string;
  readonly summary: string;
  readonly sourceAnchors: readonly string[];
};

export type SemanticImportCitation = {
  readonly path: string;
  readonly hash?: string;
};

export type NovelFabricSemanticImportArtifact = {
  readonly kind: "novelfabric.import.semantic";
  readonly version: 1;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly contextPackPath: string;
  readonly contextPackHash: string;
  readonly summary: string;
  readonly chapters: readonly SemanticImportChapter[];
  readonly characters: readonly SemanticImportCharacter[];
  readonly events: readonly SemanticImportEvent[];
  readonly cardSeeds: readonly SemanticImportCardSeed[];
  readonly sourceAnchors: readonly string[];
  readonly citations: readonly SemanticImportCitation[];
  readonly createdFromTask: {
    readonly taskId: string;
    readonly resultPath: string;
    readonly resultHash: string;
  };
  readonly materializedAt: string;
};

export type SemanticImportRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly contextPackPath: string;
  readonly sourcePath: string;
  readonly taskId?: string;
  readonly reason?: string;
};

export type SemanticImportMaterializeRequest = SemanticImportRequest & {
  readonly taskId: string;
  readonly outputPath?: string;
};

export type SemanticImportResult = {
  readonly taskId: string;
  readonly artifactPath: string;
  readonly sourceTaskResultPath: string;
  readonly write: SemanticImportWriteSummary;
};

export type SemanticImportTaskResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly files: AgentTaskCreateResult["files"];
  readonly writes: AgentTaskCreateResult["writes"];
};

export type SemanticImportValidationResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly SemanticImportValidationIssue[];
};

export type SemanticImportValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

type SemanticImportWriteSummary = Pick<
  WorkspaceFileWriteResult,
  "path" | "hash" | "bytes" | "auditPath"
>;

const SEMANTIC_IMPORT_OUTPUT_KIND = "novelfabric.import.semantic-output";
const SEMANTIC_IMPORT_ARTIFACT_KIND = "novelfabric.import.semantic";

export async function createSemanticImportTask(
  request: SemanticImportRequest
): Promise<SemanticImportTaskResult> {
  const sourceRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.sourcePath
  });
  const contextRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.contextPackPath
  });
  const task = await createAgentTask({
    workspacePath: request.workspacePath,
    actor: request.actor,
    ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
    title: `Semantic import for ${request.sourcePath}`,
    instruction: [
      "Read the provided NovelFabric import context and source evidence, then extract semantic book-splitting facts for downstream cards and workflow stages.",
      "Return exactly one valid JSON object matching OUTPUT_SCHEMA_JSON.",
      `kind must be '${SEMANTIC_IMPORT_OUTPUT_KIND}', version must be 1.`,
      `citations must include both '${request.sourcePath}' and '${request.contextPackPath}'.`,
      "sourceAnchors must be short exact phrases copied from the source text; do not invent anchors or normalize them.",
      "chapters, characters, events, and cardSeeds must be substantive arrays grounded in the cited source text."
    ].join("\n"),
    inputJson: stableJson({
      kind: "novelfabric.import.semantic.input",
      version: 1,
      sourcePath: request.sourcePath,
      contextPackPath: request.contextPackPath,
      sourceHash: sourceRead.hash,
      contextPackHash: contextRead.hash,
      sourceExcerpt: sourceRead.content.slice(0, 6000)
    }),
    contextPackPath: request.contextPackPath,
    allowedCommands: [
      "novelfabric files read",
      "novelfabric import validate",
      "novelfabric cards validate"
    ],
    outputSchemaJson: stableJson(
      semanticImportOutputSchema(request.sourcePath, request.contextPackPath)
    ),
    reason: request.reason ?? "semantic import task create"
  });
  return {
    taskId: task.taskId,
    packagePath: task.packagePath,
    files: task.files,
    writes: task.writes
  };
}

export async function materializeSemanticImportFromAgentTask(
  request: SemanticImportMaterializeRequest
): Promise<SemanticImportResult> {
  const sourceRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.sourcePath
  });
  const contextRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.contextPackPath
  });
  const output = await readCompletedAgentTaskDomainOutput({
    workspacePath: request.workspacePath,
    taskId: request.taskId
  });
  requireWorkflowOutputKind(output, SEMANTIC_IMPORT_OUTPUT_KIND);
  const citationEvidence = await readCitationEvidence(request.workspacePath, output.citations);
  const parsed = output.parsedJson;
  const artifact: NovelFabricSemanticImportArtifact = {
    kind: SEMANTIC_IMPORT_ARTIFACT_KIND,
    version: 1,
    sourcePath: sourceRead.path,
    sourceHash: sourceRead.hash,
    contextPackPath: contextRead.path,
    contextPackHash: contextRead.hash,
    summary: requiredText(parsed, "summary", 24),
    chapters: requiredSemanticItems(parsed, "chapters", semanticChapterFromJson),
    characters: requiredSemanticItems(parsed, "characters", semanticCharacterFromJson),
    events: requiredSemanticItems(parsed, "events", semanticEventFromJson),
    cardSeeds: requiredSemanticItems(parsed, "cardSeeds", semanticCardSeedFromJson),
    sourceAnchors: requiredStringArray(parsed, "sourceAnchors"),
    citations: [
      { path: output.resultPath, hash: output.resultHash },
      ...citationEvidence.map((citation) => ({ path: citation.path, hash: citation.hash }))
    ],
    createdFromTask: {
      taskId: output.taskId,
      resultPath: output.resultPath,
      resultHash: output.resultHash
    },
    materializedAt: new Date().toISOString()
  };
  const validation = validateSemanticImportArtifactValue({
    artifact,
    sourceContent: sourceRead.content,
    sourcePath: sourceRead.path,
    sourceHash: sourceRead.hash,
    contextPackPath: contextRead.path,
    contextPackHash: contextRead.hash
  });
  if (!validation.valid) {
    throw new CommandFailure(
      "semantic_import_artifact_invalid",
      `Semantic import artifact failed validation: ${validation.issues.map((issue) => issue.message).join("; ")}`
    );
  }
  const artifactPath =
    request.outputPath ??
    `imports/semantic/${safePathSegment(request.sourcePath)}-${shortHash(output.resultHash)}.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: artifactPath,
    content: stableJson(artifact),
    actor: request.actor,
    reason: request.reason ?? "semantic import materialize from agent task"
  });
  return {
    taskId: output.taskId,
    artifactPath: write.path,
    sourceTaskResultPath: output.resultPath,
    write: summarizeWrite(write)
  };
}

export async function validateSemanticImportArtifact(request: {
  readonly workspacePath: string;
  readonly artifactPath: string;
}): Promise<SemanticImportValidationResult> {
  const issues: SemanticImportValidationIssue[] = [];
  const checked = [request.artifactPath];
  let artifact: unknown;
  try {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: request.artifactPath
    });
    artifact = JSON.parse(read.content) as unknown;
  } catch (error) {
    issues.push(issue("semantic_import_unreadable", request.artifactPath, errorMessage(error)));
    return { valid: false, checked, issues };
  }
  if (!isSemanticImportArtifact(artifact)) {
    issues.push(
      issue(
        "invalid_semantic_import",
        request.artifactPath,
        "Artifact must be novelfabric.import.semantic version 1."
      )
    );
    return { valid: false, checked, issues };
  }
  let sourceRead;
  let contextRead;
  try {
    sourceRead = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: artifact.sourcePath
    });
    checked.push(sourceRead.path);
  } catch (error) {
    issues.push(issue("source_unreadable", artifact.sourcePath, errorMessage(error)));
  }
  try {
    contextRead = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: artifact.contextPackPath
    });
    checked.push(contextRead.path);
  } catch (error) {
    issues.push(issue("context_pack_unreadable", artifact.contextPackPath, errorMessage(error)));
  }
  if (sourceRead !== undefined && sourceRead.hash !== artifact.sourceHash) {
    issues.push(
      issue(
        "source_hash_mismatch",
        artifact.sourcePath,
        "Semantic import source hash no longer matches workspace content."
      )
    );
  }
  if (contextRead !== undefined && contextRead.hash !== artifact.contextPackHash) {
    issues.push(
      issue(
        "context_pack_hash_mismatch",
        artifact.contextPackPath,
        "Semantic import context pack hash no longer matches workspace content."
      )
    );
  }
  if (sourceRead !== undefined) {
    const valueValidation = validateSemanticImportArtifactValue({
      artifact,
      sourceContent: sourceRead.content,
      sourcePath: artifact.sourcePath,
      sourceHash: artifact.sourceHash,
      contextPackPath: artifact.contextPackPath,
      contextPackHash: artifact.contextPackHash
    });
    issues.push(...valueValidation.issues);
  }
  for (const citation of artifact.citations) {
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: citation.path
      });
      checked.push(read.path);
      if (citation.hash !== undefined && citation.hash !== read.hash) {
        issues.push(
          issue(
            "citation_hash_mismatch",
            citation.path,
            `Citation hash for '${citation.path}' does not match current workspace content.`
          )
        );
      }
    } catch (error) {
      issues.push(issue("citation_unreadable", citation.path, errorMessage(error)));
    }
  }
  return { valid: issues.every((item) => item.severity !== "error"), checked, issues };
}

function semanticImportOutputSchema(sourcePath: string, contextPackPath: string): JsonObject {
  const groundedArraySchema: JsonObject = {
    type: "array",
    minItems: 2,
    items: { type: "string", minLength: 2 }
  };
  const itemAnchorSchema: JsonObject = {
    type: "array",
    minItems: 1,
    items: { type: "string", minLength: 2 }
  };
  const semanticItemSchema: JsonObject = {
    type: "object",
    required: ["title", "summary", "sourceAnchors"],
    properties: {
      title: { type: "string", minLength: 2 },
      summary: { type: "string", minLength: 12 },
      sourceAnchors: itemAnchorSchema
    }
  };
  return {
    type: "object",
    required: [
      "kind",
      "version",
      "summary",
      "chapters",
      "characters",
      "events",
      "cardSeeds",
      "sourceAnchors",
      "citations"
    ],
    properties: {
      kind: { type: "string", containsText: SEMANTIC_IMPORT_OUTPUT_KIND },
      version: { type: "number" },
      summary: { type: "string", minLength: 24 },
      chapters: { type: "array", minItems: 1, items: semanticItemSchema },
      characters: {
        type: "array",
        minItems: 1,
        items: {
          ...semanticItemSchema,
          required: ["name", "summary", "sourceAnchors"],
          properties: {
            name: { type: "string", minLength: 1 },
            summary: { type: "string", minLength: 12 },
            sourceAnchors: itemAnchorSchema
          }
        }
      },
      events: { type: "array", minItems: 1, items: semanticItemSchema },
      cardSeeds: {
        type: "array",
        minItems: 1,
        items: {
          ...semanticItemSchema,
          required: ["kind", "title", "summary", "sourceAnchors"],
          properties: {
            kind: { type: "string", minLength: 3 },
            title: { type: "string", minLength: 2 },
            summary: { type: "string", minLength: 12 },
            sourceAnchors: itemAnchorSchema
          }
        }
      },
      sourceAnchors: groundedArraySchema,
      citations: {
        type: "array",
        minItems: 2,
        containsAllText: [sourcePath, contextPackPath],
        items: { type: "string", minLength: 1 }
      }
    }
  };
}

function validateSemanticImportArtifactValue(request: {
  readonly artifact: NovelFabricSemanticImportArtifact;
  readonly sourceContent: string;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly contextPackPath: string;
  readonly contextPackHash: string;
}): SemanticImportValidationResult {
  const issues: SemanticImportValidationIssue[] = [];
  const { artifact } = request;
  if (artifact.sourcePath !== request.sourcePath || artifact.sourceHash !== request.sourceHash) {
    issues.push(
      issue(
        "source_binding_mismatch",
        artifact.sourcePath,
        "Artifact source binding must match the source file used for validation."
      )
    );
  }
  if (
    artifact.contextPackPath !== request.contextPackPath ||
    artifact.contextPackHash !== request.contextPackHash
  ) {
    issues.push(
      issue(
        "context_pack_binding_mismatch",
        artifact.contextPackPath,
        "Artifact context pack binding must match the context pack used for validation."
      )
    );
  }
  if (artifact.summary.trim().length < 24) {
    issues.push(
      issue("summary_too_short", "summary", "Semantic import summary must be substantive.")
    );
  }
  if (artifact.sourceAnchors.length === 0) {
    issues.push(
      issue("source_anchors_empty", "sourceAnchors", "Semantic import must include source anchors.")
    );
  }
  for (const anchor of artifact.sourceAnchors) {
    if (!request.sourceContent.includes(anchor)) {
      issues.push(
        issue(
          "source_anchor_not_found",
          "sourceAnchors",
          `Source anchor '${anchor}' is not an exact substring of the source text.`
        )
      );
    }
  }
  validateSemanticItemArray(artifact.chapters, "chapters", request.sourceContent, issues);
  validateSemanticItemArray(
    artifact.characters.map((item) => ({
      title: item.name,
      summary: item.summary,
      sourceAnchors: item.sourceAnchors
    })),
    "characters",
    request.sourceContent,
    issues
  );
  validateSemanticItemArray(artifact.events, "events", request.sourceContent, issues);
  validateSemanticItemArray(artifact.cardSeeds, "cardSeeds", request.sourceContent, issues);
  if (
    !artifact.citations.some((citation) => citation.path === artifact.createdFromTask.resultPath)
  ) {
    issues.push(
      issue(
        "task_result_citation_missing",
        "citations",
        "Semantic import must cite its agent task result."
      )
    );
  }
  if (!artifact.citations.some((citation) => citation.path === artifact.sourcePath)) {
    issues.push(
      issue("source_citation_missing", "citations", "Semantic import must cite the source text.")
    );
  }
  if (!artifact.citations.some((citation) => citation.path === artifact.contextPackPath)) {
    issues.push(
      issue(
        "context_pack_citation_missing",
        "citations",
        "Semantic import must cite the import context pack."
      )
    );
  }
  return { valid: issues.every((item) => item.severity !== "error"), checked: [], issues };
}

function validateSemanticItemArray(
  items: readonly {
    readonly title: string;
    readonly summary: string;
    readonly sourceAnchors: readonly string[];
  }[],
  field: string,
  sourceContent: string,
  issues: SemanticImportValidationIssue[]
): void {
  if (items.length === 0) {
    issues.push(
      issue("semantic_section_empty", field, `Semantic import '${field}' must not be empty.`)
    );
  }
  for (const item of items) {
    if (item.title.trim().length === 0 || item.summary.trim().length < 12) {
      issues.push(
        issue(
          "semantic_item_invalid",
          field,
          `Semantic import '${field}' items require title/name and substantive summary.`
        )
      );
    }
    for (const anchor of item.sourceAnchors) {
      if (!sourceContent.includes(anchor)) {
        issues.push(
          issue(
            "semantic_item_anchor_not_found",
            field,
            `Source anchor '${anchor}' is not an exact substring of the source text.`
          )
        );
      }
    }
  }
}

function requiredSemanticItems<T>(
  value: JsonObject,
  field: string,
  mapper: (value: unknown) => T
): readonly T[] {
  const raw = value[field];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CommandFailure(
      "semantic_import_output_invalid",
      `Semantic import output must include non-empty array '${field}'.`
    );
  }
  return raw.map(mapper);
}

function semanticChapterFromJson(value: unknown): SemanticImportChapter {
  const item = requireRecord(value, "chapter");
  return {
    title: requiredText(item, "title", 2),
    summary: requiredText(item, "summary", 12),
    sourceAnchors: requiredStringArray(item, "sourceAnchors")
  };
}

function semanticCharacterFromJson(value: unknown): SemanticImportCharacter {
  const item = requireRecord(value, "character");
  return {
    name: requiredText(item, "name", 1),
    summary: requiredText(item, "summary", 12),
    sourceAnchors: requiredStringArray(item, "sourceAnchors")
  };
}

function semanticEventFromJson(value: unknown): SemanticImportEvent {
  const item = requireRecord(value, "event");
  return {
    title: requiredText(item, "title", 2),
    summary: requiredText(item, "summary", 12),
    sourceAnchors: requiredStringArray(item, "sourceAnchors")
  };
}

function semanticCardSeedFromJson(value: unknown): SemanticImportCardSeed {
  const item = requireRecord(value, "cardSeed");
  const kind = requiredText(item, "kind", 3);
  const allowedKinds = ["character", "scene", "world", "plot", "other"] as const;
  return {
    kind: allowedKinds.includes(kind as SemanticImportCardSeed["kind"])
      ? (kind as SemanticImportCardSeed["kind"])
      : "other",
    title: requiredText(item, "title", 2),
    summary: requiredText(item, "summary", 12),
    sourceAnchors: requiredStringArray(item, "sourceAnchors")
  };
}

function requiredText(value: JsonObject, field: string, minimumLength: number): string {
  const raw = value[field];
  if (typeof raw !== "string" || raw.trim().length < minimumLength) {
    throw new CommandFailure(
      "semantic_import_output_invalid",
      `Semantic import output field '${field}' must be a substantive string.`
    );
  }
  return raw.trim();
}

function requiredStringArray(value: JsonObject, field: string): readonly string[] {
  const raw = value[field];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CommandFailure(
      "semantic_import_output_invalid",
      `Semantic import output field '${field}' must be a non-empty string array.`
    );
  }
  const strings = raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  if (strings.length !== raw.length) {
    throw new CommandFailure(
      "semantic_import_output_invalid",
      `Semantic import output field '${field}' must contain only strings.`
    );
  }
  return [...new Set(strings)];
}

function requireRecord(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new CommandFailure(
      "semantic_import_output_invalid",
      `Semantic import ${label} item must be an object.`
    );
  }
  return value;
}

function isSemanticImportArtifact(value: unknown): value is NovelFabricSemanticImportArtifact {
  return (
    isRecord(value) &&
    value["kind"] === SEMANTIC_IMPORT_ARTIFACT_KIND &&
    value["version"] === 1 &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceHash"] === "string" &&
    typeof value["contextPackPath"] === "string" &&
    typeof value["contextPackHash"] === "string" &&
    typeof value["summary"] === "string" &&
    Array.isArray(value["chapters"]) &&
    Array.isArray(value["characters"]) &&
    Array.isArray(value["events"]) &&
    Array.isArray(value["cardSeeds"]) &&
    Array.isArray(value["sourceAnchors"]) &&
    Array.isArray(value["citations"]) &&
    isRecord(value["createdFromTask"])
  );
}

function issue(code: string, path: string, message: string): SemanticImportValidationIssue {
  return { severity: "error", code, path, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function summarizeWrite(write: WorkspaceFileWriteResult): SemanticImportWriteSummary {
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
  return segment.length === 0 ? "semantic-import" : segment.slice(0, 80);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
