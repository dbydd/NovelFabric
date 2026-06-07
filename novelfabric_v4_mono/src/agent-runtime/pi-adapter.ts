import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Environment } from "../environment.js";
import { CommandFailure } from "../errors.js";
import type { JsonObject, JsonValue } from "../output.js";
import {
  getRuntimePolicy,
  resolveRuntimeConfigPaths,
  type RuntimeFileStatus,
  type RuntimeThinkingLevel
} from "../runtime/config.js";
import type { AgentRuntimeAdapter, AgentRuntimeLaunchPlan } from "./types.js";

export type PiSdkExportName =
  | "createAgentSession"
  | "AuthStorage"
  | "ModelRegistry"
  | "SettingsManager"
  | "SessionManager"
  | "DefaultResourceLoader"
  | "defineTool";

export type PiSdkAvailability = JsonObject & {
  readonly packageName: "@earendil-works/pi-coding-agent";
  readonly available: boolean;
  readonly version: string | null;
  readonly exports: Readonly<Record<PiSdkExportName, boolean>>;
  readonly error?: string;
};

export type NovelFabricRuntimeRootResolution = JsonObject & {
  readonly runtimeRoot: string;
  readonly settingsPath: string;
  readonly policyProfile: "web-safe";
  readonly source: string;
  readonly globalPiAgentRoot: string | null;
  readonly usesGlobalPiAgentRoot: false;
};

export type WebSafePiToolName =
  | "novelfabric_read_file"
  | "novelfabric_write_file"
  | "novelfabric_context_pack"
  | "novelfabric_validate"
  | "novelfabric_apply_proposal"
  | "novelfabric_report";

export type RawPiToolName =
  | "bash"
  | "write"
  | "edit"
  | "read"
  | "network"
  | "arbitrary_path_access"
  | "raw_bash"
  | "raw_write"
  | "raw_edit"
  | "arbitrary_network";

export type WebSafePiPolicyProfile = JsonObject & {
  readonly profile: "web-safe";
  readonly defaultDecision: "deny";
  readonly allowedNovelFabricTools: readonly WebSafePiToolName[];
  readonly deniedRawTools: readonly RawPiToolName[];
};

export type WebSafePiSessionOptionsInput = {
  readonly environment: Environment;
  readonly actor: string;
  readonly requestedTools?: readonly string[];
  readonly policyProfile?: "web-safe";
};

export type WebSafePiSessionOptions = JsonObject & {
  readonly actor: string;
  readonly runtimeRoot: string;
  readonly settingsPath: string;
  readonly policyProfile: "web-safe";
  readonly allowedTools: readonly WebSafePiToolName[];
  readonly deniedRawTools: readonly RawPiToolName[];
  readonly requestedTools: readonly string[];
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly rawBuiltinToolsEnabled: false;
};

export type PiSdkNormalizedEvent =
  | {
      readonly type: "session.started";
      readonly sessionId?: string;
      readonly timestamp?: string;
    }
  | {
      readonly type: "model.output";
      readonly text: string;
      readonly timestamp?: string;
    }
  | {
      readonly type: "tool.requested";
      readonly toolName: string;
      readonly timestamp?: string;
    }
  | {
      readonly type: "tool.denied";
      readonly toolName: string;
      readonly reason: string;
      readonly timestamp?: string;
    }
  | {
      readonly type: "validation.completed";
      readonly valid: boolean;
      readonly timestamp?: string;
    }
  | {
      readonly type: "session.completed";
      readonly timestamp?: string;
    }
  | {
      readonly type: "session.failed";
      readonly message: string;
      readonly timestamp?: string;
    };

export type PiSdkWorkflowRuntimeConfig = {
  readonly runtimeRoot: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking?: RuntimeThinkingLevel;
};

export type PiSdkAgentTaskRunRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly prompt: string;
  readonly runtime: PiSdkWorkflowRuntimeConfig;
  readonly sessionDirectory?: string;
  readonly sdkModule?: unknown;
};

export type PiSdkAgentTaskRunResult = {
  readonly outputText: string;
  readonly normalizedEvents: readonly PiSdkNormalizedEvent[];
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly sessionDirectory: string;
  readonly engine: "sdk";
};

type PiSdkAgentSession = {
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly messages?: readonly unknown[];
  readonly isStreaming?: boolean;
  getLastAssistantText?(): string | undefined;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string, options?: Readonly<Record<string, unknown>>): Promise<void>;
  dispose(): void;
};

