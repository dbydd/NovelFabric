import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import {
  appendMemory,
  applySharedMemoryProposal,
  proposeSharedMemory,
  recallMemory,
  validateSharedMemoryProposal
} from "../memory/service.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addMemoryCommands(program: Command): void {
  const memory = program
    .command("memory")
    .description("Recall and mutate memory through citation-backed proposals");

  memory
    .command("recall")
    .description("Recall profile-visible workspace memory")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--profile <profile>", "Memory profile id")
    .requiredOption("--query <text>", "Recall query")
    .option("--limit <number>", "Maximum result count", parseIntegerOption)
    .option("--json", "Print machine-readable JSON")
    .action(async (options: MemoryRecallOptions) => {
      const result = await recallMemory({
        workspacePath: options.workspace,
        actor: options.actor,
        profile: options.profile,
        query: options.query,
        ...(options.limit === undefined ? {} : { limit: options.limit })
      });
      writeJson({
        ok: true,
        command: "memory recall",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  memory
    .command("append")
    .description("Append to an actor's own memory file through the shared write service")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--profile <profile>", "Memory profile id")
    .option("--stdin", "Read memory entry from stdin")
    .option("--content <content>", "Memory entry content")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: MemoryAppendOptions) => {
      const content = await resolveRequiredContent(options, "memory append");
      const result = await appendMemory({
        workspacePath: options.workspace,
        actor: options.actor,
        profile: options.profile,
        content,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "memory append",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  memory
    .command("propose-shared")
    .description("Create a citation-backed proposal for shared memory")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption(
      "--citation <path...>",
      "Workspace citation source path; repeat or pass multiple values"
    )
    .option("--stdin", "Read proposed shared memory content from stdin")
    .option("--content <content>", "Proposed shared memory content")
    .option("--output <path>", "Workspace proposal output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: MemoryProposeSharedOptions) => {
      const content = await resolveRequiredContent(options, "memory propose-shared");
      const result = await proposeSharedMemory({
        workspacePath: options.workspace,
        actor: options.actor,
        content,
        citations: options.citation,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "memory propose-shared",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  memory
    .command("validate-proposal")
    .description("Validate a shared memory proposal and its citations")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--proposal <path>", "Workspace shared memory proposal path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: MemoryValidateProposalOptions) => {
      const result = await validateSharedMemoryProposal({
        workspacePath: options.workspace,
        proposalPath: options.proposal
      });
      writeJson({
        ok: true,
        command: "memory validate-proposal",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  memory
    .command("apply-proposal")
    .description("Apply a validated shared memory proposal to memory/global")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--proposal <path>", "Workspace shared memory proposal path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--target-path <path>", "Workspace shared memory target under memory/global/")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: MemoryApplyProposalOptions) => {
      const result = await applySharedMemoryProposal({
        workspacePath: options.workspace,
        proposalPath: options.proposal,
        actor: options.actor,
        ...(options.targetPath === undefined ? {} : { targetPath: options.targetPath }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "memory apply-proposal",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type MemoryRecallOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly profile: string;
  readonly query: string;
  readonly limit?: number;
};

type MemoryAppendOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly profile: string;
  readonly stdin?: boolean;
  readonly content?: string;
  readonly reason?: string;
};

type MemoryProposeSharedOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly citation: readonly string[];
  readonly stdin?: boolean;
  readonly content?: string;
  readonly output?: string;
  readonly reason?: string;
};

type MemoryValidateProposalOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly proposal: string;
};

type MemoryApplyProposalOptions = MemoryValidateProposalOptions & {
  readonly actor: string;
  readonly targetPath?: string;
  readonly reason?: string;
};

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed.toString() !== value) {
    throw new CommandFailure("invalid_integer_option", `Expected integer option, got '${value}'.`);
  }
  return parsed;
}

async function resolveRequiredContent(
  options: Pick<MemoryAppendOptions, "stdin" | "content">,
  command: string
): Promise<string> {
  const sources = [options.content, options.stdin === true ? "stdin" : undefined].filter(
    (value) => value !== undefined
  );
  if (sources.length !== 1) {
    throw new CommandFailure(
      "invalid_content_input",
      `Use exactly one of --stdin or --content for ${command}.`
    );
  }
  if (options.stdin === true) return readStdin();
  return options.content ?? "";
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let content = "";
  for await (const chunk of process.stdin) {
    content += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return content;
}
