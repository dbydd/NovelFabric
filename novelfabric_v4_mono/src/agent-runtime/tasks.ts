import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readProcessEnvironment } from "../environment.js";
import { CommandFailure } from "../errors.js";
import type { JsonObject, JsonValue } from "../output.js";
import { resolveRuntimeConfigPaths, type RuntimeThinkingLevel } from "../runtime/config.js";
import { readWorkspaceFile, writeWorkspaceFile, appendWorkspaceFile } from "../workspace/files.js";
import { assertPiSdkImportAvailable, piAgentRuntimeAdapter } from "./pi-adapter.js";
import type { AgentRuntimeLaunchPlan } from "./types.js";

export type AgentTaskCreateRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly title: string;
  readonly instruction: string;
  readonly taskId?: string;
  readonly inputJson?: string;
  readonly contextPackPath?: string;
  readonly allowedCommands?: readonly string[];
  readonly outputSchemaJson?: string;
  readonly reason?: string;
};

export type AgentTaskInspectRequest = {
  readonly workspacePath: string;
  readonly task: string;
};

export type AgentTaskRunRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly task: string;
  readonly runtime: "pi";
  readonly reason?: string;
};

export type AgentTaskAbortRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly task: string;
  readonly reason?: string;
};

export type AgentTaskPackage = {
  readonly kind: "novelfabric.agent.task";
  readonly version: 1;
  readonly taskId: string;
  readonly title: string;
  readonly actor: string;
  readonly instruction: string;
  readonly runtime: {
    readonly envelope: "novelfabric.pi.runtime";
    readonly adapter: "@earendil-works/pi-coding-agent";
    readonly policyProfile: "web-safe";
    readonly status: "planned";
  };
  readonly packagePath: string;
  readonly files: AgentTaskPackageFiles;
  readonly createdAt: string;
};

export type AgentTaskPackageFiles = {
  readonly taskMarkdown: string;
  readonly input: string;
  readonly contextPack: string;
  readonly allowedCommands: string;
  readonly outputSchema: string;
  readonly result: string;
  readonly events: string;
};

export type AgentTaskResultStatus = "pending-pi-runtime" | "run-recorded" | "completed" | "aborted";

export type AgentTaskOutput = JsonObject & {
  readonly kind: "novelfabric.agent.task.output";
  readonly version: 1;
  readonly format: "json" | "text";
  readonly rawText: string;
  readonly parsedJson?: JsonValue;
};

export type AgentTaskRuntimeEvidence = JsonObject & {
  readonly runtimeRoot: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking?: RuntimeThinkingLevel;
  readonly modelPurpose: "production";
  readonly piBin: string;
  readonly toolPolicy: "--no-tools";
  readonly sessionPolicy: "--no-session";
  readonly contextPolicy: "--no-context-files";
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
};

export type AgentTaskResult = JsonObject & {
  readonly kind: "novelfabric.agent.task.result";
  readonly version: 1;
  readonly taskId: string;
  readonly status: AgentTaskResultStatus;
  readonly runtime: "pi";
  readonly actor: string;
  readonly updatedAt: string;
  readonly piSdk: PiSdkAvailability;
  readonly runtimeEvidence?: AgentTaskRuntimeEvidence;
  readonly output?: AgentTaskOutput;
  readonly notes: readonly string[];
};

export type PiSdkAvailability = JsonObject & {
  readonly adapter: "@earendil-works/pi-coding-agent";
  readonly available: boolean;
  readonly launchPlan?: AgentRuntimeLaunchPlan;
  readonly error?: string;
};

export type AgentTaskCreateResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly files: AgentTaskPackageFiles;
  readonly writes: readonly AgentTaskWriteSummary[];
};

export type AgentTaskInspectResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly task: AgentTaskPackage;
  readonly input: JsonValue;
  readonly contextPack: JsonValue;
  readonly outputSchema: JsonValue;
  readonly result: AgentTaskResult;
  readonly allowedCommands: readonly string[];
  readonly events: readonly AgentTaskEvent[];
};

