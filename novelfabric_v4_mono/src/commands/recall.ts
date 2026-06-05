import type { Command } from "commander";

import { recallKnowledge, type RecallMode } from "../knowledge/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addRecallCommands(program: Command): void {
  const recall = program
    .command("recall")
    .description("Deterministic citation-backed recall tools without LLM calls");

  recall
    .command("quick")
    .description("Run deterministic source recall with query expansion")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--query <text>", "Recall query text")
    .option("--limit <number>", "Maximum result count", parseIntegerOption)
    .option("--json", "Print machine-readable JSON")
    .action(async (options: RecallOptions) => {
      await runRecallCommand("quick", options);
    });

  recall
    .command("panorama")
    .description("Run deterministic recall prioritized for timeline context")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--query <text>", "Recall query text")
    .option("--timeline <timeline>", "Timeline name", "main")
    .option("--limit <number>", "Maximum result count", parseIntegerOption)
    .option("--json", "Print machine-readable JSON")
    .action(async (options: RecallOptions) => {
      await runRecallCommand("panorama", options);
    });

  recall
    .command("insight")
    .description("Run deterministic recall and summarize source coverage facts")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--query <text>", "Recall query text")
    .option("--limit <number>", "Maximum result count", parseIntegerOption)
    .option("--json", "Print machine-readable JSON")
    .action(async (options: RecallOptions) => {
      await runRecallCommand("insight", options);
    });
}

async function runRecallCommand(mode: RecallMode, options: RecallOptions): Promise<void> {
  const result = await recallKnowledge({
    workspacePath: options.workspace,
    query: options.query,
    mode,
    ...(options.timeline === undefined ? {} : { timeline: options.timeline }),
    ...(options.limit === undefined ? {} : { limit: options.limit })
  });
  writeJson({
    ok: true,
    command: `recall ${mode}`,
    data: { ...result, outputMode: resolveOutputMode(options) }
  });
}

type RecallOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly query: string;
  readonly timeline?: string;
  readonly limit?: number;
};

function parseIntegerOption(value: string): number {
  return Number.parseInt(value, 10);
}
