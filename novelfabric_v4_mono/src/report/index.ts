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

export type ReportTaskCreateRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly session: string;
  readonly kind: string;
  readonly contextPackPath?: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type ReportTaskCreateResult = {
  readonly taskPath: string;
  readonly taskHash: string;
  readonly reportPath: string;
  readonly write: ArtifactWriteSummary;
};

export type ReportValidateRequest = {
  readonly workspacePath: string;
  readonly artifactPath: string;
};

export type ReportValidateResult = ValidationResult;

export type ReportApplyRequest = {
  readonly workspacePath: string;
  readonly artifactPath: string;
  readonly actor: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type ReportApplyResult = {
  readonly reportPath: string;
  readonly reportHash: string;
  readonly sourceArtifactPath: string;
  readonly write: ArtifactWriteSummary;
};

export type ReportListRequest = {
  readonly workspacePath: string;
};

export type ReportMaterializeFromAgentTaskRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly actor: string;
  readonly reportKind: string;
  readonly session?: string | null;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type ReportMaterializeFromAgentTaskResult = {
  readonly artifactPath: string;
  readonly sourceTaskResultPath: string;
  readonly write: ArtifactWriteSummary;
};

export type ReportListResult = {
  readonly reports: readonly ReportListItem[];
  readonly reportCount: number;
};

export type ReportShowRequest = {
  readonly workspacePath: string;
  readonly path: string;
};

export type ReportShowResult = {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly content: string;
};

export type ReportListItem = {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly title: string;
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

export type NovelFabricReportTask = {
  readonly kind: "novelfabric.report.task";
  readonly version: 1;
  readonly taskId: string;
  readonly reportKind: string;
  readonly session: string;
  readonly actor: string;
  readonly contextPackPath: string | null;
  readonly expectedOutputPath: string;
  readonly status: "pending-pi-runtime";
  readonly instructions: readonly string[];
  readonly requiredCapabilities: readonly string[];
};

export type NovelFabricReportArtifact = {
  readonly kind: "novelfabric.report.artifact";
  readonly version: 1;
  readonly reportKind: string;
  readonly session: string | null;
  readonly title: string;
  readonly markdown: string;
  readonly citations: readonly ArtifactCitation[];
};

export type ArtifactCitation = {
  readonly path: string;
  readonly hash?: string;
};

const REPORT_RENDER_CAPABILITY = "report.render";
const REPORT_APPLY_CAPABILITY = "report.apply";
const PROJECT_MANAGE_CAPABILITY = "project.manage";

export async function createReportTask(
  request: ReportTaskCreateRequest
): Promise<ReportTaskCreateResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [
    REPORT_RENDER_CAPABILITY,
    PROJECT_MANAGE_CAPABILITY
  ]);

  const taskId = `report-${safePathSegment(request.kind)}-${shortHash(
    `${request.session}:${request.kind}:${request.contextPackPath ?? ""}`
  )}`;
  const reportPath =
    request.outputPath ??
    `reports/${safePathSegment(request.kind)}-${safePathSegment(request.session)}.md`;
  const task: NovelFabricReportTask = {
    kind: "novelfabric.report.task",
    version: 1,
    taskId,
    reportKind: request.kind,
    session: request.session,
    actor: request.actor,
    contextPackPath: request.contextPackPath ?? null,
    expectedOutputPath: reportPath,
    status: "pending-pi-runtime",
    instructions: [
      "Use the NovelFabric wrapped pi runtime to produce a report artifact.",
      "Return a novelfabric.report.artifact JSON file; do not mutate canonical workspace files directly.",
      "Citations must include workspace-relative paths and hashes when available."
    ],
    requiredCapabilities: [REPORT_RENDER_CAPABILITY]
  };
  const content = stableJson(task);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: `reports/tasks/${taskId}.json`,
    content,
    actor: request.actor,
    reason: request.reason ?? "report task create"
  });
  return {
    taskPath: write.path,
    taskHash: contentHash(content),
    reportPath,
    write: summarizeWrite(write)
  };
}

export async function validateReportArtifact(
  request: ReportValidateRequest
): Promise<ReportValidateResult> {
  const issues: ValidationIssue[] = [];
  const checked = [request.artifactPath];
  const artifact = await readJsonArtifact(request.workspacePath, request.artifactPath, issues);
  if (!isReportArtifact(artifact)) {
    issues.push({
      severity: "error",
      code: "invalid_report_artifact",
      path: request.artifactPath,
      message: "Report artifact must be novelfabric.report.artifact version 1."
    });
    return { valid: false, checked, issues };
  }

  if (artifact.markdown.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "empty_report_markdown",
      path: request.artifactPath,
      message: "Report artifact markdown is empty."
    });
  }

  for (const citation of artifact.citations) {
    checked.push(citation.path);
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: citation.path
      });
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

