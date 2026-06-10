import type { JsonObject } from "../output.js";
import { CommandFailure } from "../errors.js";
import { createAgentTask, runAgentTask, validateAgentOutput } from "../agent-runtime/tasks.js";
import { applyCardProposal, proposeCards } from "../cards/proposals.js";
import {
  createSemanticImportTask,
  materializeSemanticImportFromAgentTask,
  validateSemanticImportArtifact
} from "../import/semantic.js";
import {
  buildImportContextPack,
  normalizeImportSource
} from "../import/source.js";
import type { ImportContextPack } from "../import/source.js";
import type {
  KnowledgeCitation,
  KnowledgeSource,
  KnowledgeSourceKind,
  NovelFabricContextPack
} from "../knowledge/index.js";
import { buildContextPack, rebuildKnowledgeIndex } from "../knowledge/index.js";
import {
  createReportTask,
  materializeReportArtifactFromAgentTask,
  validateReportArtifact
} from "../report/index.js";
import {
  DEFAULT_SWARM_ROUND_ORDER,
  buildSimulationContextPack,
  createSimulationSession,
  roundDirectoryPath,
  safePathSegment,
  stableJson
} from "../simulation/index.js";
import {
  applySwarmOutput,
  createSwarmTask,
  materializeSwarmOutputFromAgentTask,
  planSwarmRound,
  validateSwarmOutput
} from "../swarm/index.js";
import {
  applyWritingDraft,
  buildWritingContextPack,
  createWritingDraftTask,
  materializeWritingDraftFromAgentTask,
  reviewChapter,
  validateWritingDraftArtifact
} from "../writing/index.js";
import {
  appendWorkspaceFile,
  contentHash,
  readWorkspaceFile,
  writeWorkspaceFile
} from "../workspace/files.js";

export type WorkflowStatus = "planned" | "running" | "completed" | "failed" | "cancelled";

export type WorkflowStageId =
  | "import.normalize"
  | "import.context-pack"
  | "import.semantic"
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
  | "writing.draft"
  | "writing.apply"
  | "writing.review";

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

