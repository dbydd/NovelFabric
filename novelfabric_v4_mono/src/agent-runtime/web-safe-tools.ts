import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import type { JsonObject } from "../output.js";
import { readWorkspaceFile, statWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";
import { isProtectedWorkspacePath } from "../workspace/protection.js";

export type WebSafeToolResult = {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly details: JsonObject;
};

export type WebSafeToolDefinition = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
  readonly parameters: JsonObject;
  execute(toolCallId: string, params: unknown, signal?: AbortSignal): Promise<WebSafeToolResult>;
};

export type WebSafeDefineTool = (tool: WebSafeToolDefinition) => unknown;

export type WebSafeToolContext = {
  readonly workspacePath: string;
  readonly actor: string;
};

export type WebSafeToolManifestEntry = JsonObject & {
  readonly name: string;
  readonly implemented: boolean;
  readonly mode: "custom-tool" | "planned";
  readonly description: string;
};

export const WEB_SAFE_CUSTOM_TOOL_NAMES = [
  "novelfabric_read_file",
  "novelfabric_validate",
  "novelfabric_context_pack",
  "novelfabric_report",
  "novelfabric_write_file"
] as const;

export type WebSafeCustomToolName = (typeof WEB_SAFE_CUSTOM_TOOL_NAMES)[number];

export const WEB_SAFE_CUSTOM_TOOL_MANIFEST: readonly WebSafeToolManifestEntry[] = [
  {
    name: "novelfabric_read_file",
    implemented: true,
    mode: "custom-tool",
    description:
      "Read a non-protected workspace text file through NovelFabric safe-path and symlink guards. Workspace and actor are bound by the host runtime, not by model parameters."
  },
  {
    name: "novelfabric_validate",
    implemented: true,
    mode: "custom-tool",
    description:
      "Run compact read-only validation against supported NovelFabric artifacts without returning raw file content."
  },
  {
    name: "novelfabric_context_pack",
    implemented: true,
    mode: "custom-tool",
    description:
      "Validate or build bounded NovelFabric context packs through CLI-equivalent workspace services. Workspace and actor are bound by the host runtime."
  },
  {
    name: "novelfabric_report",
    implemented: true,
    mode: "custom-tool",
    description:
      "List, show bounded previews for, or validate report artifacts without exposing protected workspace content."
  },
  {
    name: "novelfabric_write_file",
    implemented: true,
    mode: "custom-tool",
    description:
      "Write only to bounded proposal, draft, report, and simulation artifact namespaces through NovelFabric capability, conflict, safe-path, symlink, and audit guards. Workspace and actor are bound by the host runtime."
  }
];

const MAX_BOUNDED_ISSUES = 12;
const MAX_REPORT_PREVIEW_CHARS = 4000;
const MAX_CONTEXT_PACK_LIMIT = 20;
const CONTEXT_PACK_OUTPUT_NAMESPACE = "knowledge/context-packs/";
const REPORT_PREVIEW_NAMESPACE = "reports/";
const REPORT_ARTIFACT_NAMESPACE = "reports/artifacts/";
const WRITING_DRAFT_NAMESPACE = "writing/drafts/";
const SWARM_OUTPUT_NAMESPACE = "simulation/rounds/";
const CARDS_PROPOSAL_NAMESPACE = "proposals/cards/";
const MEMORY_PROPOSAL_NAMESPACE = "proposals/memory/";

export const WEB_SAFE_WRITE_NAMESPACES = [
  CARDS_PROPOSAL_NAMESPACE,
  MEMORY_PROPOSAL_NAMESPACE,
  WRITING_DRAFT_NAMESPACE,
  "reports/generated/",
  SWARM_OUTPUT_NAMESPACE,
  "simulation/turns/"
] as const;

type ValidationTarget =
  | "context-pack"
  | "workflow"
  | "report"
  | "writing-draft"
  | "swarm-output"
  | "cards-proposal"
  | "memory-proposal";

type ReportMode = "list" | "show" | "validate";
type ContextPackMode = "validate" | "build";

