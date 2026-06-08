import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import {
  applyCardProposal,
  listCards,
  proposeCards,
  readCard,
  validateCardProposal,
  type CardKind
} from "../cards/proposals.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addCardCommands(program: Command): void {
  const cards = program
    .command("cards")
    .description("Validate and apply citation-backed card proposals");

  cards
    .command("list")
    .description("List workspace cards")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--kind <kind>", "Card kind: character, scene, world, or rule")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: CardsListOptions) => {
      const result = await listCards({
        workspacePath: options.workspace,
        ...(options.kind === undefined ? {} : { kind: parseCardKind(options.kind) })
      });
      writeJson({
        ok: true,
        command: "cards list",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  cards
    .command("read")
    .description("Read a card file with card metadata")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace card path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: CardsReadOptions) => {
      const result = await readCard({ workspacePath: options.workspace, path: options.path });
      writeJson({
        ok: true,
        command: "cards read",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  cards
    .command("propose")
    .description("Create a schema-valid card proposal from a context pack or cited content")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--context-pack <path>", "Workspace context-pack path")
    .option("--semantic-import <path>", "Workspace semantic import artifact path")
    .option("--stdin", "Read proposed card markdown from stdin")
    .option("--content <content>", "Proposed card markdown content")
    .option(
      "--citation <path...>",
      "Workspace citation source path; repeat or pass multiple values"
    )
    .option("--kind <kind>", "Card kind: character, scene, world, or rule")
    .option("--title <title>", "Proposed card title")
    .option("--target-path <path>", "Canonical card target path")
    .option("--output <path>", "Workspace proposal output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: CardsProposeOptions) => {
      const content = await resolveOptionalContent(options, "cards propose");
      const result = await proposeCards({
        workspacePath: options.workspace,
        actor: options.actor,
        ...(options.contextPack === undefined ? {} : { contextPackPath: options.contextPack }),
        ...(options.semanticImport === undefined
          ? {}
          : { semanticImportPath: options.semanticImport }),
        ...(content === undefined ? {} : { content }),
        ...(options.citation === undefined ? {} : { citations: options.citation }),
        ...(options.kind === undefined ? {} : { kind: parseCardKind(options.kind) }),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(options.targetPath === undefined ? {} : { targetPath: options.targetPath }),
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "cards propose",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  cards
    .command("validate")
    .description("Validate a card proposal and its citations")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--proposal <path>", "Workspace card proposal path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: CardsValidateOptions) => {
      const result = await validateCardProposal({
        workspacePath: options.workspace,
        proposalPath: options.proposal
      });
      writeJson({
        ok: true,
        command: "cards validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  cards
    .command("apply")
    .description("Apply a validated card proposal to canonical cards/")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--proposal <path>", "Workspace card proposal path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: CardsApplyOptions) => {
      const result = await applyCardProposal({
        workspacePath: options.workspace,
        proposalPath: options.proposal,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "cards apply",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type CardsListOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly kind?: string;
};

type CardsReadOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path: string;
};

type CardsProposeOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly contextPack?: string;
  readonly semanticImport?: string;
  readonly stdin?: boolean;
  readonly content?: string;
  readonly citation?: readonly string[];
  readonly kind?: string;
  readonly title?: string;
  readonly targetPath?: string;
  readonly output?: string;
  readonly reason?: string;
};

type CardsValidateOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly proposal: string;
};

type CardsApplyOptions = CardsValidateOptions & {
  readonly actor: string;
  readonly reason?: string;
};

function parseCardKind(value: string): CardKind {
  if (value === "character" || value === "scene" || value === "world" || value === "rule") {
    return value;
  }
  throw new CommandFailure(
    "invalid_card_kind",
    `Card kind must be one of character, scene, world, or rule; got '${value}'.`
  );
}

async function resolveOptionalContent(
  options: Pick<CardsProposeOptions, "stdin" | "content">,
  command: string
): Promise<string | undefined> {
  const sources = [options.content, options.stdin === true ? "stdin" : undefined].filter(
    (value) => value !== undefined
  );
  if (sources.length > 1) {
    throw new CommandFailure(
      "invalid_content_input",
      `Use only one of --stdin or --content for ${command}.`
    );
  }
  if (options.stdin === true) return readStdin();
  return options.content;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let content = "";
  for await (const chunk of process.stdin) {
    content += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return content;
}
