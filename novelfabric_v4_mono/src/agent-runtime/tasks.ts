import { CommandFailure } from "../errors.js";
import type { JsonObject, JsonValue } from "../output.js";
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

export type AgentTaskResultStatus = "pending-pi-runtime" | "run-recorded" | "aborted";

export type AgentTaskResult = JsonObject & {
  readonly kind: "novelfabric.agent.task.result";
  readonly version: 1;
  readonly taskId: string;
  readonly status: AgentTaskResultStatus;
  readonly runtime: "pi";
  readonly actor: string;
  readonly updatedAt: string;
  readonly piSdk: PiSdkAvailability;
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
  readonly type: "created" | "run-recorded" | "aborted";
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
  const now = new Date().toISOString();
  const piSdk = await checkPiSdkAvailability();
  const result: AgentTaskResult = {
    kind: "novelfabric.agent.task.result",
    version: 1,
    taskId,
    status: "run-recorded",
    runtime: request.runtime,
    actor: request.actor,
    updatedAt: now,
    piSdk,
    notes: [
      "Recorded a deterministic pi runtime run envelope.",
      "No custom provider was called and no model session was launched in this command."
    ]
  };
  const event = taskEvent({
    taskId,
    actor: request.actor,
    type: "run-recorded",
    timestamp: now,
    message: piSdk.available
      ? "pi SDK import availability asserted; runtime execution remains deferred."
      : "pi SDK import availability check failed safely; runtime execution remains deferred."
  });
  const writes = [
    summarizeWrite(
      await writeWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.result,
        content: stableJson(result),
        actor: request.actor,
        reason: request.reason ?? "agent run result record"
      })
    ),
    summarizeWrite(
      await appendWorkspaceFile({
        workspacePath: request.workspacePath,
        path: paths.files.events,
        content: `${jsonLine(event)}\n`,
        actor: request.actor,
        reason: request.reason ?? "agent run event append"
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

async function checkPiSdkAvailability(): Promise<PiSdkAvailability> {
  try {
    const launchPlan = await assertPiSdkImportAvailable();
    return {
      adapter: piAgentRuntimeAdapter.packageName,
      available: true,
      launchPlan
    };
  } catch (error) {
    return unavailablePiSdkRecord(error instanceof Error ? error.message : String(error));
  }
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
  if (status !== "pending-pi-runtime" && status !== "run-recorded" && status !== "aborted") {
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
  readonly type: "created" | "run-recorded" | "aborted";
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

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
