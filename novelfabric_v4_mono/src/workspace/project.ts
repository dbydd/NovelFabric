import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import { readCapabilityManifest, requireAnyCapability } from "./capabilities.js";
import { inspectWorkspace, type WorkspaceDoctorReport } from "./doctor.js";
import { canonicalLayout, type LayoutEntry } from "./layout.js";

export type ProjectMetadata = {
  readonly slug: string;
  readonly title: string;
  readonly schemaVersion: "v4";
};

export type WorkspaceMetadata = {
  readonly schemaVersion: "v4";
  readonly projectSlug: string;
  readonly template: string;
};

export type ProjectInspectResult = {
  readonly workspaceRoot: string;
  readonly project: ProjectMetadata | null;
  readonly workspace: WorkspaceMetadata | null;
  readonly valid: boolean;
  readonly issues: readonly ProjectValidationIssue[];
  readonly layout: WorkspaceDoctorSummary;
};

export type ProjectValidationIssue = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

export type WorkspaceDoctorSummary = Pick<
  WorkspaceDoctorReport,
  "valid" | "requiredCount" | "presentCount" | "missingCount" | "wrongKindCount"
>;

export type ProjectListResult = {
  readonly root: string;
  readonly projects: readonly ProjectListEntry[];
  readonly validCount: number;
  readonly invalidCount: number;
};

export type ProjectListEntry = {
  readonly workspaceRoot: string;
  readonly slug: string | null;
  readonly title: string | null;
  readonly valid: boolean;
  readonly issueCount: number;
};

export type ProjectInitRequest = {
  readonly path: string;
  readonly name: string;
  readonly slug?: string;
  readonly template?: string;
};

export type WorkspaceMaterializeRequest = {
  readonly workspacePath: string;
  readonly template: string;
  readonly actor: string;
  readonly name?: string;
  readonly slug?: string;
};

export type WorkspaceMaterializeResult = {
  readonly workspaceRoot: string;
  readonly template: string;
  readonly project: ProjectMetadata;
  readonly created: readonly string[];
  readonly preserved: readonly string[];
  readonly valid: boolean;
  readonly layout: WorkspaceDoctorSummary;
};

const MATERIALIZE_CAPABILITIES = ["workspace.materialize", "project.manage"] as const;
const DEFAULT_TEMPLATE = "novel-project";
const DEFAULT_ACTOR = "main_agent";

export async function initProject(
  request: ProjectInitRequest
): Promise<WorkspaceMaterializeResult> {
  const root = path.resolve(request.path);
  await assertInitTargetAvailable(root);
  const project = makeProjectMetadata(request.name, request.slug);
  return materializeWorkspaceFiles({
    workspaceRoot: root,
    template: request.template ?? DEFAULT_TEMPLATE,
    project,
    capabilityActor: DEFAULT_ACTOR
  });
}

export async function inspectProject(workspacePath: string): Promise<ProjectInspectResult> {
  const workspaceRoot = resolveInsideRoot(workspacePath, ".").root;
  const layoutReport = await inspectWorkspace(workspaceRoot);
  const issues: ProjectValidationIssue[] = [];
  const project = await readProjectMetadata(workspaceRoot, issues);
  const workspace = await readWorkspaceMetadata(workspaceRoot, issues);

  if (project !== null && workspace !== null && project.slug !== workspace.projectSlug) {
    issues.push({
      path: ".novelfabric/workspace.json",
      code: "project_slug_mismatch",
      message: `Workspace projectSlug '${workspace.projectSlug}' does not match project slug '${project.slug}'.`
    });
  }

  if (!layoutReport.valid) {
    issues.push({
      path: ".",
      code: "workspace_layout_invalid",
      message: "Workspace layout is missing required entries or has wrong-kind entries."
    });
  }

  return {
    workspaceRoot,
    project,
    workspace,
    valid: layoutReport.valid && issues.length === 0,
    issues,
    layout: summarizeDoctor(layoutReport)
  };
}

export async function validateProject(workspacePath: string): Promise<ProjectInspectResult> {
  return inspectProject(workspacePath);
}

export async function listProjects(rootPath: string): Promise<ProjectListResult> {
  const root = path.resolve(rootPath);
  const candidates = await workspaceCandidateRoots(root);
  const projects = await Promise.all(
    candidates.map(async (candidate): Promise<ProjectListEntry> => {
      const inspected = await inspectProject(candidate);
      return {
        workspaceRoot: inspected.workspaceRoot,
        slug: inspected.project?.slug ?? inspected.workspace?.projectSlug ?? null,
        title: inspected.project?.title ?? null,
        valid: inspected.valid,
        issueCount: inspected.issues.length
      };
    })
  );
  const sortedProjects = projects.sort((left, right) =>
    left.workspaceRoot.localeCompare(right.workspaceRoot, "zh-Hans-CN")
  );

  return {
    root,
    projects: sortedProjects,
    validCount: sortedProjects.filter((entry) => entry.valid).length,
    invalidCount: sortedProjects.filter((entry) => !entry.valid).length
  };
}

