import { CommandFailure } from "../errors.js";
import { createAgentTask, runAgentTask, validateAgentOutput } from "../agent-runtime/tasks.js";
import { applyCardProposal, proposeCards } from "../cards/proposals.js";
import {
  buildImportContextPack,
  chapterizeImportSource,
  normalizeImportSource
} from "../import/source.js";
import { buildContextPack, rebuildKnowledgeIndex } from "../knowledge/index.js";
import { createReportTask } from "../report/index.js";
import {
  buildSimulationContextPack,
  createSimulationSession,
  safePathSegment,
  stableJson
} from "../simulation/index.js";
import { createSwarmTask, planSwarmRound } from "../swarm/index.js";
import { buildWritingContextPack, createWritingDraftTask } from "../writing/index.js";
import { contentHash, readWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";

export type WorkflowStatus = "planned" | "running" | "completed" | "failed" | "cancelled";

export type WorkflowStageId =
  | "import.normalize"
  | "import.chapterize"
  | "import.context-pack"
  | "cards.propose"
  | "cards.apply"
  | "knowledge.rebuild"
  | "context-pack.build"
  | "simulation.session.create"
  | "simulation.context-pack"
  | "swarm.plan"
  | "swarm.task.create"
  | "report.task.create"
  | "writing.context-pack"
  | "writing.draft";

export type WorkflowStageDefinition = {
  readonly id: WorkflowStageId;
  readonly command: string;
  readonly family: string;
  readonly description: string;
  readonly semanticRuntime: "none" | "pi-task";
};

export type WorkflowPlanArtifact = {
  readonly kind: "novelfabric.workflow.plan";
  readonly version: 1;
  readonly planId: string;
  readonly createdAt: string;
  readonly sourcePath: string;
  readonly role: string;
  readonly stages: readonly WorkflowStageDefinition[];
};

export type WorkflowJobArtifact = {
  readonly kind: "novelfabric.workflow.job";
  readonly version: 1;
  readonly jobId: string;
  readonly planId: string;
  readonly actor: string;
  readonly sourcePath: string;
  readonly role: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WorkflowStateArtifact = {
  readonly kind: "novelfabric.workflow.state";
  readonly version: 1;
  readonly jobId: string;
  readonly status: WorkflowStatus;
  readonly nextStageIndex: number;
  readonly completedStages: readonly WorkflowCompletedStage[];
  readonly failedStage: WorkflowFailedStage | null;
  readonly updatedAt: string;
  readonly cancelledAt: string | null;
};

export type WorkflowCompletedStage = {
  readonly stage: WorkflowStageId;
  readonly completedAt: string;
};

export type WorkflowFailedStage = {
  readonly stage: WorkflowStageId;
  readonly failedAt: string;
  readonly code: string;
  readonly message: string;
};

export type WorkflowArtifactsArtifact = {
  readonly kind: "novelfabric.workflow.artifacts";
  readonly version: 1;
  readonly jobId: string;
  readonly items: readonly WorkflowArtifactItem[];
};

export type WorkflowArtifactItem = {
  readonly stage: WorkflowStageId;
  readonly name: string;
  readonly path: string;
  readonly hash?: string;
  readonly artifactKind: string;
};

type AgentTaskEvidence = {
  readonly taskId: string;
  readonly packagePath: string;
  readonly resultPath: string;
  readonly resultWrite: WorkflowWriteSummary;
};

export type WorkflowTraceEntry = {
  readonly timestamp: string;
  readonly jobId: string;
  readonly event: string;
  readonly stage?: WorkflowStageId;
  readonly payload?: Record<string, unknown>;
};

export type WorkflowPlanRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath: string;
  readonly role: string;
  readonly planId?: string;
  readonly reason?: string;
};

export type WorkflowPlanResult = {
  readonly planId: string;
  readonly planPath: string;
  readonly sourcePath: string;
  readonly role: string;
  readonly stageCount: number;
  readonly stages: readonly WorkflowStageDefinition[];
  readonly write: WorkflowWriteSummary;
};

export type WorkflowStartRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly planId: string;
  readonly reason?: string;
};

export type WorkflowStartResult = WorkflowPeekResult & {
  readonly writes: readonly WorkflowWriteSummary[];
};

export type WorkflowPeekRequest = {
  readonly workspacePath: string;
  readonly jobId: string;
};

export type WorkflowPeekResult = {
  readonly jobId: string;
  readonly planId: string;
  readonly status: WorkflowStatus;
  readonly sourcePath: string;
  readonly role: string;
  readonly nextStage: WorkflowStageDefinition | null;
  readonly progress: WorkflowProgress;
  readonly paths: WorkflowJobPaths;
};

export type WorkflowProgress = {
  readonly completed: number;
  readonly total: number;
};

export type WorkflowStepRequest = {
  readonly workspacePath: string;
  readonly jobId: string;
  readonly actor: string;
  readonly input?: unknown;
  readonly reason?: string;
};

export type WorkflowStepResult = WorkflowPeekResult & {
  readonly executedStage: WorkflowStageId;
  readonly stageStatus: "completed" | "failed";
  readonly output: Record<string, unknown>;
  readonly artifacts: readonly WorkflowArtifactItem[];
  readonly writes: readonly WorkflowWriteSummary[];
};

export type WorkflowResumeRequest = {
  readonly workspacePath: string;
  readonly jobId: string;
  readonly actor: string;
  readonly reason?: string;
};

export type WorkflowRetryRequest = WorkflowResumeRequest & {
  readonly stage: WorkflowStageId;
};

export type WorkflowCancelRequest = WorkflowResumeRequest;

export type WorkflowArtifactsRequest = WorkflowPeekRequest;

export type WorkflowArtifactsResult = {
  readonly jobId: string;
  readonly artifactCount: number;
  readonly artifacts: readonly WorkflowArtifactItem[];
  readonly paths: WorkflowJobPaths;
};

export type WorkflowVerifyRequest = WorkflowPeekRequest;

export type WorkflowVerifyResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly WorkflowVerifyIssue[];
  readonly status: WorkflowStatus;
  readonly artifactCount: number;
};

export type WorkflowVerifyIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type WorkflowWriteSummary = {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly auditPath: string;
};

export type WorkflowJobPaths = {
  readonly planPath: string;
  readonly jobPath: string;
  readonly statePath: string;
  readonly tracePath: string;
  readonly artifactsPath: string;
};

