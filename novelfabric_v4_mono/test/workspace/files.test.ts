import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandFailure } from "../../src/errors.js";
import {
  contentHash,
  readWorkspaceFile,
  readWorkspaceTree,
  writeWorkspaceFile
} from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("workspace file services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-files-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("reads UTF-8 files with hash and protected metadata", async () => {
    const result = await readWorkspaceFile({ workspacePath, path: "project.md" });

    expect(result.path).toBe("project.md");
    expect(result.content).toContain("Valid Basic Workspace");
    expect(result.hash).toBe(contentHash(result.content));
    expect(result.protected).toBe(false);
  });

  it("lists the real workspace tree with protected metadata", async () => {
    const result = await readWorkspaceTree({ workspacePath });
    expect(result.tree.path).toBe(".");
    expect(result.tree.kind).toBe("directory");
    const novelfabric = result.tree.children?.find((node) => node.path === ".novelfabric");
    expect(novelfabric?.kind).toBe("directory");
    expect(novelfabric?.protected).toBe(true);
  });

  it("writes normal files through capability-checked atomic service and audit log", async () => {
    const content = "# Editor Smoke\n\nSaved through shared service.\n";
    const result = await writeWorkspaceFile({
      workspacePath,
      path: "writing/drafts/editor-smoke.md",
      content,
      actor: "main_agent",
      reason: "unit test save"
    });

    expect(result.path).toBe("writing/drafts/editor-smoke.md");
    expect(result.hash).toBe(contentHash(content));
    expect(result.previousHash).toBeNull();
    expect(result.protected).toBe(false);

    const saved = await fs.readFile(
      path.join(workspacePath, "writing/drafts/editor-smoke.md"),
      "utf8"
    );
    expect(saved).toBe(content);

    const audit = await fs.readFile(path.join(workspacePath, result.auditPath), "utf8");
    expect(audit).toContain("unit test save");
    expect(audit).toContain("writing/drafts/editor-smoke.md");
  });

  it("rejects stale expectedBaseHash writes with file_conflict", async () => {
    const firstRead = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      path: "project.md",
      content: "# Changed elsewhere\n",
      actor: "main_agent",
      expectedBaseHash: firstRead.hash
    });

    await expect(
      writeWorkspaceFile({
        workspacePath,
        path: "project.md",
        content: "# Stale editor\n",
        actor: "main_agent",
        expectedBaseHash: firstRead.hash
      })
    ).rejects.toMatchObject({ code: "file_conflict" } satisfies Partial<CommandFailure>);
  });

  it("denies protected writes without files.patch_protected", async () => {
    await expect(
      writeWorkspaceFile({
        workspacePath,
        path: ".novelfabric/capabilities.toml",
        content: "[main_agent]\nallow = []\n",
        actor: "main_agent"
      })
    ).rejects.toMatchObject({ code: "capability_denied" } satisfies Partial<CommandFailure>);
  });

  it("allows protected writes only when manifest grants files.patch_protected", async () => {
    const manifestPath = path.join(workspacePath, ".novelfabric", "capabilities.toml");
    await fs.writeFile(
      manifestPath,
      '[main_agent]\nallow = ["project.manage", "files.patch_protected"]\n',
      "utf8"
    );

    const nextManifest = '[main_agent]\nallow = ["project.manage"]\n';
    const result = await writeWorkspaceFile({
      workspacePath,
      path: ".novelfabric/capabilities.toml",
      content: nextManifest,
      actor: "main_agent",
      reason: "protected policy test"
    });

    expect(result.protected).toBe(true);
    expect(await fs.readFile(manifestPath, "utf8")).toBe(nextManifest);
  });
});