type PiSdkAgentSessionResult = {
  readonly session: PiSdkAgentSession;
};

export type PiSdkAgentSessionModule = {
  readonly createAgentSession: (
    options: Readonly<Record<string, unknown>>
  ) => Promise<PiSdkAgentSessionResult>;
  readonly AuthStorage: {
    create(authPath?: string): unknown;
  };
  readonly ModelRegistry: {
    create(authStorage: unknown, modelsJsonPath?: string): PiSdkModelRegistry;
  };
  readonly SettingsManager: {
    create(cwd: string, agentDir?: string): unknown;
  };
  readonly SessionManager: {
    create(cwd: string, sessionDir?: string): unknown;
    inMemory(cwd?: string): unknown;
  };
  readonly DefaultResourceLoader: new (options: Readonly<Record<string, unknown>>) => unknown;
};

type PiSdkModelRegistry = {
  readonly raw: unknown;
  find(provider: string, modelId: string): unknown;
};

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent" as const;
const REQUIRED_SDK_EXPORTS: readonly PiSdkExportName[] = [
  "createAgentSession",
  "AuthStorage",
  "ModelRegistry",
  "SettingsManager",
  "SessionManager",
  "DefaultResourceLoader",
  "defineTool"
];

const WEB_SAFE_ALLOWED_TOOLS: readonly WebSafePiToolName[] = [
  "novelfabric_read_file",
  "novelfabric_write_file",
  "novelfabric_context_pack",
  "novelfabric_validate",
  "novelfabric_apply_proposal",
  "novelfabric_report"
];

const WEB_SAFE_DENIED_RAW_TOOLS: readonly RawPiToolName[] = [
  "bash",
  "write",
  "edit",
  "read",
  "network",
  "arbitrary_path_access",
  "raw_bash",
  "raw_write",
  "raw_edit",
  "arbitrary_network"
];

export const piAgentRuntimeAdapter: AgentRuntimeAdapter = {
  name: "pi-coding-agent",
  packageName: PI_PACKAGE_NAME,
  describeLaunchPlan(cwd: string): AgentRuntimeLaunchPlan {
    return {
      bridge: PI_PACKAGE_NAME,
      status: "planned",
      cwd,
      sessionMode: "workspace-persistent",
      cliGuardrail: "required",
      notes: [
        "The mono app embeds the pi SDK as a future runtime bridge, not as a direct file mutator.",
        "NovelFabric-managed writes must route through protected CLI primitives and capability manifests.",
        "Role agents remain deny-by-default for protected files, other profiles' memory, and external swarm."
      ]
    };
  }
};

export function resolveNovelFabricPiRuntimeRoot(
  environment: Environment
): NovelFabricRuntimeRootResolution {
  const paths = resolveRuntimeConfigPaths(environment);
  return {
    runtimeRoot: paths.runtimeRoot,
    settingsPath: paths.settingsPath,
    policyProfile: "web-safe",
    source: paths.resolution.source,
    globalPiAgentRoot:
      environment.home === undefined ? null : path.join(environment.home, ".pi", "agent"),
    usesGlobalPiAgentRoot: false
  };
}

export function webSafePiPolicyProfile(): WebSafePiPolicyProfile {
  const policy = getRuntimePolicy("web-safe");
  return {
    profile: "web-safe",
    defaultDecision: "deny",
    allowedNovelFabricTools: WEB_SAFE_ALLOWED_TOOLS.filter((tool) =>
      policy.allowedNovelFabricTools.includes(tool)
    ),
    deniedRawTools: WEB_SAFE_DENIED_RAW_TOOLS.filter((tool) => policy.deniedRawTools.includes(tool))
  };
}

export function buildWebSafePiSessionOptions(
  input: WebSafePiSessionOptionsInput
): WebSafePiSessionOptions {
  const runtime = resolveNovelFabricPiRuntimeRoot(input.environment);
  const policy = webSafePiPolicyProfile();
  const requestedTools = input.requestedTools ?? [];
  const violations = requestedTools.flatMap((tool) => {
    if (isDeniedRawTool(tool, policy.deniedRawTools)) {
      return [`raw tool '${tool}' is denied by the NovelFabric web-safe runtime policy`];
    }
    if (!isAllowedNovelFabricTool(tool, policy.allowedNovelFabricTools)) {
      return [`tool '${tool}' is not in the NovelFabric web-safe allowlist`];
    }
    return [];
  });

  return {
    actor: input.actor,
    runtimeRoot: runtime.runtimeRoot,
    settingsPath: runtime.settingsPath,
    policyProfile: input.policyProfile ?? "web-safe",
    allowedTools: policy.allowedNovelFabricTools,
    deniedRawTools: policy.deniedRawTools,
    requestedTools,
    valid: violations.length === 0,
    violations,
    rawBuiltinToolsEnabled: false
  };
}