export type AgentTaskRunResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly status: AgentTaskResultStatus;
  readonly piSdk: PiSdkAvailability;
  readonly resultPath: string;
  readonly eventsPath: string;
  readonly writes: readonly AgentTaskWriteSummary[];
};

export type AgentTaskValidationResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly AgentTaskValidationIssue[];
};

export type AgentTaskStatusResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly status: AgentTaskResultStatus;
  readonly updatedAt: string;
  readonly piSdk: PiSdkAvailability;
  readonly eventCount: number;
};

export type AgentTaskAbortResult = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly status: "aborted";
  readonly resultPath: string;
  readonly eventsPath: string;
  readonly writes: readonly AgentTaskWriteSummary[];
};

export type AgentTaskEvent = JsonObject & {
  readonly kind: "novelfabric.agent.task.event";
  readonly version: 1;
  readonly taskId: string;
  readonly type: "created" | "run-recorded" | "pi-started" | "pi-completed" | "aborted";
  readonly actor: string;
  readonly timestamp: string;
  readonly message: string;
};

export type AgentTaskValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type AgentTaskWriteSummary = {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly auditPath: string;
};

const DEFAULT_ALLOWED_COMMANDS = [
  "novelfabric files read",
  "novelfabric files write",
  "novelfabric context-pack build",
  "novelfabric cards validate",
  "novelfabric writing apply-draft"
] as const;

export async function createAgentTask(
  request: AgentTaskCreateRequest
): Promise<AgentTaskCreateResult> {
  const title = requireNonEmpty(request.title, "title");
  const instruction = requireNonEmpty(request.instruction, "instruction");
  const taskId = request.taskId === undefined ? defaultTaskId(title) : safeTaskId(request.taskId);
  const paths = taskPaths(taskId);
  const now = new Date().toISOString();
  const input = parseOptionalJson(request.inputJson, {}, "input-json");
  const contextPack = await resolveContextPack(request.workspacePath, request.contextPackPath);
  const allowedCommands = normalizeAllowedCommands(request.allowedCommands);
  const outputSchema = parseOptionalJson(
    request.outputSchemaJson,
    defaultOutputSchema(),
    "output-schema-json"
  );
  const packageMetadata: AgentTaskPackage = {
    kind: "novelfabric.agent.task",
    version: 1,
    taskId,
    title,
    actor: request.actor,
    instruction,
    runtime: {
      envelope: "novelfabric.pi.runtime",
      adapter: piAgentRuntimeAdapter.packageName,
      policyProfile: "web-safe",
      status: "planned"
    },
    packagePath: paths.packagePath,
    files: paths.files,
    createdAt: now
  };
  const pendingResult: AgentTaskResult = {
    kind: "novelfabric.agent.task.result",
    version: 1,
    taskId,
    status: "pending-pi-runtime",
    runtime: "pi",
    actor: request.actor,
    updatedAt: now,
    piSdk: unavailablePiSdkRecord("not_checked"),
    notes: [
      "Task package created for the NovelFabric-wrapped pi runtime envelope.",
      "No model session has been launched by task creation."
    ]
  };
  const createdEvent = taskEvent({
    taskId,
    actor: request.actor,
    type: "created",
    timestamp: now,
    message: "Agent task package created."
  });

  const writes = [] as AgentTaskWriteSummary[];
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.taskMarkdown,
        content: taskMarkdown(packageMetadata),
        actor: request.actor,
        reason: request.reason ?? "agent task create task.md"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.input,
        content: stableJson(input),
        actor: request.actor,
        reason: request.reason ?? "agent task create input.json"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.contextPack,
        content: stableJson(contextPack),
        actor: request.actor,
        reason: request.reason ?? "agent task create context-pack.json"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.allowedCommands,
        content: `${allowedCommands.join("\n")}\n`,
        actor: request.actor,
        reason: request.reason ?? "agent task create allowed-commands.md"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.outputSchema,
        content: stableJson(outputSchema),
        actor: request.actor,
        reason: request.reason ?? "agent task create output.schema.json"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.result,
        content: stableJson(pendingResult),
        actor: request.actor,
        reason: request.reason ?? "agent task create result.json"
      })
    )
  );
  writes.push(
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.events,
        content: `${jsonLine(createdEvent)}\n`,
        actor: request.actor,
        reason: request.reason ?? "agent task create events.jsonl"
      })
    )
  );

  return {
    taskId,
    packagePath: paths.packagePath,
    files: paths.files,
    writes
  };
}

