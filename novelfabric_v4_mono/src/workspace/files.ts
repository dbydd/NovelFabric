import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import fastGlob from "fast-glob";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import {
  actorHasCapability,
  readCapabilityManifest,
  requireCapability,
  type CapabilityManifest
} from "./capabilities.js";
import { isProtectedWorkspacePath } from "./protection.js";

export type WorkspaceFileReadRequest = {
  readonly workspacePath: string;
  readonly path: string;
};

export type WorkspaceFileReadResult = {
  readonly path: string;
  readonly content: string;
  readonly hash: string;
  readonly bytes: number;
  readonly protected: boolean;
};

export type WorkspaceBinaryFileReadResult = {
  readonly path: string;
  readonly buffer: Buffer;
  readonly bytes: number;
  readonly protected: boolean;
};

export type WorkspaceFileWriteRequest = {
  readonly workspacePath: string;
  readonly path: string;
  readonly content: string;
  readonly actor: string;
  readonly expectedBaseHash?: string;
  readonly reason?: string;
  readonly auditAction?: WorkspaceFileAuditAction;
};

export type WorkspaceFileAppendRequest = Omit<WorkspaceFileWriteRequest, "auditAction">;

export type WorkspaceFileWriteResult = {
  readonly path: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly bytes: number;
  readonly protected: boolean;
  readonly auditPath: string;
};

export type WorkspaceFileTreeNode = {
  readonly label: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly protected?: boolean;
  readonly children?: readonly WorkspaceFileTreeNode[];
};

export type WorkspaceFileTreeRequest = {
  readonly workspacePath: string;
};

export type WorkspaceFileTreeResult = {
  readonly root: string;
  readonly tree: WorkspaceFileTreeNode;
};

export type WorkspaceFileGlobRequest = {
  readonly workspacePath: string;
  readonly base: string;
  readonly pattern: string;
};

export type WorkspaceFileGlobMatch = {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
  readonly protected: boolean;
};

export type WorkspaceFileGlobResult = {
  readonly base: string;
  readonly pattern: string;
  readonly matches: readonly WorkspaceFileGlobMatch[];
};

export type WorkspaceFileStatRequest = {
  readonly workspacePath: string;
  readonly path: string;
};

export type WorkspaceFileStatResult = {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly bytes: number;
  readonly modifiedTime: string;
  readonly protected: boolean;
};

export type WorkspaceFileProtectCheckRequest = {
  readonly workspacePath: string;
  readonly path: string;
  readonly actor: string;
};

export type WorkspaceFileProtectCheckResult = {
  readonly path: string;
  readonly actor: string;
  readonly protected: boolean;
  readonly allowed: boolean;
  readonly requiredCapabilities: readonly string[];
};

const NORMAL_WRITE_CAPABILITIES = ["files.write", "project.manage"] as const;
const PROTECTED_WRITE_CAPABILITY = "files.patch_protected";
const TREE_EXCLUDED_NAMES = new Set([".git", "node_modules", "dist", "dist-web", "coverage"]);
const GLOB_EXCLUDE_PATTERNS = [...TREE_EXCLUDED_NAMES].flatMap((name) => [
  `**/${name}`,
  `**/${name}/**`
]);

type WorkspaceFileAuditAction = "file.write" | "file.append";

export async function readWorkspaceFile(
  request: WorkspaceFileReadRequest
): Promise<WorkspaceFileReadResult> {
  const binary = await readWorkspaceBinaryFile(request);
  const content = binary.buffer.toString("utf8");
  return {
    path: binary.path,
    content,
    hash: contentHash(content),
    bytes: Buffer.byteLength(content, "utf8"),
    protected: binary.protected
  };
}

export async function readWorkspaceBinaryFile(
  request: WorkspaceFileReadRequest
): Promise<WorkspaceBinaryFileReadResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  if (resolved.relativePath.length === 0) {
    throw new CommandFailure("cannot_read_workspace_root", "Cannot read workspace root as a file.");
  }

  await requireReadableFile(resolved.root, resolved.relativePath, request.path);
  const buffer = await readFile(resolved.target);
  return {
    path: normalizeWorkspacePath(resolved.relativePath),
    buffer,
    bytes: buffer.byteLength,
    protected: isProtectedWorkspacePath(resolved.relativePath)
  };
}

export async function readWorkspaceTree(
  request: WorkspaceFileTreeRequest
): Promise<WorkspaceFileTreeResult> {
  const resolved = resolveInsideRoot(request.workspacePath, ".");
  const rootLabel = path.basename(resolved.root) || ".";
  return {
    root: resolved.root,
    tree: {
      label: rootLabel,
      path: ".",
      kind: "directory",
      children: await readTreeChildren(resolved.root, ".")
    }
  };
}