type WorkflowDomainArtifactSpec = {
  readonly name: string;
  readonly kind: string;
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
  readonly completedStages: readonly WorkflowStageId[];
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
    id: "import.context-pack",
    command: "novelfabric import context-pack",
    family: "import",
    description: "Build an import context pack for later agent work.",
    semanticRuntime: "none"
  },
  {
    id: "import.semantic",
    command: "novelfabric import semantic",
    family: "import",
    description:
      "Run pi-backed semantic import extraction for downstream cards and workflow stages.",
    semanticRuntime: "pi-task"
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
  },
  {
    id: "writing.apply",
    command: "novelfabric writing apply-draft",
    family: "writing",
    description: "Apply the validated draft to canonical writing/chapters.",
    semanticRuntime: "none"
  },
  {
    id: "writing.review",
    command: "novelfabric writing review",
    family: "writing",
    description: "Review the canonical chapter after apply.",
    semanticRuntime: "none"
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
  const missingCompletionIssues = missingCompletedStageIssues(
    runtime.plan,
    runtime.state,
    jobPaths(runtime.job.jobId).statePath
  );
  if (missingCompletionIssues.length > 0) {
    const firstIssue = missingCompletionIssues[0];
    throw new CommandFailure(
      firstIssue?.code ?? "workflow_stage_completion_missing",
      firstIssue?.message ?? "Workflow state is missing completed stage records."
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
      if (
        !isMutableWorkflowArtifact(item.artifactKind, item.path) &&
        item.hash !== undefined &&
        read.hash !== item.hash
      ) {
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
  const expectedCompletedStages = runtime.plan.stages.slice(0, runtime.state.nextStageIndex);
  issues.push(...missingCompletedStageIssues(runtime.plan, runtime.state, paths.statePath));
  for (const stage of expectedCompletedStages) {
    if (stage.semanticRuntime !== "pi-task") continue;
    const piTaskIssue = await verifyPiTaskEvidence({
      workspacePath: request.workspacePath,
      artifacts: runtime.artifacts,
      jobId: runtime.job.jobId,
      stage: stage.id
    });
    if (piTaskIssue !== null) issues.push(piTaskIssue);
    const domainArtifactIssue = await verifyDomainArtifactEvidence({
      workspacePath: request.workspacePath,
      artifacts: runtime.artifacts,
      jobId: runtime.job.jobId,
      stage: stage.id
    });
    if (domainArtifactIssue !== null) issues.push(domainArtifactIssue);
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

function isMutableWorkflowArtifact(artifactKind: string, path: string): boolean {
  return (
    (artifactKind === "novelfabric.simulation.session" &&
      path.startsWith("simulation/sessions/")) ||
    (artifactKind === "novelfabric.simulation.log" && path.startsWith("simulation/logs/"))
  );
}

function missingCompletedStageIssues(
  plan: WorkflowPlanArtifact,
  state: WorkflowStateArtifact,
  statePath: string
): readonly WorkflowVerifyIssue[] {
  const issues: WorkflowVerifyIssue[] = [];
  const completedStageIds = new Set<WorkflowStageId>();
  const stageIndexById = new Map(plan.stages.map((stage, index) => [stage.id, index]));
  for (const completedStage of state.completedStages) {
    if (completedStageIds.has(completedStage.stage)) {
      issues.push({
        severity: "error",
        code: "workflow_stage_completion_duplicate",
        path: statePath,
        message: `Workflow completedStages contains duplicate stage '${completedStage.stage}'.`
      });
    }
    completedStageIds.add(completedStage.stage);
    const completedIndex = stageIndexById.get(completedStage.stage);
    if (completedIndex === undefined) {
      issues.push({
        severity: "error",
        code: "workflow_stage_completion_unknown",
        path: statePath,
        message: `Workflow completedStages contains unknown stage '${completedStage.stage}'.`
      });
      continue;
    }
    if (completedIndex >= state.nextStageIndex) {
      issues.push({
        severity: "error",
        code: "workflow_stage_completion_ahead",
        path: statePath,
        message: `Workflow completedStages contains '${completedStage.stage}' beyond nextStageIndex.`
      });
    }
  }
  issues.push(
    ...plan.stages
      .slice(0, state.nextStageIndex)
      .filter((stage) => !completedStageIds.has(stage.id))
      .map((stage) => ({
        severity: "error" as const,
        code: "workflow_stage_completion_missing",
        path: statePath,
        message: `Workflow state advanced past '${stage.id}' without recording it in completedStages.`
      }))
  );
  return issues;
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
    completedStages: runtime.state.completedStages.map((completed) => completed.stage),
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
    case "import.context-pack": {
      const normalizedPath = requiredArtifactPath(
        request.artifacts,
        "import.normalize",
        "normalized-source"
      );
      const result = await buildImportContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        sourcePath: normalizedPath,
        outputPath: `simulation/context-packs/import-${sessionId}.json`,
        reason: "workflow import.context-pack"
      });
      const canonicalWrite = await writeCanonicalImportContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        importContextPackPath: result.write.path,
        sessionId,
        roleAgent,
        reason: "workflow canonical import context-pack"
      });
      return {
        output: { ...objectFromResult(result), canonicalContextPackPath: canonicalWrite.path },
        artifacts: [
          artifactFromWrite(
            request.stage,
            "import-context-pack",
            result.write,
            "novelfabric.import.context-pack"
          ),
          artifactFromWrite(
            request.stage,
            "context-pack",
            canonicalWrite,
            "novelfabric.context-pack"
          )
        ]
      };
    }
    case "import.semantic": {
      const contextPackPath = requiredArtifactPath(
        request.artifacts,
        "import.context-pack",
        "import-context-pack"
      );
      const task = await createSemanticImportTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        taskId: `workflow-${sessionId}-${request.stage}`,
        contextPackPath,
        sourcePath: request.plan.sourcePath,
        reason: "workflow import.semantic task create"
      });
      const run = await runAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        task: task.taskId,
        runtime: "pi",
        reason: "workflow import.semantic task run"
      });
      const resultWrite = run.writes.find((write) => write.path === task.files.result);
      if (resultWrite === undefined) {
        throw new CommandFailure(
          "workflow_agent_task_result_missing",
          `Semantic import task '${task.taskId}' did not produce a completed result evidence file.`
        );
      }
      const semantic = await materializeSemanticImportFromAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        taskId: task.taskId,
        contextPackPath,
        sourcePath: request.plan.sourcePath,
        outputPath: `imports/semantic/${sessionId}.json`,
        reason: "workflow import.semantic materialize"
      });
      const agentTask: AgentTaskEvidence = {
        taskId: task.taskId,
        packagePath: task.packagePath,
        resultPath: task.files.result,
        resultWrite
      };
      return {
        output: { ...objectFromResult(semantic), agentTaskEvidence: agentTaskOutput(agentTask) },
        artifacts: [
          agentTaskEvidenceArtifact(request.stage, agentTask),
          artifactFromWrite(
            request.stage,
            "semantic-import",
            semantic.write,
            workflowDomainArtifactDefinition(request.stage).kind
          )
        ]
      };
    }
    case "cards.propose": {
      const contextPackPath = requiredArtifactPath(
        request.artifacts,
        "import.context-pack",
        "context-pack"
      );
      const result = await proposeCards({
        workspacePath: request.workspacePath,
        actor: request.actor,
        contextPackPath,
        citations: [request.plan.sourcePath],
        outputPath: `proposals/cards/${sessionId}-proposal.json`,
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
        sourcePath: request.plan.sourcePath,
        timeline: "main",
        reason: "workflow simulation.session.create"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          {
            stage: request.stage,
            name: "simulation-session",
            path: result.write.path,
            artifactKind: "novelfabric.simulation.session"
          }
        ]
      };
    }
    case "simulation.context-pack": {
      const semanticImportPath = requiredArtifactPath(
        request.artifacts,
        "import.semantic",
        "semantic-import"
      );
      const semanticImportRead = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: semanticImportPath
      });
      const semanticImport = parseJson(semanticImportRead.content, semanticImportPath);
      const relevantEntities = semanticImportSourceAnchors(semanticImport, semanticImportPath);
      const result = await buildSimulationContextPack({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        agent: roleAgent,
        relevantEntities,
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
      const swarmContextPackPath = requiredArtifactPath(
        request.artifacts,
        "simulation.context-pack",
        "simulation-context-pack"
      );
      const artifacts: WorkflowArtifactItem[] = [];
      const outputs: Record<string, unknown>[] = [];
      const primaryAgent = roleAgent;
      for (const [index, stageAgent] of DEFAULT_SWARM_ROUND_ORDER.entries()) {
        const agent = index === 0 ? primaryAgent : stageAgent;
        const result = await createSwarmTask({
          workspacePath: request.workspacePath,
          actor: request.actor,
          session: sessionId,
          round: 1,
          agent,
          reason: `workflow swarm.task.create ${agent}`
        });
        const agentTask = await createAndRunWorkflowAgentTask({
          workspacePath: request.workspacePath,
          actor: request.actor,
          jobId: sessionId,
          stage: request.stage,
          ...(index === 0 ? {} : { taskIdSuffix: safePathSegment(agent) }),
          title: `StorySwarm ${stageAgent} task for ${agent}`,
          instruction:
            "Run the StorySwarm role reasoning through the NovelFabric-wrapped pi runtime, then write and validate the swarm output proposal.",
          input: {
            stage: request.stage,
            session: sessionId,
            agent,
            roundStage: stageAgent,
            taskPath: result.taskPath,
            expectedOutputPath: result.proposalPath
          },
          contextPackPath: swarmContextPackPath,
          allowedCommands: [
            "novelfabric files read",
            "novelfabric files write",
            "novelfabric swarm output validate",
            "novelfabric swarm output apply"
          ]
        });
        const swarmOutputArtifact = await materializeWorkflowDomainArtifact({
          workspacePath: request.workspacePath,
          actor: request.actor,
          stage: request.stage,
          jobId: sessionId,
          taskId: agentTask.taskId,
          session: sessionId,
          round: 1,
          agent,
          outputPath: `${roundDirectoryPath(sessionId, 1)}/proposals/${safePathSegment(stageAgent)}-${safePathSegment(agent)}-materialized.json`
        });
        const appliedTurn = await applySwarmOutput({
          workspacePath: request.workspacePath,
          actor: request.actor,
          artifactPath: swarmOutputArtifact.path,
          reason: `workflow swarm output apply ${agent}`
        });
        const simulationLog = await writeWorkflowSimulationLog({
          workspacePath: request.workspacePath,
          actor: request.actor,
          sessionId,
          turnPath: appliedTurn.turnPath,
          turnHash: appliedTurn.turnWrite.hash,
          summary: appliedTurn.turn.summary,
          reason: `workflow simulation log ${agent}`
        });
        outputs.push({
          agent,
          roundStage: stageAgent,
          taskPath: result.taskPath,
          proposalPath: result.proposalPath,
          turnPath: appliedTurn.turnPath,
          logPath: simulationLog.path,
          agentTaskEvidence: agentTaskOutput(agentTask)
        });
        artifacts.push(
          artifactFromWrite(
            request.stage,
            `swarm-task-${safePathSegment(agent)}`,
            result.taskWrite,
            "novelfabric.swarm.task"
          ),
          artifactFromWrite(
            request.stage,
            `swarm-output-template-${safePathSegment(agent)}`,
            result.proposalWrite,
            "novelfabric.swarm.output"
          ),
          agentTaskEvidenceArtifact(request.stage, agentTask),
          swarmOutputArtifact,
          artifactFromWrite(
            request.stage,
            `simulation-turn-${safePathSegment(agent)}`,
            appliedTurn.turnWrite,
            "novelfabric.simulation.turn"
          ),
          {
            stage: request.stage,
            name: `simulation-session-${safePathSegment(agent)}`,
            path: appliedTurn.sessionWrite.path,
            artifactKind: "novelfabric.simulation.session"
          },
          artifactFromWrite(
            request.stage,
            `simulation-log-${safePathSegment(agent)}`,
            simulationLog,
            "novelfabric.simulation.log"
          )
        );
      }
      return {
        output: {
          sessionId,
          round: 1,
          turnCount: outputs.length,
          outputs
        },
        artifacts
      };
    }
    case "report.task.create": {
      const contextPackPath = requiredArtifactPath(
        request.artifacts,
        "simulation.context-pack",
        "simulation-context-pack"
      );
      const result = await createReportTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        session: sessionId,
        kind: "consistency",
        contextPackPath,
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
        contextPackPath,
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
          agentTaskEvidenceArtifact(request.stage, agentTask),
          await materializeWorkflowDomainArtifact({
            workspacePath: request.workspacePath,
            actor: request.actor,
            stage: request.stage,
            jobId: sessionId,
            taskId: agentTask.taskId,
            session: sessionId,
            outputPath: result.reportPath
          })
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
          agentTaskEvidenceArtifact(request.stage, agentTask),
          await materializeWorkflowDomainArtifact({
            workspacePath: request.workspacePath,
            actor: request.actor,
            stage: request.stage,
            jobId: sessionId,
            taskId: agentTask.taskId,
            outputPath: result.expectedDraftPath
          })
        ]
      };
    }
    case "writing.apply": {
      const draftPath = requiredArtifactPath(request.artifacts, "writing.draft", "writing-draft");
      const result = await applyWritingDraft({
        workspacePath: request.workspacePath,
        actor: request.actor,
        draftPath,
        outputPath: `writing/chapters/${sessionId}.md`,
        reason: "workflow writing.apply"
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(request.stage, "writing-chapter", result.write, "text/markdown")
        ]
      };
    }
    case "writing.review": {
      const chapterPath = requiredArtifactPath(
        request.artifacts,
        "writing.apply",
        "writing-chapter"
      );
      const result = await reviewChapter({
        workspacePath: request.workspacePath,
        chapterPath
      });
      const write = await writeJsonArtifact({
        workspacePath: request.workspacePath,
        path: `writing/review-notes/${sessionId}.json`,
        actor: request.actor,
        reason: "workflow writing.review",
        value: result
      });
      return {
        output: objectFromResult(result),
        artifacts: [
          artifactFromWrite(request.stage, "writing-review", write, "novelfabric.writing.review")
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

async function writeCanonicalImportContextPack(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly importContextPackPath: string;
  readonly sessionId: string;
  readonly roleAgent: string;
  readonly reason: string;
}): Promise<WorkflowWriteSummary> {
  const importPackRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.importContextPackPath
  });
  const importPack = parseJson(importPackRead.content, importPackRead.path);
  if (!isImportContextPack(importPack)) {
    throw new CommandFailure(
      "workflow_import_context_pack_invalid",
      `Import context pack '${importPackRead.path}' has an invalid shape.`
    );
  }

  const sourceRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: importPack.sourcePath
  });
  if (sourceRead.hash !== importPack.sourceHash) {
    throw new CommandFailure(
      "workflow_import_context_source_hash_mismatch",
      `Import context pack '${importPackRead.path}' cites source '${sourceRead.path}' with stale hash.`
    );
  }
  const excerpt =
    importPack.sourceExcerpt.trim().length > 0
      ? importPack.sourceExcerpt
      : sourceRead.content.slice(0, 2000);
  const citation: KnowledgeCitation = {
    sourcePath: sourceRead.path,
    hash: sourceRead.hash,
    lineRange: { start: 1, end: Math.max(1, excerpt.split(/\r?\n/u).length) },
    excerpt
  };
  const source: KnowledgeSource = {
    path: sourceRead.path,
    kind: knowledgeSourceKindForPath(sourceRead.path),
    title: sourceRead.path.split("/").at(-1) ?? sourceRead.path,
    hash: sourceRead.hash,
    bytes: sourceRead.bytes,
    lineCount: Math.max(1, sourceRead.content.split(/\r?\n/u).length),
    protected: sourceRead.protected
  };
  const canonicalPack: NovelFabricContextPack = {
    kind: "novelfabric.context-pack",
    version: 1,
    packKind: "import-source",
    query: `Import source '${sourceRead.path}' for ${request.roleAgent}`,
    agent: request.roleAgent,
    session: request.sessionId,
    timeline: null,
    citations: [citation],
    recall: {
      quick: [],
      panorama: [],
      insight: []
    },
    sources: [source]
  };

  return writeTextArtifact({
    workspacePath: request.workspacePath,
    path: `simulation/context-packs/${request.sessionId}.json`,
    actor: request.actor,
    reason: request.reason,
    content: stableJson(canonicalPack)
  });
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
  readonly taskIdSuffix?: string;
}): Promise<AgentTaskEvidence> {
  const taskId = `workflow-${request.jobId}-${request.stage}${request.taskIdSuffix === undefined ? "" : `-${request.taskIdSuffix}`}`;
  if (request.contextPackPath === undefined) {
    throw new CommandFailure(
      "workflow_context_pack_required",
      "Workflow pi-task stages require a context pack before agent execution."
    );
  }
  const contextPackPath = request.contextPackPath;
  const requiredSourceAnchors = await deriveRequiredSourceAnchors(
    request.workspacePath,
    contextPackPath
  );
  const result = await createAgentTask({
    workspacePath: request.workspacePath,
    actor: request.actor,
    taskId,
    title: request.title,
    instruction: [
      request.instruction,
      "",
      `Output requirement: return exactly one valid JSON object with kind '${workflowOutputKindForStage(request.stage)}', version 1, summary, citations, sourceAnchors, requiredAnchor, and all domain fields required by OUTPUT_SCHEMA_JSON.`,
      `Source anchor requirement: sourceAnchors must contain every requiredSourceAnchors item exactly as written. Do not summarize, translate, shorten, or invent sourceAnchors. Required anchors: ${requiredSourceAnchors.join(", ")}.`,
      `Citation requirement: citations must include the exact workspace path '${contextPackPath}'.`,
      workflowDomainInstructionForStage(request.stage, contextPackPath, requiredSourceAnchors),
      "Set requiredAnchor to the first requiredSourceAnchors phrase exactly as written so verification can prove workflow data reached the model.",
      "Evidence requirement: this workflow stage is not semantically complete until this task result.json is updated to status completed by agent run --runtime pi."
    ].join("\n"),
    inputJson: stableJson({
      kind: "novelfabric.workflow.agent-task.input",
      version: 1,
      jobId: request.jobId,
      stage: request.stage,
      ...request.input,
      requiredSourceAnchors
    }),
    contextPackPath,
    allowedCommands: request.allowedCommands,
    outputSchemaJson: stableJson(
      workflowAgentOutputSchema(request.stage, requiredSourceAnchors, contextPackPath)
    ),
    reason: `workflow ${request.stage} agent task create`
  });
  const run = await runAgentTask({
    workspacePath: request.workspacePath,
    actor: request.actor,
    task: result.taskId,
    runtime: "pi",
    reason: `workflow ${request.stage} agent task run`
  });
  const resultWrite = run.writes.find((write) => write.path === result.files.result);
  if (resultWrite === undefined) {
    throw new CommandFailure(
      "workflow_agent_task_result_missing",
      `Agent task '${taskId}' did not produce a completed result evidence file.`
    );
  }

  return {
    taskId: result.taskId,
    packagePath: result.packagePath,
    resultPath: result.files.result,
    resultWrite
  };
}

