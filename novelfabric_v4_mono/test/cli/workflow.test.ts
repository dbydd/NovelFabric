import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "../../src/cli.ts");
const TSX_PATH = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), command: z.string(), data: z.record(z.string(), z.unknown()) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

type Envelope = z.infer<typeof envelopeSchema>;

describe("workflow CLI acceptance guard", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-workflow-cli-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run"]\n',
      "utf8"
    );
    await runCli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      "imports/source/cli-workflow.txt",
      "--actor",
      "main_agent",
      "--content",
      "第一章 开端\n一个可测试的故事入口。\n",
      "--json"
    ]);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("exposes workflow plan/start/step/status/artifacts/verify through the main CLI", async () => {
    const plan = await runCli([
      "workflow",
      "plan",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/cli-workflow.txt",
      "--role",
      "main_agent",
      "--plan-id",
      "cli-acceptance",
      "--json"
    ]);
    expect(plan.exitCode).toBe(0);
    expect(plan.envelope.ok).toBe(true);
    if (!plan.envelope.ok) return;
    expect(plan.envelope.command).toBe("workflow plan");

    const start = await runCli([
      "workflow",
      "start",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--plan",
      "cli-acceptance",
      "--json"
    ]);
    expect(start.exitCode).toBe(0);
    expect(start.envelope.ok).toBe(true);
    if (!start.envelope.ok) return;
    expect(start.envelope.data["status"]).toBe("running");
    expect(start.envelope.data["jobId"]).toBe("cli-acceptance");

    const step = await runCli([
      "workflow",
      "step",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--job",
      "cli-acceptance",
      "--input",
      '{"stage":"import.normalize"}',
      "--json"
    ]);
    expect(step.exitCode).toBe(0);
    expect(step.envelope.ok).toBe(true);
    if (!step.envelope.ok) return;
    expect(step.envelope.data["executedStage"]).toBe("import.normalize");
    expect(step.envelope.data["stageStatus"]).toBe("completed");

    const artifacts = await runCli([
      "workflow",
      "artifacts",
      "--workspace",
      workspacePath,
      "--job",
      "cli-acceptance",
      "--json"
    ]);
    expect(artifacts.exitCode).toBe(0);
    expect(artifacts.envelope.ok).toBe(true);
    if (artifacts.envelope.ok) {
      expect(Number(artifacts.envelope.data["artifactCount"])).toBeGreaterThan(0);
    }

    const verify = await runCli([
      "workflow",
      "verify",
      "--workspace",
      workspacePath,
      "--job",
      "cli-acceptance",
      "--json"
    ]);
    expect(verify.exitCode).toBe(0);
    expect(verify.envelope.ok).toBe(true);
    if (verify.envelope.ok) {
      expect(verify.envelope.data["valid"]).toBe(true);
    }
  }, 20000);
});

type CliRunResult = {
  readonly exitCode: number;
  readonly envelope: Envelope;
};

async function runCli(args: readonly string[]): Promise<CliRunResult> {
  try {
    const success = await execFileAsync(TSX_PATH, [CLI_PATH, ...args], {
      env: { ...process.env, HOME: "/Users/dbydd", XDG_CONFIG_HOME: "" }
    });
    return { exitCode: 0, envelope: parseEnvelope(success.stdout) };
  } catch (error) {
    if (error instanceof Error && isExecFailure(error)) {
      return { exitCode: error.code, envelope: parseEnvelope(error.stdout) };
    }
    throw error;
  }
}

function parseEnvelope(stdout: string): Envelope {
  return envelopeSchema.parse(JSON.parse(stdout));
}

type ExecFailure = Error & { readonly code: number; readonly stdout: string };

function isExecFailure(error: Error): error is ExecFailure {
  return "code" in error && "stdout" in error;
}
