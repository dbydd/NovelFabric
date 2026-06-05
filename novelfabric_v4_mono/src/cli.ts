#!/usr/bin/env node

import { Command } from "commander";

import { addAgentCommands } from "./commands/agents.js";
import { addConfigCommands } from "./commands/config.js";
import { addContextPackCommands } from "./commands/context-pack.js";
import { addFileCommands } from "./commands/files.js";
import { addImportCommands } from "./commands/import.js";
import { addKnowledgeCommands } from "./commands/knowledge.js";
import { addRecallCommands } from "./commands/recall.js";
import { addRuntimeCommands } from "./commands/runtime.js";
import { addSkillCommands } from "./commands/skills.js";
import { addWebCommands } from "./commands/web.js";
import { addWorkspaceCommands } from "./commands/workspace.js";
import { isCommandFailure } from "./errors.js";
import { writeJson } from "./output.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("novelfabric")
    .description("NovelFabric V4 workspace CLI")
    .version("0.1.0")
    .showHelpAfterError();

  addConfigCommands(program);
  addWorkspaceCommands(program);
  addFileCommands(program);
  addRuntimeCommands(program);
  addAgentCommands(program);
  addSkillCommands(program);
  addImportCommands(program);
  addKnowledgeCommands(program);
  addRecallCommands(program);
  addContextPackCommands(program);
  addWebCommands(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && isCommandFailure(error)) {
    writeJson({ ok: false, error: { code: error.code, message: error.message } });
    process.exitCode = error.exitCode;
  } else if (error instanceof Error) {
    writeJson({ ok: false, error: { code: "unexpected_error", message: error.message } });
    process.exitCode = 1;
  } else {
    writeJson({
      ok: false,
      error: { code: "unexpected_non_error", message: "Unexpected non-error throw." }
    });
    process.exitCode = 1;
  }
}
