import type { Dirent } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { readWorkspaceFile } from "./files.js";

export type AgentValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type AgentSummary = {
  readonly id: string;
  readonly path: string;
  readonly profilePath: string;
  readonly profileExists: boolean;
  readonly soulPath: string;
  readonly soulExists: boolean;
  readonly memoryPath: string;
  readonly memoryExists: boolean;
  readonly skillsPath: string;
  readonly skillCount: number;
  readonly valid: boolean;
  readonly issues: readonly AgentValidationIssue[];
};

export type AgentTextAsset = {
  readonly path: string;
  readonly exists: boolean;
  readonly content: string | null;
  readonly hash: string | null;
  readonly bytes: number;
};

export type AgentProfileAsset = AgentTextAsset & {
  readonly parsed: JsonValue | null;
  readonly error: string | null;
};

export type AgentSkillAsset = AgentTextAsset & {
  readonly name: string;
};

export type AgentInspection = AgentSummary & {
  readonly profile: AgentProfileAsset;
  readonly soul: AgentTextAsset;
  readonly memory: AgentTextAsset;
  readonly skills: readonly AgentSkillAsset[];
};

export type AgentsListResult = {
  readonly workspace: string;
  readonly agents: readonly AgentSummary[];
};

export type AgentsValidateResult = AgentsListResult & {
  readonly valid: boolean;
  readonly issueCount: number;
};

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { readonly [key: string]: JsonValue };
type JsonArray = readonly JsonValue[];
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function listWorkspaceAgents(workspacePath: string): Promise<AgentsListResult> {
  const workspace = resolveInsideRoot(workspacePath, ".").root;
  const agentsDirectory = resolveInsideRoot(workspace, "agents");
  const entries = await readDirectoryEntriesIfPresent(agentsDirectory.target);
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => summarizeAgent(workspace, entry.name))
  );

  return {
    workspace,
    agents: summaries.sort((left, right) => left.id.localeCompare(right.id, "zh-Hans-CN"))
  };
}

export async function inspectWorkspaceAgent(
  workspacePath: string,
  agentId: string
): Promise<AgentInspection> {
  assertValidAgentId(agentId);
  const workspace = resolveInsideRoot(workspacePath, ".").root;
  const agentDirectory = resolveInsideRoot(workspace, path.join("agents", agentId));
  if (!(await isDirectory(agentDirectory.target))) {
    throw new CommandFailure("agent_not_found", `Agent '${agentId}' does not exist.`);
  }

  const summary = await summarizeAgent(workspace, agentId);
  return {
    ...summary,
    profile: await readProfileAsset(workspace, summary.profilePath),
    soul: await readTextAsset(workspace, summary.soulPath),
    memory: await readTextAsset(workspace, summary.memoryPath),
    skills: await readAgentSkillAssets(workspace, agentId)
  };
}

export async function validateWorkspaceAgents(
  workspacePath: string
): Promise<AgentsValidateResult> {
  const result = await listWorkspaceAgents(workspacePath);
  const issueCount = result.agents.reduce((count, agent) => count + agent.issues.length, 0);
  return {
    ...result,
    valid: result.agents.every((agent) => agent.valid),
    issueCount
  };
}