type WorkflowRuntime = {
  readonly plan: WorkflowPlanArtifact;
  readonly job: WorkflowJobArtifact;
  readonly state: WorkflowStateArtifact;
  readonly artifacts: WorkflowArtifactsArtifact;
};

type StageExecutionResult = {
  readonly output: Record<string, unknown>;
  readonly artifacts: readonly WorkflowArtifactItem[];
};

const WORKFLOW_PLAN_KIND = "novelfabric.workflow.plan";
const WORKFLOW_JOB_KIND = "novelfabric.workflow.job";
const WORKFLOW_STATE_KIND = "novelfabric.workflow.state";
const WORKFLOW_ARTIFACTS_KIND = "novelfabric.workflow.artifacts";
const WORKFLOW_VERSION = 1;

const WORKFLOW_STAGES: readonly WorkflowStageDefinition[] = [
  {
    id: "import.normalize",
    command: "novelfabric import normalize",
    family: "import",
    description: "Normalize the imported source into UTF-8 LF text.",
    semanticRuntime: "none"
  },
  {
    id: "import.chapterize",
    command: "novelfabric import chapterize",
    family: "import",
    description: "Materialize deterministic chapter files and a chapter manifest.",
    semanticRuntime: "none"
  },
  {
    id: "import.context-pack",
    command: "novelfabric import context-pack",
    family: "import",
    description: "Build an import context pack for later agent work.",
    semanticRuntime: "none"
  },
  {
    id: "cards.propose",
    command: "novelfabric cards propose",
    family: "cards",
    description: "Create a citation-backed card proposal artifact.",
    semanticRuntime: "none"
  },
  {
    id: "cards.apply",
    command: "novelfabric cards apply",
    family: "cards",
    description: "Apply the validated card proposal to canonical cards/.",
    semanticRuntime: "none"
  },
  {
    id: "knowledge.rebuild",
    command: "novelfabric knowledge rebuild",
    family: "knowledge",
    description: "Rebuild deterministic StoryRAG source and graph indexes.",
    semanticRuntime: "none"
  },
  {
    id: "context-pack.build",
    command: "novelfabric context-pack build",
    family: "context-pack",
    description: "Build a role-turn context pack from deterministic recall.",
    semanticRuntime: "none"
  },
  {
    id: "simulation.session.create",
    command: "novelfabric simulation session create",
    family: "simulation",
    description: "Create a simulation session for the role-play branch.",
    semanticRuntime: "none"
  },
  {
    id: "simulation.context-pack",
    command: "novelfabric simulation context-pack",
    family: "simulation",
    description: "Build a simulation context pack for the selected role.",
    semanticRuntime: "none"
  },
  {
    id: "swarm.plan",
    command: "novelfabric swarm plan",
    family: "swarm",
    description: "Plan the fixed StorySwarm round order.",
    semanticRuntime: "none"
  },
  {
    id: "swarm.task.create",
    command: "novelfabric swarm task create",
    family: "swarm",
    description: "Create a pi-agent task package and output template for a swarm role.",
    semanticRuntime: "pi-task"
  },
  {
    id: "report.task.create",
    command: "novelfabric report task create",
    family: "report",
    description: "Create a ReportAgent task artifact for the wrapped pi runtime.",
    semanticRuntime: "pi-task"
  },
  {
    id: "writing.context-pack",
    command: "novelfabric writing context-pack",
    family: "writing",
    description: "Build writing context from reports, simulation, and chapters.",
    semanticRuntime: "none"
  },
  {
    id: "writing.draft",
    command: "novelfabric writing draft",
    family: "writing",
    description: "Create a chapter draft task artifact for the wrapped pi runtime.",
    semanticRuntime: "pi-task"
  }
];

export async function planWorkflow(request: WorkflowPlanRequest): Promise<WorkflowPlanResult> {
  const source = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.sourcePath
  });
  const role = normalizeNonEmpty(request.role, "role");
  const planId = request.planId ?? makeWorkflowId("workflow", `${source.path}:${role}`);
  assertSafeWorkflowId(planId, "plan");
  const plan: WorkflowPlanArtifact = {
    kind: WORKFLOW_PLAN_KIND,
    version: WORKFLOW_VERSION,
    planId,
    createdAt: new Date().toISOString(),
    sourcePath: source.path,
    role,
    stages: WORKFLOW_STAGES
  };
  const write = await writeJsonArtifact({
    workspacePath: request.workspacePath,
    path: jobPaths(planId).planPath,
    actor: request.actor,
    reason: request.reason ?? "workflow plan",
    value: plan
  });
  return {
    planId,
    planPath: write.path,
    sourcePath: source.path,
    role,
    stageCount: plan.stages.length,
    stages: plan.stages,
    write
  };
}

export async function startWorkflow(request: WorkflowStartRequest): Promise<WorkflowStartResult> {
  const paths = jobPaths(request.planId);
  const plan = await readPlan(request.workspacePath, request.planId);
  const now = new Date().toISOString();
  const job: WorkflowJobArtifact = {
    kind: WORKFLOW_JOB_KIND,
    version: WORKFLOW_VERSION,
    jobId: plan.planId,
    planId: plan.planId,
    actor: request.actor,
    sourcePath: plan.sourcePath,
    role: plan.role,
    createdAt: now,
    updatedAt: now
  };
  const state: WorkflowStateArtifact = {
    kind: WORKFLOW_STATE_KIND,
    version: WORKFLOW_VERSION,
    jobId: job.jobId,
    status: "running",
    nextStageIndex: 0,
    completedStages: [],
    failedStage: null,
    updatedAt: now,
    cancelledAt: null
  };
  const artifacts: WorkflowArtifactsArtifact = {
    kind: WORKFLOW_ARTIFACTS_KIND,
    version: WORKFLOW_VERSION,
    jobId: job.jobId,
    items: []
  };
  const trace = traceLine({
    timestamp: now,
    jobId: job.jobId,
    event: "workflow.started",
    payload: { planId: plan.planId, actor: request.actor }
  });
  const writes = await Promise.all([
    writeJsonArtifact({
      workspacePath: request.workspacePath,
      path: paths.jobPath,
      actor: request.actor,
      reason: request.reason ?? "workflow start job",
      value: job
    }),
    writeJsonArtifact({
      workspacePath: request.workspacePath,
      path: paths.statePath,
      actor: request.actor,
      reason: request.reason ?? "workflow start state",
      value: state
    }),
    writeJsonArtifact({
      workspacePath: request.workspacePath,
      path: paths.artifactsPath,
      actor: request.actor,
      reason: request.reason ?? "workflow start artifacts",
      value: artifacts
    }),
    writeTextArtifact({
      workspacePath: request.workspacePath,
      path: paths.tracePath,
      actor: request.actor,
      reason: request.reason ?? "workflow start trace",
      content: trace
    })
  ]);
  return { ...peekFromRuntime({ plan, job, state, artifacts }), writes };
}

