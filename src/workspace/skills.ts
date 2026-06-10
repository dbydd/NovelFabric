import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { contentHash, readWorkspaceFile } from "./files.js";

export type SkillSource = "workspace" | "agent" | "global-pi" | "global-template";

export type SkillValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type SkillSummary = {
  readonly name: string;
  readonly qualifiedName: string;
  readonly source: SkillSource;
  readonly path: string;
  readonly ownerAgent: string | null;
  readonly bytes: number;
  readonly hash: string;
  readonly valid: boolean;
  readonly issues: readonly SkillValidationIssue[];
};

export type SkillReadResult = SkillSummary & {
  readonly content: string;
};

export type SkillsListRequest = {
  readonly workspacePath: string;
  readonly configRoot?: string;
};

export type SkillsListResult = {
  readonly workspace: string;
  readonly configRoot: string | null;
  readonly skills: readonly SkillSummary[];
};

export type SkillsValidateResult = SkillsListResult & {
  readonly valid: boolean;
  readonly issueCount: number;
};

const SKILL_FILE_PATTERN = /^[A-Za-z0-9_.-]+\.md$/;

export async function listWorkspaceSkills(request: SkillsListRequest): Promise<SkillsListResult> {
  const workspace = resolveInsideRoot(request.workspacePath, ".").root;
  const skillGroups = await Promise.all([
    readWorkspaceSkillSummaries(workspace),
    readAgentSkillSummaries(workspace),
    readGlobalSkillSummaries(request.configRoot)
  ]);
  const skills = skillGroups.flat().sort(compareSkills);
  return { workspace, configRoot: request.configRoot ?? null, skills };
}

export async function readWorkspaceSkill(
  request: SkillsListRequest & { readonly skill: string }
): Promise<SkillReadResult> {
  const result = await listWorkspaceSkills(request);
  const matches = resolveSkillMatches(result.skills, request.skill);
  if (matches.length === 0) {
    throw new CommandFailure("skill_not_found", `Skill '${request.skill}' does not exist.`);
  }
  if (matches.length > 1) {
    throw new CommandFailure(
      "skill_ambiguous",
      `Skill '${request.skill}' is ambiguous; use one of: ${matches
        .map((skill) => skill.qualifiedName)
        .join(", ")}.`
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new CommandFailure("skill_not_found", `Skill '${request.skill}' does not exist.`);
  }

  const content = await readSkillContent({
    workspace: result.workspace,
    configRoot: result.configRoot,
    summary: match
  });
  return { ...match, content };
}

export async function validateWorkspaceSkills(
  request: SkillsListRequest
): Promise<SkillsValidateResult> {
  const result = await listWorkspaceSkills(request);
  const issueCount = result.skills.reduce((count, skill) => count + skill.issues.length, 0);
  return {
    ...result,
    valid: result.skills.every((skill) => skill.valid),
    issueCount
  };
}

async function readWorkspaceSkillSummaries(workspace: string): Promise<readonly SkillSummary[]> {
  return readSkillDirectory({
    root: workspace,
    relativeDirectory: ".pi/skills",
    source: "workspace",
    ownerAgent: null,
    qualifiedNamePrefix: null
  });
}

async function readAgentSkillSummaries(workspace: string): Promise<readonly SkillSummary[]> {
  const agentsDirectory = resolveInsideRoot(workspace, "agents");
  const agents = await readDirectoryEntriesIfPresent(agentsDirectory.target);
  const groups = await Promise.all(
    agents
      .filter((agent) => agent.isDirectory() && !agent.name.startsWith("."))
      .map((agent) =>
        readSkillDirectory({
          root: workspace,
          relativeDirectory: normalizeWorkspacePath(path.join("agents", agent.name, "skills")),
          source: "agent",
          ownerAgent: agent.name,
          qualifiedNamePrefix: agent.name
        })
      )
  );
  return groups.flat();
}

async function readGlobalSkillSummaries(
  configRoot: string | undefined
): Promise<readonly SkillSummary[]> {
  if (configRoot === undefined) return [];
  const groups = await Promise.all([
    readSkillDirectory({
      root: configRoot,
      relativeDirectory: "pi/skills",
      source: "global-pi",
      ownerAgent: null,
      qualifiedNamePrefix: "global"
    }),
    readSkillDirectory({
      root: configRoot,
      relativeDirectory: "templates/skills",
      source: "global-template",
      ownerAgent: null,
      qualifiedNamePrefix: "template"
    })
  ]);
  return groups.flat();
}

async function readSkillDirectory(options: {
  readonly root: string;
  readonly relativeDirectory: string;
  readonly source: SkillSource;
  readonly ownerAgent: string | null;
  readonly qualifiedNamePrefix: string | null;
}): Promise<readonly SkillSummary[]> {
  const directory = resolveInsideRoot(options.root, options.relativeDirectory);
  const entries = await readDirectoryEntriesIfPresent(directory.target);
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const relativePath = normalizeWorkspacePath(
          path.join(options.relativeDirectory, entry.name)
        );
        const name = entry.name.slice(0, -".md".length);
        const qualifiedName =
          options.qualifiedNamePrefix === null ? name : `${options.qualifiedNamePrefix}/${name}`;
        const target = resolveInsideRoot(options.root, relativePath).target;
        const content = await readFile(target, "utf8");
        const issues = validateSkill({ name, fileName: entry.name, content, path: relativePath });
        return {
          name,
          qualifiedName,
          source: options.source,
          path: relativePath,
          ownerAgent: options.ownerAgent,
          bytes: Buffer.byteLength(content, "utf8"),
          hash: contentHash(content),
          valid: issues.every((issue) => issue.severity !== "error"),
          issues
        };
      })
  );
  return summaries.sort(compareSkills);
}

