import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import { writeJson } from "../output.js";
import {
  abortAgentTask,
  createAgentTask,
  getAgentTaskStatus,
  inspectAgentTask,
  runAgentTask,
  validateAgentOutput
} from "../agent-runtime/tasks.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addAgentTaskCommands(program: Command): void {
  const agent = program.command("agent").description("Manage pi-runtime agent task packages");

  const task = agent
    .command("task")
    .description("Create and inspect NovelFabric agent task packages");

  task
    .command("create")
    .description("Create an auditable task package for the NovelFabric-wrapped pi runtime")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--title <title>", "Task title")
    .requiredOption("--instruction <text>", "Task instruction text")
    .option("--task-id <id>", "Stable task id; defaults to a sanitized title")
    .option("--input-json <json>", "Inline JSON object/value for input.json")
    .option("--context-pack <path>", "Workspace JSON artifact to copy into context-pack.json")
    .option(
      "--allowed-command <command>",
      "Allowed CLI command; may be repeated",
      collectRepeated,
      []
    )
    .option("--output-schema-json <json>", "Inline JSON schema for output.schema.json")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentTaskCreateOptions) => {
      const result = await createAgentTask({
        workspacePath: options.workspace,
        actor: options.actor,
        title: options.title,
        instruction: options.instruction,
        ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
        ...(options.inputJson === undefined ? {} : { inputJson: options.inputJson }),
        ...(options.contextPack === undefined ? {} : { contextPackPath: options.contextPack }),
        ...(options.allowedCommand.length === 0 ? {} : { allowedCommands: options.allowedCommand }),
        ...(options.outputSchemaJson === undefined
          ? {}
          : { outputSchemaJson: options.outputSchemaJson }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "agent task create",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  task
    .command("inspect")
    .description("Inspect one agent task package")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--task <id>", "Task id under .novelfabric/tasks/<id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentTaskInspectOptions) => {
      const result = await inspectAgentTask({
        workspacePath: options.workspace,
        task: options.task
      });
      writeJson({
        ok: true,
        command: "agent task inspect",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  agent
    .command("run")
    .description(
      "Run an agent task through the NovelFabric-owned pi workflow model and record evidence"
    )
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--task <id>", "Task id under .novelfabric/tasks/<id>")
    .option("--runtime <runtime>", "Runtime name; currently only pi", "pi")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentRunOptions) => {
      const result = await runAgentTask({
        workspacePath: options.workspace,
        actor: options.actor,
        task: options.task,
        runtime: parseRuntime(options.runtime),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "agent run",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  const output = agent.command("output").description("Validate agent task output packages");

  output
    .command("validate")
    .description("Validate a task package result/output envelope")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--task <id>", "Task id under .novelfabric/tasks/<id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentTaskInspectOptions) => {
      const result = await validateAgentOutput({
        workspacePath: options.workspace,
        task: options.task
      });
      writeJson({
        ok: true,
        command: "agent output validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
      if (!result.valid) {
        process.exitCode = 2;
      }
    });

  agent
    .command("status")
    .description("Read the current status of an agent task")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--task <id>", "Task id under .novelfabric/tasks/<id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentTaskInspectOptions) => {
      const result = await getAgentTaskStatus({
        workspacePath: options.workspace,
        task: options.task
      });
      writeJson({
        ok: true,
        command: "agent status",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  agent
    .command("abort")
    .description("Mark an agent task as aborted")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--task <id>", "Task id under .novelfabric/tasks/<id>")
    .option("--reason <reason>", "Abort reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentAbortOptions) => {
      const result = await abortAgentTask({
        workspacePath: options.workspace,
        actor: options.actor,
        task: options.task,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "agent abort",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type AgentTaskBaseOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type AgentTaskCreateOptions = AgentTaskBaseOptions & {
  readonly actor: string;
  readonly title: string;
  readonly instruction: string;
  readonly taskId?: string;
  readonly inputJson?: string;
  readonly contextPack?: string;
  readonly allowedCommand: readonly string[];
  readonly outputSchemaJson?: string;
  readonly reason?: string;
};

type AgentTaskInspectOptions = AgentTaskBaseOptions & {
  readonly task: string;
};

type AgentRunOptions = AgentTaskInspectOptions & {
  readonly actor: string;
  readonly runtime: string;
  readonly reason?: string;
};

type AgentAbortOptions = AgentTaskInspectOptions & {
  readonly actor: string;
  readonly reason?: string;
};

function collectRepeated(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

function parseRuntime(runtime: string): "pi" {
  if (runtime !== "pi") {
    throw new CommandFailure("unsupported_agent_runtime", "Only --runtime pi is supported.");
  }
  return runtime;
}