export function buildNovelFabricWebSafeCustomTools(input: {
  readonly context: WebSafeToolContext;
  readonly defineTool?: WebSafeDefineTool;
}): readonly unknown[] {
  const tools = [
    createReadFileTool(input.context),
    createValidateTool(input.context),
    createContextPackTool(input.context),
    createReportTool(input.context),
    createWriteFileTool(input.context)
  ];
  if (input.defineTool === undefined) return tools;
  return tools.map((tool) => input.defineTool?.(tool) ?? tool);
}

export function createReadFileTool(context: WebSafeToolContext): WebSafeToolDefinition {
  return {
    name: "novelfabric_read_file",
    label: "NovelFabric Read File",
    description:
      "Read a non-protected text file inside the current NovelFabric workspace. The workspace root and actor are fixed by the host runtime.",
    promptSnippet:
      "novelfabric_read_file: read a non-protected NovelFabric workspace text file by relative path.",
    promptGuidelines: [
      "Use novelfabric_read_file only for relative paths in the current NovelFabric workspace.",
      "Do not request absolute paths, parent-directory traversal, protected files, or host filesystem paths.",
      "The tool result includes a content hash and protected=false metadata."
    ],
    parameters: {
      type: "object",
      required: ["path"],
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Workspace-relative text file path to read."
        }
      }
    },
    async execute(_toolCallId, params, signal) {
      assertNotAborted(signal);
      const filePath = parseRequiredPathParams(params, "novelfabric_read_file");
      const precheckedPath = precheckNonProtectedPath({
        workspacePath: context.workspacePath,
        requestedPath: filePath,
        toolName: "novelfabric_read_file",
        action: "read"
      });
      const read = await readWorkspaceFile({
        workspacePath: context.workspacePath,
        path: precheckedPath
      });
      const payload = {
        kind: "novelfabric.web_safe_tool.read_file.result",
        version: 1,
        tool: "novelfabric_read_file",
        actor: context.actor,
        path: read.path,
        hash: read.hash,
        bytes: read.bytes,
        protected: false,
        content: read.content
      } as const;
      return resultFromPayload(payload, {
        path: read.path,
        hash: read.hash,
        bytes: read.bytes,
        protected: false
      });
    }
  };
}

export function createValidateTool(context: WebSafeToolContext): WebSafeToolDefinition {
  return {
    name: "novelfabric_validate",
    label: "NovelFabric Validate",
    description:
      "Run read-only validation on supported NovelFabric artifacts. Results are compact and never include raw artifact content.",
    promptSnippet:
      "novelfabric_validate: validate context-pack, workflow, report, writing-draft, swarm-output, cards-proposal, or memory-proposal artifacts.",
    promptGuidelines: [
      "Use novelfabric_validate to check artifact validity before proposing next actions.",
      "Pass jobId for workflow validation and path for artifact validation targets.",
      "Validation results include bounded issue summaries, not raw file content."
    ],
    parameters: {
      type: "object",
      required: ["target"],
      additionalProperties: false,
      properties: {
        target: {
          type: "string",
          enum: [
            "context-pack",
            "workflow",
            "report",
            "writing-draft",
            "swarm-output",
            "cards-proposal",
            "memory-proposal"
          ]
        },
        path: { type: "string", minLength: 1 },
        jobId: { type: "string", minLength: 1 }
      }
    },
    async execute(_toolCallId, params, signal) {
      assertNotAborted(signal);
      const parsed = parseValidateParams(params);
      const summary = await runValidationTarget(context, parsed);
      const payload = {
        kind: "novelfabric.web_safe_tool.validate.result",
        version: 1,
        tool: "novelfabric_validate",
        actor: context.actor,
        ...summary
      };
      return resultFromPayload(payload, summary);
    }
  };
}

export function createContextPackTool(context: WebSafeToolContext): WebSafeToolDefinition {
  return {
    name: "novelfabric_context_pack",
    label: "NovelFabric Context Pack",
    description:
      "Validate or build bounded NovelFabric context packs through workspace services. Workspace and actor are fixed by the host runtime.",
    promptSnippet:
      "novelfabric_context_pack: validate an existing context pack or build a bounded context pack with limit <= 20.",
    promptGuidelines: [
      "Use validate mode to check an existing context pack by path.",
      "Use build mode only with a focused kind/query and limit no greater than 20.",
      "Do not pass workspace or actor; the host runtime binds those values."
    ],
    parameters: {
      type: "object",
      required: ["mode"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["validate", "build"] },
        path: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        query: { type: "string" },
        agent: { type: "string" },
        session: { type: "string" },
        timeline: { type: "string" },
        outputPath: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_CONTEXT_PACK_LIMIT }
      }
    },
    async execute(_toolCallId, params, signal) {
      assertNotAborted(signal);
      const parsed = parseContextPackParams(params);
      const summary = await runContextPackMode(context, parsed);
      const payload = {
        kind: "novelfabric.web_safe_tool.context_pack.result",
        version: 1,
        tool: "novelfabric_context_pack",
        actor: context.actor,
        ...summary
      };
      return resultFromPayload(payload, summary);
    }
  };
}

