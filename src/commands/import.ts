import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import { runAgentTask } from "../agent-runtime/tasks.js";
import {
  materializeSemanticImportFromAgentTask,
  createSemanticImportTask
} from "../import/semantic.js";
import {
  addImportSource,
  buildImportContextPack,
  chunkImportSource,
  normalizeImportSource,
  readImportInbox,
  validateImportWorkspace
} from "../import/source.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addImportCommands(program: Command): void {
  const imports = program
    .command("import")
    .description(
      "Import normalization, chunking, source context-pack, and pi-backed semantic extraction tools"
    );

  imports
    .command("inbox")
    .description("List import inbox files and derived import artifacts")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportInboxOptions) => {
      const result = await readImportInbox({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "import inbox",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("add")
    .description("Decode and add a source text file into imports/source")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--source <path>", "External source text file path")
    .option("--stdin", "Read source text from stdin as UTF-8")
    .option("--content <content>", "Source text content; use --source or --stdin for larger files")
    .option("--target-path <path>", "Workspace target path under imports/source/")
    .option("--target-name <name>", "Target file name under imports/source/")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportAddOptions) => {
      const content = await resolveOptionalStdinContent(options);
      const result = await addImportSource({
        workspacePath: options.workspace,
        actor: options.actor,
        ...(options.source === undefined ? {} : { sourcePath: options.source }),
        ...(content === undefined ? {} : { content }),
        ...(options.targetPath === undefined ? {} : { targetPath: options.targetPath }),
        ...(options.targetName === undefined ? {} : { targetName: options.targetName }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "import add",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("normalize")
    .description("Decode and normalize a workspace import source into UTF-8 LF text")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--source <path>", "Workspace source path")
    .option("--output <path>", "Workspace output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportNormalizeOptions) => {
      const result = await normalizeImportSource({
        workspacePath: options.workspace,
        actor: options.actor,
        sourcePath: options.source,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "import normalize",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("chunk")
    .description("Split a normalized source into deterministic range-tracked chunks")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--source <path>", "Workspace source path")
    .option("--output-dir <path>", "Workspace output directory")
    .option("--max-chars <number>", "Maximum characters per chunk", parseIntegerOption)
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportChunkOptions) => {
      const result = await chunkImportSource({
        workspacePath: options.workspace,
        actor: options.actor,
        sourcePath: options.source,
        ...(options.outputDir === undefined ? {} : { outputDir: options.outputDir }),
        ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "import chunk",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("context-pack")
    .description("Build a deterministic import context pack for later agent work")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--source <path>", "Workspace source path")
    .option("--output <path>", "Workspace output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportContextPackOptions) => {
      const result = await buildImportContextPack({
        workspacePath: options.workspace,
        actor: options.actor,
        sourcePath: options.source,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "import context-pack",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("semantic")
    .description("Run pi-backed semantic import extraction and materialize an import artifact")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--context-pack <path>", "Workspace import context-pack path")
    .requiredOption("--source <path>", "Workspace source text path")
    .option("--output <path>", "Workspace semantic import artifact output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportSemanticOptions) => {
      const task = await createSemanticImportTask({
        workspacePath: options.workspace,
        actor: options.actor,
        contextPackPath: options.contextPack,
        sourcePath: options.source,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      const run = await runAgentTask({
        workspacePath: options.workspace,
        actor: options.actor,
        task: task.taskId,
        runtime: "pi",
        reason: options.reason ?? "import semantic agent run"
      });
      const result = await materializeSemanticImportFromAgentTask({
        workspacePath: options.workspace,
        actor: options.actor,
        taskId: task.taskId,
        contextPackPath: options.contextPack,
        sourcePath: options.source,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "import semantic",
        data: { ...result, run, outputMode: resolveOutputMode(options) }
      });
    });

  imports
    .command("validate")
    .description("Validate import source readability and normalization health")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--path <path>", "Specific workspace import path to validate")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ImportValidateOptions) => {
      const result = await validateImportWorkspace({
        workspacePath: options.workspace,
        ...(options.path === undefined ? {} : { path: options.path })
      });
      writeJson({
        ok: true,
        command: "import validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type ImportInboxOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type ImportAddOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly source?: string;
  readonly stdin?: boolean;
  readonly content?: string;
  readonly targetPath?: string;
  readonly targetName?: string;
  readonly reason?: string;
};

type ImportNormalizeOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly source: string;
  readonly output?: string;
  readonly reason?: string;
};

type ImportChunkOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly source: string;
  readonly outputDir?: string;
  readonly maxChars?: number;
  readonly reason?: string;
};

type ImportContextPackOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly source: string;
  readonly output?: string;
  readonly reason?: string;
};

type ImportSemanticOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly contextPack: string;
  readonly source: string;
  readonly output?: string;
  readonly reason?: string;
};

type ImportValidateOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path?: string;
};

async function resolveOptionalStdinContent(options: ImportAddOptions): Promise<string | undefined> {
  const contentSources = [
    options.source,
    options.content,
    options.stdin === true ? "stdin" : undefined
  ].filter((value) => value !== undefined);
  if (contentSources.length > 1) {
    throw new CommandFailure(
      "invalid_import_input",
      "Use only one of --source, --stdin, or --content for import add."
    );
  }
  if (options.stdin === true) return readStdin();
  return options.content;
}

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed.toString() !== value) {
    throw new CommandFailure("invalid_integer_option", `Expected integer option, got '${value}'.`);
  }
  return parsed;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let content = "";
  for await (const chunk of process.stdin) {
    if (typeof chunk === "string") {
      content += chunk;
    } else {
      content += Buffer.from(chunk).toString("utf8");
    }
  }
  return content;
}