function semanticImportSourceAnchors(
  value: unknown,
  artifactPath: string
): readonly string[] {
  if (!isRecord(value)) {
    throw new CommandFailure(
      "workflow_semantic_import_invalid",
      `Semantic import artifact '${artifactPath}' must be a JSON object.`
    );
  }
  const sourceAnchors = value["sourceAnchors"];
  if (!Array.isArray(sourceAnchors)) {
    throw new CommandFailure(
      "workflow_semantic_import_invalid",
      `Semantic import artifact '${artifactPath}' must include a sourceAnchors array.`
    );
  }
  const anchors = sourceAnchors
    .filter((item): item is string => typeof item === "string" && item.trim().length >= 2)
    .map((item) => item.trim());
  if (anchors.length === 0) {
    throw new CommandFailure(
      "workflow_semantic_import_invalid",
      `Semantic import artifact '${artifactPath}' must include non-empty sourceAnchors.`
    );
  }
  return anchors;
}

async function deriveRequiredSourceAnchors(
  workspacePath: string,
  contextPackPath: string | undefined
): Promise<readonly string[]> {
  if (contextPackPath === undefined) {
    throw new CommandFailure(
      "workflow_context_pack_required",
      "Workflow pi-task stages require a context pack before agent execution."
    );
  }
  const read = await readWorkspaceFile({ workspacePath, path: contextPackPath });
  const parsed = parseJson(read.content, contextPackPath);
  if (!isRecord(parsed)) {
    throw new CommandFailure(
      "workflow_context_pack_invalid",
      `Context pack '${contextPackPath}' must be a JSON object.`
    );
  }
  const entities = parsed["relevantEntities"];
  if (Array.isArray(entities)) {
    const anchors = entities
      .filter((item): item is string => typeof item === "string" && item.trim().length >= 2)
      .map((item) => item.trim());
    if (anchors.length > 0) return anchors;
  }
  const sourceAnchors = parsed["sourceAnchors"];
  if (Array.isArray(sourceAnchors)) {
    const anchors = sourceAnchors
      .filter((item): item is string => typeof item === "string" && item.trim().length >= 2)
      .map((item) => item.trim());
    if (anchors.length > 0) return anchors;
  }
  throw new CommandFailure(
    "workflow_context_pack_anchors_missing",
    `Context pack '${contextPackPath}' must provide explicit relevantEntities or sourceAnchors.`
  );
}

