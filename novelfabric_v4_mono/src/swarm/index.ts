import { CommandFailure } from "../errors.js";
import {
  appendSimulationTurn,
  assertPositiveInteger,
  DEFAULT_SWARM_ROUND_ORDER,
  inspectSimulationSession,
  parseTurnProposal,
  roundDirectoryPath,
  safePathSegment,
  SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
  stableJson,
  stageForAgent,
  type SimulationAppendTurnResult,
  type SimulationWriteSummary,
  type SwarmRoundStage
} from "../simulation/index.js";
import {
  assertMaterializedContent,
  assertSourceAnchorsGrounded,
  readCitationEvidence,
  readCompletedAgentTaskDomainOutput,
  requireActionTextOutput,
  requireWorkflowOutputKind
} from "../agent-runtime/materialization.js";
import { actorHasCapability, readCapabilityManifest } from "../workspace/capabilities.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";

const SWARM_RUN_CAPABILITY = "swarm.run";
const SIMULATION_APPEND_TURN_CAPABILITY = "simulation.append_turn";

export const SWARM_TASK_SCHEMA_VERSION = "novelfabric.swarm.task.v1";
export const SWARM_ROUND_FINALIZE_SCHEMA_VERSION = "novelfabric.swarm.round-finalize.v1";

export type SwarmPlanRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly round: number;
};

export type SwarmPlanResult = {
  readonly sessionId: string;
  readonly round: number;
  readonly roundOrder: readonly SwarmRoundStage[];
  readonly plannedTasks: readonly SwarmPlannedTask[];
  readonly existingTurnCount: number;
};

export type SwarmPlannedTask = {
  readonly stage: SwarmRoundStage;
  readonly agent: string;
  readonly taskPath: string;
  readonly proposalPath: string;
};

export type SwarmTaskCreateRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly round: number;
  readonly agent: string;
  readonly actor: string;
  readonly reason?: string;
};

export type SwarmTaskCreateResult = {
  readonly sessionId: string;
  readonly round: number;
  readonly agent: string;
  readonly stage: SwarmRoundStage;
  readonly taskPath: string;
  readonly proposalPath: string;
  readonly taskWrite: SimulationWriteSummary;
  readonly proposalWrite: SimulationWriteSummary;
};

export type SwarmOutputValidateRequest = {
  readonly workspacePath: string;
  readonly artifactPath: string;
};

export type SwarmOutputValidateResult = {
  readonly valid: boolean;
  readonly artifactPath: string;
  readonly sessionId?: string;
  readonly round?: number;
  readonly agent?: string;
  readonly stage?: string;
  readonly issues: readonly SwarmOutputIssue[];
};

export type SwarmOutputIssue = {
  readonly code: string;
  readonly message: string;
};

export type SwarmOutputApplyRequest = {
  readonly workspacePath: string;
  readonly artifactPath: string;
  readonly actor: string;
  readonly reason?: string;
};

export type SwarmOutputApplyResult = SimulationAppendTurnResult & {
  readonly artifactPath: string;
};

export type SwarmRoundFinalizeRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly round: number;
  readonly actor: string;
  readonly reason?: string;
};

export type SwarmMaterializeFromAgentTaskRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly session: string;
  readonly round: number;
  readonly agent: string;
  readonly actor: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type SwarmMaterializeFromAgentTaskResult = {
  readonly sessionId: string;
  readonly round: number;
  readonly agent: string;
  readonly stage: SwarmRoundStage;
  readonly artifactPath: string;
  readonly sourceTaskResultPath: string;
  readonly write: SimulationWriteSummary;
};

export type SwarmRoundFinalizeResult = {
  readonly sessionId: string;
  readonly round: number;
  readonly outputPath: string;
  readonly completedStages: readonly string[];
  readonly missingStages: readonly SwarmRoundStage[];
  readonly write: SimulationWriteSummary;
};