export async function inspectAgentTask(
  request: AgentTaskInspectRequest
): Promise<AgentTaskInspectResult> {
  const taskId = safeTaskId(request.task);
  const paths = taskPaths(taskId);
  const [taskRead, inputRead, contextRead, schemaRead, resultRead, allowedRead, eventsRead] =
    await Promise.all([
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.taskMarkdown }),
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.input }),
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.contextPack }),
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.outputSchema }),
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.result }),
      readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.allowedCommands
      }),
      readWorkspaceFile({ workspacePath: request.workspacePath, path: paths.files.events })
    ]);
  const task = parseTaskMarkdown(taskRead.content, paths.packagePath);
  const input = parseJsonFile(inputRead.content, paths.files.input);
  const contextPack = parseJsonFile(contextRead.content, paths.files.contextPack);
  const outputSchema = parseJsonFile(schemaRead.content, paths.files.outputSchema);
  const result = parseTaskResult(resultRead.content, paths.files.result);
  const allowedCommands = parseAllowedCommands(allowedRead.content);
  const events = parseEvents(eventsRead.content, paths.files.events);
  return {
    taskId,
    packagePath: paths.packagePath,
    task,
    input,
    contextPack,
    outputSchema,
    result,
    allowedCommands,
    events
  };
}

export async function runAgentTask(request: AgentTaskRunRequest): Promise<AgentTaskRunResult> {
  const taskId = safeTaskId(request.task);
  const paths = taskPaths(taskId);
  const inspected = await inspectAgentTask({ workspacePath: request.workspacePath, task: taskId });
  if (inspected.result.status === "aborted") {
    throw new CommandFailure("agent_task_aborted", `Task '${taskId}' has been aborted.`);
  }
  const piSdk = await checkPiSdkAvailabilityOrThrow();
  const runtime = await loadPiWorkflowRuntime();
  const prompt = buildPiTaskPrompt(inspected);
  const startedAt = new Date().toISOString();
  const startedEvent = taskEvent({
    taskId,
    actor: request.actor,
    type: "pi-started",
    timestamp: startedAt,
    message: `Launching pi runtime with provider '${runtime.provider}' and workflow model '${runtime.model}'.`
  });
  const pi = runPiProcess({ runtime, prompt, taskId });
  const output = parsePiTaskOutput(pi.outputText);
  const completedAt = new Date().toISOString();
  const runtimeEvidence: AgentTaskRuntimeEvidence = {
    runtimeRoot: runtime.runtimeRoot,
    provider: runtime.provider,
    model: runtime.model,
    ...(runtime.thinking === undefined ? {} : { thinking: runtime.thinking }),
    modelPurpose: "production",
    piBin: runtime.piBin,
    toolPolicy: "--no-tools",
    sessionPolicy: "--no-session",
    contextPolicy: "--no-context-files",
    stdoutBytes: Buffer.byteLength(pi.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(pi.stderr, "utf8")
  };
  const result: AgentTaskResult = {
    kind: "novelfabric.agent.task.result",
    version: 1,
    taskId,
    status: "completed",
    runtime: request.runtime,
    actor: request.actor,
    updatedAt: completedAt,
    piSdk,
    runtimeEvidence,
    output,
    notes: [
      "Launched the NovelFabric-owned pi runtime configuration with tools disabled.",
      "The model could not write files directly; NovelFabric CLI captured stdout and wrote this result through the shared workspace file service."
    ]
  };
  const completedEvent = taskEvent({
    taskId,
    actor: request.actor,
    type: "pi-completed",
    timestamp: completedAt,
    message: `pi runtime completed with non-empty ${output.format} output.`
  });
  const writes = [
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.result,
        content: stableJson(result),
        actor: request.actor,
        reason: request.reason ?? "agent run pi result record"
      })
    ),
    summarizeWrite(
      await appendWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.events,
        content: `${jsonLine(startedEvent)}\n${jsonLine(completedEvent)}\n`,
        actor: request.actor,
        reason: request.reason ?? "agent run pi event append"
      })
    )
  ];
  return {
    taskId,
    packagePath: paths.packagePath,
    status: result.status,
    piSdk,
    resultPath: paths.files.result,
    eventsPath: paths.files.events,
    writes
  };
}

