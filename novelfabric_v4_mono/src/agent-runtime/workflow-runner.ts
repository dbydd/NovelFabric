import path from "node:path";

import { CommandFailure, isCommandFailure } from "../errors.js";
import { writeWorkspaceFile } from "../workspace/files.js";
import { stepWorkflow, type WorkflowStepRequest } from "../workflow/index.js";

export type WorkflowStepRunStateStatus = "running" | "completed" | "failed";

export type WorkflowStepRunState = {
  readonly jobId: string;
  readonly status: WorkflowStepRunStateStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
};

type MutableWorkflowStepRunState = {
  jobId: string;
  status: WorkflowStepRunStateStatus;
  startedAt: string;
  updatedAt: string;
  errorCode?: string;
};

type ActiveWorkflowStepRun = {
  readonly state: MutableWorkflowStepRunState;
  readonly promise: Promise<void>;
};

const stepRunStates = new Map<string, MutableWorkflowStepRunState>();
const activeStepRuns = new Map<string, ActiveWorkflowStepRun>();

export function startWorkflowStepRun(request: WorkflowStepRequest): WorkflowStepRunState {
  const key = stepRunKey(request.workspacePath, request.jobId);
  const existing = activeStepRuns.get(key);
  if (existing?.state.status === "running") {
    throw new CommandFailure(
      "bridge_workflow_step_already_running",
      "This workflow job already has an active step run.",
      409
    );
  }

  const now = new Date().toISOString();
  const state: MutableWorkflowStepRunState = {
    jobId: request.jobId,
    status: "running",
    startedAt: now,
    updatedAt: now
  };
  stepRunStates.set(key, state);

  let resolveBackground: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveBackground = resolve;
  });
  activeStepRuns.set(key, { state, promise });
  queueMicrotask(() => {
    void runWorkflowStepInBackground(request, key, state).finally(resolveBackground);
  });
  void promise;
  return freezeWorkflowStepRunState(state);
}

export function getWorkflowStepRunState(
  jobId: string,
  workspacePath?: string
): WorkflowStepRunState | undefined {
  if (workspacePath !== undefined) {
    const state = stepRunStates.get(stepRunKey(workspacePath, jobId));
    return state === undefined ? undefined : freezeWorkflowStepRunState(state);
  }

  for (const [key, state] of stepRunStates) {
    if (key.endsWith(`\u0000${jobId}`)) {
      return freezeWorkflowStepRunState(state);
    }
  }
  return undefined;
}

export function clearWorkflowStepRunStateForTesting(): void {
  stepRunStates.clear();
  activeStepRuns.clear();
}

async function runWorkflowStepInBackground(
  request: WorkflowStepRequest,
  key: string,
  state: MutableWorkflowStepRunState
): Promise<void> {
  try {
    await maybeDelayForTesting();
    await stepWorkflow(request);
    state.status = "completed";
    state.updatedAt = new Date().toISOString();
    delete state.errorCode;
  } catch (error: unknown) {
    state.status = "failed";
    state.updatedAt = new Date().toISOString();
    state.errorCode =
      error instanceof Error && isCommandFailure(error) ? error.code : "workflow_step_run_failed";
    await ensureDurableWorkflowStepFailureEvidence(request, state.errorCode);
  } finally {
    activeStepRuns.delete(key);
  }
}

async function ensureDurableWorkflowStepFailureEvidence(
  request: WorkflowStepRequest,
  errorCode: string
): Promise<void> {
  const failedAt = new Date().toISOString();
  await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: `reports/workflow-step-failures/${request.jobId}.json`,
    actor: request.actor,
    reason: request.reason ?? "workflow async step failed run record",
    content: JSON.stringify(
      {
        kind: "novelfabric.workflow.async-step-failure",
        version: 1,
        jobId: request.jobId,
        status: "failed",
        actor: request.actor,
        errorCode,
        failedAt
      },
      null,
      2
    )
  }).catch(() => undefined);
}

async function maybeDelayForTesting(): Promise<void> {
  const raw = process.env["NOVELFABRIC_WEB_BRIDGE_WORKFLOW_STEP_DELAY_MS"];
  if (raw === undefined) return;
  const delayMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function freezeWorkflowStepRunState(state: MutableWorkflowStepRunState): WorkflowStepRunState {
  return {
    jobId: state.jobId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    ...(state.errorCode === undefined ? {} : { errorCode: state.errorCode })
  };
}

function stepRunKey(workspacePath: string, jobId: string): string {
  return `${path.resolve(workspacePath)}\u0000${jobId}`;
}
