import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

export type WorkspaceFileWriteRequest = {
  readonly workspacePath: string;
  readonly path: string;
  readonly content: string;
  readonly actor: string;
  readonly expectedBaseHash?: string;
  readonly reason?: string;
};

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

const NORMAL_WRITE_CAPABILITIES = ["files.write", "project.manage"] as const;
const PROTECTED_WRITE_CAPABILITY = "files.patch_protected";
const TREE_EXCLUDED_NAMES = new Set([".git", "node_modules", "dist", "dist-web", "coverage"]);

export async function readWorkspaceFile(
  request: WorkspaceFileReadRequest
): Promise<WorkspaceFileReadResult> {
  const resolved = resolveInsideRoot(request.workspacePath, request.path);
  if (resolved.relativePath.length === 0) {
    throw new CommandFailure("cannot_read_workspace_root", "Cannot read workspace root as a file.");
  }

  await requireReadableFile(resolved.target, request.path);
  const content = await readFile(resolved.target, "utf8");
  return {
    path: normalizeWorkspacePath(resolved.relativePath),
    content,
    hash: contentHash(content),
    bytes: Buffer.byteLength(content, "utf8"),
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

  const previousContent = await readExistingFileForConflict(resolved.target, request.path);
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
    bytes: Buffer.byteLength(request.content, "utf8")
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

  const canWrite = NORMAL_WRITE_CAPABILITIES.some((capability) =>
    actorHasCapability(manifest, actor, capability)
  );
  if (!canWrite) {
    throw new CommandFailure(
      "capability_denied",
      `Actor '${actor}' does not have required capability 'files.write' or 'project.manage'.`,
      3
    );
  }
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

async function requireReadableFile(targetPath: string, requestedPath: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(targetPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      throw new CommandFailure("file_not_found", `File '${requestedPath}' does not exist.`);
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    throw new CommandFailure("not_a_file", `Path '${requestedPath}' is not a file.`);
  }
}

async function readExistingFileForConflict(
  targetPath: string,
  requestedPath: string
): Promise<string | null> {
  try {
    await access(targetPath, constants.F_OK);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return null;
    throw error;
  }

  const fileStat = await stat(targetPath);
  if (!fileStat.isFile()) {
    throw new CommandFailure("not_a_file", `Path '${requestedPath}' is not a file.`);
  }
  return readFile(targetPath, "utf8");
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
};

async function appendFileAuditLog(entry: AuditLogEntry): Promise<string> {
  const auditDirectory = path.join(entry.workspaceRoot, ".novelfabric", "audit", "files");
  await mkdir(auditDirectory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const auditPath = path.join(auditDirectory, `${date}.jsonl`);
  const relativeAuditPath = normalizeWorkspacePath(path.relative(entry.workspaceRoot, auditPath));
  const payload = {
    timestamp: new Date().toISOString(),
    action: "file.write",
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

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