export async function applyReportArtifact(request: ReportApplyRequest): Promise<ReportApplyResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [
    REPORT_APPLY_CAPABILITY,
    PROJECT_MANAGE_CAPABILITY
  ]);
  const validation = await validateReportArtifact({
    workspacePath: request.workspacePath,
    artifactPath: request.artifactPath
  });
  if (!validation.valid) {
    throw new CommandFailure("invalid_report_artifact", "Report artifact failed validation.");
  }
  const artifact = await readRequiredJsonArtifact(request.workspacePath, request.artifactPath);
  if (!isReportArtifact(artifact)) {
    throw new CommandFailure("invalid_report_artifact", "Report artifact has an invalid shape.");
  }

  const outputPath =
    request.outputPath ??
    `reports/${safePathSegment(artifact.reportKind)}-${shortHash(artifact.title)}.md`;
  const content = `${artifact.markdown.trimEnd()}\n\n---\nsource_artifact: ${request.artifactPath}\n`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "report apply"
  });
  return {
    reportPath: write.path,
    reportHash: contentHash(content),
    sourceArtifactPath: request.artifactPath,
    write: summarizeWrite(write)
  };
}

export async function materializeReportArtifactFromAgentTask(
  request: ReportMaterializeFromAgentTaskRequest
): Promise<ReportMaterializeFromAgentTaskResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [
    REPORT_RENDER_CAPABILITY,
    PROJECT_MANAGE_CAPABILITY
  ]);
  const output = await readCompletedAgentTaskDomainOutput({
    workspacePath: request.workspacePath,
    taskId: request.taskId
  });
  requireWorkflowOutputKind(output, "novelfabric.workflow.report-output");
  const citationEvidence = await readCitationEvidence(request.workspacePath, output.citations);
  assertSourceAnchorsGrounded(output.sourceAnchors, citationEvidence, output.resultPath);
  const markdown = requireMarkdownOutput(output, "Report markdown");
  const taskResultCitation: ArtifactCitation = { path: output.resultPath, hash: output.resultHash };
  const artifact: NovelFabricReportArtifact = {
    kind: "novelfabric.report.artifact",
    version: 1,
    reportKind: request.reportKind,
    session: request.session ?? null,
    title: output.title ?? `${request.reportKind} report`,
    markdown: `${markdown}\n\n## Source anchors\n${output.sourceAnchors.map((anchor) => `- ${anchor}`).join("\n")}`,
    citations: [taskResultCitation, ...citationEvidence]
  };
  const artifactPath =
    request.outputPath ??
    `reports/artifacts/${safePathSegment(request.reportKind)}-${shortHash(output.resultHash)}.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: artifactPath,
    content: stableJson(artifact),
    actor: request.actor,
    reason: request.reason ?? "report materialize from agent task"
  });
  return {
    artifactPath: write.path,
    sourceTaskResultPath: output.resultPath,
    write: summarizeWrite(write)
  };
}

export async function listReports(request: ReportListRequest): Promise<ReportListResult> {
  const glob = await globWorkspaceFiles({
    workspacePath: request.workspacePath,
    base: "reports",
    pattern: "**/*.md"
  });
  const reports = await Promise.all(
    glob.matches
      .filter((match) => match.kind === "file")
      .map(async (match): Promise<ReportListItem> => {
        const read = await readWorkspaceFile({
          workspacePath: request.workspacePath,
          path: match.path
        });
        return {
          path: read.path,
          hash: read.hash,
          bytes: read.bytes,
          title: firstMarkdownTitle(read.content) ?? read.path
        };
      })
  );
  return { reports, reportCount: reports.length };
}

export async function showReport(request: ReportShowRequest): Promise<ReportShowResult> {
  const read = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.path
  });
  return { path: read.path, hash: read.hash, bytes: read.bytes, content: read.content };
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

function isReportArtifact(value: unknown): value is NovelFabricReportArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.report.artifact" &&
    value["version"] === 1 &&
    typeof value["reportKind"] === "string" &&
    (typeof value["session"] === "string" || value["session"] === null) &&
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
    (value["hash"] === undefined || typeof value["hash"] === "string")
  );
}

function firstMarkdownTitle(content: string): string | null {
  const line = content.split(/\r?\n/).find((candidate) => candidate.startsWith("# "));
  return line === undefined ? null : line.replace(/^#\s+/, "").trim();
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