export function createReportTool(context: WebSafeToolContext): WebSafeToolDefinition {
  return {
    name: "novelfabric_report",
    label: "NovelFabric Report",
    description:
      "Read-only report tool for listing reports, bounded report previews, and report artifact validation.",
    promptSnippet:
      "novelfabric_report: list reports, show a bounded non-protected report preview, or validate a report artifact.",
    promptGuidelines: [
      "Use list to inspect available Markdown reports without raw content.",
      "Use show only for a specific non-protected report path; content is bounded.",
      "Use validate for report artifact JSON files before relying on them."
    ],
    parameters: {
      type: "object",
      required: ["mode"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["list", "show", "validate"] },
        path: { type: "string", minLength: 1 }
      }
    },
    async execute(_toolCallId, params, signal) {
      assertNotAborted(signal);
      const parsed = parseReportParams(params);
      const summary = await runReportMode(context, parsed);
      const payload = {
        kind: "novelfabric.web_safe_tool.report.result",
        version: 1,
        tool: "novelfabric_report",
        actor: context.actor,
        ...summary
      };
      return resultFromPayload(payload, summary);
    }
  };
}

export function createWriteFileTool(context: WebSafeToolContext): WebSafeToolDefinition {
  return {
    name: "novelfabric_write_file",
    label: "NovelFabric Write File",
    description:
      "Write text only to Web-safe NovelFabric proposal, draft, report, and simulation artifact namespaces through capability-checked workspace services.",
    promptSnippet:
      "novelfabric_write_file: write a workspace artifact under an allowed namespace with a reason and expectedBaseHash for existing files.",
    promptGuidelines: [
      "Use novelfabric_write_file only for bounded NovelFabric artifact namespaces, never source code, project roots, protected files, or arbitrary paths.",
      "Provide expectedBaseHash when replacing an existing file. If you do not know it, read the file first through an allowed tool and then write.",
      "Do not pass workspace or actor; the host runtime binds those values."
    ],
    parameters: {
      type: "object",
      required: ["path", "content", "reason"],
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1 },
        content: { type: "string" },
        expectedBaseHash: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 }
      }
    },
    async execute(_toolCallId, params, signal) {
      assertNotAborted(signal);
      const parsed = parseWriteFileParams(params);
      const checkedPath = precheckWebSafeWritePath({
        workspacePath: context.workspacePath,
        requestedPath: parsed.path,
        toolName: "novelfabric_write_file",
        action: "write"
      });
      const existing = await statExistingWorkspaceFile({
        workspacePath: context.workspacePath,
        path: checkedPath
      });
      if (existing.exists && parsed.expectedBaseHash === undefined) {
        throw new CommandFailure(
          "web_safe_write_expected_hash_required",
          `Web-safe tool 'novelfabric_write_file' requires expectedBaseHash when replacing existing file '${checkedPath}'.`,
          4
        );
      }
      const write = await writeWorkspaceFile({
        workspacePath: context.workspacePath,
        path: checkedPath,
        actor: context.actor,
        content: parsed.content,
        reason: parsed.reason,
        ...(parsed.expectedBaseHash === undefined
          ? {}
          : { expectedBaseHash: parsed.expectedBaseHash })
      });
      const details = {
        ok: true,
        path: write.path,
        hash: write.hash,
        previousHash: write.previousHash,
        bytes: write.bytes,
        auditPath: write.auditPath
      } as const;
      const payload = {
        kind: "novelfabric.web_safe_tool.write_file.result",
        version: 1,
        tool: "novelfabric_write_file",
        actor: context.actor,
        ...details
      };
      return resultFromPayload(payload, details);
    }
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new CommandFailure("web_safe_tool_aborted", "Tool execution was aborted.", 2);
  }
}

