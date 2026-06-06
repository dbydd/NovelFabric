import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import { writeJson, type JsonObject } from "../output.js";
import {
  cancelWorkflow,
  listWorkflowArtifacts,
  peekWorkflow,
  planWorkflow,
  resumeWorkflow,
  retryWorkflow,
  startWorkflow,
  statusWorkflow,
  stepWorkflow,
  verifyWorkflow,
  workflowStages,
  type WorkflowStageId
} from "../workflow/index.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addWorkflowCommands(program: Command): void {
  const workflow = program
    .command("workflow")
    .description("Deterministic workflow job wrapper over NovelFabric CLI command families");

  workflow
    .command("plan")
    .description("Create a workflow plan artifact under .novelfabric/jobs/<plan-id>")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--source <path>", "Workspace source path, usually imports/source/<file>")
    .requiredOption("--role <role>", "Role or original character label for the loop")
    .option("--plan-id <id>", "Explicit deterministic plan/job id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowPlanOptions) => {
      const result = await planWorkflow({
        workspacePath: options.workspace,
        actor: options.actor,
        sourcePath: options.source,
        role: options.role,
        ...(options.planId === undefined ? {} : { planId: options.planId }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow plan",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("start")
    .description("Start a planned workflow job and initialize state/trace/artifacts files")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--plan <plan-id>", "Workflow plan id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowStartOptions) => {
      const result = await startWorkflow({
        workspacePath: options.workspace,
        actor: options.actor,
        planId: options.plan,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow start",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("peek")
    .description("Inspect the next workflow stage without mutating the job")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowJobOptions) => {
      const result = await peekWorkflow({ workspacePath: options.workspace, jobId: options.job });
      writeJson({
        ok: true,
        command: "workflow peek",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("step")
    .description("Execute the next deterministic workflow stage and record trace/artifacts")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--input <json>", "Optional JSON input; may include { stage } as a guard")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowStepOptions) => {
      const result = await stepWorkflow({
        workspacePath: options.workspace,
        jobId: options.job,
        actor: options.actor,
        ...(options.input === undefined ? {} : { input: parseJsonOption(options.input) }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow step",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("status")
    .description("Read workflow job status")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowJobOptions) => {
      const result = await statusWorkflow({ workspacePath: options.workspace, jobId: options.job });
      writeJson({
        ok: true,
        command: "workflow status",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("resume")
    .description("Resume a failed or paused workflow job")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowMutationOptions) => {
      const result = await resumeWorkflow({
        workspacePath: options.workspace,
        jobId: options.job,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow resume",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("retry")
    .description("Move a workflow job back to a previous stage and trim downstream artifacts")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--job <job-id>", "Workflow job id")
    .requiredOption("--stage <stage>", "Workflow stage id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowRetryOptions) => {
      const result = await retryWorkflow({
        workspacePath: options.workspace,
        jobId: options.job,
        actor: options.actor,
        stage: parseWorkflowStageId(options.stage),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow retry",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("cancel")
    .description("Cancel a workflow job without deleting artifacts")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowMutationOptions) => {
      const result = await cancelWorkflow({
        workspacePath: options.workspace,
        jobId: options.job,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "workflow cancel",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("artifacts")
    .description("List artifacts recorded by a workflow job")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowJobOptions) => {
      const result = await listWorkflowArtifacts({
        workspacePath: options.workspace,
        jobId: options.job
      });
      writeJson({
        ok: true,
        command: "workflow artifacts",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });

  workflow
    .command("verify")
    .description("Verify workflow job files and recorded artifact hashes")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--job <job-id>", "Workflow job id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkflowJobOptions) => {
      const result = await verifyWorkflow({ workspacePath: options.workspace, jobId: options.job });
      writeJson({
        ok: true,
        command: "workflow verify",
        data: asJsonObject({ ...result, outputMode: resolveOutputMode(options) })
      });
    });
}

type WorkflowPlanOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly source: string;
  readonly role: string;
  readonly planId?: string;
  readonly reason?: string;
};

type WorkflowStartOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly plan: string;
  readonly reason?: string;
};

type WorkflowJobOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly job: string;
};

type WorkflowStepOptions = WorkflowMutationOptions & {
  readonly input?: string;
};

type WorkflowMutationOptions = WorkflowJobOptions & {
  readonly actor: string;
  readonly reason?: string;
};

type WorkflowRetryOptions = WorkflowMutationOptions & {
  readonly stage: string;
};

function asJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

function parseWorkflowStageId(value: string): WorkflowStageId {
  if (workflowStages().some((stage) => stage.id === value)) return value as WorkflowStageId;
  throw new CommandFailure("invalid_workflow_stage", `Unknown workflow stage '${value}'.`);
}

function parseJsonOption(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_option",
      `Expected valid JSON for --input: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