export async function globWorkspaceFiles(
  request: WorkspaceFileGlobRequest
): Promise<WorkspaceFileGlobResult> {
  assertSafeGlobPattern(request.pattern);
  const baseResolved = resolveInsideRoot(request.workspacePath, request.base);
  if (baseResolved.relativePath.length > 0) {
    await requireReadableDirectory(baseResolved.root, baseResolved.relativePath, request.base);
  }

  const entries = await fastGlob(request.pattern, {
    cwd: baseResolved.target,
    dot: true,
    onlyFiles: false,
    unique: true,
    followSymbolicLinks: false,
    ignore: GLOB_EXCLUDE_PATTERNS,
    markDirectories: false
  });

  const matches = await Promise.all(
    entries.map(async (entry): Promise<WorkspaceFileGlobMatch | null> => {
      const combinedPath = normalizeWorkspacePath(
        baseResolved.relativePath.length === 0 ? entry : path.join(baseResolved.relativePath, entry)
      );
      const targetPath = resolveInsideRoot(baseResolved.root, combinedPath).target;
      await assertNoSymlinkInWorkspacePath(baseResolved.root, combinedPath, combinedPath);
      const fileStat = await lstat(targetPath);
      if (fileStat.isSymbolicLink()) return null;
      return {
        path: combinedPath,
        kind: fileStat.isDirectory() ? "directory" : "file",
        bytes: fileStat.size,
        protected: isProtectedWorkspacePath(combinedPath)
      };
    })
  );

  return {
    base: normalizeBasePath(baseResolved.relativePath),
    pattern: request.pattern,
    matches: matches
      .filter((match): match is WorkspaceFileGlobMatch => match !== null)
      .sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"))
  };
}

export async function statWorkspaceFile(
  request: WorkspaceFileStatRequest
): Promise<WorkspaceFileStatResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  const fileStat = await statWorkspaceTarget(resolved.root, resolved.relativePath, request.path);
  if (!fileStat.isFile() && !fileStat.isDirectory()) {
    throw new CommandFailure(
      "unsupported_file_kind",
      `Path '${request.path}' is not a file or directory.`
    );
  }
  const normalizedPath = normalizeBasePath(resolved.relativePath);
  return {
    path: normalizedPath,
    kind: fileStat.isDirectory() ? "directory" : "file",
    bytes: fileStat.size,
    modifiedTime: fileStat.mtime.toISOString(),
    protected: isProtectedWorkspacePath(normalizedPath)
  };
}

export async function appendWorkspaceFile(
  request: WorkspaceFileAppendRequest
): Promise<WorkspaceFileWriteResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  if (resolved.relativePath.length === 0) {
    throw new CommandFailure(
      "cannot_write_workspace_root",
      "Cannot write workspace root as a file."
    );
  }

  const normalizedPath = normalizeWorkspacePath(resolved.relativePath);
  const protectedTarget = isProtectedWorkspacePath(normalizedPath);
  const manifest = await readCapabilityManifest(resolved.root);
  requireWriteCapability(manifest, request.actor, protectedTarget);

  await assertNoSymlinkInWorkspacePath(
    resolved.root,
    path.dirname(resolved.relativePath),
    request.path,
    {
      allowMissingAncestors: true
    }
  );
  const previousContent = await readExistingFileForConflict(
    resolved.root,
    resolved.relativePath,
    request.path
  );
  const previousHash = previousContent === null ? null : contentHash(previousContent);
  const expectedBaseHash = request.expectedBaseHash ?? previousHash;
  return writeWorkspaceFile({
    ...request,
    content: `${previousContent ?? ""}${request.content}`,
    ...(expectedBaseHash === null ? {} : { expectedBaseHash }),
    reason: request.reason ?? "file append",
    auditAction: "file.append"
  });
}

export async function checkWorkspaceFileProtection(
  request: WorkspaceFileProtectCheckRequest
): Promise<WorkspaceFileProtectCheckResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  const normalizedPath = normalizeBasePath(resolved.relativePath);
  const protectedTarget = isProtectedWorkspacePath(normalizedPath);
  const manifest = await readCapabilityManifest(resolved.root);
  return {
    path: normalizedPath,
    actor: request.actor,
    protected: protectedTarget,
    allowed: actorCanWrite(manifest, request.actor, protectedTarget),
    requiredCapabilities: requiredWriteCapabilities(protectedTarget)
  };
}