export async function inspectPiSdkAvailability(): Promise<PiSdkAvailability> {
  try {
    const piSdk = await import("@earendil-works/pi-coding-agent");
    const exports = applyTestForcedMissingExports(exportStatus(piSdk));
    return {
      packageName: PI_PACKAGE_NAME,
      available: REQUIRED_SDK_EXPORTS.every((name) => exports[name]),
      version: await readPiPackageVersion(),
      exports
    };
  } catch (error) {
    return {
      packageName: PI_PACKAGE_NAME,
      available: false,
      version: null,
      exports: emptyExportStatus(),
      error: sanitizeSdkDiagnosticMessage(
        error instanceof Error ? error.message : "Unable to inspect pi SDK availability."
      )
    };
  }
}

export function piSdkAvailabilityDiagnostic(availability: PiSdkAvailability): RuntimeFileStatus {
  const missingExports = REQUIRED_SDK_EXPORTS.filter((name) => !availability.exports[name]);
  if (availability.available && missingExports.length === 0) {
    return {
      path: availability.packageName,
      exists: true,
      valid: true,
      kind: "pi-sdk",
      packageName: availability.packageName,
      version: availability.version,
      missingExports
    };
  }

  return {
    path: availability.packageName,
    exists: availability.error === undefined,
    valid: false,
    kind: "pi-sdk",
    packageName: availability.packageName,
    version: availability.version,
    reason: availability.error === undefined ? "missing_required_exports" : "package_unavailable",
    missingExports,
    ...(availability.error === undefined
      ? {}
      : { error: sanitizeSdkDiagnosticMessage(availability.error) })
  };
}

export function normalizePiSdkEvent(rawEvent: unknown): PiSdkNormalizedEvent {
  if (!isJsonObject(rawEvent)) {
    return { type: "session.failed", message: "Unrecognized pi SDK event." };
  }

  const rawType = stringValue(rawEvent["type"]);
  const timestamp = optionalString(rawEvent["timestamp"]);
  switch (rawType) {
    case "session.started":
    case "session_started":
    case "started": {
      const sessionId = optionalString(rawEvent["sessionId"]);
      return withOptionalTimestamp(
        sessionId === undefined
          ? { type: "session.started" }
          : { type: "session.started", sessionId },
        timestamp
      );
    }
    case "model.output":
    case "model_output":
    case "assistant.message":
      return withOptionalTimestamp(
        { type: "model.output", text: stringValue(rawEvent["text"]) ?? "" },
        timestamp
      );
    case "tool.requested":
    case "tool_call":
    case "tool.request":
      return withOptionalTimestamp(
        { type: "tool.requested", toolName: toolNameFromRawEvent(rawEvent) },
        timestamp
      );
    case "tool.denied":
      return withOptionalTimestamp(
        {
          type: "tool.denied",
          toolName: toolNameFromRawEvent(rawEvent),
          reason: stringValue(rawEvent["reason"]) ?? "Tool denied by NovelFabric runtime policy."
        },
        timestamp
      );
    case "validation.completed":
    case "validation_completed":
      return withOptionalTimestamp(
        { type: "validation.completed", valid: rawEvent["valid"] === true },
        timestamp
      );
    case "session.completed":
    case "completed":
      return withOptionalTimestamp({ type: "session.completed" }, timestamp);
    case "session.failed":
    case "failed":
    case "error":
      return withOptionalTimestamp(
        {
          type: "session.failed",
          message: stringValue(rawEvent["message"]) ?? "pi SDK session failed."
        },
        timestamp
      );
    default:
      return withOptionalTimestamp(
        { type: "session.failed", message: "Unrecognized pi SDK event." },
        timestamp
      );
  }
}

export async function assertPiSdkImportAvailable(): Promise<AgentRuntimeLaunchPlan> {
  const availability = await inspectPiSdkAvailability();
  if (!availability.available) {
    throw new Error(`${PI_PACKAGE_NAME} required SDK exports are unavailable.`);
  }

  return piAgentRuntimeAdapter.describeLaunchPlan(process.cwd());
}