async function summarizeAgent(workspace: string, agentId: string): Promise<AgentSummary> {
  assertValidAgentId(agentId);
  const agentPath = normalizeWorkspacePath(path.join("agents", agentId));
  const profilePath = normalizeWorkspacePath(path.join(agentPath, "profile.json"));
  const soulPath = normalizeWorkspacePath(path.join(agentPath, "soul.md"));
  const memoryPath = normalizeWorkspacePath(path.join(agentPath, "memory.md"));
  const skillsPath = normalizeWorkspacePath(path.join(agentPath, "skills"));

  const [profileExists, soulExists, memoryExists, skillCount] = await Promise.all([
    fileExists(resolveInsideRoot(workspace, profilePath).target),
    fileExists(resolveInsideRoot(workspace, soulPath).target),
    fileExists(resolveInsideRoot(workspace, memoryPath).target),
    countAgentSkills(workspace, skillsPath)
  ]);

  const issues = await validateAgentAssets(workspace, {
    id: agentId,
    profilePath,
    profileExists,
    soulPath,
    soulExists,
    memoryPath,
    memoryExists
  });
  return {
    id: agentId,
    path: agentPath,
    profilePath,
    profileExists,
    soulPath,
    soulExists,
    memoryPath,
    memoryExists,
    skillsPath,
    skillCount,
    valid: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

async function validateAgentAssets(
  workspace: string,
  agent: {
    readonly id: string;
    readonly profilePath: string;
    readonly profileExists: boolean;
    readonly soulPath: string;
    readonly soulExists: boolean;
    readonly memoryPath: string;
    readonly memoryExists: boolean;
  }
): Promise<readonly AgentValidationIssue[]> {
  const issues: AgentValidationIssue[] = [];
  if (!agent.soulExists) {
    issues.push({
      severity: "error",
      code: "agent_missing_soul",
      message: `Agent '${agent.id}' is missing soul.md.`,
      path: agent.soulPath
    });
  } else {
    const soul = await readTextAsset(workspace, agent.soulPath);
    if ((soul.content ?? "").trim().length === 0) {
      issues.push({
        severity: "error",
        code: "agent_empty_soul",
        message: `Agent '${agent.id}' has an empty soul.md.`,
        path: agent.soulPath
      });
    }
  }

  if (agent.profileExists) {
    const profile = await readProfileAsset(workspace, agent.profilePath);
    if (profile.error !== null) {
      issues.push({
        severity: "error",
        code: "agent_invalid_profile_json",
        message: profile.error,
        path: agent.profilePath
      });
    } else if (!isJsonObject(profile.parsed)) {
      issues.push({
        severity: "error",
        code: "agent_profile_not_object",
        message: `Agent '${agent.id}' profile.json must contain a JSON object.`,
        path: agent.profilePath
      });
    } else if (typeof profile.parsed["id"] === "string" && profile.parsed["id"] !== agent.id) {
      issues.push({
        severity: "warning",
        code: "agent_profile_id_mismatch",
        message: `Agent '${agent.id}' profile.json declares id '${profile.parsed["id"]}'.`,
        path: agent.profilePath
      });
    }
  }

  if (agent.memoryExists) {
    const memory = await readTextAsset(workspace, agent.memoryPath);
    if ((memory.content ?? "").trim().length === 0) {
      issues.push({
        severity: "warning",
        code: "agent_empty_memory",
        message: `Agent '${agent.id}' has an empty memory.md.`,
        path: agent.memoryPath
      });
    }
  }

  return issues;
}

async function readProfileAsset(
  workspace: string,
  relativePath: string
): Promise<AgentProfileAsset> {
  const textAsset = await readTextAsset(workspace, relativePath);
  if (!textAsset.exists || textAsset.content === null) {
    return { ...textAsset, parsed: null, error: null };
  }

  try {
    const parsed = JSON.parse(textAsset.content) as unknown;
    if (!isJsonValue(parsed)) {
      return {
        ...textAsset,
        parsed: null,
        error: `Profile '${relativePath}' does not contain JSON-serializable data.`
      };
    }
    return { ...textAsset, parsed, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    return { ...textAsset, parsed: null, error: `Invalid JSON in '${relativePath}': ${message}` };
  }
}

async function readTextAsset(workspace: string, relativePath: string): Promise<AgentTextAsset> {
  try {
    const result = await readWorkspaceFile({ workspacePath: workspace, path: relativePath });
    return {
      path: result.path,
      exists: true,
      content: result.content,
      hash: result.hash,
      bytes: result.bytes
    };
  } catch (error) {
    if (isCommandFailureCode(error, "file_not_found")) {
      return {
        path: normalizeWorkspacePath(relativePath),
        exists: false,
        content: null,
        hash: null,
        bytes: 0
      };
    }
    throw error;
  }
}

async function readAgentSkillAssets(
  workspace: string,
  agentId: string
): Promise<readonly AgentSkillAsset[]> {
  const skillsPath = normalizeWorkspacePath(path.join("agents", agentId, "skills"));
  const resolved = resolveInsideRoot(workspace, skillsPath);
  const entries = await readDirectoryEntriesIfPresent(resolved.target);
  const skillFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  const assets = await Promise.all(
    skillFiles.map(async (entry) => {
      const relativePath = normalizeWorkspacePath(path.join(skillsPath, entry.name));
      const text = await readTextAsset(workspace, relativePath);
      return { ...text, name: entry.name.slice(0, -".md".length) };
    })
  );
  return assets.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

async function countAgentSkills(workspace: string, skillsPath: string): Promise<number> {
  const resolved = resolveInsideRoot(workspace, skillsPath);
  const entries = await readDirectoryEntriesIfPresent(resolved.target);
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
}

async function readDirectoryEntriesIfPresent(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    const directoryStat = await stat(directoryPath);
    return directoryStat.isDirectory();
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function assertValidAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new CommandFailure(
      "invalid_agent_id",
      `Agent id '${agentId}' must match ${AGENT_ID_PATTERN.source}.`
    );
  }
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isCommandFailureCode(error: unknown, code: string): boolean {
  return error instanceof CommandFailure && error.code === code;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

function isJsonObject(value: JsonValue | null): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