export async function peekWorkflow(request: WorkflowPeekRequest): Promise<WorkflowPeekResult> {
  return peekFromRuntime(await readRuntime(request.workspacePath, request.jobId));
}

export async function statusWorkflow(request: WorkflowPeekRequest): Promise<WorkflowPeekResult> {
  return peekWorkflow(request);
}

export async function stepWorkflow(request: WorkflowStepRequest): Promise<WorkflowStepResult> {
  const runtime = await readRuntime(request.workspacePath, request.jobId);
  assertMutableState(runtime.state);
  if (runtime.state.nextStageIndex >= runtime.plan.stages.length) {
    throw new CommandFailure(
      "workflow_completed",
      `Workflow job '${request.jobId}' is already completed.`
    );
  }

  const stage = runtime.plan.stages[runtime.state.nextStageIndex];
  if (stage === undefined) {
    throw new CommandFailure(
      "workflow_stage_missing",
      `Workflow job '${request.jobId}' has no next stage.`
    );
  }
  assertStepInputMatchesStage(request.input, stage.id);

  const startedAt = new Date().toISOString();
  let execution: StageExecutionResult;
  let newState: WorkflowStateArtifact;
  let newArtifacts: WorkflowArtifactsArtifact;
  try {
    execution = await executeStage({
      workspacePath: request.workspacePath,
      actor: request.actor,
      plan: runtime.plan,
      job: runtime.job,
      artifacts: runtime.artifacts,
      stage: stage.id
    });
    newArtifacts = {
      ...runtime.artifacts,
      items: [...runtime.artifacts.items, ...execution.artifacts]
    };
    const nextStageIndex = runtime.state.nextStageIndex + 1;
    const status: WorkflowStatus =
      nextStageIndex >= runtime.plan.stages.length ? "completed" : "running";
    newState = {
      ...runtime.state,
      status,
      nextStageIndex,
      completedStages: [
        ...runtime.state.completedStages,
        { stage: stage.id, completedAt: new Date().toISOString() }
      ],
      failedStage: null,
      updatedAt: new Date().toISOString(),
      cancelledAt: null
    };
  } catch (error) {
    const failure = commandFailureFromUnknown(error, "workflow_stage_failed");
    execution = { output: { code: failure.code, message: failure.message }, artifacts: [] };
    newArtifacts = runtime.artifacts;
    newState = {
      ...runtime.state,
      status: "failed",
      failedStage: {
        stage: stage.id,
        failedAt: new Date().toISOString(),
        code: failure.code,
        message: failure.message
      },
      updatedAt: new Date().toISOString()
    };
  }

  const completedRuntime = {
    ...runtime,
    state: newState,
    artifacts: newArtifacts
  } satisfies WorkflowRuntime;
  const traceEntry: WorkflowTraceEntry = {
    timestamp: new Date().toISOString(),
    jobId: request.jobId,
    event: newState.status === "failed" ? "workflow.stage.failed" : "workflow.stage.completed",
    stage: stage.id,
    payload: { startedAt, output: execution.output }
  };
  const writes = await persistRuntimeUpdate({
    workspacePath: request.workspacePath,
    jobId: request.jobId,
    actor: request.actor,
    state: newState,
    artifacts: newArtifacts,
    traceEntry,
    reason: request.reason ?? `workflow step ${stage.id}`
  });

  return {
    ...peekFromRuntime(completedRuntime),
    executedStage: stage.id,
    stageStatus: newState.status === "failed" ? "failed" : "completed",
    output: execution.output,
    artifacts: execution.artifacts,
    writes
  };
}

export async function resumeWorkflow(request: WorkflowResumeRequest): Promise<WorkflowPeekResult> {
  const runtime = await readRuntime(request.workspacePath, request.jobId);
  if (runtime.state.status === "cancelled" || runtime.state.status === "completed") {
    throw new CommandFailure(
      "workflow_not_resumable",
      `Workflow job '${request.jobId}' is ${runtime.state.status}.`
    );
  }
  const state: WorkflowStateArtifact = {
    ...runtime.state,
    status: "running",
    failedStage: null,
    updatedAt: new Date().toISOString(),
    cancelledAt: null
  };
  await persistRuntimeUpdate({
    workspacePath: request.workspacePath,
    jobId: request.jobId,
    actor: request.actor,
    state,
    artifacts: runtime.artifacts,
    traceEntry: {
      timestamp: new Date().toISOString(),
      jobId: request.jobId,
      event: "workflow.resumed"
    },
    reason: request.reason ?? "workflow resume"
  });
  return peekFromRuntime({ ...runtime, state });
}

export async function retryWorkflow(request: WorkflowRetryRequest): Promise<WorkflowPeekResult> {
  const runtime = await readRuntime(request.workspacePath, request.jobId);
  if (runtime.state.status === "cancelled" || runtime.state.status === "completed") {
    throw new CommandFailure(
      "workflow_not_retryable",
      `Workflow job '${request.jobId}' is ${runtime.state.status}.`
    );
  }
  const retryIndex = runtime.plan.stages.findIndex((stage) => stage.id === request.stage);
  if (retryIndex < 0) {
    throw new CommandFailure(
      "workflow_stage_not_found",
      `Workflow stage '${request.stage}' is not part of job '${request.jobId}'.`
    );
  }
  const retainedStages = runtime.state.completedStages.filter((completed) => {
    const index = runtime.plan.stages.findIndex((stage) => stage.id === completed.stage);
    return index >= 0 && index < retryIndex;
  });
  const retainedArtifacts = runtime.artifacts.items.filter((item) => {
    const index = runtime.plan.stages.findIndex((stage) => stage.id === item.stage);
    return index >= 0 && index < retryIndex;
  });
  const state: WorkflowStateArtifact = {
    ...runtime.state,
    status: "running",
    nextStageIndex: retryIndex,
    completedStages: retainedStages,
    failedStage: null,
    updatedAt: new Date().toISOString(),
    cancelledAt: null
  };
  const artifacts: WorkflowArtifactsArtifact = { ...runtime.artifacts, items: retainedArtifacts };
  await persistRuntimeUpdate({
    workspacePath: request.workspacePath,
    jobId: request.jobId,
    actor: request.actor,
    state,
    artifacts,
    traceEntry: {
      timestamp: new Date().toISOString(),
      jobId: request.jobId,
      event: "workflow.retry",
      stage: request.stage
    },
    reason: request.reason ?? `workflow retry ${request.stage}`
  });
  return peekFromRuntime({ ...runtime, state, artifacts });
}