async function runValidationTarget(
  context: WebSafeToolContext,
  request: { readonly target: ValidationTarget; readonly path?: string; readonly jobId?: string }
): Promise<JsonObject> {
  switch (request.target) {
    case "context-pack": {
      const { validateContextPack } = await import("../knowledge/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: CONTEXT_PACK_OUTPUT_NAMESPACE,
        namespaceLabel: "context-pack"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateContextPack({
          workspacePath: context.workspacePath,
          path: checkedPath
        })
      });
    }
    case "workflow": {
      const { verifyWorkflow } = await import("../workflow/index.js");
      const jobId = requireToolString(request.jobId, "jobId", "novelfabric_validate workflow");
      const result = await verifyWorkflow({ workspacePath: context.workspacePath, jobId });
      return compactValidationResult({ target: request.target, jobId, result });
    }
    case "report": {
      const { validateReportArtifact } = await import("../report/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: REPORT_ARTIFACT_NAMESPACE,
        namespaceLabel: "report artifact"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateReportArtifact({
          workspacePath: context.workspacePath,
          artifactPath: checkedPath
        })
      });
    }
    case "writing-draft": {
      const { validateWritingDraftArtifact } = await import("../writing/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: WRITING_DRAFT_NAMESPACE,
        namespaceLabel: "writing draft"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateWritingDraftArtifact(context.workspacePath, checkedPath)
      });
    }
    case "swarm-output": {
      const { validateSwarmOutput } = await import("../swarm/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: SWARM_OUTPUT_NAMESPACE,
        namespaceLabel: "swarm output"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateSwarmOutput({
          workspacePath: context.workspacePath,
          artifactPath: checkedPath
        })
      });
    }
    case "cards-proposal": {
      const { validateCardProposal } = await import("../cards/proposals.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: CARDS_PROPOSAL_NAMESPACE,
        namespaceLabel: "cards proposal"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateCardProposal({
          workspacePath: context.workspacePath,
          proposalPath: checkedPath
        })
      });
    }
    case "memory-proposal": {
      const { validateSharedMemoryProposal } = await import("../memory/service.js");
      const pathValue = requireToolPath(request.path, "novelfabric_validate", request.target);
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_validate",
        action: "validate",
        namespace: MEMORY_PROPOSAL_NAMESPACE,
        namespaceLabel: "memory proposal"
      });
      return compactValidationResult({
        target: request.target,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateSharedMemoryProposal({
          workspacePath: context.workspacePath,
          proposalPath: checkedPath
        })
      });
    }
  }
}

async function runContextPackMode(
  context: WebSafeToolContext,
  request: {
    readonly mode: ContextPackMode;
    readonly path?: string;
    readonly kind?: string;
    readonly query?: string;
    readonly agent?: string;
    readonly session?: string;
    readonly timeline?: string;
    readonly outputPath?: string;
    readonly limit?: number;
  }
): Promise<JsonObject> {
  switch (request.mode) {
    case "validate": {
      const { validateContextPack } = await import("../knowledge/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_context_pack", "validate");
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_context_pack",
        action: "validate",
        namespace: CONTEXT_PACK_OUTPUT_NAMESPACE,
        namespaceLabel: "context-pack"
      });
      return compactValidationResult({
        target: "context-pack",
        mode: request.mode,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, checkedPath).relativePath
        ),
        result: await validateContextPack({
          workspacePath: context.workspacePath,
          path: checkedPath
        })
      });
    }
    case "build": {
      const { buildContextPack } = await import("../knowledge/index.js");
      const kind = requireToolString(request.kind, "kind", "novelfabric_context_pack build");
      const limit = boundContextPackLimit(request.limit);
      const outputPath =
        request.outputPath === undefined
          ? undefined
          : precheckNonProtectedPathInNamespace({
              workspacePath: context.workspacePath,
              requestedPath: request.outputPath,
              toolName: "novelfabric_context_pack",
              action: "build",
              namespace: CONTEXT_PACK_OUTPUT_NAMESPACE,
              namespaceLabel: "context-pack output"
            });
      const result = await buildContextPack({
        workspacePath: context.workspacePath,
        actor: context.actor,
        kind,
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.agent === undefined ? {} : { agent: request.agent }),
        ...(request.session === undefined ? {} : { session: request.session }),
        ...(request.timeline === undefined ? {} : { timeline: request.timeline }),
        ...(outputPath === undefined ? {} : { outputPath }),
        limit,
        reason: "web-safe context-pack build"
      });
      return {
        mode: request.mode,
        status: "built",
        outputPath: result.outputPath,
        outputHash: result.outputHash,
        citationCount: result.citationCount,
        sourceCount: result.sourceCount,
        write: summarizeWriteForTool(result.write)
      };
    }
  }
}

