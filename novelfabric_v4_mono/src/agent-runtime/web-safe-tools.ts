import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import type { JsonObject } from "../output.js";
import { readWorkspaceFile } from "../workspace/files.js";
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

export const WEB_SAFE_CUSTOM_TOOL_NAMES = ["novelfabric_read_file"] as const;

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
    name: "novelfabric_context_pack",
    implemented: false,
    mode: "planned",
    description:
      "Planned controlled context-pack builder/reader. Not exposed to SDK sessions until implemented."
  },
  {
    name: "novelfabric_validate",
    implemented: false,
    mode: "planned",
    description:
      "Planned controlled validation tool. Not exposed to SDK sessions until implemented."
  }
];

export function buildNovelFabricWebSafeCustomTools(input: {
  readonly context: WebSafeToolContext;
  readonly defineTool?: WebSafeDefineTool;
}): readonly unknown[] {
  const tools = [createReadFileTool(input.context)];
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
      if (signal?.aborted === true) {
        throw new CommandFailure("web_safe_tool_aborted", "Tool execution was aborted.", 2);
      }
      const filePath = parseReadFilePath(params);
      const precheckedPath = precheckNonProtectedReadPath(context.workspacePath, filePath);
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
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        details: {
          path: read.path,
          hash: read.hash,
          bytes: read.bytes,
          protected: false
        }
      };
    }
  };
}

function precheckNonProtectedReadPath(workspacePath: string, requestedPath: string): string {
  const resolved = resolveInsideRoot(workspacePath, requestedPath);
  const normalizedPath = normalizeWorkspacePath(resolved.relativePath);
  if (isProtectedWorkspacePath(normalizedPath)) {
    throw new CommandFailure(
      "web_safe_tool_protected_read_denied",
      `Web-safe tool 'novelfabric_read_file' cannot read protected path '${normalizedPath}'.`,
      3
    );
  }
  return normalizedPath;
}

function parseReadFilePath(params: unknown): string {
  if (!isJsonObject(params)) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      "novelfabric_read_file parameters must be an object.",
      2
    );
  }
  const filePath = params["path"];
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new CommandFailure(
      "web_safe_tool_invalid_params",
      "novelfabric_read_file requires a non-empty string path.",
      2
    );
  }
  return filePath;
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