export async function cancelWorkflow(request: WorkflowCancelRequest): Promise<WorkflowPeekResult> {
  const runtime = await readRuntime(request.workspacePath, request.jobId);
  if (runtime.state.status === "completed") {
    throw new CommandFailure("workflow_completed", `Workflow job '${request.jobId}' is completed.`);
  }
  const now = new Date().toISOString();
  const state: WorkflowStateArtifact = {
    ...runtime.state,
    status: "cancelled",
    updatedAt: now,
    cancelledAt: now
  };
  await persistRuntimeUpdate({
    workspacePath: request.workspacePath,
    jobId: request.jobId,
    actor: request.actor,
    state,
    artifacts: runtime.artifacts,
    traceEntry: {
      timestamp: now,
      jobId: request.jobId,
      event: "workflow.cancelled"
    },
    reason: request.reason ?? "workflow cancel"
  });
  return peekFromRuntime({ ...runtime, state });
}

export async function listWorkflowArtifacts(
  request: WorkflowArtifactsRequest
): Promise<WorkflowArtifactsResult> {
  const runtime = await readRuntime(request.workspacePath, request.jobId);
  return {
    jobId: request.jobId,
    artifactCount: runtime.artifacts.items.length,
    artifacts: runtime.artifacts.items,
    paths: jobPaths(request.jobId)
  };
}

export async function verifyWorkflow(
  request: WorkflowVerifyRequest
): Promise<WorkflowVerifyResult> {
  const checked: string[] = [];
  const issues: WorkflowVerifyIssue[] = [];
  let runtime: WorkflowRuntime;
  try {
    runtime = await readRuntime(request.workspacePath, request.jobId);
  } catch (error) {
    return {
      valid: false,
      checked,
      issues: [
        {
          severity: "error",
          code: "workflow_unreadable",
          path: jobPaths(request.jobId).jobPath,
          message:
            error instanceof Error ? error.message : `Cannot read workflow '${request.jobId}'.`
        }
      ],
      status: "failed",
      artifactCount: 0
    };
  }

  const paths = jobPaths(runtime.job.jobId);
  checked.push(
    paths.planPath,
    paths.jobPath,
    paths.statePath,
    paths.artifactsPath,
    paths.tracePath
  );
  if (runtime.plan.planId !== runtime.job.planId || runtime.state.jobId !== runtime.job.jobId) {
    issues.push({
      severity: "error",
      code: "workflow_identity_mismatch",
      path: paths.jobPath,
      message: "Workflow plan, job, and state identifiers do not match."
    });
  }
  if (runtime.state.nextStageIndex > runtime.plan.stages.length) {
    issues.push({
      severity: "error",
      code: "workflow_stage_index_out_of_range",
      path: paths.statePath,
      message: "Workflow nextStageIndex exceeds the plan stage count."
    });
  }
  for (const item of runtime.artifacts.items) {
    checked.push(item.path);
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: item.path
      });
      if (item.hash !== undefined && read.hash !== item.hash) {
        issues.push({
          severity: "error",
          code: "workflow_artifact_hash_mismatch",
          path: item.path,
          message: `Artifact '${item.path}' changed after workflow recorded it.`
        });
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "workflow_artifact_unreadable",
        path: item.path,
        message: error instanceof Error ? error.message : `Cannot read '${item.path}'.`
      });
    }
  }
  const completedStageIds = new Set(runtime.state.completedStages.map((item) => item.stage));
  for (const stage of runtime.plan.stages) {
    if (stage.semanticRuntime !== "pi-task" || !completedStageIds.has(stage.id)) continue;
    const issue = await verifyPiTaskEvidence({
      workspacePath: request.workspacePath,
      artifacts: runtime.artifacts,
      stage: stage.id
    });
    if (issue !== null) issues.push(issue);
  }
  if (runtime.state.status === "failed" && runtime.state.failedStage === null) {
    issues.push({
      severity: "error",
      code: "workflow_failed_without_stage",
      path: paths.statePath,
      message: "Failed workflow state must record failedStage."
    });
  }
  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues,
    status: runtime.state.status,
    artifactCount: runtime.artifacts.items.length
  };
}

export function workflowStages(): readonly WorkflowStageDefinition[] {
  return WORKFLOW_STAGES;
}

function jobPaths(jobId: string): WorkflowJobPaths {
  assertSafeWorkflowId(jobId, "job");
  const base = `.novelfabric/jobs/${jobId}`;
  return {
    planPath: `${base}/plan.json`,
    jobPath: `${base}/job.json`,
    statePath: `${base}/state.json`,
    tracePath: `${base}/trace.jsonl`,
    artifactsPath: `${base}/artifacts.json`
  };
}

async function readRuntime(workspacePath: string, jobId: string): Promise<WorkflowRuntime> {
  const [plan, job, state, artifacts] = await Promise.all([
    readPlan(workspacePath, jobId),
    readJob(workspacePath, jobId),
    readState(workspacePath, jobId),
    readArtifacts(workspacePath, jobId)
  ]);
  return { plan, job, state, artifacts };
}

async function readPlan(workspacePath: string, jobId: string): Promise<WorkflowPlanArtifact> {
  const read = await readWorkspaceFile({ workspacePath, path: jobPaths(jobId).planPath });
  const parsed = parseJson(read.content, read.path);
  if (!isWorkflowPlan(parsed)) {
    throw new CommandFailure(
      "invalid_workflow_plan",
      `Workflow plan '${read.path}' has an invalid shape.`
    );
  }
  return parsed;
}

async function readJob(workspacePath: string, jobId: string): Promise<WorkflowJobArtifact> {
  const read = await readWorkspaceFile({ workspacePath, path: jobPaths(jobId).jobPath });
  const parsed = parseJson(read.content, read.path);
  if (!isWorkflowJob(parsed)) {
    throw new CommandFailure(
      "invalid_workflow_job",
      `Workflow job '${read.path}' has an invalid shape.`
    );
  }
  return parsed;
}

