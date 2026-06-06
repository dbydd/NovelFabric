import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveConfigRoot, type ConfigRootResolution } from "../config/config-root.js";
import type { Environment } from "../environment.js";
import { CommandFailure } from "../errors.js";
import type { JsonObject } from "../output.js";

export type RuntimeConfigPaths = {
  readonly novelfabricConfigRoot: string;
  readonly runtimeRoot: string;
  readonly settingsPath: string;
  readonly policiesDirectory: string;
  readonly webSafePolicyPath: string;
  readonly extensionsDirectory: string;
  readonly skillsDirectory: string;
  readonly promptsDirectory: string;
  readonly resolution: ConfigRootResolution;
};

export type RuntimeThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RuntimeModelDefaults = JsonObject & {
  readonly provider: string;
  readonly model: string;
  readonly thinking: RuntimeThinkingLevel;
  readonly purpose: "testing" | "production";
};

export type RuntimeSettings = JsonObject & {
  readonly schemaVersion: "novelfabric.pi.runtime.settings.v1";
  readonly runtime: "pi-agent-sdk";
  readonly owner: "novelfabric";
  readonly actor: string;
  readonly policyProfile: "web-safe";
  readonly allowGlobalPiConfig: false;
  readonly modelsFile?: string;
  readonly modelDefaults?: RuntimeModelDefaults;
  readonly testModelDefaults?: RuntimeModelDefaults;
  readonly directories: {
    readonly extensions: "extensions";
    readonly skills: "skills";
    readonly prompts: "prompts";
    readonly policies: "policies";
  };
  readonly notes: readonly string[];
};

export type RuntimePolicyProfile = "web-safe";

export type RuntimePolicy = JsonObject & {
  readonly schemaVersion: "novelfabric.pi.runtime.policy.v1";
  readonly profile: RuntimePolicyProfile;
  readonly defaultDecision: "deny";
  readonly deniedRawTools: readonly string[];
  readonly allowedNovelFabricTools: readonly string[];
  readonly constraints: {
    readonly workspaceBound: true;
    readonly durableWritesViaNovelFabricCli: true;
    readonly protectedWritesRequireCapability: true;
    readonly arbitraryNetworkDenied: true;
  };
  readonly toolRules: readonly RuntimeToolRule[];
};

export type RuntimeToolRule = JsonObject & {
  readonly tool: string;
  readonly decision: "allow" | "deny";
  readonly reason: string;
};

export type RuntimeExtensionMetadata = JsonObject & {
  readonly schemaVersion: "novelfabric.pi.extension.metadata.v1";
  readonly id: string;
  readonly name: string;
  readonly status: "metadata-only";
  readonly kind: "sandbox" | "permission-gate" | "cli-tool-adapter";
  readonly description: string;
  readonly providesTools: readonly string[];
  readonly deniedRawTools: readonly string[];
  readonly implementation: "placeholder-metadata-only";
};

export type RuntimeExtensionRecord = RuntimeExtensionMetadata & {
  readonly directoryName: string;
  readonly relativeMetadataPath: string;
};

export type RuntimePathResult = RuntimeConfigPaths & {
  readonly outputMode?: JsonObject;
};

export type RuntimeMaterializeRequest = {
  readonly environment: Environment;
  readonly actor: string;
};

export type RuntimeMaterializeResult = {
  readonly runtimeRoot: string;
  readonly settingsPath: string;
  readonly policyPath: string;
  readonly extensionsDirectory: string;
  readonly actor: string;
  readonly createdDirectories: readonly string[];
  readonly writtenFiles: readonly string[];
  readonly existingFiles: readonly string[];
};

export type RuntimeFileStatus = JsonObject & {
  readonly path: string;
  readonly exists: boolean;
  readonly valid: boolean;
  readonly reason?: string;
};

export type RuntimeInspectResult = {
  readonly runtimeRoot: string;
  readonly settings: RuntimeFileStatus;
  readonly policy: RuntimeFileStatus;
  readonly extensions: readonly RuntimeFileStatus[];
  readonly directories: readonly RuntimeFileStatus[];
};

export type RuntimeDoctorResult = RuntimeInspectResult & {
  readonly valid: boolean;
  readonly missingCount: number;
  readonly invalidCount: number;
};

const WEB_SAFE_POLICY_PROFILE: RuntimePolicyProfile = "web-safe";

