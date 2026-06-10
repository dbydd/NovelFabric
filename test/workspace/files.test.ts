import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandFailure } from "../../src/errors.js";
import {
  appendWorkspaceFile,
  checkWorkspaceFileProtection,
  contentHash,
  globWorkspaceFiles,
  patchWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceTree,
  statWorkspaceFile,
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

  it("globs files under a safe workspace base", async () => {
    await fs.writeFile(path.join(workspacePath, "cards", "world", "city.md"), "# City\n", "utf8");
    await fs.writeFile(
      path.join(workspacePath, "cards", "scenes", "arrival.md"),
      "# Arrival\n",
      "utf8"
    );

    const result = await globWorkspaceFiles({ workspacePath, base: "cards", pattern: "**/*.md" });

    expect(result.base).toBe("cards");
    expect(result.pattern).toBe("**/*.md");
    expect(result.matches.map((match) => match.path)).toEqual([
      "cards/scenes/arrival.md",
      "cards/world/city.md"
    ]);
  });

  it("stats files and directories with protected metadata", async () => {
    const projectStat = await statWorkspaceFile({ workspacePath, path: "project.md" });
    expect(projectStat.path).toBe("project.md");
    expect(projectStat.kind).toBe("file");
    expect(projectStat.bytes).toBeGreaterThan(0);
    expect(projectStat.protected).toBe(false);
    expect(Date.parse(projectStat.modifiedTime)).not.toBeNaN();

    const protectedStat = await statWorkspaceFile({ workspacePath, path: ".novelfabric" });
    expect(protectedStat.kind).toBe("directory");
    expect(protectedStat.protected).toBe(true);
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

  it("appends normal files through the shared write path and audit log", async () => {
    const targetPath = "writing/drafts/append-smoke.md";
    const first = await appendWorkspaceFile({
      workspacePath,
      path: targetPath,
      content: "first\n",
      actor: "main_agent",
      reason: "append create"
    });
    const second = await appendWorkspaceFile({
      workspacePath,
      path: targetPath,
      content: "second\n",
      actor: "main_agent",
      expectedBaseHash: first.hash,
      reason: "append update"
    });

    expect(second.previousHash).toBe(first.hash);
    expect(await fs.readFile(path.join(workspacePath, targetPath), "utf8")).toBe("first\nsecond\n");

    const audit = await fs.readFile(path.join(workspacePath, second.auditPath), "utf8");
    expect(audit).toContain('"action":"file.append"');
    expect(audit).toContain("append update");
  });

  it("applies exact non-overlapping text patches through the shared write path", async () => {
    const targetPath = "writing/drafts/patch-smoke.md";
    await writeWorkspaceFile({
      workspacePath,
      path: targetPath,
      content: "alpha\nbeta\ngamma\n",
      actor: "main_agent"
    });
    const base = await readWorkspaceFile({ workspacePath, path: targetPath });

    const result = await patchWorkspaceFile({
      workspacePath,
      path: targetPath,
      actor: "main_agent",
      expectedBaseHash: base.hash,
      replacements: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "gamma", newText: "GAMMA" }
      ],
      reason: "patch smoke"
    });

    expect(result.replacementCount).toBe(2);
    expect(result.previousHash).toBe(base.hash);
    expect(await fs.readFile(path.join(workspacePath, targetPath), "utf8")).toBe(
      "ALPHA\nbeta\nGAMMA\n"
    );

    const audit = await fs.readFile(path.join(workspacePath, result.auditPath), "utf8");
    expect(audit).toContain('"action":"file.patch"');
    expect(audit).toContain("patch smoke");
  });

  it("rejects missing, ambiguous, and overlapping text patch replacements", async () => {
    const targetPath = "writing/drafts/patch-invalid.md";
    await writeWorkspaceFile({
      workspacePath,
      path: targetPath,
      content: "abc abc\nxyz\n",
      actor: "main_agent"
    });
    const base = await readWorkspaceFile({ workspacePath, path: targetPath });

    await expect(
      patchWorkspaceFile({
        workspacePath,
        path: targetPath,
        actor: "main_agent",
        expectedBaseHash: base.hash,
        replacements: [{ oldText: "missing", newText: "replacement" }]
      })
    ).rejects.toMatchObject({
      code: "file_patch_missing_replacement"
    } satisfies Partial<CommandFailure>);

    await expect(
      patchWorkspaceFile({
        workspacePath,
        path: targetPath,
        actor: "main_agent",
        expectedBaseHash: base.hash,
        replacements: [{ oldText: "abc", newText: "ABC" }]
      })
    ).rejects.toMatchObject({
      code: "file_patch_ambiguous_replacement"
    } satisfies Partial<CommandFailure>);

    await expect(
      patchWorkspaceFile({
        workspacePath,
        path: targetPath,
        actor: "main_agent",
        expectedBaseHash: base.hash,
        replacements: [
          { oldText: "abc abc", newText: "words" },
          { oldText: "abc\nxyz", newText: "tail" }
        ]
      })
    ).rejects.toMatchObject({
      code: "file_patch_overlapping_replacement"
    } satisfies Partial<CommandFailure>);
  });

  it("checks actor write permission for protected and normal paths", async () => {
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage"]\n',
      "utf8"
    );

    const normal = await checkWorkspaceFileProtection({
      workspacePath,
      path: "project.md",
      actor: "main_agent"
    });
    expect(normal.protected).toBe(false);
    expect(normal.allowed).toBe(true);
    expect(normal.requiredCapabilities).toEqual(["files.write", "project.manage"]);

    const protectedResult = await checkWorkspaceFileProtection({
      workspacePath,
      path: ".novelfabric/capabilities.toml",
      actor: "main_agent"
    });
    expect(protectedResult.protected).toBe(true);
    expect(protectedResult.allowed).toBe(false);
    expect(protectedResult.requiredCapabilities).toEqual(["files.patch_protected"]);
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
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage"]\n',
      "utf8"
    );

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
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]\n',
      "utf8"
    );

    const nextManifest =
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]\n';
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

  it("rejects symlink traversal for read, stat, write, and append operations and hides symlinks from glob", async () => {
    const externalPath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-files-external-"));
    await fs.writeFile(path.join(externalPath, "secret.md"), "# Secret\n", "utf8");
    await fs.symlink(externalPath, path.join(workspacePath, "imports", "source", "outside"));

    await expect(
      readWorkspaceFile({ workspacePath, path: "imports/source/outside/secret.md" })
    ).rejects.toMatchObject({ code: "path_symlink_forbidden" } satisfies Partial<CommandFailure>);
    await expect(
      statWorkspaceFile({ workspacePath, path: "imports/source/outside/secret.md" })
    ).rejects.toMatchObject({ code: "path_symlink_forbidden" } satisfies Partial<CommandFailure>);
    const globResult = await globWorkspaceFiles({
      workspacePath,
      base: "imports/source",
      pattern: "**/*.md"
    });
    expect(globResult.matches.map((match) => match.path)).not.toContain(
      "imports/source/outside/secret.md"
    );
    await expect(
      writeWorkspaceFile({
        workspacePath,
        path: "imports/source/outside/created.md",
        content: "# Created\n",
        actor: "main_agent"
      })
    ).rejects.toMatchObject({ code: "path_symlink_forbidden" } satisfies Partial<CommandFailure>);
    await expect(
      appendWorkspaceFile({
        workspacePath,
        path: "imports/source/outside/secret.md",
        content: "leak\n",
        actor: "main_agent"
      })
    ).rejects.toMatchObject({ code: "path_symlink_forbidden" } satisfies Partial<CommandFailure>);
    await expect(
      patchWorkspaceFile({
        workspacePath,
        path: "imports/source/outside/secret.md",
        actor: "main_agent",
        expectedBaseHash: contentHash("# Secret\n"),
        replacements: [{ oldText: "Secret", newText: "Leaked" }]
      })
    ).rejects.toMatchObject({ code: "path_symlink_forbidden" } satisfies Partial<CommandFailure>);

    await fs.rm(externalPath, { recursive: true, force: true });
  });
});
