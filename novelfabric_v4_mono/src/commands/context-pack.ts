import type { Command } from "commander";

import { buildContextPack, validateContextPack } from "../knowledge/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addContextPackCommands(program: Command): void {
  const contextPack = program
    .command("context-pack")
    .description("Build and validate deterministic citation context packs");

  contextPack
    .command("build")
    .description("Build a deterministic context pack from recall citations")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--kind <kind>", "Context pack kind, such as role-turn")
    .option("--query <text>", "Recall query override")
    .option("--agent <agent-id>", "Agent id for the task context")
    .option("--session <session-id>", "Simulation/session id for the task context")
    .option("--timeline <timeline>", "Timeline name")
    .option("--output <path>", "Workspace output path")
    .option("--limit <number>", "Maximum recall result count", parseIntegerOption)
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ContextPackBuildOptions) => {
      const result = await buildContextPack({
        workspacePath: options.workspace,
        actor: options.actor,
        kind: options.kind,
        ...(options.query === undefined ? {} : { query: options.query }),
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(options.session === undefined ? {} : { session: options.session }),
        ...(options.timeline === undefined ? {} : { timeline: options.timeline }),
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "context-pack build",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  contextPack
    .command("validate")
    .description("Validate context-pack citations against current source hashes")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace context-pack path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ContextPackValidateOptions) => {
      const result = await validateContextPack({
        workspacePath: options.workspace,
        path: options.path
      });
      writeJson({
        ok: true,
        command: "context-pack validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type ContextPackBuildOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly kind: string;
  readonly query?: string;
  readonly agent?: string;
  readonly session?: string;
  readonly timeline?: string;
  readonly output?: string;
  readonly limit?: number;
  readonly reason?: string;
};

type ContextPackValidateOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path: string;
};

function parseIntegerOption(value: string): number {
  return Number.parseInt(value, 10);
}