export async function materializeWorkspace(
  request: WorkspaceMaterializeRequest
): Promise<WorkspaceMaterializeResult> {
  const workspaceRoot = path.resolve(request.workspacePath);
  await authorizeWorkspaceMaterialize(workspaceRoot, request.actor);
  const current = await inspectProjectLenient(workspaceRoot);
  const fallbackName =
    request.name ??
    current.project?.title ??
    titleFromSlug(request.slug ?? path.basename(workspaceRoot));
  const project = makeProjectMetadata(fallbackName, request.slug ?? current.project?.slug);
  return materializeWorkspaceFiles({
    workspaceRoot,
    template: request.template,
    project,
    capabilityActor: request.actor
  });
}

async function materializeWorkspaceFiles(options: {
  readonly workspaceRoot: string;
  readonly template: string;
  readonly project: ProjectMetadata;
  readonly capabilityActor: string;
}): Promise<WorkspaceMaterializeResult> {
  const created: string[] = [];
  const preserved: string[] = [];
  await mkdir(options.workspaceRoot, { recursive: true });

  for (const entry of canonicalLayout) {
    const absolutePath = resolveInsideRoot(options.workspaceRoot, entry.path).target;
    const status = await inspectMaterializeTarget(absolutePath, entry);
    if (status === "conflict") {
      throw new CommandFailure(
        "workspace_materialize_conflict",
        `Cannot materialize '${entry.path}' because an entry of the wrong kind already exists.`
      );
    }
    if (status === "present") {
      preserved.push(entry.path);
      continue;
    }

    if (entry.kind === "directory") {
      await mkdir(absolutePath, { recursive: true });
    } else {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, defaultFileContent(entry.path, options), "utf8");
    }
    created.push(entry.path);
  }

  const layoutReport = await inspectWorkspace(options.workspaceRoot);
  return {
    workspaceRoot: options.workspaceRoot,
    template: options.template,
    project: options.project,
    created,
    preserved,
    valid: layoutReport.valid,
    layout: summarizeDoctor(layoutReport)
  };
}

async function authorizeWorkspaceMaterialize(workspaceRoot: string, actor: string): Promise<void> {
  const hasManifest = await pathExists(
    path.join(workspaceRoot, ".novelfabric", "capabilities.toml")
  );
  if (!hasManifest) {
    const empty = await isMissingOrEmptyDirectory(workspaceRoot);
    if (empty) return;
    throw new CommandFailure(
      "capability_manifest_missing",
      "Cannot materialize a non-empty workspace without .novelfabric/capabilities.toml."
    );
  }

  const manifest = await readCapabilityManifest(workspaceRoot);
  requireAnyCapability(manifest, actor, MATERIALIZE_CAPABILITIES);
}

async function assertInitTargetAvailable(root: string): Promise<void> {
  const empty = await isMissingOrEmptyDirectory(root);
  if (!empty) {
    throw new CommandFailure(
      "project_init_target_not_empty",
      `Project init target '${root}' already exists and is not empty.`
    );
  }
}

async function isMissingOrEmptyDirectory(targetPath: string): Promise<boolean> {
  try {
    const stat = await lstat(targetPath);
    if (!stat.isDirectory()) return false;
    const entries = await readdir(targetPath);
    return entries.length === 0;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return true;
    throw error;
  }
}

async function workspaceCandidateRoots(root: string): Promise<readonly string[]> {
  const roots = new Set<string>();
  if (await pathExists(path.join(root, ".novelfabric", "workspace.json"))) {
    roots.add(root);
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new CommandFailure("project_root_not_found", `Project root '${root}' does not exist.`);
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    if (await pathExists(path.join(candidate, ".novelfabric", "workspace.json"))) {
      roots.add(candidate);
    }
  }

  return [...roots];
}

async function inspectProjectLenient(workspaceRoot: string): Promise<ProjectInspectResult> {
  try {
    return await inspectProject(workspaceRoot);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      const layout = await inspectWorkspace(workspaceRoot);
      return {
        workspaceRoot,
        project: null,
        workspace: null,
        valid: false,
        issues: [],
        layout: summarizeDoctor(layout)
      };
    }
    throw error;
  }
}