export const runtimeExtensionDefaults = [
  {
    schemaVersion: "novelfabric.pi.extension.metadata.v1",
    id: "novelfabric-sandbox-path-guard",
    name: "NovelFabric Sandbox Path Guard",
    status: "metadata-only",
    kind: "sandbox",
    description:
      "Placeholder metadata for a pi SDK extension that restricts file access to NovelFabric-approved workspace paths.",
    providesTools: ["novelfabric_resolve_workspace_path"],
    deniedRawTools: ["arbitrary_path_access"],
    implementation: "placeholder-metadata-only",
    directoryName: "novelfabric-sandbox-path-guard",
    relativeMetadataPath: "extensions/novelfabric-sandbox-path-guard/extension.json"
  },
  {
    schemaVersion: "novelfabric.pi.extension.metadata.v1",
    id: "novelfabric-permission-gate",
    name: "NovelFabric Permission Gate",
    status: "metadata-only",
    kind: "permission-gate",
    description:
      "Placeholder metadata for a pi SDK extension that maps runtime tool use to NovelFabric capabilities and Web-safe policy.",
    providesTools: ["novelfabric_check_capability", "novelfabric_policy_decision"],
    deniedRawTools: ["bash", "write", "edit", "network"],
    implementation: "placeholder-metadata-only",
    directoryName: "novelfabric-permission-gate",
    relativeMetadataPath: "extensions/novelfabric-permission-gate/extension.json"
  },
  {
    schemaVersion: "novelfabric.pi.extension.metadata.v1",
    id: "novelfabric-cli-workspace-tools",
    name: "NovelFabric CLI Workspace Tools",
    status: "metadata-only",
    kind: "cli-tool-adapter",
    description:
      "Placeholder metadata for pi SDK tools that call novelfabric CLI/shared services instead of exposing raw write/edit/bash.",
    providesTools: [
      "novelfabric_read_file",
      "novelfabric_write_file",
      "novelfabric_context_pack",
      "novelfabric_validate",
      "novelfabric_apply_proposal",
      "novelfabric_report"
    ],
    deniedRawTools: ["raw_write", "raw_edit", "raw_bash"],
    implementation: "placeholder-metadata-only",
    directoryName: "novelfabric-cli-workspace-tools",
    relativeMetadataPath: "extensions/novelfabric-cli-workspace-tools/extension.json"
  }
] as const satisfies readonly RuntimeExtensionRecord[];

export function resolveRuntimeConfigPaths(environment: Environment): RuntimeConfigPaths {
  const resolution = resolveConfigRoot(environment);
  const runtimeRoot = path.join(resolution.configRoot, "pi");
  const policiesDirectory = path.join(runtimeRoot, "policies");
  const extensionsDirectory = path.join(runtimeRoot, "extensions");
  return {
    novelfabricConfigRoot: resolution.configRoot,
    runtimeRoot,
    settingsPath: path.join(runtimeRoot, "settings.json"),
    policiesDirectory,
    webSafePolicyPath: path.join(policiesDirectory, "web-safe.json"),
    extensionsDirectory,
    skillsDirectory: path.join(runtimeRoot, "skills"),
    promptsDirectory: path.join(runtimeRoot, "prompts"),
    resolution
  };
}

export function defaultRuntimeSettings(actor: string): RuntimeSettings {
  return {
    schemaVersion: "novelfabric.pi.runtime.settings.v1",
    runtime: "pi-agent-sdk",
    owner: "novelfabric",
    actor,
    policyProfile: WEB_SAFE_POLICY_PROFILE,
    allowGlobalPiConfig: false,
    directories: {
      extensions: "extensions",
      skills: "skills",
      prompts: "prompts",
      policies: "policies"
    },
    notes: [
      "This file configures the NovelFabric-wrapped pi SDK runtime envelope.",
      "It does not define a NovelFabric-owned LLM provider backend.",
      "Web-safe sessions must use NovelFabric extensions/tools instead of raw bash/write/edit."
    ]
  };
}

export function webSafeRuntimePolicy(): RuntimePolicy {
  return {
    schemaVersion: "novelfabric.pi.runtime.policy.v1",
    profile: WEB_SAFE_POLICY_PROFILE,
    defaultDecision: "deny",
    deniedRawTools: ["bash", "write", "edit", "network", "arbitrary_path_access"],
    allowedNovelFabricTools: [
      "novelfabric_read_file",
      "novelfabric_write_file",
      "novelfabric_context_pack",
      "novelfabric_validate",
      "novelfabric_apply_proposal",
      "novelfabric_report"
    ],
    constraints: {
      workspaceBound: true,
      durableWritesViaNovelFabricCli: true,
      protectedWritesRequireCapability: true,
      arbitraryNetworkDenied: true
    },
    toolRules: [
      {
        tool: "bash",
        decision: "deny",
        reason: "Nontechnical Web sessions must not receive unrestricted shell access."
      },
      {
        tool: "write",
        decision: "deny",
        reason: "Durable writes must go through NovelFabric CLI/shared workspace services."
      },
      {
        tool: "edit",
        decision: "deny",
        reason: "Durable edits must go through NovelFabric CLI/shared workspace services."
      },
      {
        tool: "network",
        decision: "deny",
        reason: "Arbitrary network access is outside the default Web-safe envelope."
      },
      {
        tool: "novelfabric_write_file",
        decision: "allow",
        reason: "Allowed only as a controlled adapter over capability-checked NovelFabric writes."
      }
    ]
  };
}

