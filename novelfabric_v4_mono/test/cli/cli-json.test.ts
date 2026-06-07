import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(import.meta.dirname, "../../src/cli.ts");

const outputModeSchema = z.object({
  format: z.literal("json"),
  source: z.union([z.literal("explicit-flag"), z.literal("default")])
});

const cliSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.object({
    configRoot: z.string().optional(),
    valid: z.boolean().optional(),
    mode: z.string().optional(),
    port: z.number().optional(),
    backendApi: z.string().optional(),
    piAgentBridge: z.string().optional(),
    outputMode: outputModeSchema.optional()
  })
});

const cliErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

const cliEnvelopeSchema = z.union([cliSuccessEnvelopeSchema, cliErrorEnvelopeSchema]);

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("novelfabric CLI JSON contract", () => {
  it("prints config path as JSON and records explicit --json output mode", async () => {
    const result = await runCli(["config", "path", "--json"], {
      HOME: "/Users/dbydd",
      XDG_CONFIG_HOME: ""
    });

    expect(result.exitCode).toBe(0);
    expect(result.envelope.ok).toBe(true);
    if (result.envelope.ok) {
      expect(result.envelope.command).toBe("config path");
      expect(result.envelope.data.configRoot).toBe("/Users/dbydd/.config/novelfabric");
      expect(result.envelope.data.outputMode).toEqual({ format: "json", source: "explicit-flag" });
    }
  });

  it("prints workspace doctor result as JSON for the valid fixture", async () => {
    const fixture = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
    const result = await runCli(["workspace", "doctor", "--path", fixture], {
      HOME: "/Users/dbydd",
      XDG_CONFIG_HOME: ""
    });

    expect(result.exitCode).toBe(0);
    expect(result.envelope.ok).toBe(true);
    if (result.envelope.ok) {
      expect(result.envelope.command).toBe("workspace doctor");
      expect(result.envelope.data.valid).toBe(true);
      expect(result.envelope.data.outputMode).toEqual({ format: "json", source: "default" });
    }
  });

  it("prints web demo dry-run diagnostics without starting the server", async () => {
    const result = await runCli(["web", "demo", "--port", "50021", "--dry-run", "--json"], {
      HOME: "/Users/dbydd",
      XDG_CONFIG_HOME: ""
    });

    expect(result.exitCode).toBe(0);
    expect(result.envelope.ok).toBe(true);
    if (result.envelope.ok) {
      expect(result.envelope.command).toBe("web demo");
      expect(result.envelope.data.mode).toBe("layout-only-demo");
      expect(result.envelope.data.port).toBe(50021);
      expect(result.envelope.data.backendApi).toBe("disabled");
      expect(result.envelope.data.piAgentBridge).toBe("disabled");
      expect(result.envelope.data.outputMode).toEqual({ format: "json", source: "explicit-flag" });
    }
  });

  it("prints web bridge dry-run diagnostics with web-safe pi session prepare status", async () => {
    const fixture = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
    const result = await runCli(
      ["web", "bridge", "--workspace", fixture, "--port", "50023", "--dry-run", "--json"],
      {
        HOME: "/Users/dbydd",
        XDG_CONFIG_HOME: ""
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.envelope.ok).toBe(true);
    if (result.envelope.ok) {
      expect(result.envelope.command).toBe("web bridge");
      expect(result.envelope.data.mode).toBe("cli-backed-file-bridge");
      expect(result.envelope.data.port).toBe(50023);
      expect(result.envelope.data.backendApi).toBe("cli-backed-bridge");
      expect(result.envelope.data.piAgentBridge).toBe("web-safe-session-prepare");
    }
  });

  it.each([
    ["3000", "reserved_web_port"],
    ["49999", "reserved_web_port"],
    ["50021abc", "invalid_web_port"],
    ["0", "invalid_web_port"],
    ["65536", "invalid_web_port"],
    ["50021.5", "invalid_web_port"]
  ])("rejects invalid or non-50000+ web port %s", async (port, expectedCode) => {
    const result = await runCli(["web", "demo", "--port", port, "--dry-run"], {
      HOME: "/Users/dbydd",
      XDG_CONFIG_HOME: ""
    });

    expect(result.exitCode).toBe(1);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error.code).toBe(expectedCode);
    }
  });

  it("prints a structured JSON error when config root cannot be resolved", async () => {
    const result = await runCli(["config", "path"], {
      HOME: "",
      XDG_CONFIG_HOME: ""
    });

    expect(result.exitCode).toBe(1);
    expect(result.envelope.ok).toBe(false);
    if (!result.envelope.ok) {
      expect(result.envelope.error.code).toBe("config_root_unresolved");
      expect(result.envelope.error.message).toContain("XDG_CONFIG_HOME");
    }
  });
});

type CliRunResult = {
  readonly exitCode: number;
  readonly envelope: CliEnvelope;
};

async function runCli(
  args: readonly string[],
  environment: Record<string, string>
): Promise<CliRunResult> {
  try {
    const success = await execFileAsync("npx", ["tsx", CLI_PATH, ...args], {
      env: makeEnvironment(environment)
    });
    return { exitCode: 0, envelope: parseEnvelope(success.stdout) };
  } catch (error) {
    if (error instanceof Error && isExecFailure(error)) {
      return { exitCode: error.code, envelope: parseEnvelope(error.stdout) };
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
