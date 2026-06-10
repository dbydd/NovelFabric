import path from "node:path";

import { CommandFailure, isCommandFailure } from "../errors.js";
import { appendWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";
import {
  inspectAgentTask,
  runAgentTask,
  type AgentTaskInspectResult,
  type AgentTaskRunRequest
} from "./tasks.js";

export type AgentTaskRunStateStatus = "running" | "completed" | "failed";

export type AgentTaskRunState = {
  readonly taskId: string;
  readonly status: AgentTaskRunStateStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
};

type MutableAgentTaskRunState = {
  taskId: string;
  status: AgentTaskRunStateStatus;
  startedAt: string;
  updatedAt: string;
  errorCode?: string;
};

type ActiveRun = {
  readonly state: MutableAgentTaskRunState;
  readonly promise: Promise<void>;
};

const runStates = new Map<string, MutableAgentTaskRunState>();
const activeRuns = new Map<string, ActiveRun>();

export async function startAgentTaskRun(request: AgentTaskRunRequest): Promise<AgentTaskRunState> {
  const inspected = await inspectAgentTask({
    workspacePath: request.workspacePath,
    task: request.task
  });
  if (inspected.result.status === "completed") {
    throw new CommandFailure(
      "bridge_agent_task_already_completed",
      "Completed agent tasks cannot be started again through the web bridge; prepare a retry task instead.",
      409
    );
  }

  const key = runKey(request.workspacePath, inspected.taskId);
  const existing = activeRuns.get(key);
  if (existing?.state.status === "running") {
    throw new CommandFailure(
      "bridge_agent_task_already_running",
      "This agent task is already running.",
      409
    );
  }

  const now = new Date().toISOString();
  const state: MutableAgentTaskRunState = {
    taskId: inspected.taskId,
    status: "running",
    startedAt: now,
    updatedAt: now
  };
  runStates.set(key, state);

  let resolveBackground: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveBackground = resolve;
  });
  activeRuns.set(key, { state, promise });
  queueMicrotask(() => {
    void runAgentTaskInBackground(request, inspected, key, state).finally(resolveBackground);
  });
  void promise;
  return freezeState(state);
}

export function getAgentTaskRunState(
  taskId: string,
  workspacePath?: string
): AgentTaskRunState | undefined {
  if (workspacePath !== undefined) {
    const state = runStates.get(runKey(workspacePath, taskId));
    return state === undefined ? undefined : freezeState(state);
  }

  for (const [key, state] of runStates) {
    if (key.endsWith(`\u0000${taskId}`)) {
      return freezeState(state);
    }
  }
  return undefined;
}

export function clearAgentTaskRunStateForTesting(): void {
  runStates.clear();
  activeRuns.clear();
}

async function runAgentTaskInBackground(
  request: AgentTaskRunRequest,
  inspected: AgentTaskInspectResult,
  key: string,
  state: MutableAgentTaskRunState
): Promise<void> {
  try {
    await runAgentTask(request);
    state.status = "completed";
    state.updatedAt = new Date().toISOString();
    delete state.errorCode;
  } catch (error: unknown) {
    state.status = "failed";
    state.updatedAt = new Date().toISOString();
    state.errorCode =
      error instanceof Error && isCommandFailure(error) ? error.code : "agent_task_run_failed";
    await ensureDurableFailureEvidence(request, inspected, state.errorCode);
  } finally {
    activeRuns.delete(key);
  }
}

async function ensureDurableFailureEvidence(
  request: AgentTaskRunRequest,
  inspected: AgentTaskInspectResult,
  errorCode: string
): Promise<void> {
  const refreshed = await inspectAgentTask({
    workspacePath: request.workspacePath,
    task: inspected.taskId
  }).catch(() => null);
  if (refreshed?.result.status === "completed" || refreshed?.result.status === "failed") {
    return;
  }

  const failedAt = new Date().toISOString();
  const note = `pi runtime failed before durable completion evidence was recorded: ${errorCode}`;
  await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: inspected.task.files.result,
    actor: request.actor,
    reason: request.reason ?? "agent async run failed result record",
    content: JSON.stringify(
      {
        kind: "novelfabric.agent.task.result",
        version: 1,
        taskId: inspected.taskId,
        status: "failed",
        runtime: request.runtime,
        actor: request.actor,
        updatedAt: failedAt,
        piSdk: { adapter: "@earendil-works/pi-coding-agent", available: false },
        notes: [note]
      },
      null,
      2
    )
  });
  await appendWorkspaceFile({
    workspacePath: request.workspacePath,
    path: inspected.task.files.events,
    actor: request.actor,
    reason: request.reason ?? "agent async run failed event append",
    content: `${JSON.stringify({
      kind: "novelfabric.agent.task.event",
      version: 1,
      taskId: inspected.taskId,
      type: "failed",
      actor: request.actor,
      timestamp: failedAt,
      message: note,
      runtimeEventType: "session.failed",
      terminal: true,
      sequence: 0
    })}\n`
  });
}

function freezeState(state: MutableAgentTaskRunState): AgentTaskRunState {
  return {
    taskId: state.taskId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    ...(state.errorCode === undefined ? {} : { errorCode: state.errorCode })
  };
}

function runKey(workspacePath: string, taskId: string): string {
  return `${path.resolve(workspacePath)}\u0000${taskId}`;
}