async function readState(workspacePath: string, jobId: string): Promise<WorkflowStateArtifact> {
  const read = await readWorkspaceFile({ workspacePath, path: jobPaths(jobId).statePath });
  const parsed = parseJson(read.content, read.path);
  if (!isWorkflowState(parsed)) {
    throw new CommandFailure(
      "invalid_workflow_state",
      `Workflow state '${read.path}' has an invalid shape.`
    );
  }
  return parsed;
}

async function readArtifacts(
  workspacePath: string,
  jobId: string
): Promise<WorkflowArtifactsArtifact> {
  const read = await readWorkspaceFile({ workspacePath, path: jobPaths(jobId).artifactsPath });
  const parsed = parseJson(read.content, read.path);
  if (!isWorkflowArtifacts(parsed)) {
    throw new CommandFailure(
      "invalid_workflow_artifacts",
      `Workflow artifacts '${read.path}' has an invalid shape.`
    );
  }
  return parsed;
}

function peekFromRuntime(runtime: WorkflowRuntime): WorkflowPeekResult {
  const nextStage = runtime.plan.stages[runtime.state.nextStageIndex] ?? null;
  return {
    jobId: runtime.job.jobId,
    planId: runtime.plan.planId,
    status: runtime.state.status,
    sourcePath: runtime.plan.sourcePath,
    role: runtime.plan.role,
    nextStage,
    progress: {
      completed: runtime.state.completedStages.length,
      total: runtime.plan.stages.length
    },
    paths: jobPaths(runtime.job.jobId)
  };
}