export async function writeWorkspaceFile(
  request: WorkspaceFileWriteRequest
): Promise<WorkspaceFileWriteResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  if (resolved.relativePath.length === 0) {
    throw new CommandFailure(
      "cannot_write_workspace_root",
      "Cannot write workspace root as a file."
    );
  }

  const normalizedPath = normalizeWorkspacePath(resolved.relativePath);
  const protectedTarget = isProtectedWorkspacePath(normalizedPath);
  const manifest = await readCapabilityManifest(resolved.root);
  requireWriteCapability(manifest, request.actor, protectedTarget);

  await assertNoSymlinkInWorkspacePath(
    resolved.root,
    path.dirname(resolved.relativePath),
    request.path,
    {
      allowMissingAncestors: true
    }
  );
  const previousContent = await readExistingFileForConflict(
    resolved.root,
    resolved.relativePath,
    request.path
  );
  const previousHash = previousContent === null ? null : contentHash(previousContent);
  if (request.expectedBaseHash !== undefined && previousHash !== request.expectedBaseHash) {
    throw new CommandFailure(
      "file_conflict",
      `File '${normalizedPath}' changed since it was opened; reload before saving.`,
      4
    );
  }

  await mkdir(path.dirname(resolved.target), { recursive: true });
  const tempPath = path.join(
    path.dirname(resolved.target),
    `.${path.basename(resolved.target)}.${process.pid.toString()}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(tempPath, request.content, "utf8");
    await rename(tempPath, resolved.target);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  const hash = contentHash(request.content);
  const auditPath = await appendFileAuditLog({
    workspaceRoot: resolved.root,
    actor: request.actor,
    reason: request.reason ?? "file editor save",
    filePath: normalizedPath,
    hash,
    previousHash,
    expectedBaseHash: request.expectedBaseHash ?? null,
    protectedTarget,
    bytes: Buffer.byteLength(request.content, "utf8"),
    action: request.auditAction ?? "file.write"
  });

  return {
    path: normalizedPath,
    hash,
    previousHash,
    bytes: Buffer.byteLength(request.content, "utf8"),
    protected: protectedTarget,
    auditPath
  };
}

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function requireWriteCapability(
  manifest: CapabilityManifest,
  actor: string,
  protectedTarget: boolean
): void {
  if (protectedTarget) {
    requireCapability(manifest, actor, PROTECTED_WRITE_CAPABILITY);
    return;
  }

  if (!actorCanWrite(manifest, actor, protectedTarget)) {
    throw new CommandFailure(
      "capability_denied",
      `Actor '${actor}' does not have required capability 'files.write' or 'project.manage'.`,
      3
    );
  }
}

function actorCanWrite(
  manifest: CapabilityManifest,
  actor: string,
  protectedTarget: boolean
): boolean {
  if (protectedTarget) return actorHasCapability(manifest, actor, PROTECTED_WRITE_CAPABILITY);
  return NORMAL_WRITE_CAPABILITIES.some((capability) =>
    actorHasCapability(manifest, actor, capability)
  );
}

function requiredWriteCapabilities(protectedTarget: boolean): readonly string[] {
  return protectedTarget ? [PROTECTED_WRITE_CAPABILITY] : [...NORMAL_WRITE_CAPABILITIES];
}

async function readTreeChildren(
  rootPath: string,
  relativePath: string
): Promise<readonly WorkspaceFileTreeNode[]> {
  const directoryPath = relativePath === "." ? rootPath : path.join(rootPath, relativePath);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !TREE_EXCLUDED_NAMES.has(entry.name) && !entry.isSymbolicLink())
      .map(async (entry) => {
        const childPath = normalizeWorkspacePath(
          relativePath === "." ? entry.name : path.join(relativePath, entry.name)
        );
        if (entry.isDirectory()) {
          return {
            label: entry.name,
            path: childPath,
            kind: "directory" as const,
            ...(isProtectedWorkspacePath(childPath) ? { protected: true } : {}),
            children: await readTreeChildren(rootPath, childPath)
          };
        }
        return {
          label: entry.name,
          path: childPath,
          kind: "file" as const,
          ...(isProtectedWorkspacePath(childPath) ? { protected: true } : {})
        };
      })
  );
  return sortTreeNodes(nodes);
}

function sortTreeNodes(nodes: readonly WorkspaceFileTreeNode[]): readonly WorkspaceFileTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.label.localeCompare(right.label, "zh-Hans-CN");
  });
}

function assertSafeGlobPattern(pattern: string): void {
  if (path.isAbsolute(pattern)) {
    throw new CommandFailure(
      "path_outside_workspace",
      `Glob pattern '${pattern}' must be relative to the requested base directory.`
    );
  }

  for (const segment of pattern.split(/[\\/]+/)) {
    if (segment === "..") {
      throw new CommandFailure(
        "path_outside_workspace",
        `Glob pattern '${pattern}' must not contain parent-directory segments.`
      );
    }
  }
}

async function requireReadableFile(
  workspaceRoot: string,
  relativePath: string,
  requestedPath: string
): Promise<void> {
  const fileStat = await statWorkspaceTarget(workspaceRoot, relativePath, requestedPath);
  if (!fileStat.isFile()) {
    throw new CommandFailure("not_a_file", `Path '${requestedPath}' is not a file.`);
  }
}

async function requireReadableDirectory(
  workspaceRoot: string,
  relativePath: string,
  requestedPath: string
): Promise<void> {
  const fileStat = await statWorkspaceTarget(workspaceRoot, relativePath, requestedPath);
  if (!fileStat.isDirectory()) {
    throw new CommandFailure("not_a_directory", `Path '${requestedPath}' is not a directory.`);
  }
}

async function statWorkspaceTarget(
  workspaceRoot: string,
  relativePath: string,
  requestedPath: string
) {
  try {
    await assertNoSymlinkInWorkspacePath(workspaceRoot, relativePath, requestedPath);
    return await lstat(path.join(workspaceRoot, relativePath));
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new CommandFailure("file_not_found", `Path '${requestedPath}' does not exist.`);
    }
    throw error;
  }
}

async function readExistingFileForConflict(
  workspaceRoot: string,
  relativePath: string,
  requestedPath: string
): Promise<string | null> {
  const targetPath = path.join(workspaceRoot, relativePath);
  try {
    await access(targetPath, constants.F_OK);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return null;
    throw error;
  }

  await assertNoSymlinkInWorkspacePath(workspaceRoot, relativePath, requestedPath);
  const fileStat = await lstat(targetPath);
  if (!fileStat.isFile()) {
    throw new CommandFailure("not_a_file", `Path '${requestedPath}' is not a file.`);
  }
  return readFile(targetPath, "utf8");
}

type SymlinkCheckOptions = {
  /** If true, non-existent path segments stop the walk instead of throwing. */
  readonly allowMissingAncestors?: boolean;
};

async function assertNoSymlinkInWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
  requestedPath: string,
  options: SymlinkCheckOptions = {}
): Promise<void> {
  const normalizedRelativePath = normalizeWorkspacePath(relativePath);
  if (normalizedRelativePath.length === 0 || normalizedRelativePath === ".") return;

  const segments = normalizedRelativePath.split("/").filter((segment) => segment.length > 0);
  let currentPath = workspaceRoot;
  for (const [, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const entryStat = await lstat(currentPath);
      if (entryStat.isSymbolicLink()) {
        throw new CommandFailure(
          "path_symlink_forbidden",
          `Path '${requestedPath}' includes a symbolic link, which is not allowed in NovelFabric workspace operations.`
        );
      }
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        if (options.allowMissingAncestors === true) {
          return;
        }
        throw error;
      }
      throw error;
    }
  }
}

type AuditLogEntry = {
  readonly workspaceRoot: string;
  readonly actor: string;
  readonly reason: string;
  readonly filePath: string;
  readonly hash: string;
  readonly previousHash: string | null;
  readonly expectedBaseHash: string | null;
  readonly protectedTarget: boolean;
  readonly bytes: number;
  readonly action: WorkspaceFileAuditAction;
};

async function appendFileAuditLog(entry: AuditLogEntry): Promise<string> {
  const auditDirectory = path.join(entry.workspaceRoot, ".novelfabric", "audit", "files");
  await mkdir(auditDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const auditPath = path.join(auditDirectory, `${date}.jsonl`);
  const relativeAuditPath = normalizeWorkspacePath(path.relative(entry.workspaceRoot, auditPath));
  const payload = {
    timestamp: new Date().toISOString(),
    action: entry.action,
    actor: entry.actor,
    reason: entry.reason,
    path: entry.filePath,
    hash: entry.hash,
    previousHash: entry.previousHash,
    expectedBaseHash: entry.expectedBaseHash,
    protected: entry.protectedTarget,
    bytes: entry.bytes
  } as const;
  await writeFile(auditPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "a" });
  return relativeAuditPath;
}

function normalizeBasePath(relativePath: string): string {
  const normalized = normalizeWorkspacePath(relativePath);
  return normalized.length === 0 ? "." : normalized;
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