function workflowAgentOutputSchema(
  stage: WorkflowStageId,
  requiredSourceAnchors: readonly string[],
  requiredCitationPath: string | undefined
): JsonObject {
  const firstAnchor = requiredSourceAnchors[0];
  const sourceAnchorSchema: JsonObject = {
    type: "array",
    minItems: requiredSourceAnchors.length,
    containsAllText: requiredSourceAnchors,
    containsOnlyText: requiredSourceAnchors,
    items: { type: "string", minLength: 2 }
  };
  const requiredAnchorSchema: JsonObject = {
    type: "string",
    minLength: 2,
    ...(firstAnchor === undefined ? {} : { containsText: firstAnchor })
  };
  const stageSpecific = workflowOutputStageSchema(stage);
  const citationsSchema: JsonObject = {
    type: "array",
    minItems: 1,
    ...(requiredCitationPath === undefined ? {} : { containsText: requiredCitationPath }),
    items: { type: "string", minLength: 1 }
  };
  return {
    type: "object",
    required: [
      "kind",
      "version",
      "citations",
      "summary",
      "sourceAnchors",
      "requiredAnchor",
      ...stageSpecific.requiredFields
    ],
    properties: {
      kind: { type: "string", containsText: stageSpecific.kind },
      version: { type: "number" },
      summary: { type: "string", minLength: 24 },
      citations: citationsSchema,
      sourceAnchors: sourceAnchorSchema,
      requiredAnchor: requiredAnchorSchema,
      ...stageSpecific.properties
    }
  };
}

