import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import {
  applyWritingDraft,
  buildWritingContextPack,
  createWritingDraftTask,
  exportWriting,
  reviewChapter
} from "../writing/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addWritingCommands(program: Command): void {
  const writing = program
    .command("writing")
    .description("Prepare context, tasks, drafts, reviews, and exports for chapter writing");

  writing
    .command("context-pack")
    .description("Build a deterministic writing context pack for a session")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--session <id>", "Simulation/session id")
    .option("--output <path>", "Workspace context-pack output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WritingContextPackOptions) => {
      const result = await buildWritingContextPack({
        workspacePath: options.workspace,
        actor: options.actor,
        session: options.session,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "writing context-pack",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  writing
    .command("draft")
    .description("Create a chapter draft task artifact for the wrapped pi runtime")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--context-pack <path>", "Workspace writing context-pack path")
    .option("--output <path>", "Expected draft artifact output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WritingDraftOptions) => {
      const result = await createWritingDraftTask({
        workspacePath: options.workspace,
        actor: options.actor,
        contextPackPath: options.contextPack,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "writing draft",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  writing
    .command("apply-draft")
    .description("Apply a validated chapter draft artifact to writing/chapters")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--draft <path>", "Workspace writing draft artifact path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--output <path>", "Workspace chapter output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WritingApplyDraftOptions) => {
      const result = await applyWritingDraft({
        workspacePath: options.workspace,
        actor: options.actor,
        draftPath: options.draft,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "writing apply-draft",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  writing
    .command("review")
    .description("Review a chapter deterministically without calling an LLM")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--chapter <path>", "Workspace chapter path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WritingReviewOptions) => {
      const result = await reviewChapter({
        workspacePath: options.workspace,
        chapterPath: options.chapter
      });
      writeJson({
        ok: true,
        command: "writing review",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  writing
    .command("export")
    .description("Export materialized chapters to a Markdown artifact")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--format <format>", "Export format", "markdown")
    .option("--output <path>", "Workspace export output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WritingExportOptions) => {
      const result = await exportWriting({
        workspacePath: options.workspace,
        actor: options.actor,
        format: parseExportFormat(options.format),
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "writing export",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type WritingWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type WritingContextPackOptions = WritingWorkspaceOptions & {
  readonly actor: string;
  readonly session: string;
  readonly output?: string;
  readonly reason?: string;
};

type WritingDraftOptions = WritingWorkspaceOptions & {
  readonly actor: string;
  readonly contextPack: string;
  readonly output?: string;
  readonly reason?: string;
};

type WritingApplyDraftOptions = WritingWorkspaceOptions & {
  readonly actor: string;
  readonly draft: string;
  readonly output?: string;
  readonly reason?: string;
};

type WritingReviewOptions = WritingWorkspaceOptions & {
  readonly chapter: string;
};

type WritingExportOptions = WritingWorkspaceOptions & {
  readonly actor: string;
  readonly format: string;
  readonly output?: string;
  readonly reason?: string;
};

function parseExportFormat(format: string): "markdown" {
  if (format !== "markdown") {
    throw new CommandFailure("unsupported_export_format", "Only markdown export is supported.");
  }
  return format;
}