export async function validateAgentOutput(
  request: AgentTaskInspectRequest
): Promise<AgentTaskValidationResult> {
  const taskId = safeTaskId(request.task);
  const paths = taskPaths(taskId);
  const checked = Object.values(paths.files);
  const issues: AgentTaskValidationIssue[] = [];
  let inspected: AgentTaskInspectResult | null = null;
  try {
    inspected = await inspectAgentTask(request);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "agent_task_unreadable",
      path: paths.packagePath,
      message: error instanceof Error ? error.message : `Could not inspect task '${taskId}'.`
    });
  }
  if (inspected !== null) {
    if (inspected.task.taskId !== taskId || inspected.result.taskId !== taskId) {
      issues.push({
        severity: "error",
        code: "agent_task_id_mismatch",
        path: paths.packagePath,
        message: "Task metadata and result must use the requested task id."
      });
    }
    if (!isJsonObject(inspected.outputSchema)) {
      issues.push({
        severity: "error",
        code: "invalid_output_schema",
        path: paths.files.outputSchema,
        message: "Output schema must be a JSON object."
      });
    }
    if (inspected.result.status !== "completed") {
      issues.push({
        severity: "error",
        code: "agent_task_not_completed",
        path: paths.files.result,
        message: `Agent task output validation requires completed pi runtime evidence, found ${inspected.result.status}.`
      });
    }
    if (inspected.result.runtimeEvidence === undefined) {
      issues.push({
        severity: "error",
        code: "agent_task_runtime_evidence_missing",
        path: paths.files.result,
        message: "Agent task result must include pi runtime evidence."
      });
    }
    if (inspected.result.output === undefined) {
      issues.push({
        severity: "error",
        code: "agent_task_output_missing",
        path: paths.files.result,
        message: "Agent task result must include captured pi output."
      });
    } else {
      validateAgentTaskOutputContent(inspected.result.output, paths.files.result, issues);
    }
    if (inspected.allowedCommands.length === 0) {
      issues.push({
        severity: "warning",
        code: "empty_allowed_commands",
        path: paths.files.allowedCommands,
        message: "Allowed command list is empty; pi runtime tools will have no CLI surface."
      });
    }
  }
  return {
    taskId,
    packagePath: paths.packagePath,
    valid: !issues.some((issue) => issue.severity === "error"),
    checked,
    issues
  };
}

function validateAgentTaskOutputContent(
  output: AgentTaskOutput,
  resultPath: string,
  issues: AgentTaskValidationIssue[]
): void {
  if (output.rawText.trim().length === 0) {
    issues.push({
      severity: "error",
      code: "agent_task_output_empty",
      path: resultPath,
      message: "Captured pi output must not be empty."
    });
  }
  if (output.format === "json") {
    if (output.parsedJson === undefined) {
      issues.push({
        severity: "error",
        code: "agent_task_output_json_missing",
        path: resultPath,
        message: "JSON pi output must include parsedJson."
      });
    } else if (
      typeof output.parsedJson === "object" &&
      output.parsedJson !== null &&
      !Array.isArray(output.parsedJson) &&
      Object.keys(output.parsedJson).length === 0
    ) {
      issues.push({
        severity: "error",
        code: "agent_task_output_json_empty",
        path: resultPath,
        message: "JSON pi output must not be an empty object."
      });
    }
  }
}

