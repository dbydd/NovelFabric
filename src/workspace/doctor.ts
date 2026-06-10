import { lstat } from "node:fs/promises";

import { resolveInsideRoot } from "../fs/safe-path.js";
import { canonicalLayout, type LayoutEntry } from "./layout.js";

export type LayoutCheckStatus = "present" | "missing" | "wrong-kind";

export type LayoutCheck = {
  readonly path: string;
  readonly expectedKind: LayoutEntry["kind"];
  readonly surface: LayoutEntry["surface"];
  readonly status: LayoutCheckStatus;
};

export type WorkspaceDoctorReport = {
  readonly workspaceRoot: string;
  readonly valid: boolean;
  readonly requiredCount: number;
  readonly presentCount: number;
  readonly missingCount: number;
  readonly wrongKindCount: number;
  readonly checks: readonly LayoutCheck[];
};

export async function inspectWorkspace(workspacePath: string): Promise<WorkspaceDoctorReport> {
  const rootResolution = resolveInsideRoot(workspacePath, ".");
  const checks = await Promise.all(
    canonicalLayout.map((entry) => inspectEntry(rootResolution.root, entry))
  );
  const presentCount = checks.filter((check) => check.status === "present").length;
  const missingCount = checks.filter((check) => check.status === "missing").length;
  const wrongKindCount = checks.filter((check) => check.status === "wrong-kind").length;

  return {
    workspaceRoot: rootResolution.root,
    valid: missingCount === 0 && wrongKindCount === 0,
    requiredCount: checks.length,
    presentCount,
    missingCount,
    wrongKindCount,
    checks
  };
}

async function inspectEntry(rootPath: string, entry: LayoutEntry): Promise<LayoutCheck> {
  const resolved = resolveInsideRoot(rootPath, entry.path);

  try {
    const stat = await lstat(resolved.target);
    const kindMatches = entry.kind === "directory" ? stat.isDirectory() : stat.isFile();
    return {
      path: entry.path,
      expectedKind: entry.kind,
      surface: entry.surface,
      status: kindMatches ? "present" : "wrong-kind"
    };
  } catch (error) {
    if (error instanceof Error && isNodeFileMissingError(error)) {
      return {
        path: entry.path,
        expectedKind: entry.kind,
        surface: entry.surface,
        status: "missing"
      };
    }
    throw error;
  }
}

function isNodeFileMissingError(error: Error): error is Error & { readonly code: "ENOENT" } {
  return hasStringCode(error) && error.code === "ENOENT";
}

function hasStringCode(error: Error): error is Error & { readonly code: string } {
  return "code" in error && typeof error.code === "string";
}