async function runReportMode(
  context: WebSafeToolContext,
  request: { readonly mode: ReportMode; readonly path?: string }
): Promise<JsonObject> {
  switch (request.mode) {
    case "list": {
      const { listReports } = await import("../report/index.js");
      const result = await listReports({ workspacePath: context.workspacePath });
      return {
        mode: request.mode,
        status: "listed",
        reportCount: result.reportCount,
        reports: result.reports.slice(0, 50).map((report) => ({
          path: report.path,
          hash: report.hash,
          bytes: report.bytes,
          title: report.title
        }))
      };
    }
    case "show": {
      const { showReport } = await import("../report/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_report", "show");
      const checkedPath = precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_report",
        action: "show",
        namespace: REPORT_PREVIEW_NAMESPACE,
        namespaceLabel: "report preview"
      });
      const result = await showReport({ workspacePath: context.workspacePath, path: checkedPath });
      const preview = boundText(result.content, MAX_REPORT_PREVIEW_CHARS);
      return {
        mode: request.mode,
        status: "shown",
        path: result.path,
        hash: result.hash,
        bytes: result.bytes,
        contentPreview: preview.text,
        truncated: preview.truncated,
        maxChars: MAX_REPORT_PREVIEW_CHARS
      };
    }
    case "validate": {
      const { validateReportArtifact } = await import("../report/index.js");
      const pathValue = requireToolPath(request.path, "novelfabric_report", "validate");
      precheckNonProtectedPathInNamespace({
        workspacePath: context.workspacePath,
        requestedPath: pathValue,
        toolName: "novelfabric_report",
        action: "validate",
        namespace: REPORT_ARTIFACT_NAMESPACE,
        namespaceLabel: "report artifact"
      });
      return compactValidationResult({
        target: "report",
        mode: request.mode,
        path: normalizeWorkspacePath(
          resolveInsideRoot(context.workspacePath, pathValue).relativePath
        ),
        result: await validateReportArtifact({
          workspacePath: context.workspacePath,
          artifactPath: pathValue
        })
      });
    }
  }
}

function compactValidationResult(input: {
  readonly target: string;
  readonly mode?: string;
  readonly path?: string;
  readonly jobId?: string;
  readonly result: unknown;
}): JsonObject {
  const record = isJsonObject(input.result) ? input.result : {};
  const valid = record["valid"] === true;
  const status =
    typeof record["status"] === "string" ? record["status"] : valid ? "valid" : "invalid";
  const rawIssues = Array.isArray(record["issues"]) ? record["issues"] : [];
  const boundedIssues = rawIssues.slice(0, MAX_BOUNDED_ISSUES).map(compactIssue);
  return {
    target: input.target,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
    valid,
    status,
    issueCount: rawIssues.length,
    issues: boundedIssues
  };
}

function compactIssue(issue: unknown): JsonObject {
  if (!isJsonObject(issue)) return { message: "Unrecognized validation issue." };
  const severity = typeof issue["severity"] === "string" ? issue["severity"] : undefined;
  const code = typeof issue["code"] === "string" ? issue["code"] : undefined;
  const pathValue = typeof issue["path"] === "string" ? issue["path"] : undefined;
  const message =
    typeof issue["message"] === "string" ? boundText(issue["message"], 500).text : undefined;
  return {
    ...(severity === undefined ? {} : { severity }),
    ...(code === undefined ? {} : { code }),
    ...(pathValue === undefined ? {} : { path: pathValue }),
    ...(message === undefined ? {} : { message })
  };
}

function resultFromPayload(payload: JsonObject, details: JsonObject): WebSafeToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details
  };
}