async function executeStage(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly plan: WorkflowPlanArtifact;
  readonly job: WorkflowJobArtifact;
  readonly artifacts: WorkflowArtifactsArtifact;
  readonly stage: WorkflowStageId;
}): Promise<StageExecutionResult> {
  const roleAgent = safePathSegment(request.plan.role);
  const sessionId = request.job.jobId;
  switch (request.stage) {
    case "import.normalize": {
      const result = await normalizeImportSource({
        workspacePath: request.workspacePath,
        actor: request.actor,
        sourcePath: request.plan.sourcePath,
        outputPath: `imports/normalized/${sessionId}.txt`,
        reason: "workflow import.normalize"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(request.stage, "normalized-source", result.write, "text/plain")
        ]
      };
    }
    case "import.chapterize": {
      const normalizedPath = requiredArtifactPath(
        request.artifacts,
        "import.normalize",
        "normalized-source"
      );
      const result = await chapterizeImportSource({
        workspacePath: request.workspacePath,
        actor: request.actor,
        sourcePath: normalizedPath,
        outputDir: `imports/chapters/${sessionId}`,
        reason: "workflow import.chapterize"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          {
            stage: request.stage,
            name: "chapter-manifest",
            path: result.manifestPath,
            hash: result.manifestHash,
            artifactKind: "novelfabric.import.chapters"
          }
        ]
      };
    }
    case "import.context-pack": {
      const manifestPath = requiredArtifactPath(
        request.artifacts,
        "import.chapterize",
        "chapter-manifest"
      );
      const result = await buildImportContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        chapterManifestPath: manifestPath,
        outputPath: `simulation/context-packs/import-${sessionId}.json`,
        reason: "workflow import.context-pack"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(
            request.stage,
            "import-context-pack",
            result.write,
            "novelfabric.import.context-pack"
          )
        ]
      };
    }
    case "cards.propose": {
      const contextPackPath = requiredArtifactPath(
        request.artifacts,
        "import.context-pack",
        "import-context-pack"
      );
      const result = await proposeCards({
        workspacePath: request.workspacePath,
        actor: request.actor,
        contextPackPath,
        kind: "character",
        title: `${request.plan.role} Source Card`,
        outputPath: `proposals/cards/${sessionId}-role-card.json`,
        reason: "workflow cards.propose"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          {
            stage: request.stage,
            name: "card-proposal",
            path: result.proposalPath,
            hash: result.proposalHash,
            artifactKind: "novelfabric.cards.proposal"
          }
        ]
      };
    }
    case "cards.apply": {
      const proposalPath = requiredArtifactPath(
        request.artifacts,
        "cards.propose",
        "card-proposal"
      );
      const result = await applyCardProposal({
        workspacePath: request.workspacePath,
        actor: request.actor,
        proposalPath,
        reason: "workflow cards.apply"
      });
      return {
        output: objectFromResult(result),
        artifacts: result.applied.map((write) => ({
          stage: request.stage,
          name: `card-${write.kind}`,
          path: write.path,
          hash: write.hash,
          artifactKind: "text/markdown"
        }))
      };
    }
    case "knowledge.rebuild": {
      const result = await rebuildKnowledgeIndex({
        workspacePath: request.workspacePath,
        actor: request.actor,
        reason: "workflow knowledge.rebuild"
      });
      return {
        output: objectFromResult(result),
        artifacts: result.writes.map((write) =>
          artifactFromWrite(
            request.stage,
            `knowledge-${write.path.split("/").at(-1) ?? "artifact"}`,
            write,
            "novelfabric.knowledge"
          )
        )
      };
    }
    case "context-pack.build": {
      const result = await buildContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        kind: "role-turn",
        query: `${request.plan.role} ${request.plan.sourcePath}`,
        agent: roleAgent,
        session: sessionId,
        timeline: "main",
        outputPath: `knowledge/context-packs/${sessionId}-role-turn.json`,
        reason: "workflow context-pack.build"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(
            request.stage,
            "role-context-pack",
            result.write,
            "novelfabric.context-pack"
          )
        ]
      };
    }
    case "simulation.session.create": {
      const result = await createSimulationSession({
        workspacePath: request.workspacePath,
        actor: request.actor,
        sessionId,
        objective: `Bring ${request.plan.role} through ${request.plan.sourcePath}.`,
        timeline: "main",
        reason: "workflow simulation.session.create"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(
            request.stage,
            "simulation-session",
            result.write,
            "novelfabric.simulation.session"
          )
        ]
      };
    }
    case "simulation.context-pack": {
      const result = await buildSimulationContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        agent: roleAgent,
        outputPath: `simulation/context-packs/${sessionId}/${roleAgent}.json`,
        reason: "workflow simulation.context-pack"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(
            request.stage,
            "simulation-context-pack",
            result.write,
            "novelfabric.simulation.context-pack"
          )
        ]
      };
    }
    case "swarm.plan": {
      const result = await planSwarmRound({
        workspacePath: request.workspacePath,
        session: sessionId,
        round: 1
      });
      return { output: objectFromResult(result), artifacts: [] };
    }
    case "swarm.task.create": {
      const result = await createSwarmTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        round: 1,
        agent: roleAgent,
        reason: "workflow swarm.task.create"
      });
      const swarmContextPackPath = optionalArtifactPath(
        request.artifacts,
        "simulation.context-pack",
        "simulation-context-pack"
      );
      const agentTask = await createAndRunWorkflowAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        jobId: sessionId,
        stage: request.stage,
        title: `StorySwarm role task for ${roleAgent}`,
        instruction:
          "Run the StorySwarm role reasoning through the NovelFabric-wrapped pi runtime, then write and validate the swarm output proposal.",
        input: {
          stage: request.stage,
          session: sessionId,
          agent: roleAgent,
          taskPath: result.taskPath,
          expectedOutputPath: result.proposalPath
        },
        ...(swarmContextPackPath === undefined ? {} : { contextPackPath: swarmContextPackPath }),
        allowedCommands: [
          "novelfabric files read",
          "novelfabric files write",
          "novelfabric swarm output validate",
          "novelfabric swarm output apply"
        ]
      });
      return {
        output: {
          ...objectFromResult(result),
          agentTaskEvidence: agentTaskOutput(agentTask)
        },
        artifacts: [
          artifactFromWrite(
            request.stage,
            "swarm-task",
            result.taskWrite,
            "novelfabric.swarm.task"
          ),
          artifactFromWrite(
            request.stage,
            "swarm-output-template",
            result.proposalWrite,
            "novelfabric.swarm.output"
          ),
          agentTaskEvidenceArtifact(request.stage, agentTask)
        ]
      };
    }
    case "report.task.create": {
      const contextPackPath = optionalArtifactPath(
        request.artifacts,
        "simulation.context-pack",
        "simulation-context-pack"
      );
      const result = await createReportTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        kind: "consistency",
        ...(contextPackPath === undefined ? {} : { contextPackPath }),
        outputPath: `reports/${sessionId}-consistency.json`,
        reason: "workflow report.task.create"
      });
      const agentTask = await createAndRunWorkflowAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        jobId: sessionId,
        stage: request.stage,
        title: "ReportAgent consistency task",
        instruction:
          "Run ReportAgent through the NovelFabric-wrapped pi runtime, then write a citation-backed report artifact at the expected output path.",
        input: {
          stage: request.stage,
          session: sessionId,
          reportTaskPath: result.taskPath,
          expectedOutputPath: result.reportPath
        },
        ...(contextPackPath === undefined ? {} : { contextPackPath }),
        allowedCommands: [
          "novelfabric files read",
          "novelfabric files write",
          "novelfabric report validate",
          "novelfabric report apply"
        ]
      });
      return {
        output: {
          ...objectFromResult(result),
          agentTaskEvidence: agentTaskOutput(agentTask)
        },
        artifacts: [
          artifactFromWrite(request.stage, "report-task", result.write, "novelfabric.report.task"),
          agentTaskEvidenceArtifact(request.stage, agentTask)
        ]
      };
    }
    case "writing.context-pack": {
      const result = await buildWritingContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        outputPath: `writing/context-packs/${sessionId}.json`,
        reason: "workflow writing.context-pack"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(
            request.stage,
            "writing-context-pack",
            result.write,
            "novelfabric.writing.context-pack"
          )
        ]
      };
    }
    case "writing.draft": {
      const contextPackPath = requiredArtifactPath(
        request.artifacts,
        "writing.context-pack",
        "writing-context-pack"
      );
      const result = await createWritingDraftTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        contextPackPath,
        outputPath: `writing/drafts/${sessionId}.json`,
        reason: "workflow writing.draft"
      });
      const agentTask = await createAndRunWorkflowAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        jobId: sessionId,
        stage: request.stage,
        title: "Chapter draft writing task",
        instruction:
          "Run the chapter drafting task through the NovelFabric-wrapped pi runtime, then write and validate a novelfabric.writing.draft artifact.",
        input: {
          stage: request.stage,
          writingTaskPath: result.taskPath,
          expectedDraftPath: result.expectedDraftPath
        },
        contextPackPath,
        allowedCommands: [
          "novelfabric files read",
          "novelfabric files write",
          "novelfabric writing review",
          "novelfabric writing apply-draft"
        ]
      });
      return {
        output: {
          ...objectFromResult(result),
          agentTaskEvidence: agentTaskOutput(agentTask)
        },
        artifacts: [
          artifactFromWrite(
            request.stage,
            "writing-draft-task",
            result.write,
            "novelfabric.writing.task"
          ),
          agentTaskEvidenceArtifact(request.stage, agentTask)
        ]
      };
    }
  }
}

async function persistRuntimeUpdate(request: {
  readonly workspacePath: string;
  readonly jobId: string;
  readonly actor: string;
  readonly state: WorkflowStateArtifact;
  readonly artifacts: WorkflowArtifactsArtifact;
  readonly traceEntry: WorkflowTraceEntry;
  readonly reason: string;
}): Promise<readonly WorkflowWriteSummary[]> {
  const paths = jobPaths(request.jobId);
  const trace = await readTraceOrEmpty(request.workspacePath, request.jobId);
  return Promise.all([
    writeJsonArtifact({
      workspacePath: request.workspacePath,
      path: paths.statePath,
      actor: request.actor,
      reason: request.reason,
      value: request.state
    }),
    writeJsonArtifact({
      workspacePath: request.workspacePath,
      path: paths.artifactsPath,
      actor: request.actor,
      reason: request.reason,
      value: request.artifacts
    }),
    writeTextArtifact({
      workspacePath: request.workspacePath,
      path: paths.tracePath,
      actor: request.actor,
      reason: request.reason,
      content: `${trace}${traceLine(request.traceEntry)}`
    })
  ]);
}

async function readTraceOrEmpty(workspacePath: string, jobId: string): Promise<string> {
  try {
    const read = await readWorkspaceFile({ workspacePath, path: jobPaths(jobId).tracePath });
    return read.content;
  } catch (error) {
    if (error instanceof CommandFailure && error.code === "file_not_found") return "";
    throw error;
  }
}

