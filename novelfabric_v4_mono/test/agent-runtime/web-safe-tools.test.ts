import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildNovelFabricWebSafeCustomTools,
  createApplyProposalTool,
  createContextPackTool,
  createReadFileTool,
  createReportTool,
  createValidateTool,
  createWriteFileTool,
  WEB_SAFE_CUSTOM_TOOL_NAMES
} from "../../src/agent-runtime/web-safe-tools.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await fs.access(pathValue);
    return true;
  } catch {
    return false;
  }
}

describe("NovelFabric web-safe SDK custom tools", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-web-safe-tools-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("exposes only implemented read-only web-safe custom tools", () => {
    expect(WEB_SAFE_CUSTOM_TOOL_NAMES).toEqual([
      "novelfabric_read_file",
      "novelfabric_validate",
      "novelfabric_context_pack",
      "novelfabric_report",
      "novelfabric_write_file",
      "novelfabric_apply_proposal"
    ]);

    const wrapped = buildNovelFabricWebSafeCustomTools({
      context: { workspacePath, actor: "main_agent" },
      defineTool: (tool) => ({
        name: tool.name,
        execute: (toolCallId: string, params: unknown, signal?: AbortSignal) =>
          tool.execute(toolCallId, params, signal)
      })
    });

    expect(wrapped).toEqual([
      expect.objectContaining({ name: "novelfabric_read_file" }),
      expect.objectContaining({ name: "novelfabric_validate" }),
      expect.objectContaining({ name: "novelfabric_context_pack" }),
      expect.objectContaining({ name: "novelfabric_report" }),
      expect.objectContaining({ name: "novelfabric_write_file" }),
      expect.objectContaining({ name: "novelfabric_apply_proposal" })
    ]);
    expect(JSON.stringify(wrapped)).not.toMatch(/bash|raw_write/);
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

  it("builds and validates bounded context packs without model-supplied workspace or actor", async () => {
    const tool = createContextPackTool({ workspacePath, actor: "main_agent" });

    const built = await tool.execute("tool-call-context-build", {
      mode: "build",
      kind: "agent",
      query: "project",
      limit: 3
    });
    const builtPayload = JSON.parse(built.content[0].text) as {
      readonly outputPath: string;
      readonly citationCount: number;
      readonly write: { readonly path: string };
    };

    expect(builtPayload.outputPath).toBe(builtPayload.write.path);
    expect(builtPayload.citationCount).toBeGreaterThanOrEqual(0);

    const validated = await tool.execute("tool-call-context-validate", {
      mode: "validate",
      path: builtPayload.outputPath
    });
    const validationPayload = JSON.parse(validated.content[0].text) as {
      readonly valid: boolean;
      readonly issueCount: number;
      readonly issues: readonly unknown[];
    };

    expect(validationPayload.valid).toBe(true);
    expect(validationPayload.issueCount).toBe(0);
    expect(validationPayload.issues).toEqual([]);
  });

  it("allows context-pack build output paths only under the context-pack namespace", async () => {
    const tool = createContextPackTool({ workspacePath, actor: "main_agent" });

    const built = await tool.execute("tool-call-context-build-explicit-output", {
      mode: "build",
      kind: "agent",
      query: "project",
      outputPath: "knowledge/context-packs/web-safe-explicit.json",
      limit: 2
    });
    expect(JSON.parse(built.content[0].text)).toMatchObject({
      outputPath: "knowledge/context-packs/web-safe-explicit.json",
      write: { path: "knowledge/context-packs/web-safe-explicit.json" }
    });

    for (const outputPath of ["project.md", "writing/chapters/foo.md", "cards/characters/foo.md"]) {
      await expect(
        tool.execute("tool-call-context-build-bad-output", {
          mode: "build",
          kind: "agent",
          query: "project",
          outputPath,
          limit: 2
        })
      ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    }
  });

  it("allows context-pack validate paths only under the context-pack namespace", async () => {
    const tool = createContextPackTool({ workspacePath, actor: "main_agent" });

    const built = await tool.execute("tool-call-context-build-validate-namespace", {
      mode: "build",
      kind: "agent",
      query: "project",
      outputPath: "knowledge/context-packs/web-safe-validate.json",
      limit: 2
    });
    const builtPayload = JSON.parse(built.content[0].text) as { readonly outputPath: string };

    for (const pathValue of ["project.md", "reports/foo.md"]) {
      await expect(
        tool.execute("tool-call-context-validate-bad-path", { mode: "validate", path: pathValue })
      ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    }

    const validated = await tool.execute("tool-call-context-validate-good-path", {
      mode: "validate",
      path: builtPayload.outputPath
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "context-pack",
      mode: "validate",
      path: "knowledge/context-packs/web-safe-validate.json",
      valid: true,
      issueCount: 0
    });
  });

  it("rejects context-pack build limits above the web-safe bound", async () => {
    const tool = createContextPackTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-context-build-limit", { mode: "build", kind: "agent", limit: 21 })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });
  });

  it("validates supported artifact targets with compact issue output", async () => {
    const contextTool = createContextPackTool({ workspacePath, actor: "main_agent" });
    const built = await contextTool.execute("tool-call-context-build-for-validate", {
      mode: "build",
      kind: "agent",
      query: "project",
      limit: 2
    });
    const builtPayload = JSON.parse(built.content[0].text) as { readonly outputPath: string };
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    const result = await tool.execute("tool-call-validate", {
      target: "context-pack",
      path: builtPayload.outputPath
    });
    const payload = JSON.parse(result.content[0].text) as {
      readonly target: string;
      readonly valid: boolean;
      readonly issueCount: number;
      readonly issues: readonly unknown[];
    };

    expect(payload).toMatchObject({ target: "context-pack", valid: true, issueCount: 0 });
    expect(payload.issues).toEqual([]);
    expect(result.content[0].text).not.toContain("controlled workspace content");
  });

  it("restricts generic context-pack validation to context-pack paths", async () => {
    const contextTool = createContextPackTool({ workspacePath, actor: "main_agent" });
    const built = await contextTool.execute("tool-call-context-build-for-generic-validate", {
      mode: "build",
      kind: "agent",
      query: "project",
      outputPath: "knowledge/context-packs/generic-validate.json",
      limit: 2
    });
    const builtPayload = JSON.parse(built.content[0].text) as { readonly outputPath: string };
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    for (const pathValue of ["project.md", "reports/foo.md"]) {
      await expect(
        tool.execute("tool-call-validate-context-bad-path", {
          target: "context-pack",
          path: pathValue
        })
      ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    }

    const validated = await tool.execute("tool-call-validate-context-valid-path", {
      target: "context-pack",
      path: builtPayload.outputPath
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "context-pack",
      path: "knowledge/context-packs/generic-validate.json",
      valid: true,
      issueCount: 0
    });
  });

  it("requires jobId for workflow validation and path for artifact validation", async () => {
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(tool.execute("tool-call-no-job", { target: "workflow" })).rejects.toMatchObject({
      code: "web_safe_tool_invalid_params"
    });
    await expect(tool.execute("tool-call-no-path", { target: "report" })).rejects.toMatchObject({
      code: "web_safe_tool_invalid_params"
    });
  });

  it("restricts generic writing-draft validation to writing draft paths", async () => {
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "writing/drafts/web-safe-draft.json",
      content: stableJson({
        kind: "novelfabric.writing.draft",
        version: 1,
        title: "Web Safe Draft",
        markdown: "# Web Safe Draft\n\nValidated draft body.",
        citations: [{ path: source.path, hash: source.hash }]
      })
    });
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-validate-writing-outside", {
        target: "writing-draft",
        path: "project.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-validate-writing-wrong-namespace", {
        target: "writing-draft",
        path: "reports/artifacts/web-safe-draft.json"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });

    const validated = await tool.execute("tool-call-validate-writing-valid", {
      target: "writing-draft",
      path: "writing/drafts/web-safe-draft.json"
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "writing-draft",
      path: "writing/drafts/web-safe-draft.json",
      valid: true,
      issueCount: 0
    });
  });

  it("restricts generic swarm-output validation to simulation round paths", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "simulation/rounds/session-a/round-001/web-safe-swarm.json",
      content: stableJson({
        schemaVersion: "novelfabric.swarm.turn-proposal.v1",
        sessionId: "session-a",
        round: 1,
        agent: "characters",
        stage: "characters",
        summary: "Characters propose a grounded next action.",
        action: { kind: "pi-agent-proposal", text: "Move toward the clock tower." },
        citations: [],
        evidence: []
      })
    });
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-validate-swarm-outside", {
        target: "swarm-output",
        path: "project.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-validate-swarm-wrong-namespace", {
        target: "swarm-output",
        path: "reports/artifacts/web-safe-swarm.json"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });

    const validated = await tool.execute("tool-call-validate-swarm-valid", {
      target: "swarm-output",
      path: "simulation/rounds/session-a/round-001/web-safe-swarm.json"
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "swarm-output",
      path: "simulation/rounds/session-a/round-001/web-safe-swarm.json",
      valid: true,
      issueCount: 0
    });
  });

  it("restricts generic cards-proposal validation to card proposal paths", async () => {
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "proposals/cards/web-safe-card.json",
      content: stableJson({
        kind: "novelfabric.cards.proposal",
        version: 1,
        actor: "main_agent",
        createdAt: "2026-06-07T00:00:00.000Z",
        sourceContextPack: null,
        cards: [
          {
            kind: "world",
            title: "Web Safe World",
            targetPath: "cards/world/web-safe-world.md",
            content: "# Web Safe World\n\nValidated card content.",
            citations: [
              {
                sourcePath: source.path,
                hash: source.hash,
                lineRange: { start: 1, end: 1 },
                excerpt: source.content.slice(0, 80)
              }
            ]
          }
        ]
      })
    });
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-validate-cards-outside", {
        target: "cards-proposal",
        path: "project.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-validate-cards-wrong-namespace", {
        target: "cards-proposal",
        path: "reports/artifacts/web-safe-card.json"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });

    const validated = await tool.execute("tool-call-validate-cards-valid", {
      target: "cards-proposal",
      path: "proposals/cards/web-safe-card.json"
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "cards-proposal",
      path: "proposals/cards/web-safe-card.json",
      valid: true,
      issueCount: 0
    });
  });

  it("restricts generic memory-proposal validation to memory proposal paths", async () => {
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "proposals/memory/web-safe-memory.json",
      content: stableJson({
        kind: "novelfabric.memory.shared-proposal",
        version: 1,
        actor: "main_agent",
        createdAt: "2026-06-07T00:00:00.000Z",
        content: "Remember the validated Web-safe memory proposal.",
        citations: [
          {
            sourcePath: source.path,
            hash: source.hash,
            lineRange: { start: 1, end: 1 },
            excerpt: source.content.slice(0, 80)
          }
        ]
      })
    });
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-validate-memory-outside", {
        target: "memory-proposal",
        path: "project.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-validate-memory-wrong-namespace", {
        target: "memory-proposal",
        path: "reports/artifacts/web-safe-memory.json"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });

    const validated = await tool.execute("tool-call-validate-memory-valid", {
      target: "memory-proposal",
      path: "proposals/memory/web-safe-memory.json"
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "memory-proposal",
      path: "proposals/memory/web-safe-memory.json",
      valid: true,
      issueCount: 0
    });
  });

  it("restricts generic report validation to report artifact paths", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/visible-report.md",
      content: "# Visible Report\n\nReport preview body."
    });
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/artifacts/visible-report.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.report.artifact",
          version: 1,
          reportKind: "test-report",
          session: null,
          title: "Visible Report",
          markdown: "# Visible Report\n\nValidated report artifact.",
          citations: [{ path: source.path, hash: source.hash }]
        },
        null,
        2
      )}\n`
    });
    const tool = createValidateTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-validate-report-outside", { target: "report", path: "project.md" })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-validate-report-wrong-namespace", {
        target: "report",
        path: "reports/visible-report.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    const validated = await tool.execute("tool-call-validate-report-valid", {
      target: "report",
      path: "reports/artifacts/visible-report.json"
    });

    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "report",
      valid: true,
      issueCount: 0
    });
  });

  it("lists, shows bounded previews for, and validates reports", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/long-report.md",
      content: `# Long Report\n\n${"human-readable report body ".repeat(400)}`
    });
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/artifacts/tool-report.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.report.artifact",
          version: 1,
          reportKind: "test-report",
          session: null,
          title: "Tool Report",
          markdown: "# Tool Report\n\nValidated report artifact.",
          citations: [{ path: source.path, hash: source.hash }]
        },
        null,
        2
      )}\n`
    });
    const tool = createReportTool({ workspacePath, actor: "main_agent" });

    const listed = await tool.execute("tool-call-report-list", { mode: "list" });
    expect(listed.content[0].text).toContain("reports/long-report.md");
    expect(listed.content[0].text).not.toContain("human-readable report body");

    const shown = await tool.execute("tool-call-report-show", {
      mode: "show",
      path: "reports/long-report.md"
    });
    const showPayload = JSON.parse(shown.content[0].text) as {
      readonly contentPreview: string;
      readonly truncated: boolean;
      readonly maxChars: number;
    };
    expect(showPayload.truncated).toBe(true);
    expect(showPayload.contentPreview.length).toBeLessThanOrEqual(showPayload.maxChars + 1);
    expect(showPayload.contentPreview).toContain("# Long Report");

    const validated = await tool.execute("tool-call-report-validate", {
      mode: "validate",
      path: "reports/artifacts/tool-report.json"
    });
    expect(JSON.parse(validated.content[0].text)).toMatchObject({
      target: "report",
      valid: true,
      issueCount: 0
    });
  });

  it("restricts report show and validate paths to report namespaces", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/visible-report.md",
      content: "# Visible Report\n\nReport preview body."
    });
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/artifacts/visible-report.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.report.artifact",
          version: 1,
          reportKind: "test-report",
          session: null,
          title: "Visible Report",
          markdown: "# Visible Report\n\nValidated report artifact.",
          citations: [{ path: source.path, hash: source.hash }]
        },
        null,
        2
      )}\n`
    });
    const tool = createReportTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-report-show-outside", { mode: "show", path: "project.md" })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-report-validate-outside", { mode: "validate", path: "project.md" })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-report-validate-wrong-report-namespace", {
        mode: "validate",
        path: "reports/visible-report.md"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    const shown = await tool.execute("tool-call-report-show-valid", {
      mode: "show",
      path: "reports/visible-report.md"
    });
    expect(shown.details["mode"]).toBe("show");
    const validated = await tool.execute("tool-call-report-validate-valid", {
      mode: "validate",
      path: "reports/artifacts/visible-report.json"
    });
    expect(validated.details["mode"]).toBe("validate");
  });

  it("does not return raw protected report content", async () => {
    const tool = createReportTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-report-protected", { mode: "show", path: "AGENTS.md" })
    ).rejects.toMatchObject({ code: "web_safe_tool_protected_read_denied" });
    await expect(
      tool.execute("tool-call-report-traversal", { mode: "show", path: "../secret.md" })
    ).rejects.toMatchObject({ code: "path_outside_workspace" });
  });

  it("writes card proposals through novelfabric_write_file", async () => {
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });

    const result = await tool.execute("tool-call-write-card-proposal", {
      path: "proposals/cards/generated-character.json",
      content: stableJson({ kind: "test-card-proposal", title: "Generated Character" }),
      reason: "create generated card proposal"
    });
    const payload = JSON.parse(result.content[0].text) as {
      readonly ok: boolean;
      readonly path: string;
      readonly hash: string;
      readonly previousHash: string | null;
      readonly bytes: number;
      readonly auditPath: string;
    };

    expect(payload).toMatchObject({
      ok: true,
      path: "proposals/cards/generated-character.json",
      previousHash: null
    });
    expect(payload.hash).toMatch(/^sha256:/u);
    expect(payload.bytes).toBeGreaterThan(0);
    expect(payload.auditPath).toMatch(/^\.novelfabric\/audit\/files\//u);
    const saved = await readWorkspaceFile({
      workspacePath,
      path: "proposals/cards/generated-character.json"
    });
    expect(saved.content).toContain("Generated Character");
  });

  it("ignores model-supplied workspacePath and actor parameters for novelfabric_write_file", async () => {
    const otherWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-web-safe-tools-other-"));
    await fs.cp(VALID_FIXTURE, otherWorkspacePath, { recursive: true });
    try {
      const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });
      const targetPath = "proposals/cards/closure-bound-write.json";

      const result = await tool.execute("tool-call-write-closure-bound", {
        workspacePath: otherWorkspacePath,
        actor: "role_agent",
        path: targetPath,
        content: stableJson({ kind: "test-card-proposal", title: "Closure Bound" }),
        reason: "prove host-bound workspace and actor are used"
      });

      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: true,
        path: targetPath
      });
      const saved = await readWorkspaceFile({ workspacePath, path: targetPath });
      expect(saved.content).toContain("Closure Bound");
      await expect(
        readWorkspaceFile({ workspacePath: otherWorkspacePath, path: targetPath })
      ).rejects.toMatchObject({ code: "file_not_found" });
      expect(await pathExists(path.join(otherWorkspacePath, targetPath))).toBe(false);
    } finally {
      await fs.rm(otherWorkspacePath, { recursive: true, force: true });
    }
  });

  it("does not echo written content in novelfabric_write_file responses", async () => {
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });
    const secretContent = stableJson({
      kind: "test-card-proposal",
      title: "Sanitized Response",
      body: "SECRET-WEB-SAFE-WRITE-CONTENT-SHOULD-NOT-ECHO"
    });

    const result = await tool.execute("tool-call-write-sanitized-response", {
      path: "proposals/cards/sanitized-response.json",
      content: secretContent,
      reason: "verify response sanitization"
    });

    expect(result.content[0].text).not.toContain(secretContent);
    expect(result.content[0].text).not.toContain("SECRET-WEB-SAFE-WRITE-CONTENT-SHOULD-NOT-ECHO");
    expect(JSON.stringify(result.details)).not.toContain(
      "SECRET-WEB-SAFE-WRITE-CONTENT-SHOULD-NOT-ECHO"
    );
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      path: "proposals/cards/sanitized-response.json"
    });
  });

  it("writes writing drafts through novelfabric_write_file", async () => {
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });

    const result = await tool.execute("tool-call-write-draft", {
      path: "writing/drafts/chapter-001.md",
      content: "# Chapter 001\n\nDraft body from web-safe write tool.\n",
      reason: "create generated draft"
    });

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      path: "writing/drafts/chapter-001.md",
      previousHash: null
    });
    const saved = await readWorkspaceFile({ workspacePath, path: "writing/drafts/chapter-001.md" });
    expect(saved.content).toContain("Draft body from web-safe write tool.");
  });

  it("rejects protected and non-allowlisted paths through novelfabric_write_file", async () => {
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });
    const params = { content: "blocked", reason: "negative test" };

    for (const protectedPath of [
      ".novelfabric/capabilities.toml",
      "AGENTS.md",
      "agents/main_agent/soul.md"
    ]) {
      await expect(
        tool.execute("tool-call-write-protected", { path: protectedPath, ...params })
      ).rejects.toMatchObject({ code: "web_safe_tool_protected_write_denied" });
    }

    for (const deniedPath of ["src/workflow/index.ts", "project.md"]) {
      await expect(
        tool.execute("tool-call-write-denied-namespace", { path: deniedPath, ...params })
      ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    }

    await expect(
      tool.execute("tool-call-write-traversal", { path: "../outside.md", ...params })
    ).rejects.toMatchObject({ code: "path_outside_workspace" });
  });

  it("requires expectedBaseHash for existing web-safe writes", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "writing/drafts/existing.md",
      content: "# Existing\n"
    });
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-write-existing-no-hash", {
        path: "writing/drafts/existing.md",
        content: "# Replacement\n",
        reason: "replace existing draft"
      })
    ).rejects.toMatchObject({ code: "web_safe_write_expected_hash_required" });
  });

  it("replaces existing files when expectedBaseHash matches", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "writing/drafts/replace-with-hash.md",
      content: "# First Draft\n"
    });
    const existing = await readWorkspaceFile({
      workspacePath,
      path: "writing/drafts/replace-with-hash.md"
    });
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });

    const result = await tool.execute("tool-call-write-replace-with-hash", {
      path: "writing/drafts/replace-with-hash.md",
      content: "# Replacement Draft\n\nUpdated through expectedBaseHash.\n",
      expectedBaseHash: existing.hash,
      reason: "replace existing draft with current hash"
    });
    const payload = JSON.parse(result.content[0].text) as {
      readonly ok: boolean;
      readonly path: string;
      readonly previousHash: string | null;
      readonly hash: string;
    };

    expect(payload).toMatchObject({
      ok: true,
      path: "writing/drafts/replace-with-hash.md",
      previousHash: existing.hash
    });
    expect(payload.hash).toMatch(/^sha256:/u);
    expect(payload.hash).not.toBe(existing.hash);
    const replaced = await readWorkspaceFile({
      workspacePath,
      path: "writing/drafts/replace-with-hash.md"
    });
    expect(replaced.content).toContain("Replacement Draft");
    expect(replaced.hash).toBe(payload.hash);
  });

  it("rejects stale expectedBaseHash through workspace conflict checks", async () => {
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "simulation/turns/existing.json",
      content: stableJson({ turn: 1 })
    });
    const tool = createWriteFileTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-write-stale-hash", {
        path: "simulation/turns/existing.json",
        content: stableJson({ turn: 2 }),
        expectedBaseHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        reason: "replace existing turn"
      })
    ).rejects.toMatchObject({ code: "file_conflict" });
  });

  it("applies card, memory, swarm, report, and writing artifacts through novelfabric_apply_proposal", async () => {
    const source = await readWorkspaceFile({ workspacePath, path: "project.md" });
    const tool = createApplyProposalTool({ workspacePath, actor: "main_agent" });

    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "proposals/cards/apply-card.json",
      content: stableJson({
        kind: "novelfabric.cards.proposal",
        version: 1,
        actor: "main_agent",
        createdAt: "2026-06-07T00:00:00.000Z",
        sourceContextPack: null,
        cards: [
          {
            kind: "world",
            title: "Applied Web Safe World",
            targetPath: "cards/world/applied-web-safe-world.md",
            content: "# Applied Web Safe World\n\nCard materialized by apply tool.",
            citations: [
              {
                sourcePath: source.path,
                hash: source.hash,
                lineRange: { start: 1, end: 1 },
                excerpt: source.content.slice(0, 80)
              }
            ]
          }
        ]
      })
    });
    const cardResult = await tool.execute("tool-call-apply-card", {
      kind: "card-proposal",
      path: "proposals/cards/apply-card.json",
      reason: "apply card proposal through web-safe tool"
    });
    expect(JSON.parse(cardResult.content[0].text)).toMatchObject({
      kind: "card-proposal",
      applied: true,
      sourcePath: "proposals/cards/apply-card.json",
      appliedCount: 1,
      outputs: [expect.objectContaining({ path: "cards/world/applied-web-safe-world.md" })]
    });

    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "proposals/memory/apply-memory.json",
      content: stableJson({
        kind: "novelfabric.memory.shared-proposal",
        version: 1,
        actor: "main_agent",
        createdAt: "2026-06-07T00:00:00.000Z",
        content: "Remember this applied Web-safe memory.",
        citations: [
          {
            sourcePath: source.path,
            hash: source.hash,
            lineRange: { start: 1, end: 1 },
            excerpt: source.content.slice(0, 80)
          }
        ]
      })
    });
    const memoryResult = await tool.execute("tool-call-apply-memory", {
      kind: "memory-proposal",
      path: "proposals/memory/apply-memory.json",
      targetPath: "memory/global/web-safe-shared.md",
      reason: "apply memory proposal through web-safe tool"
    });
    expect(JSON.parse(memoryResult.content[0].text)).toMatchObject({
      kind: "memory-proposal",
      applied: true,
      sourcePath: "proposals/memory/apply-memory.json",
      targetPath: "memory/global/web-safe-shared.md",
      outputs: [expect.objectContaining({ path: "memory/global/web-safe-shared.md" })]
    });

    const { createSimulationSession } = await import("../../src/simulation/index.js");
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: "web-safe-apply-session",
      objective: "Apply a web-safe swarm output.",
      timeline: "main"
    });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "simulation/rounds/web-safe-apply-session/round-001/proposals/characters.json",
      content: stableJson({
        schemaVersion: "novelfabric.swarm.turn-proposal.v1",
        sessionId: "web-safe-apply-session",
        round: 1,
        agent: "characters",
        stage: "characters",
        summary: "Characters propose a grounded next action.",
        action: { kind: "pi-agent-proposal", text: "Move toward the clock tower." },
        citations: [],
        evidence: []
      })
    });
    const swarmResult = await tool.execute("tool-call-apply-swarm", {
      kind: "swarm-output",
      path: "simulation/rounds/web-safe-apply-session/round-001/proposals/characters.json",
      reason: "apply swarm output through web-safe tool"
    });
    const swarmPayload = JSON.parse(swarmResult.content[0].text) as {
      readonly kind: string;
      readonly applied: boolean;
      readonly sourcePath: string;
      readonly sessionId: string;
      readonly outputs: readonly { readonly path: string; readonly hash: string }[];
    };
    expect(swarmPayload).toMatchObject({
      kind: "swarm-output",
      applied: true,
      sourcePath: "simulation/rounds/web-safe-apply-session/round-001/proposals/characters.json",
      sessionId: "web-safe-apply-session"
    });
    expect(swarmPayload.outputs.map((output) => output.path)).toEqual([
      expect.stringMatching(/^simulation\/turns\/web-safe-apply-session\//u),
      "simulation/sessions/web-safe-apply-session/session.json"
    ]);

    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "reports/artifacts/apply-report.json",
      content: stableJson({
        kind: "novelfabric.report.artifact",
        version: 1,
        reportKind: "web-safe",
        session: null,
        title: "Applied Web Safe Report",
        markdown: "# Applied Web Safe Report\n\nReport body from apply tool.",
        citations: [{ path: source.path, hash: source.hash }]
      })
    });
    const reportResult = await tool.execute("tool-call-apply-report", {
      kind: "report-artifact",
      path: "reports/artifacts/apply-report.json",
      outputPath: "reports/applied-web-safe-report.md",
      reason: "apply report artifact through web-safe tool"
    });
    expect(JSON.parse(reportResult.content[0].text)).toMatchObject({
      kind: "report-artifact",
      applied: true,
      sourcePath: "reports/artifacts/apply-report.json",
      reportPath: "reports/applied-web-safe-report.md",
      outputs: [expect.objectContaining({ path: "reports/applied-web-safe-report.md" })]
    });

    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: "writing/drafts/apply-draft.json",
      content: stableJson({
        kind: "novelfabric.writing.draft",
        version: 1,
        title: "Applied Web Safe Chapter",
        markdown: "# Applied Web Safe Chapter\n\nChapter body from apply tool.",
        citations: [{ path: source.path, hash: source.hash }]
      })
    });
    const writingResult = await tool.execute("tool-call-apply-writing", {
      kind: "writing-draft",
      path: "writing/drafts/apply-draft.json",
      outputPath: "writing/chapters/applied-web-safe-chapter.md",
      reason: "apply writing draft through web-safe tool"
    });
    expect(JSON.parse(writingResult.content[0].text)).toMatchObject({
      kind: "writing-draft",
      applied: true,
      sourcePath: "writing/drafts/apply-draft.json",
      chapterPath: "writing/chapters/applied-web-safe-chapter.md",
      outputs: [expect.objectContaining({ path: "writing/chapters/applied-web-safe-chapter.md" })]
    });
  }, 120000);

  it("rejects invalid novelfabric_apply_proposal parameters and namespaces", async () => {
    const tool = createApplyProposalTool({ workspacePath, actor: "main_agent" });

    await expect(
      tool.execute("tool-call-apply-invalid-kind", {
        kind: "unknown-kind",
        path: "proposals/cards/apply-card.json",
        reason: "invalid kind"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });
    await expect(
      tool.execute("tool-call-apply-missing-kind", {
        path: "proposals/cards/apply-card.json",
        reason: "missing kind"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });
    await expect(
      tool.execute("tool-call-apply-missing-path", {
        kind: "card-proposal",
        reason: "missing path"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });
    await expect(
      tool.execute("tool-call-apply-missing-reason", {
        kind: "card-proposal",
        path: "proposals/cards/apply-card.json"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });

    await expect(
      tool.execute("tool-call-apply-card-wrong-input", {
        kind: "card-proposal",
        path: "reports/artifacts/apply-card.json",
        reason: "wrong namespace"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-apply-memory-wrong-target", {
        kind: "memory-proposal",
        path: "proposals/memory/apply-memory.json",
        targetPath: "memory/agents/main_agent.md",
        reason: "wrong target namespace"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-apply-report-wrong-output", {
        kind: "report-artifact",
        path: "reports/artifacts/apply-report.json",
        outputPath: "writing/chapters/not-a-report.md",
        reason: "wrong output namespace"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-apply-writing-wrong-output", {
        kind: "writing-draft",
        path: "writing/drafts/apply-draft.json",
        outputPath: "reports/not-a-chapter.md",
        reason: "wrong output namespace"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_path_namespace_denied" });
    await expect(
      tool.execute("tool-call-apply-swarm-output-unused", {
        kind: "swarm-output",
        path: "simulation/rounds/session/round-001/proposals/characters.json",
        outputPath: "simulation/turns/not-used.json",
        reason: "unused output path"
      })
    ).rejects.toMatchObject({ code: "web_safe_tool_invalid_params" });
  });
});