export async function planSwarmRound(request: SwarmPlanRequest): Promise<SwarmPlanResult> {
  assertPositiveInteger(request.round, "round");
  const session = await inspectSimulationSession({
    workspacePath: request.workspacePath,
    session: request.session
  });
  return {
    sessionId: session.session.id,
    round: request.round,
    roundOrder: DEFAULT_SWARM_ROUND_ORDER,
    plannedTasks: DEFAULT_SWARM_ROUND_ORDER.map((stage) =>
      plannedTask(session.session.id, request.round, stage)
    ),
    existingTurnCount: session.turnCount
  };
}

export async function createSwarmTask(
  request: SwarmTaskCreateRequest
): Promise<SwarmTaskCreateResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [SWARM_RUN_CAPABILITY]);
  assertPositiveInteger(request.round, "round");
  const session = await inspectSimulationSession({
    workspacePath: request.workspacePath,
    session: request.session
  });
  const agent = normalizeAgent(request.agent);
  const stage = stageForAgent(agent);
  const baseDir = roundDirectoryPath(session.session.id, request.round);
  const agentSegment = safePathSegment(agent);
  const taskPath = `${baseDir}/tasks/${agentSegment}.json`;
  const proposalPath = `${baseDir}/proposals/${agentSegment}.json`;
  const task = {
    schemaVersion: SWARM_TASK_SCHEMA_VERSION,
    sessionId: session.session.id,
    round: request.round,
    agent,
    stage,
    objective: session.session.objective,
    timeline: session.session.timeline,
    roundOrder: DEFAULT_SWARM_ROUND_ORDER,
    contextPackHint: `novelfabric simulation context-pack --workspace <workspace> --session ${session.session.id} --agent ${agent} --actor ${request.actor} --json`,
    expectedOutputPath: proposalPath,
    outputSchemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
    instructions: [
      "Run semantic work through the NovelFabric-wrapped pi agent SDK.",
      "Write the final proposal artifact at expectedOutputPath.",
      "Validate with `novelfabric swarm output validate` before applying."
    ]
  } as const;
  const proposalTemplate = {
    schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
    sessionId: session.session.id,
    round: request.round,
    agent,
    stage,
    summary: `Pending ${stage} proposal for ${agent}.`,
    action: {
      kind: "proposal",
      text: "Replace this text with pi-agent generated semantic output before applying."
    },
    citations: [taskPath],
    evidence: [session.sessionPath],
    createdFromTask: taskPath
  } as const;
  const taskWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: taskPath,
    content: stableJson(task),
    actor: request.actor,
    reason: request.reason ?? "swarm task create",
    authorizedCapability: SWARM_RUN_CAPABILITY
  });
  const proposalWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: proposalPath,
    content: stableJson(proposalTemplate),
    actor: request.actor,
    reason: request.reason ?? "swarm proposal template create",
    authorizedCapability: SWARM_RUN_CAPABILITY
  });
  return {
    sessionId: session.session.id,
    round: request.round,
    agent,
    stage,
    taskPath: taskWrite.path,
    proposalPath: proposalWrite.path,
    taskWrite: summarizeWrite(taskWrite),
    proposalWrite: summarizeWrite(proposalWrite)
  };
}

export async function validateSwarmOutput(
  request: SwarmOutputValidateRequest
): Promise<SwarmOutputValidateResult> {
  const issues: SwarmOutputIssue[] = [];
  try {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: request.artifactPath
    });
    const proposal = parseTurnProposal(read.content, read.path);
    if (proposal.summary.includes("Pending ")) {
      issues.push({
        code: "swarm_output_pending_template",
        message: "Swarm output still appears to be an unedited task template."
      });
    }
    if (proposal.action.text.includes("Replace this text")) {
      issues.push({
        code: "swarm_output_placeholder_action",
        message: "Swarm output action text must be replaced before apply."
      });
    }
    const citationHashIssues = await validateCitationHashes(request.workspacePath, read.content);
    issues.push(...citationHashIssues);
    return {
      valid: issues.length === 0,
      artifactPath: read.path,
      sessionId: proposal.sessionId,
      round: proposal.round,
      agent: proposal.agent,
      stage: proposal.stage,
      issues
    };
  } catch (error) {
    return {
      valid: false,
      artifactPath: request.artifactPath,
      issues: [
        {
          code: error instanceof CommandFailure ? error.code : "invalid_swarm_output",
          message: error instanceof Error ? error.message : "Swarm output could not be validated."
        }
      ]
    };
  }
}