async function writeJsonArtifact(request: {
  readonly workspacePath: string;
  readonly path: string;
  readonly actor: string;
  readonly reason: string;
  readonly value: unknown;
}): Promise<WorkflowWriteSummary> {
  return writeTextArtifact({
    workspacePath: request.workspacePath,
    path: request.path,
    actor: request.actor,
    reason: request.reason,
    content: stableJson(request.value)
  });
}

async function writeTextArtifact(request: {
  readonly workspacePath: string;
  readonly path: string;
  readonly actor: string;
  readonly reason: string;
  readonly content: string;
}): Promise<WorkflowWriteSummary> {
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.path,
    content: request.content,
    actor: request.actor,
    reason: request.reason
  });
  return {
    path: write.path,
    hash: write.hash,
    bytes: write.bytes,
    auditPath: write.auditPath
  };
}

function artifactFromWrite(
  stage: WorkflowStageId,
  name: string,
  write: { readonly path: string; readonly hash: string },
  artifactKind: string
): WorkflowArtifactItem {
  return { stage, name, path: write.path, hash: write.hash, artifactKind };
}

async function createAndRunWorkflowAgentTask(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly jobId: string;
  readonly stage: WorkflowStageId;
  readonly title: string;
  readonly instruction: string;
  readonly input: Record<string, unknown>;
  readonly contextPackPath?: string | undefined;
  readonly allowedCommands: readonly string[];
}): Promise<AgentTaskEvidence> {
  const taskId = `workflow-${request.jobId}-${request.stage}`;
  const result = await createAgentTask({
    workspacePath: request.workspacePath,
    actor: request.actor,
    taskId,
    title: request.title,
    instruction: [
      request.instruction,
      "",
      "Evidence requirement: this workflow stage is not semantically complete until this task result.json is updated to status completed by agent run --runtime pi."
    ].join("\n"),
    inputJson: stableJson({
      kind: "novelfabric.workflow.agent-task.input",
      version: 1,
      jobId: request.jobId,
      stage: request.stage,
      ...request.input
    }),
    ...(request.contextPackPath === undefined ? {} : { contextPackPath: request.contextPackPath }),
    allowedCommands: request.allowedCommands,
    outputSchemaJson: stableJson({
      type: "object",
      required: ["kind", "version", "citations", "summary"],
      properties: {
        kind: { type: "string" },
        version: { type: "number" },
        summary: { type: "string" },
        citations: { type: "array", items: { type: "string" } }
      }
    }),
    reason: `workflow ${request.stage} agent task create`
  });
  const resultWrite = result.writes.find((write) => write.path === result.files.result);
  if (resultWrite === undefined) {
    throw new CommandFailure(
      "workflow_agent_task_result_missing",
      `Agent task '${taskId}' did not produce a result evidence file.`
    );
  }
  await runAgentTask({
    workspacePath: request.workspacePath,
    actor: request.actor,
    task: result.taskId,
    runtime: "pi",
    reason: `workflow ${request.stage} agent task run`
  });

  return {
    taskId: result.taskId,
    packagePath: result.packagePath,
    resultPath: result.files.result,
    resultWrite
  };
}

function agentTaskEvidenceArtifact(
  stage: WorkflowStageId,
  evidence: AgentTaskEvidence
): WorkflowArtifactItem {
  return {
    stage,
    name: "agent-task-result",
    path: evidence.resultPath,
    artifactKind: "novelfabric.agent.task.result"
  };
}

function agentTaskOutput(evidence: AgentTaskEvidence): Record<string, string> {
  return {
    taskId: evidence.taskId,
    packagePath: evidence.packagePath,
    resultPath: evidence.resultPath,
    requiredStatus: "completed"
  };
}

async function verifyPiTaskEvidence(request: {
  readonly workspacePath: string;
  readonly artifacts: WorkflowArtifactsArtifact;
  readonly stage: WorkflowStageId;
}): Promise<WorkflowVerifyIssue | null> {
  const evidence = request.artifacts.items.find(
    (item) =>
      item.stage === request.stage &&
      item.name === "agent-task-result" &&
      item.artifactKind === "novelfabric.agent.task.result"
  );
  if (evidence === undefined) {
    return {
      severity: "error",
      code: "workflow_pi_task_evidence_missing",
      path: request.stage,
      message: `Workflow pi-task stage '${request.stage}' completed without an agent task result evidence artifact.`
    };
  }
  try {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: evidence.path
    });
    const parsed = parseJson(read.content, read.path);
    if (!isAgentTaskResult(parsed)) {
      return {
        severity: "error",
        code: "workflow_pi_task_result_invalid",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' result evidence has an invalid shape.`
      };
    }
    if (!isExecutedAgentTaskStatus(parsed.status)) {
      return {
        severity: "error",
        code: "workflow_pi_task_unexecuted",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' requires executed result status, found ${parsed.status}.`
      };
    }
    if (!hasRuntimeEvidence(parsed)) {
      return {
        severity: "error",
        code: "workflow_pi_task_runtime_evidence_missing",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' result evidence must include runtimeEvidence.`
      };
    }
    if (!hasNonEmptyAgentOutput(parsed)) {
      return {
        severity: "error",
        code: "workflow_pi_task_output_missing",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' result evidence must include non-empty pi output.`
      };
    }
    const taskValidation = await validateAgentOutput({
      workspacePath: request.workspacePath,
      task: parsed.taskId
    });
    if (!taskValidation.valid) {
      return {
        severity: "error",
        code: "workflow_pi_task_output_invalid",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' agent output failed validation: ${taskValidation.issues
          .map((issue) => issue.message)
          .join("; ")}`
      };
    }
    return null;
  } catch (error) {
    return {
      severity: "error",
      code: "workflow_pi_task_result_unreadable",
      path: evidence.path,
      message:
        error instanceof Error ? error.message : `Cannot read pi task evidence '${evidence.path}'.`
    };
  }
}

function requiredArtifactPath(
  artifacts: WorkflowArtifactsArtifact,
  stage: WorkflowStageId,
  name: string
): string {
  const pathValue = optionalArtifactPath(artifacts, stage, name);
  if (pathValue !== undefined) return pathValue;
  throw new CommandFailure(
    "workflow_artifact_missing",
    `Workflow stage '${stage}' artifact '${name}' is required before continuing.`
  );
}

function optionalArtifactPath(
  artifacts: WorkflowArtifactsArtifact,
  stage: WorkflowStageId,
  name: string
): string | undefined {
  return artifacts.items.find((item) => item.stage === stage && item.name === name)?.path;
}

function assertMutableState(state: WorkflowStateArtifact): void {
  if (state.status === "cancelled" || state.status === "completed") {
    throw new CommandFailure("workflow_not_mutable", `Workflow job is ${state.status}.`);
  }
  if (state.status === "failed") {
    throw new CommandFailure("workflow_failed", "Retry or resume the workflow before stepping.");
  }
}

function assertStepInputMatchesStage(input: unknown, stage: WorkflowStageId): void {
  if (input === undefined) return;
  if (!isRecord(input)) return;
  const requestedStage = input["stage"];
  if (requestedStage === undefined) return;
  if (typeof requestedStage !== "string") {
    throw new CommandFailure("invalid_request", "Step input stage must be a string when present.");
  }
  if (requestedStage !== stage) {
    throw new CommandFailure(
      "workflow_stage_mismatch",
      `Step input requested stage '${requestedStage}', but next stage is '${stage}'.`
    );
  }
}

function traceLine(entry: WorkflowTraceEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

function makeWorkflowId(prefix: string, seed: string): string {
  return `${prefix}-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${shortHash(seed)}`;
}

function shortHash(content: string): string {
  return contentHash(content).slice("sha256:".length, "sha256:".length + 12);
}

function assertSafeWorkflowId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new CommandFailure(
      "invalid_workflow_id",
      `${label} id '${value}' must contain only letters, numbers, dots, underscores, or hyphens.`
    );
  }
}

function normalizeNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CommandFailure("invalid_workflow_input", `${label} must not be empty.`);
  }
  return trimmed;
}

function objectFromResult(result: unknown): Record<string, unknown> {
  if (isRecord(result)) return result;
  return { value: result };
}

function parseJson(content: string, artifactPath: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_artifact",
      `Artifact '${artifactPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function commandFailureFromUnknown(error: unknown, fallbackCode: string): CommandFailure {
  if (error instanceof CommandFailure) return error;
  return new CommandFailure(
    fallbackCode,
    error instanceof Error ? error.message : "Workflow stage failed."
  );
}