export async function getAgentTaskStatus(
  request: AgentTaskInspectRequest
): Promise<AgentTaskStatusResult> {
  const inspected = await inspectAgentTask(request);
  return {
    taskId: inspected.taskId,
    packagePath: inspected.packagePath,
    status: inspected.result.status,
    updatedAt: inspected.result.updatedAt,
    piSdk: inspected.result.piSdk,
    eventCount: inspected.events.length
  };
}

export async function abortAgentTask(
  request: AgentTaskAbortRequest
): Promise<AgentTaskAbortResult> {
  const taskId = safeTaskId(request.task);
  const paths = taskPaths(taskId);
  await inspectAgentTask({ workspacePath: request.workspacePath, task: taskId });
  const now = new Date().toISOString();
  const result: AgentTaskResult = {
    kind: "novelfabric.agent.task.result",
    version: 1,
    taskId,
    status: "aborted",
    runtime: "pi",
    actor: request.actor,
    updatedAt: now,
    piSdk: unavailablePiSdkRecord("not_checked"),
    notes: [request.reason ?? "Task aborted by operator before runtime execution."]
  };
  const event = taskEvent({
    taskId,
    actor: request.actor,
    type: "aborted",
    timestamp: now,
    message: request.reason ?? "Task aborted."
  });
  const writes = [
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.result,
        content: stableJson(result),
        actor: request.actor,
        reason: request.reason ?? "agent abort result record"
      })
    ),
    summarizeWrite(
      await appendWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.events,
        content: `${jsonLine(event)}\n`,
        actor: request.actor,
        reason: request.reason ?? "agent abort event append"
      })
    )
  ];
  return {
    taskId,
    packagePath: paths.packagePath,
    status: "aborted",
    resultPath: paths.files.result,
    eventsPath: paths.files.events,
    writes
  };
}

type PiWorkflowRuntimeConfig = {
  readonly runtimeRoot: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking?: RuntimeThinkingLevel;
  readonly piBin: string;
};

type PiProcessResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly outputText: string;
};

async function loadPiWorkflowRuntime(): Promise<PiWorkflowRuntimeConfig> {
  const paths = resolveRuntimeConfigPaths(readProcessEnvironment());
  let settings: JsonObject;
  try {
    settings = parseJsonFile(
      await readFile(paths.settingsPath, "utf8"),
      paths.settingsPath
    ) as JsonObject;
  } catch (error) {
    if (error instanceof CommandFailure) throw error;
    throw new CommandFailure(
      "pi_runtime_not_configured",
      `NovelFabric pi runtime settings are required at '${paths.settingsPath}'. Run 'novelfabric runtime materialize' and configure modelDefaults for generic-writer.`,
      2
    );
  }
  const modelDefaults = modelDefaultsFromSettings(settings["modelDefaults"]);
  const provider = modelDefaults?.provider ?? stringSetting(settings, "defaultProvider");
  const model = modelDefaults?.model ?? stringSetting(settings, "defaultModel");
  const thinking = modelDefaults?.thinking ?? thinkingSetting(settings, "defaultThinkingLevel");
  const purpose = modelDefaults?.purpose ?? "production";
  if (provider === undefined || model === undefined) {
    throw new CommandFailure(
      "pi_runtime_model_unconfigured",
      "NovelFabric pi workflow runtime requires settings.modelDefaults.provider/model or defaultProvider/defaultModel.",
      2
    );
  }
  if (purpose !== "production" || model === "flash-vibe") {
    throw new CommandFailure(
      "pi_runtime_test_model_for_workflow",
      "agent run must use the production workflow model, normally generic-writer. flash-vibe is reserved for acceptance tests.",
      2
    );
  }
  return {
    runtimeRoot: paths.runtimeRoot,
    provider,
    model,
    ...(thinking === undefined ? {} : { thinking }),
    piBin: await resolvePiBinary()
  };
}