function workflowOutputKindForStage(stage: WorkflowStageId): string {
  switch (stage) {
    case "swarm.task.create":
      return "novelfabric.workflow.swarm-output";
    case "report.task.create":
      return "novelfabric.workflow.report-output";
    case "writing.draft":
      return "novelfabric.workflow.writing-output";
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${stage}' does not have a domain output kind.`
      );
  }
}

function workflowOutputStageSchema(stage: WorkflowStageId): {
  readonly kind: string;
  readonly requiredFields: readonly string[];
  readonly properties: JsonObject;
} {
  const markdownSchema: JsonObject = { type: "string", minLength: 24 };
  const actionTextSchema: JsonObject = { type: "string", minLength: 24 };
  switch (stage) {
    case "swarm.task.create":
      return {
        kind: workflowOutputKindForStage(stage),
        requiredFields: ["actionText"],
        properties: { actionText: actionTextSchema }
      };
    case "report.task.create":
      return {
        kind: workflowOutputKindForStage(stage),
        requiredFields: ["markdown"],
        properties: { markdown: markdownSchema }
      };
    case "writing.draft":
      return {
        kind: workflowOutputKindForStage(stage),
        requiredFields: ["markdown"],
        properties: { title: { type: "string", minLength: 2 }, markdown: markdownSchema }
      };
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${stage}' does not have a domain output schema.`
      );
  }
}