export async function applySwarmOutput(
  request: SwarmOutputApplyRequest
): Promise<SwarmOutputApplyResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [
    SIMULATION_APPEND_TURN_CAPABILITY
  ]);
  const validation = await validateSwarmOutput({
    workspacePath: request.workspacePath,
    artifactPath: request.artifactPath
  });
  if (!validation.valid) {
    throw new CommandFailure(
      "invalid_swarm_output",
      `Swarm output '${request.artifactPath}' has validation issues and cannot be applied.`
    );
  }
  const appended = await appendSimulationTurn({
    workspacePath: request.workspacePath,
    session: requiredResultString(validation.sessionId, "sessionId"),
    proposalPath: request.artifactPath,
    actor: request.actor,
    ...(request.reason === undefined ? {} : { reason: request.reason })
  });
  return { ...appended, artifactPath: request.artifactPath };
}

export async function materializeSwarmOutputFromAgentTask(
  request: SwarmMaterializeFromAgentTaskRequest
): Promise<SwarmMaterializeFromAgentTaskResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [SWARM_RUN_CAPABILITY]);
  assertPositiveInteger(request.round, "round");
  const session = await inspectSimulationSession({
    workspacePath: request.workspacePath,
    session: request.session
  });
  const agent = normalizeAgent(request.agent);
  const stage = stageForAgent(agent);
  const output = await readCompletedAgentTaskDomainOutput({
    workspacePath: request.workspacePath,
    taskId: request.taskId
  });
  requireWorkflowOutputKind(output, "novelfabric.workflow.swarm-output");
  const citationEvidence = await readCitationEvidence(request.workspacePath, output.citations);
  assertSourceAnchorsGrounded(output.sourceAnchors, citationEvidence, output.resultPath);
  const taskResultCitation = { path: output.resultPath, hash: output.resultHash };
  const actionText = requireActionTextOutput(output, "Swarm action text");
  const proposal = {
    schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
    sessionId: session.session.id,
    round: request.round,
    agent,
    stage,
    summary: assertMaterializedContent(output.summary, "Swarm summary"),
    action: {
      kind: "pi-agent-proposal",
      text: actionText
    },
    citations: citationEvidence.map((citation) => citation.path),
    evidence: [taskResultCitation.path, ...citationEvidence.map((citation) => citation.path)],
    createdFromTask: output.resultPath,
    sourceAnchors: output.sourceAnchors,
    citationHashes: [taskResultCitation, ...citationEvidence]
  } as const;
  const artifactPath =
    request.outputPath ??
    `${roundDirectoryPath(session.session.id, request.round)}/proposals/${safePathSegment(agent)}-materialized.json`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: artifactPath,
    content: stableJson(proposal),
    actor: request.actor,
    reason: request.reason ?? "swarm materialize from agent task",
    authorizedCapability: SWARM_RUN_CAPABILITY
  });
  return {
    sessionId: session.session.id,
    round: request.round,
    agent,
    stage,
    artifactPath: write.path,
    sourceTaskResultPath: output.resultPath,
    write: summarizeWrite(write)
  };
}