async function readProjectMetadata(
  workspaceRoot: string,
  issues: ProjectValidationIssue[]
): Promise<ProjectMetadata | null> {
  const raw = await readJsonFile(path.join(workspaceRoot, "project.json"), "project.json", issues);
  if (raw === null) return null;
  const slug = readString(raw, "slug");
  const title = readString(raw, "title");
  const schemaVersion = readString(raw, "schemaVersion");
  if (schemaVersion !== "v4") {
    issues.push({
      path: "project.json",
      code: "invalid_project_schema_version",
      message: "project.json must use schemaVersion 'v4'."
    });
  }
  if (slug === null || title === null || schemaVersion !== "v4") return null;
  return { slug, title, schemaVersion };
}

async function readWorkspaceMetadata(
  workspaceRoot: string,
  issues: ProjectValidationIssue[]
): Promise<WorkspaceMetadata | null> {
  const raw = await readJsonFile(
    path.join(workspaceRoot, ".novelfabric", "workspace.json"),
    ".novelfabric/workspace.json",
    issues
  );
  if (raw === null) return null;
  const schemaVersion = readString(raw, "schemaVersion");
  const projectSlug = readString(raw, "projectSlug");
  const template = readString(raw, "template");
  if (schemaVersion !== "v4") {
    issues.push({
      path: ".novelfabric/workspace.json",
      code: "invalid_workspace_schema_version",
      message: ".novelfabric/workspace.json must use schemaVersion 'v4'."
    });
  }
  if (schemaVersion !== "v4" || projectSlug === null || template === null) return null;
  return { schemaVersion, projectSlug, template };
}

async function readJsonFile(
  filePath: string,
  relativePath: string,
  issues: ProjectValidationIssue[]
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(parsed)) {
      issues.push({
        path: relativePath,
        code: "invalid_json_object",
        message: `${relativePath} must contain a JSON object.`
      });
      return null;
    }
    return parsed;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      issues.push({
        path: relativePath,
        code: "file_missing",
        message: `${relativePath} is missing.`
      });
      return null;
    }
    if (error instanceof SyntaxError) {
      issues.push({
        path: relativePath,
        code: "invalid_json",
        message: `${relativePath} is not valid JSON.`
      });
      return null;
    }
    throw error;
  }
}

async function inspectMaterializeTarget(
  absolutePath: string,
  entry: LayoutEntry
): Promise<"missing" | "present" | "conflict"> {
  try {
    const stat = await lstat(absolutePath);
    const matches = entry.kind === "directory" ? stat.isDirectory() : stat.isFile();
    return matches ? "present" : "conflict";
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return "missing";
    throw error;
  }
}

function defaultFileContent(
  relativePath: string,
  options: {
    readonly template: string;
    readonly project: ProjectMetadata;
    readonly capabilityActor: string;
  }
): string {
  switch (relativePath) {
    case "AGENTS.md":
      return `# Story Workspace Agent Contract\n\nAll durable writes must go through novelfabric CLI commands or NovelFabric-owned pi tools.\n`;
    case "project.md":
      return `# ${options.project.title}\n\n`;
    case "project.json":
      return `${JSON.stringify(options.project, null, 2)}\n`;
    case ".novelfabric/workspace.json":
      return `${JSON.stringify(
        {
          schemaVersion: "v4",
          projectSlug: options.project.slug,
          template: options.template
        },
        null,
        2
      )}\n`;
    case ".novelfabric/template-manifest.json":
      return `${JSON.stringify({ schemaVersion: "v4", templates: [] }, null, 2)}\n`;
    case ".novelfabric/capabilities.toml":
      return `[${options.capabilityActor}]\nallow = ["project.manage", "workspace.materialize", "files.write", "knowledge.query"]\n`;
    case "timeline/index.json":
      return `${JSON.stringify({ schemaVersion: "v4", branches: [] }, null, 2)}\n`;
    case "simulation/active-session.txt":
      return "";
    default:
      return "";
  }
}

function makeProjectMetadata(name: string, slug?: string): ProjectMetadata {
  const title = name.trim();
  if (title.length === 0) {
    throw new CommandFailure("invalid_project_name", "Project name must not be empty.");
  }
  return {
    slug: normalizeSlug(slug ?? title),
    title,
    schemaVersion: "v4"
  };
}

function normalizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) {
    throw new CommandFailure(
      "invalid_project_slug",
      "Project slug must contain ASCII letters or numbers."
    );
  }
  return normalized;
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function summarizeDoctor(report: WorkspaceDoctorReport): WorkspaceDoctorSummary {
  return {
    valid: report.valid,
    requiredCount: report.requiredCount,
    presentCount: report.presentCount,
    missingCount: report.missingCount,
    wrongKindCount: report.wrongKindCount
  };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