function workflowDomainInstructionForStage(
  stage: WorkflowStageId,
  contextPackPath: string,
  requiredSourceAnchors: readonly string[]
): string {
  const anchorsList = requiredSourceAnchors.map((anchor) => `- ${anchor}`).join("\n");
  switch (stage) {
    case "swarm.task.create":
      return [
        "Domain output requirement: include actionText with the StorySwarm proposed action text.",
        "actionText must be grounded in the required source anchors."
      ].join("\n");
    case "report.task.create":
      return [
        "Domain output requirement: produce a ReportAgent JSON object for novelfabric.workflow.report-output.",
        "Required exact fields: kind='novelfabric.workflow.report-output', version=1, summary, citations, sourceAnchors, requiredAnchor, markdown.",
        `citations must include exactly this context pack path: ${contextPackPath}`,
        "sourceAnchors must include every required source anchor exactly as listed here:",
        anchorsList,
        "markdown must be a substantive citation-backed report body of at least 24 characters and must reference the cited context/source facts.",
        "Do not return a novelfabric.report.artifact object; return the workflow report-output object required by OUTPUT_SCHEMA_JSON."
      ].join("\n");
    case "writing.draft":
      return [
        "Domain output requirement: include title and markdown for the writing draft.",
        "markdown must be grounded in sourceAnchors and citations."
      ].join("\n");
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${stage}' does not require domain materialization.`
      );
  }
}