export function getRuntimePolicy(profile: string): RuntimePolicy {
  if (profile !== WEB_SAFE_POLICY_PROFILE) {
    throw new CommandFailure(
      "invalid_runtime_policy_profile",
      `Unsupported runtime policy profile '${profile}'. Only 'web-safe' is available.`
    );
  }
  return webSafeRuntimePolicy();
}

export async function materializeRuntimeConfig(
  request: RuntimeMaterializeRequest
): Promise<RuntimeMaterializeResult> {
  const paths = resolveRuntimeConfigPaths(request.environment);
  const createdDirectories = await ensureRuntimeDirectories(paths);
  const writtenFiles: string[] = [];
  const existingFiles: string[] = [];

  await writeJsonFileIfMissing(paths.settingsPath, defaultRuntimeSettings(request.actor), {
    writtenFiles,
    existingFiles
  });
  await writeJsonFileIfMissing(paths.webSafePolicyPath, webSafeRuntimePolicy(), {
    writtenFiles,
    existingFiles
  });

  for (const extension of runtimeExtensionDefaults) {
    const metadataPath = path.join(paths.runtimeRoot, extension.relativeMetadataPath);
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeJsonFileIfMissing(metadataPath, extensionMetadataForFile(extension), {
      writtenFiles,
      existingFiles
    });
  }

  return {
    runtimeRoot: paths.runtimeRoot,
    settingsPath: paths.settingsPath,
    policyPath: paths.webSafePolicyPath,
    extensionsDirectory: paths.extensionsDirectory,
    actor: request.actor,
    createdDirectories,
    writtenFiles,
    existingFiles
  };
}

export async function inspectRuntimeConfig(
  environment: Environment
): Promise<RuntimeInspectResult> {
  const paths = resolveRuntimeConfigPaths(environment);
  return {
    runtimeRoot: paths.runtimeRoot,
    settings: await inspectJsonFile(paths.settingsPath, isRuntimeSettingsFile),
    policy: await inspectJsonFile(paths.webSafePolicyPath, isRuntimePolicyFile),
    extensions: await Promise.all(
      runtimeExtensionDefaults.map((extension) =>
        inspectJsonFile(
          path.join(paths.runtimeRoot, extension.relativeMetadataPath),
          isRuntimeExtensionMetadataFile
        )
      )
    ),
    directories: await Promise.all([
      inspectDirectory(paths.runtimeRoot),
      inspectDirectory(paths.policiesDirectory),
      inspectDirectory(paths.extensionsDirectory),
      inspectDirectory(paths.skillsDirectory),
      inspectDirectory(paths.promptsDirectory)
    ])
  };
}

export async function doctorRuntimeConfig(environment: Environment): Promise<RuntimeDoctorResult> {
  const inspection = await inspectRuntimeConfig(environment);
  const statuses = [
    inspection.settings,
    inspection.policy,
    ...inspection.extensions,
    ...inspection.directories
  ];
  const missingCount = statuses.filter((status) => !status.exists).length;
  const invalidCount = statuses.filter((status) => status.exists && !status.valid).length;
  return {
    ...inspection,
    valid: missingCount === 0 && invalidCount === 0,
    missingCount,
    invalidCount
  };
}

export function listRuntimeExtensions(): readonly RuntimeExtensionRecord[] {
  return runtimeExtensionDefaults;
}

export async function validateRuntimeExtensions(
  environment: Environment
): Promise<readonly RuntimeFileStatus[]> {
  const paths = resolveRuntimeConfigPaths(environment);
  return Promise.all(
    runtimeExtensionDefaults.map((extension) =>
      inspectJsonFile(
        path.join(paths.runtimeRoot, extension.relativeMetadataPath),
        isRuntimeExtensionMetadataFile
      )
    )
  );
}