export async function finalizeSwarmRound(
  request: SwarmRoundFinalizeRequest
): Promise<SwarmRoundFinalizeResult> {
  await requireAnyCapability(request.workspacePath, request.actor, [SWARM_RUN_CAPABILITY]);
  assertPositiveInteger(request.round, "round");
  const session = await inspectSimulationSession({
    workspacePath: request.workspacePath,
    session: request.session
  });
  const roundTurns = session.session.turns.filter((turn) => turn.round === request.round);
  const completedStages = [...new Set(roundTurns.map((turn) => turn.stage))].sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN")
  );
  const missingStages = DEFAULT_SWARM_ROUND_ORDER.filter(
    (stage) => !completedStages.includes(stage)
  );
  const outputPath = `${roundDirectoryPath(session.session.id, request.round)}/finalize.json`;
  const payload = {
    schemaVersion: SWARM_ROUND_FINALIZE_SCHEMA_VERSION,
    sessionId: session.session.id,
    round: request.round,
    roundOrder: DEFAULT_SWARM_ROUND_ORDER,
    completedStages,
    missingStages,
    turnPaths: roundTurns.map((turn) => turn.path),
    finalizedAt: new Date().toISOString(),
    finalizedBy: request.actor
  } as const;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: stableJson(payload),
    actor: request.actor,
    reason: request.reason ?? "swarm round finalize",
    authorizedCapability: SWARM_RUN_CAPABILITY
  });
  return {
    sessionId: session.session.id,
    round: request.round,
    outputPath: write.path,
    completedStages,
    missingStages,
    write: summarizeWrite(write)
  };
}

async function requireAnyCapability(
  workspacePath: string,
  actor: string,
  capabilities: readonly string[]
): Promise<void> {
  const manifest = await readCapabilityManifest(workspacePath);
  if (capabilities.some((capability) => actorHasCapability(manifest, actor, capability))) return;
  throw new CommandFailure(
    "capability_denied",
    `Actor '${actor}' does not have any required capability: ${capabilities.join(", ")}.`,
    3
  );
}

function plannedTask(sessionId: string, round: number, stage: SwarmRoundStage): SwarmPlannedTask {
  const baseDir = roundDirectoryPath(sessionId, round);
  return {
    stage,
    agent: stage,
    taskPath: `${baseDir}/tasks/${stage}.json`,
    proposalPath: `${baseDir}/proposals/${stage}.json`
  };
}

function normalizeAgent(agent: string): string {
  const trimmed = agent.trim();
  if (trimmed.length === 0) {
    throw new CommandFailure("invalid_swarm_input", "Agent must not be empty.");
  }
  return trimmed;
}

function requiredResultString(value: string | undefined, label: string): string {
  if (value !== undefined && value.length > 0) return value;
  throw new CommandFailure(
    "invalid_swarm_output",
    `Validated swarm output did not include ${label}.`
  );
}

async function validateCitationHashes(
  workspacePath: string,
  artifactContent: string
): Promise<SwarmOutputIssue[]> {
  const parsed = JSON.parse(artifactContent) as unknown;
  if (!isRecord(parsed)) return [];
  const rawCitationHashes = parsed["citationHashes"];
  if (!Array.isArray(rawCitationHashes)) return [];
  const issues: SwarmOutputIssue[] = [];
  for (const item of rawCitationHashes) {
    if (!isRecord(item)) continue;
    const citationPath = item["path"];
    const citationHash = item["hash"];
    if (typeof citationPath !== "string" || typeof citationHash !== "string") continue;
    try {
      const read = await readWorkspaceFile({ workspacePath, path: citationPath });
      if (read.hash !== citationHash) {
        issues.push({
          code: "citation_hash_mismatch",
          message: `Citation hash for '${citationPath}' does not match current workspace content.`
        });
      }
    } catch (error) {
      issues.push({
        code: "citation_unreadable",
        message:
          error instanceof Error ? error.message : `Could not read citation '${citationPath}'.`
      });
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeWrite(write: {
  readonly path: string;
  readonly hash: string;
  readonly auditPath: string;
}): SimulationWriteSummary {
  return { path: write.path, hash: write.hash, auditPath: write.auditPath };
}