async function resolvePiBinary(): Promise<string> {
  const configured = process.env["NOVELFABRIC_PI_BIN"];
  if (configured !== undefined && configured.trim().length > 0) return configured;
  const local = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pi.cmd" : "pi"
  );
  try {
    await access(local);
    return local;
  } catch {
    return "pi";
  }
}

async function checkPiSdkAvailabilityOrThrow(): Promise<PiSdkAvailability> {
  try {
    const launchPlan = await assertPiSdkImportAvailable();
    return {
      adapter: piAgentRuntimeAdapter.packageName,
      available: true,
      launchPlan
    };
  } catch (error) {
    throw new CommandFailure(
      "pi_sdk_unavailable",
      `@earendil-works/pi-coding-agent is required for agent run --runtime pi: ${error instanceof Error ? error.message : String(error)}`,
      2
    );
  }
}

function buildPiTaskPrompt(inspected: AgentTaskInspectResult): string {
  return [
    "You are the NovelFabric wrapped pi runtime executing an agent task package.",
    "You must not use tools, write files, edit files, execute bash, or access arbitrary paths.",
    "Return the final task output only. Prefer valid JSON conforming to OUTPUT_SCHEMA when possible.",
    "The NovelFabric CLI will capture your stdout and write result.json/events.jsonl through audited workspace services.",
    "",
    "TASK_MD:",
    `# ${inspected.task.title}`,
    `task_id: ${inspected.task.taskId}`,
    `actor: ${inspected.task.actor}`,
    "",
    "INSTRUCTION:",
    inspected.task.instruction,
    "",
    "INPUT_JSON:",
    stableJson(inspected.input).trim(),
    "",
    "CONTEXT_PACK_JSON:",
    stableJson(inspected.contextPack).trim(),
    "",
    "ALLOWED_NOVELFABRIC_COMMANDS_FOR_FUTURE_TOOL_ADAPTERS:",
    inspected.allowedCommands.length === 0 ? "(none)" : inspected.allowedCommands.join("\n"),
    "",
    "OUTPUT_SCHEMA_JSON:",
    stableJson(inspected.outputSchema).trim()
  ].join("\n");
}

function runPiProcess(request: {
  readonly runtime: PiWorkflowRuntimeConfig;
  readonly prompt: string;
  readonly taskId: string;
}): PiProcessResult {
  const modelArgument =
    request.runtime.thinking === undefined
      ? request.runtime.model
      : `${request.runtime.model}:${request.runtime.thinking}`;
  const promptPath = writePiPromptFile(request.taskId, request.prompt);
  const result = spawnSync(
    request.runtime.piBin,
    [
      "--print",
      "--no-tools",
      "--no-session",
      "--no-context-files",
      "--provider",
      request.runtime.provider,
      "--model",
      modelArgument,
      `@${promptPath}`
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: request.runtime.runtimeRoot,
        PI_SKIP_VERSION_CHECK: "1"
      },
      timeout: Number(process.env["NOVELFABRIC_AGENT_RUN_TIMEOUT_MS"] ?? "180000"),
      maxBuffer: 1024 * 1024 * 8,
      encoding: "utf8"
    }
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new CommandFailure(
      "pi_runtime_failed",
      `pi process failed. status=${String(result.status)} signal=${String(result.signal)} error=${result.error instanceof Error ? result.error.message : String(result.error)} stderr=${result.stderr}`,
      2
    );
  }
  const stdout = result.stdout;
  const stderr = result.stderr;
  const outputText = `${stdout}\n${stderr}`.trim();
  if (outputText.length === 0) {
    throw new CommandFailure("pi_runtime_empty_output", "pi runtime returned empty output.", 2);
  }
  return { stdout, stderr, outputText };
}

