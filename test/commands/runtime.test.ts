import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { addRuntimeCommands } from "../../src/commands/runtime.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "../../src/cli.ts");

describe("runtime command module", () => {
  it("registers the NovelFabric-wrapped pi runtime command surface", () => {
    const program = new Command();
    addRuntimeCommands(program);

    const runtime = findCommand(program, "runtime");
    expect(runtime).toBeDefined();
    if (runtime === undefined) return;

    expect(commandNames(runtime)).toEqual(
      expect.arrayContaining(["doctor", "config", "materialize", "extensions", "policy"])
    );

    const config = findCommand(runtime, "config");
    expect(config).toBeDefined();
    if (config !== undefined) {
      expect(commandNames(config)).toEqual(expect.arrayContaining(["path", "inspect"]));
    }

    const extensions = findCommand(runtime, "extensions");
    expect(extensions).toBeDefined();
    if (extensions !== undefined) {
      expect(commandNames(extensions)).toEqual(expect.arrayContaining(["list", "validate"]));
    }

    const policy = findCommand(runtime, "policy");
    expect(policy).toBeDefined();
    if (policy !== undefined) {
      expect(commandNames(policy)).toContain("inspect");
    }
  });

  it("fails runtime doctor through the CLI when required pi SDK exports are unavailable", async () => {
    const configHome = await mkdtemp(path.join(os.tmpdir(), "novelfabric-runtime-cli-"));
    try {
      await execFileAsync(
        "npx",
        ["tsx", CLI_PATH, "runtime", "materialize", "--actor", "main_agent", "--json"],
        {
          env: makeEnvironment({ HOME: configHome, XDG_CONFIG_HOME: configHome })
        }
      );

      const result = await runCliExpectingFailure(["runtime", "doctor", "--json"], {
        HOME: configHome,
        XDG_CONFIG_HOME: configHome,
        NOVELFABRIC_TEST_FORCE_PI_SDK_MISSING_EXPORTS: "createAgentSession"
      });

      expect(result.exitCode).toBe(2);
      expect(result.envelope.ok).toBe(true);
      expect(result.envelope.command).toBe("runtime doctor");
      expect(result.envelope.data.valid).toBe(false);
      const sdkDiagnostic = result.envelope.data.diagnostics.find(
        (diagnostic) => diagnostic.kind === "pi-sdk"
      );
      expect(sdkDiagnostic).toBeDefined();
      expect(sdkDiagnostic?.valid).toBe(false);
      expect(sdkDiagnostic?.reason).toBe("missing_required_exports");
      expect(sdkDiagnostic?.missingExports).toContain("createAgentSession");
    } finally {
      await rm(configHome, { recursive: true, force: true });
    }
  });
});

function findCommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find((command) => command.name() === name);
}

function commandNames(parent: Command): readonly string[] {
  return parent.commands.map((command) => command.name());
}

async function runCliExpectingFailure(
  args: readonly string[],
  environment: Record<string, string>
): Promise<{ readonly exitCode: number; readonly envelope: RuntimeDoctorCliEnvelope }> {
  try {
    await execFileAsync("npx", ["tsx", CLI_PATH, ...args], {
      env: makeEnvironment(environment)
    });
    throw new Error(`Expected CLI command to fail: ${args.join(" ")}`);
  } catch (error) {
    if (error instanceof Error && isExecFailure(error)) {
      return { exitCode: error.code, envelope: parseRuntimeDoctorEnvelope(error.stdout) };
    }
    throw error;
  }
}

function makeEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    npm_config_cache: process.env["npm_config_cache"],
    ...overrides
  };
}

function parseRuntimeDoctorEnvelope(stdout: string): RuntimeDoctorCliEnvelope {
  const parsed: unknown = JSON.parse(stdout.trim());
  if (!isRuntimeDoctorCliEnvelope(parsed)) {
    throw new Error(`Unexpected runtime doctor envelope: ${stdout}`);
  }
  return parsed;
}

type RuntimeDoctorCliEnvelope = {
  readonly ok: true;
  readonly command: "runtime doctor";
  readonly data: {
    readonly valid: boolean;
    readonly diagnostics: readonly RuntimeDoctorDiagnostic[];
  };
};

type RuntimeDoctorDiagnostic = {
  readonly kind?: string;
  readonly valid: boolean;
  readonly reason?: string;
  readonly missingExports?: readonly string[];
};

function isRuntimeDoctorCliEnvelope(value: unknown): value is RuntimeDoctorCliEnvelope {
  return (
    isRecord(value) &&
    value["ok"] === true &&
    value["command"] === "runtime doctor" &&
    isRecord(value["data"]) &&
    typeof value["data"]["valid"] === "boolean" &&
    Array.isArray(value["data"]["diagnostics"]) &&
    value["data"]["diagnostics"].every(isRuntimeDoctorDiagnostic)
  );
}

function isRuntimeDoctorDiagnostic(value: unknown): value is RuntimeDoctorDiagnostic {
  return (
    isRecord(value) &&
    typeof value["valid"] === "boolean" &&
    (value["kind"] === undefined || typeof value["kind"] === "string") &&
    (value["reason"] === undefined || typeof value["reason"] === "string") &&
    (value["missingExports"] === undefined ||
      (Array.isArray(value["missingExports"]) &&
        value["missingExports"].every((item) => typeof item === "string")))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
