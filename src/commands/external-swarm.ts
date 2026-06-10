import { readFile } from "node:fs/promises";

import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import {
  createOrGetExternalSwarmInference,
  getExternalSwarmInference,
  requireExternalSwarmContext,
  toMcpStructuredResult,
  validateExternalSwarmInference,
  type ExternalSwarmInferenceRequest
} from "../external-swarm/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addExternalSwarmCommands(program: Command): void {
  const externalSwarm = program
    .command("external-swarm")
    .description("Frozen external swarm REST/MCP compatibility CLI wrapper");

  externalSwarm
    .command("infer")
    .description("Create or reuse a deterministic external swarm inference artifact set")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--request <path>", "Request JSON path, or '-' for stdin")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ExternalSwarmInferOptions) => {
      const request = await readRequestJson(options.request);
      const result = await createOrGetExternalSwarmInference({
        workspacePath: options.workspace,
        actor: options.actor,
        request,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "external-swarm infer",
        data: {
          ...result,
          mcp: toMcpStructuredResult(result),
          outputMode: resolveOutputMode(options)
        }
      });
    });

  externalSwarm
    .command("get")
    .description("Read a persisted external swarm inference by inference_id")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--inference-id <id>", "External swarm inference id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ExternalSwarmGetOptions) => {
      const result = await getExternalSwarmInference({
        workspacePath: options.workspace,
        actor: options.actor,
        inferenceId: options.inferenceId
      });
      writeJson({
        ok: true,
        command: "external-swarm get",
        data: {
          ...result,
          mcp: toMcpStructuredResult(result),
          outputMode: resolveOutputMode(options)
        }
      });
    });

  externalSwarm
    .command("require-context")
    .description("Inspect an external swarm request and return missing context requirements")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--request <path>", "Request JSON path, or '-' for stdin")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ExternalSwarmRequireContextOptions) => {
      const request = await readRequestJson(options.request);
      const result = await requireExternalSwarmContext({
        workspacePath: options.workspace,
        actor: options.actor,
        request
      });
      writeJson({
        ok: true,
        command: "external-swarm require-context",
        data: {
          ...result,
          mcp: toMcpStructuredResult(result),
          outputMode: resolveOutputMode(options)
        }
      });
    });

  externalSwarm
    .command("validate")
    .description("Validate persisted external swarm manifest and artifact paths")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--inference-id <id>", "External swarm inference id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ExternalSwarmValidateOptions) => {
      const result = await validateExternalSwarmInference({
        workspacePath: options.workspace,
        actor: options.actor,
        inferenceId: options.inferenceId
      });
      writeJson({
        ok: true,
        command: "external-swarm validate",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!result.valid) {
        process.exitCode = 2;
      }
    });
}

type ExternalSwarmBaseOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
};

type ExternalSwarmInferOptions = ExternalSwarmBaseOptions & {
  readonly request: string;
  readonly reason?: string;
};

type ExternalSwarmGetOptions = ExternalSwarmBaseOptions & {
  readonly inferenceId: string;
};

type ExternalSwarmRequireContextOptions = ExternalSwarmBaseOptions & {
  readonly request: string;
};

type ExternalSwarmValidateOptions = ExternalSwarmGetOptions;

async function readRequestJson(requestPath: string): Promise<ExternalSwarmInferenceRequest> {
  const content = requestPath === "-" ? await readStdin() : await readFile(requestPath, "utf8");
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      throw new CommandFailure(
        "invalid_external_swarm_request",
        "External swarm request JSON must be an object."
      );
    }
    return parsed as ExternalSwarmInferenceRequest;
  } catch (error) {
    if (error instanceof CommandFailure) throw error;
    throw new CommandFailure(
      "invalid_external_swarm_request",
      error instanceof Error ? error.message : "External swarm request JSON could not be parsed."
    );
  }
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk.toString("utf8"));
    } else {
      throw new CommandFailure(
        "invalid_external_swarm_request",
        "stdin produced a non-text chunk that could not be decoded."
      );
    }
  }
  return chunks.join("");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