function writePiPromptFile(taskId: string, prompt: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "novelfabric-agent-run-"));
  const promptPath = path.join(directory, `${taskId}.prompt.md`);
  writeFileSync(promptPath, prompt, "utf8");
  return promptPath;
}

function parsePiTaskOutput(outputText: string): AgentTaskOutput {
  const jsonText = extractFirstJsonObject(outputText);
  if (jsonText !== undefined) {
    const parsed = parseJsonFile(jsonText, "pi stdout");
    return {
      kind: "novelfabric.agent.task.output",
      version: 1,
      format: "json",
      rawText: outputText,
      parsedJson: parsed
    };
  }
  return {
    kind: "novelfabric.agent.task.output",
    version: 1,
    format: "text",
    rawText: outputText
  };
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function modelDefaultsFromSettings(value: unknown):
  | {
      readonly provider: string;
      readonly model: string;
      readonly thinking?: RuntimeThinkingLevel;
      readonly purpose: "testing" | "production";
    }
  | undefined {
  if (!isJsonObject(value)) return undefined;
  const provider = stringSetting(value, "provider");
  const model = stringSetting(value, "model");
  const thinking = thinkingSetting(value, "thinking");
  const purpose = value["purpose"];
  if (provider === undefined || model === undefined) return undefined;
  if (purpose !== "testing" && purpose !== "production") return undefined;
  return { provider, model, ...(thinking === undefined ? {} : { thinking }), purpose };
}

function stringSetting(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : undefined;
}

function thinkingSetting(value: JsonObject, key: string): RuntimeThinkingLevel | undefined {
  const field = value[key];
  return isThinkingLevel(field) ? field : undefined;
}

function isThinkingLevel(value: unknown): value is RuntimeThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

async function resolveContextPack(
  workspacePath: string,
  contextPackPath: string | undefined
): Promise<JsonValue> {
  if (contextPackPath === undefined) {
    return {
      kind: "novelfabric.agent.context-pack",
      version: 1,
      citations: []
    };
  }
  const read = await readWorkspaceFile({ workspacePath, path: contextPackPath });
  return parseJsonFile(read.content, contextPackPath);
}

function unavailablePiSdkRecord(error: string): PiSdkAvailability {
  return {
    adapter: piAgentRuntimeAdapter.packageName,
    available: false,
    error
  };
}

function taskPaths(taskId: string): {
  readonly packagePath: string;
  readonly files: AgentTaskPackageFiles;
} {
  const packagePath = `.novelfabric/tasks/${taskId}`;
  return {
    packagePath,
    files: {
      taskMarkdown: `${packagePath}/task.md`,
      input: `${packagePath}/input.json`,
      contextPack: `${packagePath}/context-pack.json`,
      allowedCommands: `${packagePath}/allowed-commands.md`,
      outputSchema: `${packagePath}/output.schema.json`,
      result: `${packagePath}/result.json`,
      events: `${packagePath}/events.jsonl`
    }
  };
}

function taskMarkdown(task: AgentTaskPackage): string {
  return [
    `# ${task.title}`,
    "",
    `task_id: ${task.taskId}`,
    `actor: ${task.actor}`,
    "runtime: novelfabric-wrapped-pi-sdk",
    "policy: web-safe",
    "",
    "## Instruction",
    "",
    task.instruction,
    "",
    "## Package",
    "",
    `- input: ${task.files.input}`,
    `- context_pack: ${task.files.contextPack}`,
    `- allowed_commands: ${task.files.allowedCommands}`,
    `- output_schema: ${task.files.outputSchema}`,
    `- result: ${task.files.result}`,
    ""
  ].join("\n");
}

function parseTaskMarkdown(content: string, packagePath: string): AgentTaskPackage {
  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? "Untitled Agent Task";
  const taskId = /^task_id:\s*(.+)$/m.exec(content)?.[1]?.trim();
  const actor = /^actor:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? "unknown";
  if (taskId === undefined || taskId.length === 0) {
    throw new CommandFailure("invalid_agent_task", "task.md is missing task_id metadata.");
  }
  const instructionMatch = /## Instruction\s+([\s\S]*?)(?:\n## |$)/.exec(content);
  const instruction = instructionMatch?.[1]?.trim() ?? "";
  return {
    kind: "novelfabric.agent.task",
    version: 1,
    taskId,
    title,
    actor,
    instruction,
    runtime: {
      envelope: "novelfabric.pi.runtime",
      adapter: piAgentRuntimeAdapter.packageName,
      policyProfile: "web-safe",
      status: "planned"
    },
    packagePath,
    files: taskPaths(taskId).files,
    createdAt: "unknown"
  };
}

function parseTaskResult(content: string, filePath: string): AgentTaskResult {
  const parsed = parseJsonFile(content, filePath);
  if (!isJsonObject(parsed) || parsed["kind"] !== "novelfabric.agent.task.result") {
    throw new CommandFailure(
      "invalid_agent_task_result",
      `Agent task result '${filePath}' has an invalid shape.`
    );
  }
  const status = parsed["status"];
  if (
    status !== "pending-pi-runtime" &&
    status !== "run-recorded" &&
    status !== "completed" &&
    status !== "aborted"
  ) {
    throw new CommandFailure(
      "invalid_agent_task_result",
      `Agent task result '${filePath}' has an invalid status.`
    );
  }
  return parsed as AgentTaskResult;
}

function parseEvents(content: string, filePath: string): readonly AgentTaskEvent[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed = parseJsonFile(line, `${filePath}:${String(index + 1)}`);
      if (!isJsonObject(parsed) || parsed["kind"] !== "novelfabric.agent.task.event") {
        throw new CommandFailure(
          "invalid_agent_task_event",
          `Agent task event '${filePath}:${String(index + 1)}' has an invalid shape.`
        );
      }
      return parsed as AgentTaskEvent;
    });
}