export async function runPiSdkAgentTask(
  request: PiSdkAgentTaskRunRequest
): Promise<PiSdkAgentTaskRunResult> {
  const sdkModule = toPiSdkAgentSessionModule(request.sdkModule ?? (await import(PI_PACKAGE_NAME)));
  const sessionDirectory =
    request.sessionDirectory ??
    path.join(request.workspacePath, ".novelfabric", "pi-sessions", request.taskId);
  await mkdir(sessionDirectory, { recursive: true });

  const authStorage = sdkModule.AuthStorage.create(
    path.join(request.runtime.runtimeRoot, "auth.json")
  );
  const modelRegistry = sdkModule.ModelRegistry.create(
    authStorage,
    path.join(request.runtime.runtimeRoot, "models.json")
  );
  const model = modelRegistry.find(request.runtime.provider, request.runtime.model);
  if (model === undefined) {
    throw new CommandFailure(
      "pi_sdk_model_unavailable",
      `NovelFabric pi SDK runtime could not find workflow model '${request.runtime.provider}/${request.runtime.model}' in '${request.runtime.runtimeRoot}'.`,
      2
    );
  }

  const settingsManager = sdkModule.SettingsManager.create(
    request.workspacePath,
    request.runtime.runtimeRoot
  );
  const resourceLoader = new sdkModule.DefaultResourceLoader({
    cwd: request.workspacePath,
    agentDir: request.runtime.runtimeRoot,
    settingsManager,
    noExtensions: true,
    noContextFiles: true,
    systemPrompt:
      "You are the NovelFabric web-safe pi SDK runtime. Raw read/write/edit/bash/network tools are disabled. Return only the requested final answer."
  });
  if (isJsonObject(resourceLoader)) {
    const reload = Reflect.get(resourceLoader, "reload");
    if (typeof reload === "function") {
      await Reflect.apply(reload, resourceLoader, []);
    }
  }

  const { session } = await sdkModule.createAgentSession({
    cwd: request.workspacePath,
    agentDir: request.runtime.runtimeRoot,
    model,
    ...(request.runtime.thinking === undefined ? {} : { thinkingLevel: request.runtime.thinking }),
    authStorage,
    modelRegistry: modelRegistry.raw,
    settingsManager,
    resourceLoader,
    noTools: "all",
    tools: [],
    customTools: [],
    sessionManager: sdkModule.SessionManager.create(request.workspacePath, sessionDirectory)
  });

  const normalizedEvents: PiSdkNormalizedEvent[] = [];
  const outputParts: string[] = [];
  const unsubscribe = session.subscribe((event) => {
    const normalized = normalizePiSdkEvent(event);
    normalizedEvents.push(normalized);
    if (normalized.type === "model.output") {
      outputParts.push(normalized.text);
    }
  });

  try {
    const messageCountBeforePrompt = session.messages?.length ?? 0;
    normalizedEvents.push({
      type: "session.started",
      ...(session.sessionId === undefined ? {} : { sessionId: session.sessionId })
    });
    await session.prompt(request.prompt, { expandPromptTemplates: false, source: "novelfabric" });
    normalizedEvents.push({ type: "session.completed" });
    let outputText = outputParts.join("").trim();
    if (outputText.length === 0) {
      const fallbackOutput = extractLastAssistantTextFromCurrentPrompt(
        session,
        messageCountBeforePrompt
      );
      if (fallbackOutput !== undefined) {
        outputText = fallbackOutput;
        normalizedEvents.push({ type: "model.output", text: fallbackOutput });
      }
    }
    if (outputText.length === 0) {
      throw new CommandFailure("pi_sdk_empty_output", "pi SDK session returned empty output.", 2);
    }
    return {
      outputText,
      normalizedEvents,
      ...(session.sessionId === undefined ? {} : { sessionId: session.sessionId }),
      ...(session.sessionFile === undefined ? {} : { sessionFile: session.sessionFile }),
      sessionDirectory,
      engine: "sdk"
    };
  } catch (error) {
    normalizedEvents.push({
      type: "session.failed",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

function extractLastAssistantTextFromCurrentPrompt(
  session: PiSdkAgentSession,
  messageCountBeforePrompt: number
): string | undefined {
  const messages = session.messages;
  if (messages === undefined) return undefined;
  if (messages.length <= messageCountBeforePrompt) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (index < messageCountBeforePrompt) break;
    const message = messages[index];
    const text = extractAssistantTextFromMessage(message);
    if (text !== undefined) return text;
  }
  return undefined;
}

function extractAssistantTextFromMessage(message: unknown): string | undefined {
  if (!isJsonObject(message) || message["role"] !== "assistant") return undefined;
  const content = message["content"];
  if (typeof content === "string" && content.trim().length > 0) return content.trim();
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item): readonly string[] => {
    if (typeof item === "string") return [item];
    if (!isJsonObject(item)) return [];
    const text = item["text"];
    return typeof text === "string" ? [text] : [];
  });
  const joined = parts.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

function toPiSdkAgentSessionModule(moduleExports: unknown): PiSdkAgentSessionModule {
  if (!isJsonObject(moduleExports)) {
    throw new CommandFailure("pi_sdk_unavailable", "pi SDK module exports are not an object.", 2);
  }
  const createAgentSession = callableExport(moduleExports, "createAgentSession");
  const AuthStorage = staticMethodOwnerExport(moduleExports, "AuthStorage");
  const ModelRegistry = staticMethodOwnerExport(moduleExports, "ModelRegistry");
  const SettingsManager = staticMethodOwnerExport(moduleExports, "SettingsManager");
  const SessionManager = staticMethodOwnerExport(moduleExports, "SessionManager");
  const DefaultResourceLoader = constructorExport(moduleExports, "DefaultResourceLoader");

  return {
    createAgentSession: async (options) => {
      const result: unknown = await Reflect.apply(createAgentSession, moduleExports, [options]);
      if (!isJsonObject(result) || !isPiSdkAgentSession(result["session"])) {
        throw new CommandFailure(
          "pi_sdk_session_unavailable",
          "pi SDK createAgentSession did not return a usable session.",
          2
        );
      }
      return { session: result["session"] };
    },
    AuthStorage: {
      create(authPath) {
        return Reflect.apply(callableExport(AuthStorage, "create"), AuthStorage, [authPath]);
      }
    },
    ModelRegistry: {
      create(authStorage, modelsJsonPath) {
        const raw = Reflect.apply(callableExport(ModelRegistry, "create"), ModelRegistry, [
          authStorage,
          modelsJsonPath
        ]);
        const find = callableProperty(raw, "find", "ModelRegistry.find");
        return {
          raw,
          find(provider, modelId) {
            return Reflect.apply(find, raw, [provider, modelId]);
          }
        };
      }
    },
    SettingsManager: {
      create(cwd, agentDir) {
        return Reflect.apply(callableExport(SettingsManager, "create"), SettingsManager, [
          cwd,
          agentDir
        ]);
      }
    },
    SessionManager: {
      create(cwd, sessionDir) {
        return Reflect.apply(callableExport(SessionManager, "create"), SessionManager, [
          cwd,
          sessionDir
        ]);
      },
      inMemory(cwd) {
        return Reflect.apply(callableExport(SessionManager, "inMemory"), SessionManager, [cwd]);
      }
    },
    DefaultResourceLoader
  };
}

function isPiSdkAgentSession(value: unknown): value is PiSdkAgentSession {
  return (
    isJsonObject(value) &&
    typeof Reflect.get(value, "subscribe") === "function" &&
    typeof Reflect.get(value, "prompt") === "function" &&
    typeof Reflect.get(value, "dispose") === "function"
  );
}

function callableExport(moduleExports: object, name: string): (...args: unknown[]) => unknown {
  return callableProperty(moduleExports, name, `pi SDK export ${name}`);
}

function staticMethodOwnerExport(moduleExports: object, name: string): object {
  const value = reflectGet(moduleExports, name);
  if (!isStaticMethodOwner(value)) {
    throw new CommandFailure("pi_sdk_unavailable", `pi SDK export ${name} is unavailable.`, 2);
  }
  return value;
}

function constructorExport(
  moduleExports: object,
  name: string
): new (options: Readonly<Record<string, unknown>>) => unknown {
  const value = reflectGet(moduleExports, name);
  if (!isResourceLoaderConstructor(value)) {
    throw new CommandFailure("pi_sdk_unavailable", `pi SDK export ${name} is unavailable.`, 2);
  }
  return value;
}

function callableProperty(
  owner: unknown,
  name: string,
  label: string
): (...args: unknown[]) => unknown {
  const value = isStaticMethodOwner(owner) ? reflectGet(owner, name) : undefined;
  if (!isCallableFunction(value)) {
    throw new CommandFailure("pi_sdk_unavailable", `${label} is unavailable.`, 2);
  }
  return value;
}

function isCallableFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function reflectGet(owner: object, name: string): unknown {
  return Reflect.get(owner, name) as unknown;
}

function isStaticMethodOwner(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isResourceLoaderConstructor(
  value: unknown
): value is new (options: Readonly<Record<string, unknown>>) => unknown {
  return typeof value === "function";
}

function exportStatus(moduleExports: object): Readonly<Record<PiSdkExportName, boolean>> {
  return {
    createAgentSession: typeof Reflect.get(moduleExports, "createAgentSession") === "function",
    AuthStorage: typeof Reflect.get(moduleExports, "AuthStorage") === "function",
    ModelRegistry: typeof Reflect.get(moduleExports, "ModelRegistry") === "function",
    SettingsManager: typeof Reflect.get(moduleExports, "SettingsManager") === "function",
    SessionManager: typeof Reflect.get(moduleExports, "SessionManager") === "function",
    DefaultResourceLoader:
      typeof Reflect.get(moduleExports, "DefaultResourceLoader") === "function",
    defineTool: typeof Reflect.get(moduleExports, "defineTool") === "function"
  };
}

function emptyExportStatus(): Readonly<Record<PiSdkExportName, boolean>> {
  return {
    createAgentSession: false,
    AuthStorage: false,
    ModelRegistry: false,
    SettingsManager: false,
    SessionManager: false,
    DefaultResourceLoader: false,
    defineTool: false
  };
}

function applyTestForcedMissingExports(
  exports: Readonly<Record<PiSdkExportName, boolean>>
): Readonly<Record<PiSdkExportName, boolean>> {
  const forcedMissingExports = forcedMissingPiSdkExportsForTests();
  if (forcedMissingExports.length === 0) {
    return exports;
  }

  return Object.fromEntries(
    REQUIRED_SDK_EXPORTS.map((name) => [
      name,
      forcedMissingExports.includes(name) ? false : exports[name]
    ])
  ) as Readonly<Record<PiSdkExportName, boolean>>;
}

function forcedMissingPiSdkExportsForTests(): readonly PiSdkExportName[] {
  // Test-only failure injection: this can only mark real exports as missing so production
  // diagnostics cannot be made falsely healthy by setting an environment variable.
  const rawValue = process.env["NOVELFABRIC_TEST_FORCE_PI_SDK_MISSING_EXPORTS"];
  if (rawValue === undefined || rawValue.trim() === "") {
    return [];
  }

  const requestedNames = rawValue
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (requestedNames.includes("*")) {
    return REQUIRED_SDK_EXPORTS;
  }

  return requestedNames.filter(isPiSdkExportName);
}

function isPiSdkExportName(value: string): value is PiSdkExportName {
  return REQUIRED_SDK_EXPORTS.includes(value as PiSdkExportName);
}

function sanitizeSdkDiagnosticMessage(message: string): string {
  return message.replace(
    /(api[_-]?key|authorization|token|secret|bearer)\s*[:=]\s*\S+/gi,
    "$1=<redacted>"
  );
}

async function readPiPackageVersion(): Promise<string | null> {
  try {
    const packageJsonUrl = new URL("../package.json", import.meta.resolve(PI_PACKAGE_NAME));
    const parsed: unknown = JSON.parse(await readFile(fileURLToPath(packageJsonUrl), "utf8"));
    if (isJsonObject(parsed)) {
      return stringValue(parsed["version"]) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function isAllowedNovelFabricTool(
  tool: string,
  allowedTools: readonly WebSafePiToolName[]
): tool is WebSafePiToolName {
  return allowedTools.some((allowed) => allowed === tool);
}

function isDeniedRawTool(
  tool: string,
  deniedTools: readonly RawPiToolName[]
): tool is RawPiToolName {
  return deniedTools.some((denied) => denied === tool);
}

function toolNameFromRawEvent(rawEvent: JsonObject): string {
  return (
    stringValue(rawEvent["toolName"]) ??
    stringValue(rawEvent["tool"]) ??
    stringValue(rawEvent["name"]) ??
    "unknown"
  );
}

function withOptionalTimestamp<TEvent extends PiSdkNormalizedEvent>(
  event: TEvent,
  timestamp: string | undefined
): TEvent {
  if (timestamp === undefined) return event;
  return { ...event, timestamp };
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