async function materializeWorkflowDomainArtifact(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly stage: WorkflowStageId;
  readonly jobId: string;
  readonly taskId: string;
  readonly session?: string;
  readonly round?: number;
  readonly agent?: string;
  readonly outputPath?: string;
}): Promise<WorkflowArtifactItem> {
  switch (request.stage) {
    case "swarm.task.create": {
      if (
        request.session === undefined ||
        request.round === undefined ||
        request.agent === undefined
      ) {
        throw new CommandFailure(
          "workflow_domain_materialization_input_missing",
          "Swarm materialization requires session, round, and agent."
        );
      }
      const result = await materializeSwarmOutputFromAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        taskId: request.taskId,
        session: request.session,
        round: request.round,
        agent: request.agent,
        ...(request.outputPath === undefined ? {} : { outputPath: request.outputPath }),
        reason: "workflow swarm domain materialize"
      });
      return artifactFromWrite(
        request.stage,
        `swarm-output-${safePathSegment(request.agent)}`,
        result.write,
        workflowDomainArtifactDefinition(request.stage).kind
      );
    }
    case "report.task.create": {
      const result = await materializeReportArtifactFromAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        taskId: request.taskId,
        reportKind: "consistency",
        session: request.session ?? request.jobId,
        ...(request.outputPath === undefined ? {} : { outputPath: request.outputPath }),
        reason: "workflow report domain materialize"
      });
      return artifactFromWrite(
        request.stage,
        "report-artifact",
        result.write,
        workflowDomainArtifactDefinition(request.stage).kind
      );
    }
    case "writing.draft": {
      const result = await materializeWritingDraftFromAgentTask({
        workspacePath: request.workspacePath,
        actor: request.actor,
        taskId: request.taskId,
        ...(request.outputPath === undefined ? {} : { outputPath: request.outputPath }),
        reason: "workflow writing domain materialize"
      });
      return artifactFromWrite(
        request.stage,
        "writing-draft",
        result.write,
        workflowDomainArtifactDefinition(request.stage).kind
      );
    }
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${request.stage}' cannot materialize a domain artifact.`
      );
  }
}

function workflowDomainArtifactDefinition(stage: WorkflowStageId): WorkflowDomainArtifactSpec {
  switch (stage) {
    case "import.semantic":
      return { name: "semantic-import", kind: "novelfabric.import.semantic" };
    case "swarm.task.create":
      return { name: "swarm-output", kind: "novelfabric.swarm.output" };
    case "report.task.create":
      return { name: "report-artifact", kind: "novelfabric.report.artifact" };
    case "writing.draft":
      return { name: "writing-draft", kind: "novelfabric.writing.draft" };
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${stage}' does not have a domain artifact definition.`
      );
  }
}

async function writeWorkflowSimulationLog(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sessionId: string;
  readonly turnPath: string;
  readonly turnHash: string;
  readonly summary: string;
  readonly reason: string;
}): Promise<WorkflowWriteSummary> {
  const entry = {
    kind: "novelfabric.simulation.log-entry",
    version: 1,
    sessionId: request.sessionId,
    turnPath: request.turnPath,
    turnHash: request.turnHash,
    summary: request.summary,
    loggedAt: new Date().toISOString()
  } as const;
  const write = await appendWorkspaceFile({
    workspacePath: request.workspacePath,
    path: `simulation/logs/${safePathSegment(request.sessionId)}.jsonl`,
    content: `${JSON.stringify(entry)}\n`,
    actor: request.actor,
    reason: request.reason
  });
  return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
}