function parseAllowedCommands(content: string): readonly string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function parseJsonFile(content: string, filePath: string): JsonValue {
  try {
    return JSON.parse(content) as JsonValue;
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_artifact",
      `Artifact '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseOptionalJson(raw: string | undefined, fallback: JsonValue, label: string): JsonValue {
  if (raw === undefined) return fallback;
  return parseJsonFile(raw, label);
}

function normalizeAllowedCommands(commands: readonly string[] | undefined): readonly string[] {
  const normalized = (commands ?? DEFAULT_ALLOWED_COMMANDS)
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
  return [...new Set(normalized)];
}

function defaultOutputSchema(): JsonObject {
  return {
    type: "object",
    required: ["kind", "version"],
    properties: {
      kind: { type: "string" },
      version: { type: "number" },
      artifacts: { type: "array" },
      notes: { type: "array" }
    }
  };
}

function taskEvent(request: {
  readonly taskId: string;
  readonly type: "created" | "run-recorded" | "pi-started" | "pi-completed" | "aborted";
  readonly actor: string;
  readonly timestamp: string;
  readonly message: string;
}): AgentTaskEvent {
  return {
    kind: "novelfabric.agent.task.event",
    version: 1,
    taskId: request.taskId,
    type: request.type,
    actor: request.actor,
    timestamp: request.timestamp,
    message: request.message
  };
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CommandFailure("invalid_agent_task_input", `Agent task ${label} must not be empty.`);
  }
  return trimmed;
}

function defaultTaskId(title: string): string {
  return `agent-task-${safeTaskId(title).slice(0, 48)}`;
}

function safeTaskId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    throw new CommandFailure("invalid_agent_task_id", "Agent task id must not be empty.");
  }
  return normalized;
}

function summarizeWrite(write: {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly auditPath: string;
}): AgentTaskWriteSummary {
  return {
    path: write.path,
    hash: write.hash,
    bytes: write.bytes,
    auditPath: write.auditPath
  };
}

function stableJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonLine(value: JsonValue): string {
  return JSON.stringify(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
