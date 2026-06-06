import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { addAgentTaskCommands } from "../../src/commands/agent.js";
import { readWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.union([
  z.object({
    ok: z.literal(true),
    command: z.string(),
    data: z.looseObject({
      taskId: z.string().optional(),
      packagePath: z.string().optional(),
      status: z.string().optional(),
      eventCount: z.number().optional(),
      valid: z.boolean().optional(),
      issues: z.array(z.looseObject({ code: z.string() })).optional(),
      writes: z.array(z.looseObject({ path: z.string(), auditPath: z.string() })).optional(),
      files: z.looseObject({ taskMarkdown: z.string() }).optional(),
      piSdk: z.looseObject({ adapter: z.string(), available: z.boolean() }).optional()
    })
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("agent task command module", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-agent-task-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("creates and inspects a complete pi runtime task package", async () => {
    const createResult = await runCommand([
      "agent",
      "task",
      "create",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--task-id",
      "chapter-draft-001",
      "--title",
      "Chapter Draft",
      "--instruction",
      "Draft a chapter from the provided context pack.",
      "--input-json",
      JSON.stringify({ source: "imports/source/test_novel.txt" }),
      "--allowed-command",
      "novelfabric files read",
      "--allowed-command",
      "novelfabric writing apply-draft",
      "--json"
    ]);

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error("Expected create success.");
    expect(createResult.command).toBe("agent task create");
    expect(createResult.data).toMatchObject({
      taskId: "chapter-draft-001",
      packagePath: ".novelfabric/tasks/chapter-draft-001"
    });
    expect(createResult.data.writes).toHaveLength(7);
    expect(createResult.data.files?.taskMarkdown).toBe(
      ".novelfabric/tasks/chapter-draft-001/task.md"
    );

    for (const fileName of [
      "task.md",
      "input.json",
      "context-pack.json",
      "allowed-commands.md",
      "output.schema.json",
      "result.json",
      "events.jsonl"
    ]) {
      await expect(
        fs.stat(path.join(workspacePath, ".novelfabric", "tasks", "chapter-draft-001", fileName))
      ).resolves.toBeDefined();
    }

    const inspectResult = await runCommand([
      "agent",
      "task",
      "inspect",
      "--workspace",
      workspacePath,
      "--task",
      "chapter-draft-001",
      "--json"
    ]);

    expect(inspectResult.ok).toBe(true);
    if (inspectResult.ok) {
      expect(inspectResult.command).toBe("agent task inspect");
      expect(inspectResult.data.taskId).toBe("chapter-draft-001");
    }
  });

  it("records run status, validates output, and aborts through audited workspace writes", async () => {
    await runCommand([
      "agent",
      "task",
      "create",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--task-id",
      "runtime-check",
      "--title",
      "Runtime Check",
      "--instruction",
      "Record runtime metadata only.",
      "--json"
    ]);

    const runResult = await runCommand([
      "agent",
      "run",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--task",
      "runtime-check",
      "--runtime",
      "pi",
      "--json"
    ]);

    expect(runResult.ok).toBe(true);
    if (!runResult.ok) throw new Error("Expected run success.");
    expect(runResult.command).toBe("agent run");
    expect(runResult.data.status).toBe("run-recorded");
    expect(runResult.data.piSdk?.adapter).toBe("@earendil-works/pi-coding-agent");

    const statusResult = await runCommand([
      "agent",
      "status",
      "--workspace",
      workspacePath,
      "--task",
      "runtime-check",
      "--json"
    ]);
    expect(statusResult.ok).toBe(true);
    if (statusResult.ok) {
      expect(statusResult.command).toBe("agent status");
      expect(statusResult.data).toMatchObject({ status: "run-recorded", eventCount: 2 });
    }

    const validateResult = await runCommand([
      "agent",
      "output",
      "validate",
      "--workspace",
      workspacePath,
      "--task",
      "runtime-check",
      "--json"
    ]);
    expect(validateResult.ok).toBe(true);
    if (validateResult.ok) {
      expect(validateResult.command).toBe("agent output validate");
      expect(validateResult.data.valid).toBe(true);
      expect(validateResult.data.issues).toEqual([]);
    }

    const abortResult = await runCommand([
      "agent",
      "abort",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--task",
      "runtime-check",
      "--reason",
      "operator stopped task",
      "--json"
    ]);
    expect(abortResult.ok).toBe(true);
    if (abortResult.ok) {
      expect(abortResult.command).toBe("agent abort");
      expect(abortResult.data.status).toBe("aborted");
      expect(abortResult.data.writes?.every((write) => write.auditPath.length > 0)).toBe(true);
    }

    const resultFile = await readWorkspaceFile({
      workspacePath,
      path: ".novelfabric/tasks/runtime-check/result.json"
    });
    expect(JSON.parse(resultFile.content)).toMatchObject({ status: "aborted" });
  });

  it("keeps task package writes behind protected workspace capabilities", async () => {
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage"]\n\n',
      "utf8"
    );

    await expect(
      runCommand([
        "agent",
        "task",
        "create",
        "--workspace",
        workspacePath,
        "--actor",
        "main_agent",
        "--task-id",
        "denied-task",
        "--title",
        "Denied Task",
        "--instruction",
        "This should not bypass protected writes.",
        "--json"
      ])
    ).rejects.toMatchObject({ code: "capability_denied" });
  });
});

async function grantProtectedTaskWrite(workspacePath: string): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      'allow = ["project.manage", "files.patch_protected"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function runCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  addAgentTaskCommands(program);

  const stdout = await captureStdout(async () => {
    await program.parseAsync(["node", "novelfabric", ...args], { from: "node" });
  });
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  try {
    await action();
    return stdout;
  } finally {
    process.stdout.write = originalWrite;
  }
}