function isWorkflowPlan(value: unknown): value is WorkflowPlanArtifact {
  return (
    isRecord(value) &&
    value["kind"] === WORKFLOW_PLAN_KIND &&
    value["version"] === WORKFLOW_VERSION &&
    typeof value["planId"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["role"] === "string" &&
    Array.isArray(value["stages"]) &&
    value["stages"].every(isWorkflowStageDefinition)
  );
}

function isWorkflowJob(value: unknown): value is WorkflowJobArtifact {
  return (
    isRecord(value) &&
    value["kind"] === WORKFLOW_JOB_KIND &&
    value["version"] === WORKFLOW_VERSION &&
    typeof value["jobId"] === "string" &&
    typeof value["planId"] === "string" &&
    typeof value["actor"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["role"] === "string"
  );
}

function isWorkflowState(value: unknown): value is WorkflowStateArtifact {
  return (
    isRecord(value) &&
    value["kind"] === WORKFLOW_STATE_KIND &&
    value["version"] === WORKFLOW_VERSION &&
    typeof value["jobId"] === "string" &&
    isWorkflowStatus(value["status"]) &&
    typeof value["nextStageIndex"] === "number" &&
    Number.isInteger(value["nextStageIndex"]) &&
    value["nextStageIndex"] >= 0 &&
    Array.isArray(value["completedStages"]) &&
    value["completedStages"].every(isCompletedStage) &&
    (value["failedStage"] === null || isFailedStage(value["failedStage"]))
  );
}

function isWorkflowArtifacts(value: unknown): value is WorkflowArtifactsArtifact {
  return (
    isRecord(value) &&
    value["kind"] === WORKFLOW_ARTIFACTS_KIND &&
    value["version"] === WORKFLOW_VERSION &&
    typeof value["jobId"] === "string" &&
    Array.isArray(value["items"]) &&
    value["items"].every(isWorkflowArtifactItem)
  );
}

function isWorkflowStageDefinition(value: unknown): value is WorkflowStageDefinition {
  return (
    isRecord(value) &&
    isWorkflowStageId(value["id"]) &&
    typeof value["command"] === "string" &&
    typeof value["family"] === "string" &&
    typeof value["description"] === "string" &&
    (value["semanticRuntime"] === "none" || value["semanticRuntime"] === "pi-task")
  );
}

function isCompletedStage(value: unknown): value is WorkflowCompletedStage {
  return (
    isRecord(value) && isWorkflowStageId(value["stage"]) && typeof value["completedAt"] === "string"
  );
}

function isFailedStage(value: unknown): value is WorkflowFailedStage {
  return (
    isRecord(value) &&
    isWorkflowStageId(value["stage"]) &&
    typeof value["failedAt"] === "string" &&
    typeof value["code"] === "string" &&
    typeof value["message"] === "string"
  );
}

function isWorkflowArtifactItem(value: unknown): value is WorkflowArtifactItem {
  return (
    isRecord(value) &&
    isWorkflowStageId(value["stage"]) &&
    typeof value["name"] === "string" &&
    typeof value["path"] === "string" &&
    (value["hash"] === undefined || typeof value["hash"] === "string") &&
    typeof value["artifactKind"] === "string"
  );
}

function isAgentTaskResult(value: unknown): value is Record<string, unknown> & {
  readonly taskId: string;
  readonly status: string;
} {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.agent.task.result" &&
    typeof value["taskId"] === "string" &&
    typeof value["status"] === "string"
  );
}

function hasRuntimeEvidence(value: Record<string, unknown>): boolean {
  const evidence = value["runtimeEvidence"];
  return (
    isRecord(evidence) &&
    typeof evidence["provider"] === "string" &&
    typeof evidence["model"] === "string" &&
    typeof evidence["runtimeRoot"] === "string"
  );
}

function hasNonEmptyAgentOutput(value: Record<string, unknown>): boolean {
  const output = value["output"];
  return (
    isRecord(output) && typeof output["rawText"] === "string" && output["rawText"].trim().length > 0
  );
}

function isExecutedAgentTaskStatus(value: string): boolean {
  return value === "completed";
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return (
    value === "planned" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isWorkflowStageId(value: unknown): value is WorkflowStageId {
  return WORKFLOW_STAGES.some((stage) => stage.id === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