async function ensureRuntimeDirectories(paths: RuntimeConfigPaths): Promise<readonly string[]> {
  const directories = [
    paths.runtimeRoot,
    paths.policiesDirectory,
    paths.extensionsDirectory,
    paths.skillsDirectory,
    paths.promptsDirectory
  ];
  const created: string[] = [];
  for (const directory of directories) {
    if (!(await pathExists(directory))) {
      created.push(directory);
    }
    await mkdir(directory, { recursive: true });
  }
  return created;
}

async function writeJsonFileIfMissing(
  filePath: string,
  payload: JsonObject,
  result: { readonly writtenFiles: string[]; readonly existingFiles: string[] }
): Promise<void> {
  if (await pathExists(filePath)) {
    result.existingFiles.push(filePath);
    return;
  }
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  result.writtenFiles.push(filePath);
}

function extensionMetadataForFile(extension: RuntimeExtensionRecord): RuntimeExtensionMetadata {
  return {
    schemaVersion: extension.schemaVersion,
    id: extension.id,
    name: extension.name,
    status: extension.status,
    kind: extension.kind,
    description: extension.description,
    providesTools: extension.providesTools,
    deniedRawTools: extension.deniedRawTools,
    implementation: extension.implementation
  };
}

async function inspectDirectory(directoryPath: string): Promise<RuntimeFileStatus> {
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) {
      return { path: directoryPath, exists: true, valid: false, reason: "not_a_directory" };
    }
    return { path: directoryPath, exists: true, valid: true };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { path: directoryPath, exists: false, valid: false, reason: "missing" };
    }
    throw error;
  }
}

async function inspectJsonFile(
  filePath: string,
  validator: (value: JsonObject) => boolean
): Promise<RuntimeFileStatus> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return { path: filePath, exists: true, valid: false, reason: "not_a_file" };
    }
    const content = await readFile(filePath, "utf8");
    const parsed = parseJsonObject(content);
    if (!validator(parsed)) {
      return { path: filePath, exists: true, valid: false, reason: "schema_mismatch" };
    }
    return { path: filePath, exists: true, valid: true };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { path: filePath, exists: false, valid: false, reason: "missing" };
    }
    if (error instanceof SyntaxError) {
      return { path: filePath, exists: true, valid: false, reason: "invalid_json" };
    }
    throw error;
  }
}

function parseJsonObject(content: string): JsonObject {
  const parsed: unknown = JSON.parse(content);
  if (isJsonObject(parsed)) {
    return parsed;
  }
  throw new SyntaxError("Expected a JSON object.");
}

function isRuntimeSettingsFile(value: JsonObject): boolean {
  const modelDefaults = value["modelDefaults"];
  const testModelDefaults = value["testModelDefaults"];
  return (
    value["schemaVersion"] === "novelfabric.pi.runtime.settings.v1" &&
    value["runtime"] === "pi-agent-sdk" &&
    value["owner"] === "novelfabric" &&
    typeof value["actor"] === "string" &&
    value["policyProfile"] === WEB_SAFE_POLICY_PROFILE &&
    value["allowGlobalPiConfig"] === false &&
    (value["modelsFile"] === undefined || typeof value["modelsFile"] === "string") &&
    (modelDefaults === undefined || isRuntimeModelDefaults(modelDefaults)) &&
    (testModelDefaults === undefined || isRuntimeModelDefaults(testModelDefaults))
  );
}

function isRuntimeModelDefaults(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return (
    typeof value["provider"] === "string" &&
    typeof value["model"] === "string" &&
    isThinkingLevel(value["thinking"]) &&
    (value["purpose"] === "testing" || value["purpose"] === "production")
  );
}

function isThinkingLevel(value: unknown): value is RuntimeThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isRuntimePolicyFile(value: JsonObject): boolean {
  return (
    value["schemaVersion"] === "novelfabric.pi.runtime.policy.v1" &&
    value["profile"] === WEB_SAFE_POLICY_PROFILE &&
    value["defaultDecision"] === "deny" &&
    isStringArray(value["deniedRawTools"]) &&
    value["deniedRawTools"].includes("bash") &&
    value["deniedRawTools"].includes("write") &&
    value["deniedRawTools"].includes("edit")
  );
}

function isRuntimeExtensionMetadataFile(value: JsonObject): boolean {
  return (
    value["schemaVersion"] === "novelfabric.pi.extension.metadata.v1" &&
    typeof value["id"] === "string" &&
    value["status"] === "metadata-only" &&
    isStringArray(value["providesTools"]) &&
    value["implementation"] === "placeholder-metadata-only"
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
