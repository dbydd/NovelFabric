import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import { writeJson } from "../output.js";
import {
  appendWorkspaceFile,
  checkWorkspaceFileProtection,
  globWorkspaceFiles,
  readWorkspaceFile,
  readWorkspaceTree,
  statWorkspaceFile,
  writeWorkspaceFile
} from "../workspace/files.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addFileCommands(program: Command): void {
  const files = program
    .command("files")
    .description("Read and write workspace files through capability-checked services");

  files
    .command("read")
    .description("Read a UTF-8 workspace file with safe path checks")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace-relative file path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileReadOptions) => {
      const result = await readWorkspaceFile({
        workspacePath: options.workspace,
        path: options.path
      });
      writeJson({
        ok: true,
        command: "files read",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("tree")
    .description("List the real workspace file tree with protected metadata")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileTreeOptions) => {
      const result = await readWorkspaceTree({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "files tree",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("write")
    .description("Write a UTF-8 workspace file with capability, conflict, and audit checks")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace-relative file path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--stdin", "Read replacement content from stdin")
    .option("--content <content>", "Replacement content; use --stdin for larger files")
    .option("--expected-base-hash <hash>", "Optional sha256 hash for conflict detection")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileWriteOptions) => {
      const content = await resolveWriteContent(options, "files write");
      const result = await writeWorkspaceFile({
        workspacePath: options.workspace,
        path: options.path,
        content,
        actor: options.actor,
        ...(options.expectedBaseHash === undefined
          ? {}
          : { expectedBaseHash: options.expectedBaseHash }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "files write",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("glob")
    .description("Find workspace files/directories under a safe base path")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--base <dir>", "Workspace-relative base directory")
    .requiredOption("--pattern <pattern>", "Glob pattern relative to --base")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileGlobOptions) => {
      const result = await globWorkspaceFiles({
        workspacePath: options.workspace,
        base: options.base,
        pattern: options.pattern
      });
      writeJson({
        ok: true,
        command: "files glob",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("stat")
    .description("Inspect workspace file or directory metadata")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace-relative file or directory path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileStatOptions) => {
      const result = await statWorkspaceFile({
        workspacePath: options.workspace,
        path: options.path
      });
      writeJson({
        ok: true,
        command: "files stat",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("append")
    .description("Append UTF-8 text to a workspace file with capability and audit checks")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace-relative file path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--stdin", "Read appended content from stdin")
    .option("--content <content>", "Appended content; use --stdin for larger files")
    .option("--expected-base-hash <hash>", "Optional sha256 hash for conflict detection")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileAppendOptions) => {
      const content = await resolveWriteContent(options, "files append");
      const result = await appendWorkspaceFile({
        workspacePath: options.workspace,
        path: options.path,
        content,
        actor: options.actor,
        ...(options.expectedBaseHash === undefined
          ? {}
          : { expectedBaseHash: options.expectedBaseHash }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "files append",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  files
    .command("protect-check")
    .description("Check whether an actor may write a workspace path")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace-relative file path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: FileProtectCheckOptions) => {
      const result = await checkWorkspaceFileProtection({
        workspacePath: options.workspace,
        path: options.path,
        actor: options.actor
      });
      writeJson({
        ok: true,
        command: "files protect-check",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });
}

type FileReadOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path: string;
};

type FileTreeOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type FileWriteOptions = FileContentInputOptions & {
  readonly workspace: string;
  readonly path: string;
  readonly actor: string;
  readonly expectedBaseHash?: string;
  readonly reason?: string;
};

type FileAppendOptions = FileWriteOptions;

type FileContentInputOptions = JsonOutputOptions & {
  readonly stdin?: boolean;
  readonly content?: string;
};

type FileGlobOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly base: string;
  readonly pattern: string;
};

type FileStatOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path: string;
};

type FileProtectCheckOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly path: string;
  readonly actor: string;
};

async function resolveWriteContent(
  options: FileContentInputOptions,
  commandName: "files write" | "files append"
): Promise<string> {
  if (options.stdin === true && options.content !== undefined) {
    throw new CommandFailure(
      "invalid_file_write_input",
      `Use only one of --stdin or --content for ${commandName}.`
    );
  }
  if (options.stdin === true) {
    return readStdin();
  }
  if (options.content !== undefined) {
    return options.content;
  }
  throw new CommandFailure(
    "invalid_file_write_input",
    `${commandName} requires --stdin or --content.`
  );
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
