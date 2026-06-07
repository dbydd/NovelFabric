import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadFileTool } from "../../src/agent-runtime/web-safe-tools.js";
import { writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("NovelFabric web-safe SDK custom tools", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-web-safe-tools-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("reads an allowed workspace file through novelfabric_read_file", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/tool-readable.txt",
      actor: "main_agent",
      content: "controlled workspace content"
    });
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    const result = await tool.execute("tool-call-1", { path: "imports/source/tool-readable.txt" });

    const text = result.content[0].text;
    expect(text).toContain("controlled workspace content");
    expect(text).toContain("imports/source/tool-readable.txt");
    expect(text).toContain("sha256:");
    expect(result.details).toMatchObject({
      path: "imports/source/tool-readable.txt",
      protected: false
    });
  });

  it("rejects parent traversal through workspace safe-path checks", async () => {
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    await expect(tool.execute("tool-call-2", { path: "../outside.txt" })).rejects.toMatchObject({
      code: "path_outside_workspace"
    });
  });

  it("rejects protected workspace paths before reading content", async () => {
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-3", { path: ".novelfabric/capabilities.toml" })
    ).rejects.toMatchObject({ code: "web_safe_tool_protected_read_denied" });
  });

  it("rejects protected workspace paths before checking whether the file exists", async () => {
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-4", { path: ".novelfabric/does-not-exist.txt" })
    ).rejects.toMatchObject({ code: "web_safe_tool_protected_read_denied" });
  });

  it("rejects protected agent soul paths before reading content", async () => {
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-5", { path: "agents/main_agent/soul.md" })
    ).rejects.toMatchObject({
      code: "web_safe_tool_protected_read_denied"
    });
  });

  it("rejects invalid parameters before touching the filesystem", async () => {
    const tool = createReadFileTool({ workspacePath, actor: "main_agent" });

    await expect(tool.execute("tool-call-4", { path: "" })).rejects.toMatchObject({
      code: "web_safe_tool_invalid_params"
    });
  });
});