function parseValidateParams(params: unknown): {
  readonly target: ValidationTarget;
  readonly path?: string;
  readonly jobId?: string;
} {
  const record = requireToolObject(params, "novelfabric_validate");
  const target = requireOneOf(record["target"], "target", [
    "context-pack",
    "workflow",
    "report",
    "writing-draft",
    "swarm-output",
    "cards-proposal",
    "memory-proposal"
  ] as const);
  const pathValue = optionalToolString(record["path"], "path", "novelfabric_validate");
  const jobId = optionalToolString(record["jobId"], "jobId", "novelfabric_validate");
  return {
    target,
    ...(pathValue === undefined ? {} : { path: pathValue }),
    ...(jobId === undefined ? {} : { jobId })
  };
}

function parseContextPackParams(params: unknown): {
  readonly mode: ContextPackMode;
  readonly path?: string;
  readonly kind?: string;
  readonly query?: string;
  readonly agent?: string;
  readonly session?: string;
  readonly timeline?: string;
  readonly outputPath?: string;
  readonly limit?: number;
} {
  const record = requireToolObject(params, "novelfabric_context_pack");
  const mode = requireOneOf(record["mode"], "mode", ["validate", "build"] as const);
  const pathValue = optionalToolString(record["path"], "path", "novelfabric_context_pack");
  const kind = optionalToolString(record["kind"], "kind", "novelfabric_context_pack");
  const query = optionalToolString(record["query"], "query", "novelfabric_context_pack");
  const agent = optionalToolString(record["agent"], "agent", "novelfabric_context_pack");
  const session = optionalToolString(record["session"], "session", "novelfabric_context_pack");
  const timeline = optionalToolString(record["timeline"], "timeline", "novelfabric_context_pack");
  const outputPath = optionalToolString(
    record["outputPath"],
    "outputPath",
    "novelfabric_context_pack"
  );
  const limit = optionalToolNumber(record["limit"], "limit", "novelfabric_context_pack");
  return {
    mode,
    ...(pathValue === undefined ? {} : { path: pathValue }),
    ...(kind === undefined ? {} : { kind }),
    ...(query === undefined ? {} : { query }),
    ...(agent === undefined ? {} : { agent }),
    ...(session === undefined ? {} : { session }),
    ...(timeline === undefined ? {} : { timeline }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(limit === undefined ? {} : { limit })
  };
}

function parseReportParams(params: unknown): { readonly mode: ReportMode; readonly path?: string } {
  const record = requireToolObject(params, "novelfabric_report");
  const mode = requireOneOf(record["mode"], "mode", ["list", "show", "validate"] as const);
  const pathValue = optionalToolString(record["path"], "path", "novelfabric_report");
  return { mode, ...(pathValue === undefined ? {} : { path: pathValue }) };
}

function parseRequiredPathParams(params: unknown, toolName: string): string {
  const record = requireToolObject(params, toolName);
  return requireToolString(record["path"], "path", toolName);
}

function parseWriteFileParams(params: unknown): {
  readonly path: string;
  readonly content: string;
  readonly expectedBaseHash?: string;
  readonly reason: string;
} {
  const record = requireToolObject(params, "novelfabric_write_file");
  const pathValue = requireToolString(record["path"], "path", "novelfabric_write_file");
  const content = requireToolStringValue(record["content"], "content", "novelfabric_write_file");
  const reason = requireToolString(record["reason"], "reason", "novelfabric_write_file");
  const expectedBaseHash = optionalToolString(
    record["expectedBaseHash"],
    "expectedBaseHash",
    "novelfabric_write_file"
  );
  return {
    path: pathValue,
    content,
    reason,
    ...(expectedBaseHash === undefined ? {} : { expectedBaseHash })
  };
}

function requireToolObject(params: unknown, toolName: string): JsonObject {
  if (!isJsonObject(params)) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${toolName} parameters must be an object.`,
      2
    );
  }
  return params;
}

function requireToolPath(
  value: string | undefined,
  toolName: string,
  targetOrMode: string
): string {
  if (value === undefined) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${toolName} ${targetOrMode} requires a non-empty string path.`,
      2
    );
  }
  return value;
}

function requireToolString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${context} requires a non-empty string ${field}.`,
      2
    );
  }
  return value;
}

function requireToolStringValue(value: unknown, field: string, context: string): string {
  if (typeof value !== "string") {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${context} requires a string ${field}.`,
      2
    );
  }
  return value;
}