function validateSkill(options: {
  readonly name: string;
  readonly fileName: string;
  readonly content: string;
  readonly path: string;
}): readonly SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  if (!SKILL_FILE_PATTERN.test(options.fileName)) {
    issues.push({
      severity: "error",
      code: "skill_invalid_filename",
      message: `Skill file '${options.fileName}' must match ${SKILL_FILE_PATTERN.source}.`,
      path: options.path
    });
  }
  if (options.content.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "skill_empty",
      message: `Skill '${options.name}' is empty.`,
      path: options.path
    });
  }
  if (!/^#\s+\S+/m.test(options.content)) {
    issues.push({
      severity: "warning",
      code: "skill_missing_title",
      message: `Skill '${options.name}' should start with a Markdown title.`,
      path: options.path
    });
  }
  return issues;
}

function resolveSkillMatches(
  skills: readonly SkillSummary[],
  requestedSkill: string
): readonly SkillSummary[] {
  if (requestedSkill.includes("/")) {
    return skills.filter((skill) => skill.qualifiedName === requestedSkill);
  }
  return skills.filter((skill) => skill.name === requestedSkill);
}

async function readSkillContent(options: {
  readonly workspace: string;
  readonly configRoot: string | null;
  readonly summary: SkillSummary;
}): Promise<string> {
  if (options.summary.source === "workspace" || options.summary.source === "agent") {
    const result = await readWorkspaceFile({
      workspacePath: options.workspace,
      path: options.summary.path
    });
    return result.content;
  }
  if (options.configRoot === null) {
    throw new CommandFailure(
      "config_root_unresolved",
      `Cannot read global skill '${options.summary.qualifiedName}' without config root.`
    );
  }
  const resolved = resolveInsideRoot(options.configRoot, options.summary.path);
  return readFile(resolved.target, "utf8");
}

async function readDirectoryEntriesIfPresent(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

function compareSkills(left: SkillSummary, right: SkillSummary): number {
  if (left.source !== right.source) return sourceRank(left.source) - sourceRank(right.source);
  return left.qualifiedName.localeCompare(right.qualifiedName, "zh-Hans-CN");
}

function sourceRank(source: SkillSource): number {
  switch (source) {
    case "workspace":
      return 0;
    case "agent":
      return 1;
    case "global-pi":
      return 2;
    case "global-template":
      return 3;
  }
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
