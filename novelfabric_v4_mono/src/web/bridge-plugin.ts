import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin } from "vite";
import { z } from "zod";

import {
  abortAgentTask,
  createAgentTask,
  getAgentTaskStatus,
  inspectAgentTask,
  type AgentTaskAbortResult,
  type AgentTaskCreateResult,
  type AgentTaskEvent,
  type AgentTaskInspectResult,
  type AgentTaskRuntimeEvidence,
  type PiSdkAvailability,
  type AgentTaskStatusResult
} from "../agent-runtime/tasks.js";
import {
  getAgentTaskRunState,
  startAgentTaskRun,
  type AgentTaskRunState
} from "../agent-runtime/task-runner.js";
import {
  buildWebSafePiSessionOptions,
  inspectPiSdkAvailability
} from "../agent-runtime/pi-adapter.js";
import { readProcessEnvironment } from "../environment.js";
import { CommandFailure, isCommandFailure } from "../errors.js";
import { readWorkspaceFile, readWorkspaceTree, writeWorkspaceFile } from "../workspace/files.js";

const readRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().min(1)
});

const writeRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  actor: z.string().min(1),
  expectedBaseHash: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
});

const runtimeSessionPrepareRequestSchema = z.object({
  workspacePath: z.string().min(1),
  actor: z.string().min(1),
  requestedTools: z.array(z.string().min(1)).optional()
});

const agentTaskCreateRequestSchema = z.object({
  workspacePath: z.string().min(1),
  actor: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  taskId: z.string().min(1).optional(),
  inputJson: z.string().min(1).optional(),
  contextPackPath: z.string().min(1).optional(),
  outputSchemaJson: z.string().min(1).optional(),
  allowedCommands: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1).optional()
});

const agentTaskRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  actor: z.string().min(1),
  task: z.string().min(1),
  runtime: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
});

const agentTaskReadRequestSchema = z.object({
  workspacePath: z.string().min(1),
  actor: z.string().min(1),
  task: z.string().min(1)
});

const agentTaskStreamRequestSchema = agentTaskReadRequestSchema.extend({
  cursor: z.number().int().nonnegative().optional()
});

const agentTaskLifecycleRequestSchema = agentTaskReadRequestSchema.extend({
  reason: z.string().min(1).optional()
});

const DEFAULT_AGENT_TASK_STREAM_POLL_MS = 1000;
const DEFAULT_AGENT_TASK_STREAM_MAX_MS = 5 * 60 * 1000;

let activeAgentTaskStreamCount = 0;

export function getActiveAgentTaskStreamCountForTesting(): number {
  return activeAgentTaskStreamCount;
}

export function novelFabricBridgePlugin(): Plugin {
  return {
    name: "novelfabric-local-file-bridge",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleBridgeRequest(request, response, next);
      });
    }
  };
}