function optionalToolString(value: unknown, field: string, context: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${context} optional field ${field} must be a string.`,
      2
    );
  }
  return value;
}

function optionalToolNumber(value: unknown, field: string, context: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `${context} optional field ${field} must be a finite number.`,
      2
    );
  }
  return value;
}

function requireOneOf<const TValues extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: TValues
): TValues[number] {
  if (typeof value !== "string" || !allowed.some((allowedValue) => allowedValue === value)) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `Invalid ${field}; expected one of: ${allowed.join(", ")}.`,
      2
    );
  }
  return value;
}

function boundContextPackLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_CONTEXT_PACK_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONTEXT_PACK_LIMIT) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      `novelfabric_context_pack build limit must be an integer between 1 and ${String(MAX_CONTEXT_PACK_LIMIT)}.`,
      2
    );
  }
  return limit;
}

function precheckNonProtectedPath(input: {
  readonly workspacePath: string;
  readonly requestedPath: string;
  readonly toolName: string;
  readonly action: string;
}): string {
  const resolved = resolveInsideRoot(input.workspacePath, input.requestedPath);
  const normalizedPath = normalizeWorkspacePath(resolved.relativePath);
  if (isProtectedWorkspacePath(normalizedPath)) {
    throw new CommandFailure(
      "web_safe_tool_protected_read_denied",
      `Web-safe tool '${input.toolName}' cannot ${input.action} protected path '${normalizedPath}'.`,
      3
    );
  }
  return normalizedPath;
}

function precheckNonProtectedPathInNamespace(input: {
  readonly workspacePath: string;
  readonly requestedPath: string;
  readonly toolName: string;
  readonly action: string;
  readonly namespace: string;
  readonly namespaceLabel: string;
}): string {
  const normalizedPath = precheckNonProtectedPath(input);
  if (!normalizedPath.startsWith(input.namespace)) {
    throw new CommandFailure(
      "web_safe_tool_path_namespace_denied",
      `Web-safe tool '${input.toolName}' cannot ${input.action} ${input.namespaceLabel} path '${normalizedPath}'; expected path under '${input.namespace}'.`,
      3
    );
  }
  return normalizedPath;
}

function precheckWebSafeWritePath(input: {
  readonly workspacePath: string;
  readonly requestedPath: string;
  readonly toolName: string;
  readonly action: string;
}): string {
  const resolved = resolveInsideRoot(input.workspacePath, input.requestedPath);
  const normalizedPath = normalizeWorkspacePath(resolved.relativePath);
  if (isProtectedWorkspacePath(normalizedPath)) {
    throw new CommandFailure(
      "web_safe_tool_protected_write_denied",
      `Web-safe tool '${input.toolName}' cannot ${input.action} protected path '${normalizedPath}'.`,
      3
    );
  }
  if (!WEB_SAFE_WRITE_NAMESPACES.some((namespace) => normalizedPath.startsWith(namespace))) {
    throw new CommandFailure(
      "web_safe_tool_path_namespace_denied",
      `Web-safe tool '${input.toolName}' cannot ${input.action} path '${normalizedPath}'; expected path under one of: ${WEB_SAFE_WRITE_NAMESPACES.join(", ")}.`,
      3
    );
  }
  return normalizedPath;
}

async function statExistingWorkspaceFile(input: {
  readonly workspacePath: string;
  readonly path: string;
}): Promise<{ readonly exists: boolean }> {
  try {
    const stat = await statWorkspaceFile(input);
    if (stat.kind !== "file") {
      throw new CommandFailure(
        "web_safe_write_target_not_file",
        `Web-safe writes can replace only files; '${stat.path}' is a ${stat.kind}.`,
        3
      );
    }
    return { exists: true };
  } catch (error) {
    if (error instanceof CommandFailure && error.code === "file_not_found") {
      return { exists: false };
    }
    throw error;
  }
}

function summarizeWriteForTool(write: {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly auditPath?: string;
}): JsonObject {
  return {
    path: write.path,
    hash: write.hash,
    bytes: write.bytes,
    ...(write.auditPath === undefined ? {} : { auditPath: write.auditPath })
  };
}

function boundText(
  text: string,
  maxChars: number
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}…`, truncated: true };
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
