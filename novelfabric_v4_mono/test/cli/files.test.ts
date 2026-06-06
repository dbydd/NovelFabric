import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "../../src/cli.ts");
const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.union([
  z.object({
    ok: z.literal(true),
    command: z.string(),
    data: z.looseObject({
      path: z.string().optional(),
      protected: z.boolean().optional(),
      hash: z.string().optional(),
      auditPath: z.string().optional()
    })
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("novelfabric files CLI", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-files-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("reads and writes files through JSON CLI commands", async () => {
    const readResult = await runCli([
      "files",
      "read",
      "--workspace",
      workspacePath,
      "--path",
      "project.md",
      "--json"
    ]);
    expect(readResult.exitCode).toBe(0);
    expect(readResult.envelope.ok).toBe(true);
    if (readResult.envelope.ok) {
      expect(readResult.envelope.command).toBe("files read");
      expect(readResult.envelope.data.path).toBe("project.md");
      expect(readResult.envelope.data.protected).toBe(false);
    }

    const writeResult = await runCli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      "writing/drafts/cli-test.md",
      "--actor",
      "main_agent",
      "--content",
      "# CLI Test\n",
      "--json"
    ]);
    expect(writeResult.exitCode).toBe(0);
    expect(writeResult.envelope.ok).toBe(true);
    expect(await fs.readFile(path.join(workspacePath, "writing/drafts/cli-test.md"), "utf8")).toBe(
      "# CLI Test\n"
    );
  });

  it("runs files glob, stat, append, and protect-check commands", async () => {
    await fs.writeFile(
      path.join(workspacePath, "cards", "world", "cli-city.md"),
      "# CLI City\n",
      "utf8"
    );

    const globResult = await runCli([
      "files",
      "glob",
      "--workspace",
      workspacePath,
      "--base",
      "cards",
      "--pattern",
      "**/*.md",
      "--json"
    ]);
    expect(globResult.exitCode).toBe(0);
    expect(globResult.envelope.ok).toBe(true);
    if (globResult.envelope.ok) {
      expect(globResult.envelope.command).toBe("files glob");
      expect(globResult.envelope.data).toMatchObject({ base: "cards", pattern: "**/*.md" });
    }

    const statResult = await runCli([
      "files",
      "stat",
      "--workspace",
      workspacePath,
      "--path",
      "cards/world/cli-city.md",
      "--json"
    ]);
    expect(statResult.exitCode).toBe(0);
    expect(statResult.envelope.ok).toBe(true);
    if (statResult.envelope.ok) {
      expect(statResult.envelope.command).toBe("files stat");
      expect(statResult.envelope.data).toMatchObject({
        path: "cards/world/cli-city.md",
        protected: false
      });
    }

    const appendResult = await runCli([
      "files",
      "append",
      "--workspace",
      workspacePath,
      "--path",
      "writing/drafts/cli-append.md",
      "--actor",
      "main_agent",
      "--content",
      "appended\n",
      "--json"
    ]);
    expect(appendResult.exitCode).toBe(0);
    expect(appendResult.envelope.ok).toBe(true);
    expect(
      await fs.readFile(path.join(workspacePath, "writing/drafts/cli-append.md"), "utf8")
    ).toBe("appended\n");

    const protectResult = await runCli([
      "files",
      "protect-check",
      "--workspace",
      workspacePath,
      "--path",
      ".novelfabric/capabilities.toml",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(protectResult.exitCode).toBe(0);
    expect(protectResult.envelope.ok).toBe(true);
    if (protectResult.envelope.ok) {
      expect(protectResult.envelope.command).toBe("files protect-check");
      expect(protectResult.envelope.data).toMatchObject({
        path: ".novelfabric/capabilities.toml",
        protected: true
      });
    }
  });

  it("applies files patch through JSON CLI command", async () => {
    const targetPath = "writing/drafts/cli-patch.md";
    await fs.writeFile(path.join(workspacePath, targetPath), "one\ntwo\nthree\n", "utf8");
    const readResult = await runCli([
      "files",
      "read",
      "--workspace",
      workspacePath,
      "--path",
      targetPath,
      "--json"
    ]);
    expect(readResult.envelope.ok).toBe(true);
    if (!readResult.envelope.ok) throw new Error("Expected read success.");
    const patchJson = JSON.stringify({
      expectedBaseHash: readResult.envelope.data.hash,
      replacements: [
        { oldText: "one", newText: "ONE" },
        { oldText: "three", newText: "THREE" }
      ]
    });

    const patchResult = await runCli([
      "files",
      "patch",
      "--workspace",
      workspacePath,
      "--path",
      targetPath,
      "--actor",
      "main_agent",
      "--patch-json",
      patchJson,
      "--json"
    ]);

    expect(patchResult.exitCode).toBe(0);
    expect(patchResult.envelope.ok).toBe(true);
    if (patchResult.envelope.ok) {
      expect(patchResult.envelope.command).toBe("files patch");
      expect(patchResult.envelope.data).toMatchObject({
        path: targetPath,
        protected: false,
        replacementCount: 2
      });
    }
    expect(await fs.readFile(path.join(workspacePath, targetPath), "utf8")).toBe(
      "ONE\ntwo\nTHREE\n"
    );
  });

  it("reports invalid files patch replacements as structured JSON", async () => {
    const targetPath = "writing/drafts/cli-patch-error.md";
    await fs.writeFile(path.join(workspacePath, targetPath), "same same\n", "utf8");
    const readResult = await runCli([
      "files",
      "read",
      "--workspace",
      workspacePath,
      "--path",
      targetPath,
      "--json"
    ]);
    expect(readResult.envelope.ok).toBe(true);
    if (!readResult.envelope.ok) throw new Error("Expected read success.");

    const result = await runCli([
      "files",
      "patch",
      "--workspace",
      workspacePath,
      "--path",
      targetPath,
      "--actor",
      "main_agent",
      "--patch-json",
      JSON.stringify({
        expectedBaseHash: readResult.envelope.data.hash,
        replacements: [{ oldText: "same", newText: "SAME" }]
      }),
      "--json"
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error.code).toBe("file_patch_ambiguous_replacement");
    }
  });

  it("reports protected write denial as structured JSON", async () => {
    const result = await runCli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      ".novelfabric/capabilities.toml",
      "--actor",
      "main_agent",
      "--content",
      "[main_agent]\nallow = []\n",
      "--json"
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error.code).toBe("capability_denied");
    }
  });
});

type CliRunResult = {
  readonly exitCode: number;
  readonly envelope: CliEnvelope;
};

async function runCli(args: readonly string[]): Promise<CliRunResult> {
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

function makeEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    npm_config_cache: process.env["npm_config_cache"],
    HOME: "/Users/dbydd",
    XDG_CONFIG_HOME: ""
  };
}

function parseEnvelope(stdout: string): CliEnvelope {
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}

type ExecFileFailure = Error & {
  readonly code: number;
  readonly stdout: string;
};

function isExecFailure(error: Error): error is ExecFileFailure {
  return hasNumberCode(error) && hasStringStdout(error);
}

function hasNumberCode(error: Error): error is Error & { readonly code: number } {
  return "code" in error && typeof error.code === "number";
}

function hasStringStdout(error: Error): error is Error & { readonly stdout: string } {
  return "stdout" in error && typeof error.stdout === "string";
}