export async function handleBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void
): Promise<void> {
  const routePath =
    request.url === undefined ? "" : new URL(request.url, "http://localhost").pathname;
  if (!isBridgeRoute(routePath)) {
    next();
    return;
  }

  if (process.env["NOVELFABRIC_WEB_BRIDGE"] !== "1") {
    writeJson(response, 404, {
      ok: false,
      error: {
        code: "bridge_disabled",
        message: "NovelFabric file bridge is disabled for this web surface."
      }
    });
    return;
  }

  try {
    const workspacePath = bridgeWorkspacePath();
    if (request.method === "POST" && routePath === "/api/bridge/files/read") {
      const body = readRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      const result = await readWorkspaceFile({ workspacePath, path: body.path });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/files/tree") {
      const body = readRequestSchema
        .pick({ workspacePath: true })
        .parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      const result = await readWorkspaceTree({ workspacePath });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/files/write") {
      const body = writeRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      const result = await writeWorkspaceFile({
        workspacePath,
        path: body.path,
        content: body.content,
        actor: body.actor,
        ...(body.expectedBaseHash === undefined ? {} : { expectedBaseHash: body.expectedBaseHash }),
        ...(body.reason === undefined ? {} : { reason: body.reason })
      });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/runtime/session/prepare") {
      const body = runtimeSessionPrepareRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      const sessionOptions = buildWebSafePiSessionOptions({
        environment: readProcessEnvironment(),
        actor: body.actor,
        ...(body.requestedTools === undefined ? {} : { requestedTools: body.requestedTools })
      });
      const sdkAvailability = await inspectPiSdkAvailability();
      const missingExports = Object.entries(sdkAvailability.exports)
        .filter(([, available]) => !available)
        .map(([name]) => name);
      writeJson(response, 200, {
        ok: true,
        data: {
          actor: body.actor,
          workspacePath,
          runtimeRoot: sessionOptions.runtimeRoot,
          policyProfile: sessionOptions.policyProfile,
          requestedTools: sessionOptions.requestedTools,
          allowedTools: sessionOptions.allowedTools,
          deniedRawTools: sessionOptions.deniedRawTools,
          valid: sessionOptions.valid,
          violations: sessionOptions.violations,
          rawBuiltinToolsEnabled: sessionOptions.rawBuiltinToolsEnabled,
          sdk: {
            packageName: sdkAvailability.packageName,
            available: sdkAvailability.available,
            version: sdkAvailability.version,
            missingExports
          }
        }
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/create") {
      const body = agentTaskCreateRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      if (body.allowedCommands !== undefined) {
        throw new CommandFailure(
          "bridge_agent_allowed_commands_forbidden",
          "Web bridge agent tasks must use the NovelFabric web-safe command policy; client-supplied allowedCommands are not accepted.",
          403
        );
      }
      if (body.taskId !== undefined) {
        assertBridgeAgentTaskIdSafe(body.taskId);
      }
      const result = await createAgentTask({
        workspacePath,
        actor: body.actor,
        title: body.title,
        instruction: body.instruction,
        ...(body.taskId === undefined ? {} : { taskId: body.taskId }),
        ...(body.inputJson === undefined ? {} : { inputJson: body.inputJson }),
        ...(body.contextPackPath === undefined ? {} : { contextPackPath: body.contextPackPath }),
        ...(body.outputSchemaJson === undefined ? {} : { outputSchemaJson: body.outputSchemaJson }),
        ...(body.reason === undefined ? {} : { reason: body.reason })
      });
      writeJson(response, 200, {
        ok: true,
        data: summarizeAgentTaskCreateResult(result)
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/run") {
      const body = agentTaskRunRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      const runtime = body.runtime ?? "pi-sdk";
      if (runtime !== "pi-sdk") {
        throw new CommandFailure(
          "bridge_agent_runtime_forbidden",
          "Web bridge agent tasks may only run through the pi-sdk runtime.",
          403
        );
      }
      assertBridgeAgentTaskIdSafe(body.task);
      const runState = await startAgentTaskRun({
        workspacePath,
        actor: body.actor,
        task: body.task,
        runtime: "pi-sdk",
        ...(body.reason === undefined ? {} : { reason: body.reason })
      });
      writeJson(response, 202, {
        ok: true,
        data: summarizeAgentTaskAsyncRunResult(runState)
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/status") {
      const body = agentTaskReadRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      assertBridgeAgentTaskIdSafe(body.task);
      const [status, inspected] = await Promise.all([
        getAgentTaskStatus({ workspacePath, task: body.task }),
        inspectAgentTask({ workspacePath, task: body.task })
      ]);
      const runState = getAgentTaskRunState(body.task, workspacePath);
      writeJson(response, 200, {
        ok: true,
        data: summarizeAgentTaskStatusResult(status, inspected, runState)
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/events") {
      const body = agentTaskReadRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      assertBridgeAgentTaskIdSafe(body.task);
      const inspected = await inspectAgentTask({ workspacePath, task: body.task });
      writeJson(response, 200, {
        ok: true,
        data: summarizeAgentTaskEventsResult(inspected)
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/cancel") {
      const body = agentTaskLifecycleRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      assertBridgeAgentTaskIdSafe(body.task);
      const current = await inspectAgentTask({ workspacePath, task: body.task });
      if (current.result.status === "completed") {
        throw new CommandFailure(
          "bridge_agent_task_already_completed",
          "Completed agent tasks cannot be cancelled through the web bridge.",
          409
        );
      }
      const result = await abortAgentTask({
        workspacePath,
        actor: body.actor,
        task: body.task,
        ...(body.reason === undefined ? {} : { reason: body.reason })
      });
      const inspected = await inspectAgentTask({ workspacePath, task: result.taskId });
      writeJson(response, 200, {
        ok: true,
        data: summarizeAgentTaskAbortResult(result, inspected)
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/retry") {
      const body = agentTaskLifecycleRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      assertBridgeAgentTaskIdSafe(body.task);
      const inspected = await inspectAgentTask({ workspacePath, task: body.task });
      const retryTaskId = retryAgentTaskId(body.task);
      const created = await createAgentTask({
        workspacePath,
        actor: body.actor,
        title: `${inspected.task.title} retry`,
        instruction: inspected.task.instruction,
        taskId: retryTaskId,
        inputJson: JSON.stringify(inspected.input),
        outputSchemaJson: JSON.stringify(inspected.outputSchema),
        reason: body.reason ?? `web bridge retry of ${body.task}`
      });
      const retryPaths = agentTaskBridgePaths(retryTaskId);
      await writeWorkspaceFile({
        workspacePath,
        path: retryPaths.contextPack,
        content: JSON.stringify(inspected.contextPack, null, 2),
        actor: body.actor,
        reason: body.reason ?? `web bridge retry context copy for ${body.task}`
      });
      const retryInspected = await inspectAgentTask({ workspacePath, task: retryTaskId });
      writeJson(response, 200, {
        ok: true,
        data: summarizeAgentTaskRetryResult({
          original: inspected,
          created,
          retry: retryInspected
        })
      });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/agent/tasks/stream") {
      const body = agentTaskStreamRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      assertBridgeAgentTaskIdSafe(body.task);
      await inspectAgentTask({ workspacePath, task: body.task });
      writeAgentTaskEventStream({
        request,
        response,
        workspacePath,
        task: body.task,
        cursor: body.cursor ?? 0
      });
      return;
    }

    throw new CommandFailure(
      "bridge_route_not_found",
      `Unsupported bridge route ${request.method ?? "GET"} ${routePath}.`,
      404
    );
  } catch (error) {
    writeBridgeError(response, error);
  }
}

function isBridgeRoute(routePath: string): boolean {
  return (
    routePath.startsWith("/api/bridge/files/") ||
    routePath === "/api/bridge/runtime/session/prepare" ||
    routePath.startsWith("/api/bridge/agent/tasks/")
  );
}

function summarizeAgentTaskCreateResult(result: AgentTaskCreateResult): {
  readonly taskId: string;
  readonly packageCreated: true;
  readonly fileCount: number;
  readonly writeCount: number;
} {
  return {
    taskId: result.taskId,
    packageCreated: true,
    fileCount: Object.keys(result.files).length,
    writeCount: result.writes.length
  };
}

function summarizeAgentTaskAsyncRunResult(state: AgentTaskRunState): {
  readonly taskId: string;
  readonly status: "running";
  readonly eventStreamAvailable: true;
  readonly runStartedAt: string;
} {
  return {
    taskId: state.taskId,
    status: "running",
    eventStreamAvailable: true,
    runStartedAt: state.startedAt
  };
}

function summarizeAgentTaskStatusResult(
  status: AgentTaskStatusResult,
  inspected: AgentTaskInspectResult,
  runState: AgentTaskRunState | undefined
): {
  readonly taskId: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly piSdk: ReturnType<typeof summarizePiSdkAvailability>;
  readonly eventCount: number;
  readonly runtimeEvidence: ReturnType<typeof summarizeRuntimeEvidence>;
  readonly resultAvailable: boolean;
  readonly eventsAvailable: boolean;
  readonly runState?: {
    readonly status: AgentTaskRunState["status"];
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly errorCode?: string;
  };
} {
  const durableTerminal = isTerminalAgentTaskStatus(inspected.result.status);
  return {
    taskId: status.taskId,
    status: !durableTerminal && runState?.status === "running" ? "running" : status.status,
    updatedAt: status.updatedAt,
    piSdk: summarizePiSdkAvailability(status.piSdk),
    eventCount: status.eventCount,
    runtimeEvidence: summarizeRuntimeEvidence(inspected.result.runtimeEvidence),
    resultAvailable: inspected.result.status !== "pending-pi-runtime",
    eventsAvailable: inspected.events.length > 0,
    ...(runState === undefined
      ? {}
      : {
          runState: {
            status: runState.status,
            startedAt: runState.startedAt,
            updatedAt: runState.updatedAt,
            ...(runState.errorCode === undefined ? {} : { errorCode: runState.errorCode })
          }
        })
  };
}

function isTerminalAgentTaskStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "aborted";
}

function summarizeAgentTaskEventsResult(
  inspected: AgentTaskInspectResult,
  cursor = 0
): {
  readonly taskId: string;
  readonly eventCount: number;
  readonly cursor: number;
  readonly nextCursor: number;
  readonly eventsAvailable: boolean;
  readonly events: ReturnType<typeof summarizeAgentTaskEvent>[];
} {
  const boundedCursor = Math.min(Math.max(0, cursor), inspected.events.length);
  const events = inspected.events.slice(boundedCursor).map(summarizeAgentTaskEvent);
  return {
    taskId: inspected.taskId,
    eventCount: inspected.events.length,
    cursor: boundedCursor,
    nextCursor: inspected.events.length,
    eventsAvailable: events.length > 0,
    events
  };
}

function summarizeAgentTaskAbortResult(
  result: AgentTaskAbortResult,
  inspected: AgentTaskInspectResult
): {
  readonly taskId: string;
  readonly status: "aborted";
  readonly eventCount: number;
  readonly writeCount: number;
  readonly resultAvailable: true;
  readonly eventsAvailable: boolean;
} {
  return {
    taskId: result.taskId,
    status: result.status,
    eventCount: inspected.events.length,
    writeCount: result.writes.length,
    resultAvailable: true,
    eventsAvailable: inspected.events.length > 0
  };
}

function summarizeAgentTaskRetryResult(input: {
  readonly original: AgentTaskInspectResult;
  readonly created: AgentTaskCreateResult;
  readonly retry: AgentTaskInspectResult;
}): {
  readonly originalTaskId: string;
  readonly retryTaskId: string;
  readonly status: "retry-prepared";
  readonly retryStatus: string;
  readonly previousStatus: string;
  readonly previousEvidencePreserved: true;
  readonly writeCount: number;
  readonly eventCount: number;
  readonly packageCreated: true;
} {
  return {
    originalTaskId: input.original.taskId,
    retryTaskId: input.retry.taskId,
    status: "retry-prepared",
    retryStatus: input.retry.result.status,
    previousStatus: input.original.result.status,
    previousEvidencePreserved: true,
    writeCount: input.created.writes.length + 1,
    eventCount: input.retry.events.length,
    packageCreated: true
  };
}

function retryAgentTaskId(taskId: string): string {
  const suffix = Date.now().toString(36);
  const marker = "-retry-";
  const baseLength = Math.max(1, 80 - marker.length - suffix.length);
  return `${taskId.slice(0, baseLength)}${marker}${suffix}`;
}

function agentTaskBridgePaths(taskId: string): { readonly contextPack: string } {
  return { contextPack: `.novelfabric/tasks/${taskId}/context-pack.json` };
}

function writeAgentTaskEventStream(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly workspacePath: string;
  readonly task: string;
  readonly cursor: number;
}): void {
  const { request, response, workspacePath, task } = input;
  let cursor = input.cursor;
  let closed = false;
  let polling = false;
  let terminalEmitted = false;
  let firstPoll = true;
  const timers: { interval?: NodeJS.Timeout; maxTimer?: NodeJS.Timeout } = {};

  activeAgentTaskStreamCount += 1;
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("connection", "keep-alive");
  response.flushHeaders();

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    activeAgentTaskStreamCount = Math.max(0, activeAgentTaskStreamCount - 1);
    if (timers.interval !== undefined) clearInterval(timers.interval);
    if (timers.maxTimer !== undefined) clearTimeout(timers.maxTimer);
  };

  response.on("close", cleanup);
  request.on("aborted", cleanup);

  const end = (): void => {
    cleanup();
    if (!response.writableEnded) response.end();
  };

  const poll = async (): Promise<void> => {
    if (closed || polling || response.writableEnded) return;
    polling = true;
    try {
      const inspected = await inspectAgentTask({ workspacePath, task });
      const data = summarizeAgentTaskEventsResult(inspected, cursor);
      if (firstPoll) {
        writeSseFrame(response, "snapshot", data);
        firstPoll = false;
      } else if (data.events.length > 0) {
        writeSseFrame(response, "events", data);
      }
      cursor = data.nextCursor;
      if (isTerminalAgentTaskStatus(inspected.result.status) && !terminalEmitted) {
        terminalEmitted = true;
        writeSseFrame(response, "task.terminal", {
          taskId: inspected.taskId,
          status: inspected.result.status,
          nextCursor: cursor
        });
        end();
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unexpected non-error agent task stream failure.";
      writeSseFrame(response, "error", {
        code:
          error instanceof Error && isCommandFailure(error) ? error.code : "bridge_stream_error",
        message: sanitizeBridgeErrorMessage(message)
      });
      end();
    } finally {
      polling = false;
    }
  };

  void poll();
  timers.interval = setInterval(() => {
    void poll();
  }, agentTaskStreamPollMs());
  timers.maxTimer = setTimeout(() => {
    if (closed || response.writableEnded) return;
    writeSseFrame(response, "stream.timeout", {
      taskId: task,
      maxDurationMs: agentTaskStreamMaxMs()
    });
    end();
  }, agentTaskStreamMaxMs());
}

function writeSseFrame(response: ServerResponse, event: string, data: unknown): void {
  if (response.writableEnded) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify({ ok: true, data })}\n\n`);
}

function agentTaskStreamPollMs(): number {
  return positiveIntegerEnvironment(
    "NOVELFABRIC_WEB_BRIDGE_STREAM_POLL_MS",
    DEFAULT_AGENT_TASK_STREAM_POLL_MS
  );
}

function agentTaskStreamMaxMs(): number {
  return positiveIntegerEnvironment(
    "NOVELFABRIC_WEB_BRIDGE_STREAM_MAX_MS",
    DEFAULT_AGENT_TASK_STREAM_MAX_MS
  );
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function summarizePiSdkAvailability(piSdk: PiSdkAvailability): {
  readonly adapter: string;
  readonly available: boolean;
} {
  return {
    adapter: piSdk.adapter,
    available: piSdk.available
  };
}

function summarizeRuntimeEvidence(evidence: AgentTaskRuntimeEvidence | undefined):
  | {
      readonly provider: string;
      readonly model: string;
      readonly engine: "cli" | "sdk";
      readonly toolPolicy: string;
      readonly sessionPolicy: string;
      readonly contextPolicy: "attached" | "none";
      readonly stdoutBytes: number;
      readonly stderrBytes: number;
      readonly sessionId?: string;
    }
  | undefined {
  if (evidence === undefined) return undefined;
  return {
    provider: evidence.provider,
    model: evidence.model,
    engine: evidence.engine,
    toolPolicy: evidence.toolPolicy,
    sessionPolicy: evidence.sessionPolicy,
    contextPolicy: evidence.contextPolicy.includes("no-context") ? "none" : "attached",
    stdoutBytes: evidence.stdoutBytes,
    stderrBytes: evidence.stderrBytes,
    ...(evidence.sessionId === undefined ? {} : { sessionId: evidence.sessionId })
  };
}

function summarizeAgentTaskEvent(event: AgentTaskEvent): {
  readonly taskId: string;
  readonly type: AgentTaskEvent["type"];
  readonly actor: string;
  readonly timestamp: string;
  readonly runtimeEventType?: AgentTaskEvent["runtimeEventType"];
  readonly toolName?: string;
  readonly denialCode?: string;
  readonly valid?: boolean;
  readonly textBytes?: number;
  readonly terminal?: boolean;
  readonly sequence?: number;
} {
  const runtimeEventType = sanitizeRuntimeEventType(event.runtimeEventType);
  const toolName = sanitizeStructuredEventField(event.toolName);
  const denialCode = sanitizeStructuredEventField(event.denialCode);
  return {
    taskId: event.taskId,
    type: event.type,
    actor: event.actor,
    timestamp: event.timestamp,
    ...(runtimeEventType === undefined ? {} : { runtimeEventType }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(denialCode === undefined ? {} : { denialCode }),
    ...(event.valid === undefined ? {} : { valid: event.valid }),
    ...(event.textBytes === undefined ? {} : { textBytes: event.textBytes }),
    ...(event.terminal === undefined ? {} : { terminal: event.terminal }),
    ...(event.sequence === undefined ? {} : { sequence: event.sequence })
  };
}

const SAFE_RUNTIME_EVENT_TYPES = new Set<AgentTaskEvent["runtimeEventType"]>([
  "session.started",
  "model.output",
  "tool.requested",
  "tool.denied",
  "validation.completed",
  "session.completed",
  "session.failed"
]);

function sanitizeRuntimeEventType(
  value: AgentTaskEvent["runtimeEventType"] | undefined
): AgentTaskEvent["runtimeEventType"] | undefined {
  if (value === undefined) return undefined;
  return SAFE_RUNTIME_EVENT_TYPES.has(value) ? value : undefined;
}

function sanitizeStructuredEventField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = stripControlCharacters(sanitizeBridgeErrorMessage(value))
    .replace(/\s+/gu, " ")
    .trim();
  if (sanitized.length === 0) return undefined;
  const maxLength = 96;
  return sanitized.length <= maxLength ? sanitized : `${sanitized.slice(0, maxLength - 1)}…`;
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return "";
      return codePoint < 0x20 || codePoint === 0x7f ? " " : character;
    })
    .join("");
}

function bridgeWorkspacePath(): string {
  const configured = process.env["NOVELFABRIC_WEB_BRIDGE_WORKSPACE"];
  if (configured === undefined || configured.trim().length === 0) {
    throw new CommandFailure(
      "bridge_workspace_unset",
      "File bridge requires NOVELFABRIC_WEB_BRIDGE_WORKSPACE.",
      500
    );
  }
  return configured;
}

function bridgeActor(): string {
  const configured = process.env["NOVELFABRIC_WEB_BRIDGE_ACTOR"];
  if (configured === undefined || configured.trim().length === 0) return "main_agent";
  return configured;
}

function assertBridgeWorkspaceMatches(
  requestedWorkspace: string,
  configuredWorkspace: string
): void {
  if (path.resolve(requestedWorkspace) === path.resolve(configuredWorkspace)) return;
  throw new CommandFailure(
    "bridge_workspace_mismatch",
    "Bridge requests may only target the workspace selected when the bridge was launched.",
    403
  );
}

function assertBridgeActorMatches(requestedActor: string, configuredActor: string): void {
  if (requestedActor === configuredActor) return;
  throw new CommandFailure(
    "bridge_actor_mismatch",
    "Bridge writes may only use the actor selected when the bridge was launched.",
    403
  );
}

function assertBridgeAgentTaskIdSafe(taskId: string): void {
  if (!taskId.includes("/") && !taskId.includes("\\")) return;
  throw new CommandFailure(
    "bridge_agent_task_id_forbidden",
    "Web bridge agent task ids must be plain task identifiers, not path-like values.",
    400
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding("utf8");
  let raw = "";
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      raw += chunk;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new CommandFailure("invalid_bridge_json", "Bridge request body must be valid JSON.", 400);
  }
}

function writeBridgeError(response: ServerResponse, error: unknown): void {
  if (error instanceof Error && isCommandFailure(error)) {
    writeJson(response, httpStatusForCommandFailure(error), {
      ok: false,
      error: { code: error.code, message: sanitizeBridgeErrorMessage(error.message) }
    });
    return;
  }

  if (error instanceof z.ZodError) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "invalid_bridge_request",
        message: sanitizeBridgeErrorMessage(z.prettifyError(error))
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected non-error bridge failure.";
  writeJson(response, 500, {
    ok: false,
    error: { code: "bridge_unexpected_error", message: sanitizeBridgeErrorMessage(message) }
  });
}

function sanitizeBridgeErrorMessage(message: string): string {
  return message
    .replace(/\.novelfabric\/tasks\/[^\s"'`)]+/gu, "[internal-task-path]")
    .replace(
      /\b(?:result|events|task|input|context-pack|output\.schema|allowed-commands)\.jsonl?\b/gu,
      "[internal-file]"
    )
    .replace(/\b(?:sessionFile|rawText|parsedJson)\b(?:\s*=\s*[^\s"'`)]+)?/giu, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted-secret]")
    .replace(/\b(?:token|secret|api[_-]?key)\b\s*[:=]\s*[^\s"'`)]+/giu, "[redacted-secret]")
    .replace(/\b(?:token|secret)-[A-Za-z0-9_-]+\b/giu, "[redacted-secret]")
    .replace(
      /(?:[A-Za-z]:\\|\/)(?:[^\s"'`{}[\],;:|]+[\\/])+[^\s"'`{}[\],;:|]*/gu,
      "[internal-path]"
    );
}

function httpStatusForCommandFailure(error: CommandFailure): number {
  if (error.exitCode === 3) return 403;
  if (error.exitCode === 4) return 409;
  if (error.exitCode >= 400 && error.exitCode <= 599) return error.exitCode;
  return 400;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
