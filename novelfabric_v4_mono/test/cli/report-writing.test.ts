import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addReportCommands } from "../../src/commands/report.js";
import { addWritingCommands } from "../../src/commands/writing.js";
import { contentHash, readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    taskPath: z.string().optional(),
    reportPath: z.string().optional(),
    valid: z.boolean().optional(),
    reportCount: z.number().optional(),
    content: z.string().optional(),
    outputPath: z.string().optional(),
    citationCount: z.number().optional(),
    expectedDraftPath: z.string().optional(),
    chapterPath: z.string().optional(),
    wordCount: z.number().optional(),
    exportPath: z.string().optional(),
    chapterCount: z.number().optional()
  })
});

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("report and writing command registrations", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-report-writing-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md",
      content: "# Chapter One\n\nAria opens the west gate.\n",
      actor: "main_agent",
      reason: "seed chapter"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/sessions/session-001.json",
      content: '{"id":"session-001","status":"ready"}\n',
      actor: "main_agent",
      reason: "seed session"
    });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("exposes report task, validate, apply, list, and show commands", async () => {
    const task = await runRegisteredCommand([
      "report",
      "task",
      "create",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--session",
      "session-001",
      "--kind",
      "consistency",
      "--json"
    ]);
    expect(task.command).toBe("report task create");
    expect(task.data.taskPath).toMatch(/^reports\/tasks\/report-consistency-/);

    const citation = await readWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/artifacts/cli-report.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.report.artifact",
          version: 1,
          reportKind: "consistency",
          session: "session-001",
          title: "CLI Report",
          markdown: "# CLI Report\n\nReady to apply.",
          citations: [{ path: citation.path, hash: citation.hash }]
        },
        null,
        2
      )}\n`,
      actor: "main_agent"
    });

    const validation = await runRegisteredCommand([
      "report",
      "validate",
      "--workspace",
      workspacePath,
      "--artifact",
      "reports/artifacts/cli-report.json",
      "--json"
    ]);
    expect(validation.command).toBe("report validate");
    expect(validation.data.valid).toBe(true);

    const apply = await runRegisteredCommand([
      "report",
      "apply",
      "--workspace",
      workspacePath,
      "--artifact",
      "reports/artifacts/cli-report.json",
      "--actor",
      "main_agent",
      "--output",
      "reports/cli-report.md",
      "--json"
    ]);
    expect(apply.command).toBe("report apply");
    expect(apply.data.reportPath).toBe("reports/cli-report.md");

    const list = await runRegisteredCommand([
      "report",
      "list",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(list.command).toBe("report list");
    expect(list.data.reportCount).toBeGreaterThan(0);

    const show = await runRegisteredCommand([
      "report",
      "show",
      "--workspace",
      workspacePath,
      "--path",
      "reports/cli-report.md",
      "--json"
    ]);
    expect(show.command).toBe("report show");
    expect(show.data.content).toContain("Ready to apply");
  });

  it("exposes writing context-pack, draft, apply-draft, review, and export commands", async () => {
    const pack = await runRegisteredCommand([
      "writing",
      "context-pack",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--session",
      "session-001",
      "--json"
    ]);
    expect(pack.command).toBe("writing context-pack");
    expect(pack.data.outputPath).toBe("writing/context-packs/session-001.json");
    expect(pack.data.citationCount).toBeGreaterThan(0);

    const draftTask = await runRegisteredCommand([
      "writing",
      "draft",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--context-pack",
      "writing/context-packs/session-001.json",
      "--json"
    ]);
    expect(draftTask.command).toBe("writing draft");
    expect(draftTask.data.expectedDraftPath).toMatch(/^writing\/drafts\/session-001-/);

    const chapter = await readWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/drafts/cli-draft.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.writing.draft",
          version: 1,
          title: "CLI Chapter",
          markdown: "# CLI Chapter\n\nThe applied draft keeps its citation.",
          citations: [{ path: chapter.path, hash: chapter.hash }]
        },
        null,
        2
      )}\n`,
      actor: "main_agent"
    });

    const applied = await runRegisteredCommand([
      "writing",
      "apply-draft",
      "--workspace",
      workspacePath,
      "--draft",
      "writing/drafts/cli-draft.json",
      "--actor",
      "main_agent",
      "--output",
      "writing/chapters/cli-chapter.md",
      "--json"
    ]);
    expect(applied.command).toBe("writing apply-draft");
    expect(applied.data.chapterPath).toBe("writing/chapters/cli-chapter.md");

    const review = await runRegisteredCommand([
      "writing",
      "review",
      "--workspace",
      workspacePath,
      "--chapter",
      "writing/chapters/cli-chapter.md",
      "--json"
    ]);
    expect(review.command).toBe("writing review");
    expect(review.data.valid).toBe(true);
    expect(review.data.wordCount).toBeGreaterThan(0);

    const exported = await runRegisteredCommand([
      "writing",
      "export",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--format",
      "markdown",
      "--output",
      "writing/exports/cli.md",
      "--json"
    ]);
    expect(exported.command).toBe("writing export");
    expect(exported.data.exportPath).toBe("writing/exports/cli.md");
    expect(exported.data.chapterCount).toBeGreaterThan(0);
  });

  it("validates stale draft citation hashes before apply-draft", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/drafts/stale.json",
      content: `${JSON.stringify(
        {
          kind: "novelfabric.writing.draft",
          version: 1,
          title: "Stale",
          markdown: "# Stale\n",
          citations: [{ path: "writing/chapters/chapter-001.md", hash: contentHash("old") }]
        },
        null,
        2
      )}\n`,
      actor: "main_agent"
    });

    await expect(
      runRegisteredCommand([
        "writing",
        "apply-draft",
        "--workspace",
        workspacePath,
        "--draft",
        "writing/drafts/stale.json",
        "--actor",
        "main_agent",
        "--json"
      ])
    ).rejects.toThrow("Writing draft failed validation");
  });
});

async function runRegisteredCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.name("novelfabric-test").exitOverride();
  addReportCommands(program);
  addWritingCommands(program);

  let stdout = "";
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  try {
    await program.parseAsync(["node", "novelfabric-test", ...args], { from: "node" });
  } finally {
    writeSpy.mockRestore();
  }
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}
