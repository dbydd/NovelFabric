import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";

import { addProjectCommands } from "../../src/commands/project.js";
import { isCommandFailure } from "../../src/errors.js";
import { writeJson } from "../../src/output.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "../../src/cli.ts");
const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const envelopeSchema = z.union([
  z.object({ ok: z.literal(true), command: z.string(), data: z.record(z.string(), z.unknown()) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

type Envelope = z.infer<typeof envelopeSchema>;

describe("project and workspace CLI commands", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-project-cli-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("materializes and validates a workspace through workspace commands", async () => {
    const workspacePath = path.join(tempRoot, "workspace");
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.rm(path.join(workspacePath, "reports"), { recursive: true, force: true });

    const invalid = await runMainCli([
      "workspace",
      "validate",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(invalid.exitCode).toBe(2);
    expect(invalid.envelope.ok).toBe(true);
    if (invalid.envelope.ok) {
      expect(invalid.envelope.command).toBe("workspace validate");
      expect(invalid.envelope.data["valid"]).toBe(false);
    }

    const materialized = await runMainCli([
      "workspace",
      "materialize",
      "--workspace",
      workspacePath,
      "--template",
      "novel-project",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(materialized.exitCode).toBe(0);
    expect(materialized.envelope.ok).toBe(true);
    if (materialized.envelope.ok) {
      expect(materialized.envelope.command).toBe("workspace materialize");
      expect(materialized.envelope.data["valid"]).toBe(true);
      expect(materialized.envelope.data["created"]).toContain("reports");
    }

    const inspected = await runMainCli([
      "workspace",
      "inspect",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.envelope.ok).toBe(true);
    if (inspected.envelope.ok) {
      expect(inspected.envelope.command).toBe("workspace inspect");
      expect(inspected.envelope.data["valid"]).toBe(true);
    }
  });

  it("initializes a workspace whose main_agent can create protected workflow plans", async () => {
    const workspacePath = path.join(tempRoot, "test-novel");

    const init = await runMainCli([
      "project",
      "init",
      "--path",
      workspacePath,
      "--name",
      "Test Novel",
      "--json"
    ]);
    expect(init.exitCode).toBe(0);
    expect(init.envelope.ok).toBe(true);

    const sourceWrite = await runMainCli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      "imports/source/test_novel.txt",
      "--actor",
      "main_agent",
      "--content",
      "第一章 开端\n叶小伟醒来，城市边缘传来钟声。\n第二章 余波\n新的选择被摆在桌面。\n",
      "--json"
    ]);
    expect(sourceWrite.exitCode).toBe(0);
    expect(sourceWrite.envelope.ok).toBe(true);

    const planned = await runMainCli([
      "workflow",
      "plan",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/test_novel.txt",
      "--role",
      "Aria",
      "--json"
    ]);
    expect(planned.exitCode).toBe(0);
    expect(planned.envelope.ok).toBe(true);
    if (planned.envelope.ok) {
      expect(planned.envelope.command).toBe("workflow plan");
      expect(planned.envelope.data["planPath"]).toEqual(
        expect.stringMatching(/^\.novelfabric\/jobs\/.+\/plan\.json$/)
      );
    }

    const caps = await fs.readFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      "utf8"
    );
    expect(caps).toContain('"files.patch_protected"');
    expect(caps).toContain('"swarm.run"');
    expect(caps).toContain("[role_agent]");
    expect(caps).toContain("deny = ");
  });

  it("runs project command module without requiring src/cli.ts integration", async () => {
    const workspacePath = path.join(tempRoot, "ember-archive");

    const init = await runProjectCli([
      "project",
      "init",
      "--path",
      workspacePath,
      "--name",
      "Ember Archive",
      "--json"
    ]);
    expect(init.exitCode).toBe(0);
    expect(init.envelope.ok).toBe(true);
    if (init.envelope.ok) {
      expect(init.envelope.command).toBe("project init");
      expect(init.envelope.data["valid"]).toBe(true);
    }

    const inspected = await runProjectCli([
      "project",
      "inspect",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.envelope.ok).toBe(true);
    if (inspected.envelope.ok) {
      expect(inspected.envelope.command).toBe("project inspect");
      expect(inspected.envelope.data["valid"]).toBe(true);
    }

    const listed = await runProjectCli(["project", "list", "--root", tempRoot, "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(listed.envelope.ok).toBe(true);
    if (listed.envelope.ok) {
      expect(listed.envelope.command).toBe("project list");
      expect(listed.envelope.data["validCount"]).toBe(1);
    }
  });
});

type CliRunResult = {
  readonly exitCode: number;
  readonly envelope: Envelope;
};

async function runMainCli(args: readonly string[]): Promise<CliRunResult> {
  try {
    const success = await execFileAsync("npx", ["tsx", CLI_PATH, ...args], {
      env: makeEnvironment()
    });
    return { exitCode: 0, envelope: parseEnvelope(success.stdout) };
  } catch (error) {
    if (error instanceof Error && isExecFailure(error)) {
      return { exitCode: error.code, envelope: parseEnvelope(error.stdout) };
    }
    throw error;
  }
}

async function runProjectCli(args: readonly string[]): Promise<CliRunResult> {
  const originalExitCode = process.exitCode;
  let stdout = "";
  process.exitCode = undefined;
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });

  try {
    const program = new Command();
    program.exitOverride();
    addProjectCommands(program);
    await program.parseAsync(["node", "novelfabric", ...args], { from: "node" });
  } catch (error) {
    if (error instanceof Error && isCommandFailure(error)) {
      writeJson({ ok: false, error: { code: error.code, message: error.message } });
      process.exitCode = error.exitCode;
    } else {
      throw error;
    }
  } finally {
    stdoutSpy.mockRestore();
  }

  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = originalExitCode;
  return { exitCode, envelope: parseEnvelope(stdout) };
}

function makeEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    npm_config_cache: process.env["npm_config_cache"],
    HOME: "/Users/dbydd",
    XDG_CONFIG_HOME: ""
  };
}

function parseEnvelope(stdout: string): Envelope {
  return envelopeSchema.parse(JSON.parse(stdout.trim()));
}

type ExecFileFailure = Error & {
  readonly code: number;
  readonly stdout: string;
};

function isExecFailure(error: Error): error is ExecFileFailure {
  return (
    "code" in error &&
    typeof error.code === "number" &&
    "stdout" in error &&
    typeof error.stdout === "string"
  );
}