function agentTaskEvidenceArtifact(
  stage: WorkflowStageId,
  evidence: AgentTaskEvidence
): WorkflowArtifactItem {
  return {
    stage,
    name: "agent-task-result",
    path: evidence.resultPath,
    hash: evidence.resultWrite.hash,
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
  readonly jobId: string;
  readonly stage: WorkflowStageId;
}): Promise<WorkflowVerifyIssue | null> {
  const evidences = request.artifacts.items.filter(
    (item) =>
      item.stage === request.stage &&
      item.name === "agent-task-result" &&
      item.artifactKind === "novelfabric.agent.task.result"
  );
  if (evidences.length === 0) {
    return {
      severity: "error",
      code: "workflow_pi_task_evidence_missing",
      path: request.stage,
      message: `Workflow pi-task stage '${request.stage}' completed without an agent task result evidence artifact.`
    };
  }
  for (const evidence of evidences) {
    if (evidence.hash === undefined) {
      return {
        severity: "error",
        code: "workflow_pi_task_evidence_hash_missing",
        path: evidence.path,
        message: `Workflow pi-task stage '${request.stage}' evidence must record the completed result hash.`
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
      const taskId = parsed.taskId;
      const taskValidation = await validateAgentOutput({
        workspacePath: request.workspacePath,
        task: taskId
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
    } catch (error) {
      return {
        severity: "error",
        code: "workflow_pi_task_result_unreadable",
        path: evidence.path,
        message:
          error instanceof Error
            ? error.message
            : `Cannot read pi task evidence '${evidence.path}'.`
      };
    }
  }
  return null;
}

async function verifyDomainArtifactEvidence(request: {
  readonly workspacePath: string;
  readonly artifacts: WorkflowArtifactsArtifact;
  readonly jobId: string;
  readonly stage: WorkflowStageId;
}): Promise<WorkflowVerifyIssue | null> {
  const definition = workflowDomainArtifactDefinition(request.stage);
  const evidences = request.artifacts.items.filter(
    (item) =>
      item.stage === request.stage &&
      item.artifactKind === definition.kind &&
      !item.name.includes("template")
  );
  if (evidences.length === 0) {
    return {
      severity: "error",
      code: "workflow_domain_artifact_missing",
      path: request.stage,
      message: `Workflow pi-task stage '${request.stage}' completed without '${definition.name}' domain artifact evidence.`
    };
  }
  for (const evidence of evidences) {
    if (evidence.hash === undefined) {
      return {
        severity: "error",
        code: "workflow_domain_artifact_hash_missing",
        path: evidence.path,
        message: `Workflow domain artifact '${evidence.path}' must record a content hash.`
      };
    }
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: evidence.path
    });
    if (
      read.hash !== evidence.hash &&
      !isMutableWorkflowArtifact(evidence.artifactKind, evidence.path)
    ) {
      return {
        severity: "error",
        code: "workflow_domain_artifact_hash_mismatch",
        path: evidence.path,
        message: `Workflow domain artifact '${evidence.path}' changed after workflow recorded it.`
      };
    }
    const validation = await validateWorkflowDomainArtifact({
      workspacePath: request.workspacePath,
      stage: request.stage,
      path: evidence.path
    });
    if (!validation.valid) {
      return {
        severity: "error",
        code: "workflow_domain_artifact_invalid",
        path: evidence.path,
        message: `Workflow domain artifact '${evidence.path}' failed validation: ${validation.issues.join("; ")}`
      };
    }
  }
  return null;
}

async function validateWorkflowDomainArtifact(request: {
  readonly workspacePath: string;
  readonly stage: WorkflowStageId;
  readonly path: string;
}): Promise<{ readonly valid: boolean; readonly issues: readonly string[] }> {
  switch (request.stage) {
    case "import.semantic": {
      const result = await validateSemanticImportArtifact({
        workspacePath: request.workspacePath,
        artifactPath: request.path
      });
      return { valid: result.valid, issues: result.issues.map((issue) => issue.message) };
    }
    case "swarm.task.create": {
      const result = await validateSwarmOutput({
        workspacePath: request.workspacePath,
        artifactPath: request.path
      });
      return { valid: result.valid, issues: result.issues.map((issue) => issue.message) };
    }
    case "report.task.create": {
      const result = await validateReportArtifact({
        workspacePath: request.workspacePath,
        artifactPath: request.path
      });
      return { valid: result.valid, issues: result.issues.map((issue) => issue.message) };
    }
    case "writing.draft": {
      const result = await validateWritingDraftArtifact(request.workspacePath, request.path);
      return { valid: result.valid, issues: result.issues.map((issue) => issue.message) };
    }
    default:
      throw new CommandFailure(
        "workflow_stage_not_pi_task",
        `Workflow stage '${request.stage}' does not have a domain artifact validator.`
      );
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

function isImportContextPack(value: unknown): value is ImportContextPack {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.import.context-pack" &&
    value["version"] === 1 &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceHash"] === "string" &&
    typeof value["sourceExcerpt"] === "string" &&
    Array.isArray(value["chapters"])
  );
}

function knowledgeSourceKindForPath(pathValue: string): KnowledgeSourceKind {
  const lower = pathValue.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".jsonl")) return "jsonl";
  if (lower.endsWith(".toml")) return "toml";
  return "text";
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
    isRecord(value) &&
    typeof value["stage"] === "string" &&
    typeof value["completedAt"] === "string"
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
