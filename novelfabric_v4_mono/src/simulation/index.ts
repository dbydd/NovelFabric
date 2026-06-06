import { CommandFailure } from "../errors.js";
import { contentHash, readWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";

export const SIMULATION_SESSION_SCHEMA_VERSION = "novelfabric.simulation.session.v1";
export const SIMULATION_CONTEXT_PACK_SCHEMA_VERSION = "novelfabric.simulation.context-pack.v1";
export const SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION = "novelfabric.swarm.turn-proposal.v1";
export const SIMULATION_TURN_SCHEMA_VERSION = "novelfabric.simulation.turn.v1";

export const DEFAULT_SWARM_ROUND_ORDER = [
  "characters",
  "random-event",
  "world-maintainer",
  "kp",
  "project-auditor"
] as const;

export type SwarmRoundStage = (typeof DEFAULT_SWARM_ROUND_ORDER)[number];

export type SimulationSessionTurnRef = {
  readonly path: string;
  readonly round: number;
  readonly sequence: number;
  readonly agent: string;
  readonly stage: string;
  readonly summary: string;
  readonly hash: string;
};

export type SimulationSession = {
  readonly schemaVersion: typeof SIMULATION_SESSION_SCHEMA_VERSION;
  readonly id: string;
  readonly objective: string;
  readonly timeline: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly status: "active" | "finalized";
  readonly roundOrder: readonly SwarmRoundStage[];
  readonly turns: readonly SimulationSessionTurnRef[];
};

export type SimulationTurnProposal = {
  readonly schemaVersion: typeof SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly round: number;
  readonly agent: string;
  readonly stage: string;
  readonly summary: string;
  readonly action: {
    readonly kind: string;
    readonly text: string;
  };
  readonly citations: readonly string[];
  readonly evidence: readonly string[];
  readonly createdFromTask?: string;
};

export type SimulationTurn = {
  readonly schemaVersion: typeof SIMULATION_TURN_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly round: number;
  readonly sequence: number;
  readonly agent: string;
  readonly stage: string;
  readonly summary: string;
  readonly action: {
    readonly kind: string;
    readonly text: string;
  };
  readonly citations: readonly string[];
  readonly evidence: readonly string[];
  readonly proposalPath: string;
  readonly appendedAt: string;
  readonly appendedBy: string;
};

export type SimulationWriteSummary = {
  readonly path: string;
  readonly hash: string;
  readonly auditPath: string;
};

export type SimulationSessionCreateRequest = {
  readonly workspacePath: string;
  readonly objective: string;
  readonly timeline: string;
  readonly actor: string;
  readonly sessionId?: string;
  readonly reason?: string;
};

export type SimulationSessionCreateResult = {
  readonly session: SimulationSession;
  readonly sessionPath: string;
  readonly write: SimulationWriteSummary;
};

export type SimulationSessionInspectRequest = {
  readonly workspacePath: string;
  readonly session: string;
};

export type SimulationSessionInspectResult = {
  readonly session: SimulationSession;
  readonly sessionPath: string;
  readonly hash: string;
  readonly turnCount: number;
  readonly nextRound: number;
};

export type SimulationContextPackRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly agent: string;
  readonly actor: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type SimulationContextPackResult = {
  readonly sessionId: string;
  readonly agent: string;
  readonly outputPath: string;
  readonly turnCount: number;
  readonly write: SimulationWriteSummary;
};

export type SimulationAppendTurnRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly proposalPath: string;
  readonly actor: string;
  readonly reason?: string;
};

export type SimulationAppendTurnResult = {
  readonly sessionId: string;
  readonly turn: SimulationTurn;
  readonly turnPath: string;
  readonly turnWrite: SimulationWriteSummary;
  readonly sessionWrite: SimulationWriteSummary;
};

export type SimulationValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type SimulationValidateRequest = {
  readonly workspacePath: string;
  readonly session: string;
};

export type SimulationValidateResult = {
  readonly sessionId: string;
  readonly valid: boolean;
  readonly issues: readonly SimulationValidationIssue[];
  readonly turnCount: number;
  readonly roundOrder: readonly SwarmRoundStage[];
};

export type SimulationReportRequest = {
  readonly workspacePath: string;
  readonly session: string;
  readonly actor: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type SimulationReportResult = {
  readonly sessionId: string;
  readonly outputPath: string;
  readonly turnCount: number;
  readonly write: SimulationWriteSummary;
};

export async function createSimulationSession(
  request: SimulationSessionCreateRequest
): Promise<SimulationSessionCreateResult> {
  const objective = request.objective.trim();
  if (objective.length === 0) {
    throw new CommandFailure("invalid_simulation_input", "Simulation objective must not be empty.");
  }
  const timeline = normalizeNonEmptySegment(request.timeline, "timeline");
  const id = request.sessionId ?? makeSessionId(objective, timeline);
  assertSafeIdentifier(id, "session");
  const session: SimulationSession = {
    schemaVersion: SIMULATION_SESSION_SCHEMA_VERSION,
    id,
    objective,
    timeline,
    createdBy: request.actor,
    createdAt: new Date().toISOString(),
    status: "active",
    roundOrder: DEFAULT_SWARM_ROUND_ORDER,
    turns: []
  };
  const sessionPath = sessionFilePath(id);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: sessionPath,
    content: stableJson(session),
    actor: request.actor,
    reason: request.reason ?? "simulation session create"
  });
  return { session, sessionPath, write: summarizeWrite(write) };
}

export async function inspectSimulationSession(
  request: SimulationSessionInspectRequest
): Promise<SimulationSessionInspectResult> {
  const read = await readSessionFile(request.workspacePath, request.session);
  return {
    session: read.session,
    sessionPath: read.path,
    hash: read.hash,
    turnCount: read.session.turns.length,
    nextRound: nextRoundForSession(read.session)
  };
}

export async function buildSimulationContextPack(
  request: SimulationContextPackRequest
): Promise<SimulationContextPackResult> {
  const { session } = await readSessionFile(request.workspacePath, request.session);
  const agent = normalizeNonEmptySegment(request.agent, "agent");
  const outputPath =
    request.outputPath ?? `simulation/context-packs/${session.id}/${safePathSegment(agent)}.json`;
  const payload = {
    schemaVersion: SIMULATION_CONTEXT_PACK_SCHEMA_VERSION,
    session: {
      id: session.id,
      objective: session.objective,
      timeline: session.timeline,
      status: session.status,
      roundOrder: session.roundOrder
    },
    agent,
    latestTurns: session.turns.slice(-8),
    instructions: [
      "Use this context pack as evidence for pi-agent semantic work.",
      "Write proposed outputs as workspace artifacts, then validate/apply through novelfabric CLI."
    ]
  } as const;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: stableJson(payload),
    actor: request.actor,
    reason: request.reason ?? "simulation context-pack"
  });
  return {
    sessionId: session.id,
    agent,
    outputPath: write.path,
    turnCount: session.turns.length,
    write: summarizeWrite(write)
  };
}

export async function appendSimulationTurn(
  request: SimulationAppendTurnRequest
): Promise<SimulationAppendTurnResult> {
  const sessionRead = await readSessionFile(request.workspacePath, request.session);
  const proposalRead = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.proposalPath
  });
  const proposal = parseTurnProposal(proposalRead.content, proposalRead.path);
  if (proposal.sessionId !== sessionRead.session.id) {
    throw new CommandFailure(
      "invalid_simulation_proposal",
      `Proposal session '${proposal.sessionId}' does not match session '${sessionRead.session.id}'.`
    );
  }
  const sequence = sessionRead.session.turns.length + 1;
  const turn: SimulationTurn = {
    schemaVersion: SIMULATION_TURN_SCHEMA_VERSION,
    sessionId: sessionRead.session.id,
    round: proposal.round,
    sequence,
    agent: proposal.agent,
    stage: proposal.stage,
    summary: proposal.summary,
    action: proposal.action,
    citations: proposal.citations,
    evidence: proposal.evidence,
    proposalPath: proposalRead.path,
    appendedAt: new Date().toISOString(),
    appendedBy: request.actor
  };
  const turnPath = `simulation/turns/${sessionRead.session.id}/round-${padRound(
    proposal.round
  )}-${sequence.toString().padStart(3, "0")}-${safePathSegment(proposal.agent)}.json`;
  const turnContent = stableJson(turn);
  const turnWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: turnPath,
    content: turnContent,
    actor: request.actor,
    reason: request.reason ?? "simulation append-turn"
  });
  const turnRef: SimulationSessionTurnRef = {
    path: turnWrite.path,
    round: turn.round,
    sequence: turn.sequence,
    agent: turn.agent,
    stage: turn.stage,
    summary: turn.summary,
    hash: contentHash(turnContent)
  };
  const updatedSession: SimulationSession = {
    ...sessionRead.session,
    turns: [...sessionRead.session.turns, turnRef]
  };
  const sessionWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: sessionRead.path,
    content: stableJson(updatedSession),
    actor: request.actor,
    expectedBaseHash: sessionRead.hash,
    reason: request.reason ?? "simulation append-turn session manifest"
  });
  return {
    sessionId: sessionRead.session.id,
    turn,
    turnPath: turnWrite.path,
    turnWrite: summarizeWrite(turnWrite),
    sessionWrite: summarizeWrite(sessionWrite)
  };
}

export async function validateSimulationSession(
  request: SimulationValidateRequest
): Promise<SimulationValidateResult> {
  const { session } = await readSessionFile(request.workspacePath, request.session);
  const issues: SimulationValidationIssue[] = [];
  if (!sameStringArray(session.roundOrder, DEFAULT_SWARM_ROUND_ORDER)) {
    issues.push({
      code: "simulation_round_order_mismatch",
      message: `Round order must be ${DEFAULT_SWARM_ROUND_ORDER.join(" -> ")}.`
    });
  }
  let expectedSequence = 1;
  for (const turn of session.turns) {
    if (turn.sequence !== expectedSequence) {
      issues.push({
        code: "simulation_turn_sequence_gap",
        message: `Expected turn sequence ${expectedSequence.toString()}, got ${turn.sequence.toString()}.`,
        path: turn.path
      });
      expectedSequence = turn.sequence;
    }
    expectedSequence += 1;
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: turn.path
      });
      if (read.hash !== turn.hash) {
        issues.push({
          code: "simulation_turn_hash_mismatch",
          message: `Turn '${turn.path}' hash does not match the session manifest.`,
          path: turn.path
        });
      }
    } catch (error) {
      issues.push({
        code: "simulation_turn_missing",
        message: error instanceof Error ? error.message : `Turn '${turn.path}' could not be read.`,
        path: turn.path
      });
    }
  }
  return {
    sessionId: session.id,
    valid: issues.length === 0,
    issues,
    turnCount: session.turns.length,
    roundOrder: session.roundOrder
  };
}

export async function renderSimulationReport(
  request: SimulationReportRequest
): Promise<SimulationReportResult> {
  const { session } = await readSessionFile(request.workspacePath, request.session);
  const outputPath = request.outputPath ?? `reports/simulation-${session.id}.md`;
  const content = [
    `# Simulation Report: ${session.id}`,
    "",
    `- Objective: ${session.objective}`,
    `- Timeline: ${session.timeline}`,
    `- Status: ${session.status}`,
    `- Round order: ${session.roundOrder.join(" -> ")}`,
    `- Turn count: ${session.turns.length.toString()}`,
    "",
    "## Turns",
    "",
    ...session.turns.map(
      (turn) =>
        `- Round ${turn.round.toString()} / ${turn.stage} / ${turn.agent}: ${turn.summary} (${turn.path})`
    )
  ].join("\n");
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: `${content}\n`,
    actor: request.actor,
    reason: request.reason ?? "simulation report"
  });
  return {
    sessionId: session.id,
    outputPath: write.path,
    turnCount: session.turns.length,
    write: summarizeWrite(write)
  };
}

export function parseTurnProposal(content: string, artifactPath: string): SimulationTurnProposal {
  const parsed = parseJsonObject(content, artifactPath);
  if (parsed["schemaVersion"] !== SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION) {
    throw new CommandFailure(
      "invalid_swarm_output",
      `Artifact '${artifactPath}' is not a NovelFabric swarm turn proposal.`
    );
  }
  const sessionId = requiredString(parsed, "sessionId", artifactPath);
  const round = requiredPositiveInteger(parsed, "round", artifactPath);
  const agent = requiredString(parsed, "agent", artifactPath);
  const stage = requiredString(parsed, "stage", artifactPath);
  const summary = requiredString(parsed, "summary", artifactPath);
  const action = requiredRecord(parsed, "action", artifactPath);
  const actionKind = requiredString(action, "kind", artifactPath);
  const actionText = requiredString(action, "text", artifactPath);
  const citations = optionalStringArray(parsed, "citations", artifactPath);
  const evidence = optionalStringArray(parsed, "evidence", artifactPath);
  const createdFromTaskValue = parsed["createdFromTask"];
  return {
    schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
    sessionId,
    round,
    agent,
    stage,
    summary,
    action: { kind: actionKind, text: actionText },
    citations,
    evidence,
    ...(typeof createdFromTaskValue === "string" ? { createdFromTask: createdFromTaskValue } : {})
  };
}

export function sessionFilePath(sessionId: string): string {
  assertSafeIdentifier(sessionId, "session");
  return `simulation/sessions/${sessionId}/session.json`;
}

export function roundDirectoryPath(sessionId: string, round: number): string {
  assertSafeIdentifier(sessionId, "session");
  assertPositiveInteger(round, "round");
  return `simulation/sessions/${sessionId}/swarm/round-${padRound(round)}`;
}

export function stageForAgent(agent: string): SwarmRoundStage {
  const normalized = agent.trim().toLocaleLowerCase();
  if (isSwarmRoundStage(normalized)) return normalized;
  return "characters";
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new CommandFailure("invalid_integer_option", `${label} must be a positive integer.`);
  }
}

export function padRound(round: number): string {
  assertPositiveInteger(round, "round");
  return round.toString().padStart(3, "0");
}

export function safePathSegment(value: string): string {
  const segment = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return segment.length === 0 ? "item" : segment.slice(0, 80);
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readSessionFile(
  workspacePath: string,
  sessionId: string
): Promise<{ readonly session: SimulationSession; readonly path: string; readonly hash: string }> {
  const sessionPath = sessionFilePath(sessionId);
  const read = await readWorkspaceFile({ workspacePath, path: sessionPath });
  return { session: parseSession(read.content, read.path), path: read.path, hash: read.hash };
}

function parseSession(content: string, artifactPath: string): SimulationSession {
  const parsed = parseJsonObject(content, artifactPath);
  if (parsed["schemaVersion"] !== SIMULATION_SESSION_SCHEMA_VERSION) {
    throw new CommandFailure(
      "invalid_simulation_session",
      `Artifact '${artifactPath}' is not a NovelFabric simulation session.`
    );
  }
  const status = requiredString(parsed, "status", artifactPath);
  if (status !== "active" && status !== "finalized") {
    throw new CommandFailure(
      "invalid_simulation_session",
      `Session '${artifactPath}' has invalid status.`
    );
  }
  const roundOrder = requiredStringArray(parsed, "roundOrder", artifactPath);
  if (!roundOrder.every(isSwarmRoundStage)) {
    throw new CommandFailure(
      "invalid_simulation_session",
      `Session '${artifactPath}' has invalid roundOrder entries.`
    );
  }
  return {
    schemaVersion: SIMULATION_SESSION_SCHEMA_VERSION,
    id: requiredString(parsed, "id", artifactPath),
    objective: requiredString(parsed, "objective", artifactPath),
    timeline: requiredString(parsed, "timeline", artifactPath),
    createdBy: requiredString(parsed, "createdBy", artifactPath),
    createdAt: requiredString(parsed, "createdAt", artifactPath),
    status,
    roundOrder,
    turns: parseTurnRefs(parsed["turns"], artifactPath)
  };
}

function parseTurnRefs(value: unknown, artifactPath: string): readonly SimulationSessionTurnRef[] {
  if (!Array.isArray(value)) {
    throw new CommandFailure(
      "invalid_simulation_session",
      `Session '${artifactPath}' turns must be an array.`
    );
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new CommandFailure(
        "invalid_simulation_session",
        `Session '${artifactPath}' turn ${index.toString()} must be an object.`
      );
    }
    return {
      path: requiredString(item, "path", artifactPath),
      round: requiredPositiveInteger(item, "round", artifactPath),
      sequence: requiredPositiveInteger(item, "sequence", artifactPath),
      agent: requiredString(item, "agent", artifactPath),
      stage: requiredString(item, "stage", artifactPath),
      summary: requiredString(item, "summary", artifactPath),
      hash: requiredString(item, "hash", artifactPath)
    };
  });
}

function parseJsonObject(content: string, artifactPath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to uniform artifact error.
  }
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' must contain a JSON object.`
  );
}

function requiredRecord(
  record: Record<string, unknown>,
  key: string,
  artifactPath: string
): Record<string, unknown> {
  const value = record[key];
  if (isRecord(value)) return value;
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' field '${key}' must be an object.`
  );
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  artifactPath: string
): string {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' field '${key}' must be a non-empty string.`
  );
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  artifactPath: string
): number {
  const value = record[key];
  if (Number.isInteger(value) && typeof value === "number" && value > 0) return value;
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' field '${key}' must be a positive integer.`
  );
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  artifactPath: string
): readonly string[] {
  const value = record[key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' field '${key}' must be a string array.`
  );
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  artifactPath: string
): readonly string[] {
  const value = record[key];
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  throw new CommandFailure(
    "invalid_artifact",
    `Artifact '${artifactPath}' field '${key}' must be a string array.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSwarmRoundStage(value: string): value is SwarmRoundStage {
  return DEFAULT_SWARM_ROUND_ORDER.some((stage) => stage === value);
}

function makeSessionId(objective: string, timeline: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const digest = contentHash(`${objective}:${timeline}:${timestamp}`).slice(
    "sha256:".length,
    "sha256:".length + 8
  );
  return `session-${timestamp}-${digest}`;
}

function nextRoundForSession(session: SimulationSession): number {
  const lastRound = session.turns.reduce((max, turn) => Math.max(max, turn.round), 0);
  return lastRound + 1;
}

function normalizeNonEmptySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CommandFailure("invalid_simulation_input", `${label} must not be empty.`);
  }
  return trimmed;
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new CommandFailure(
      "invalid_simulation_input",
      `${label} '${value}' must contain only letters, numbers, dots, underscores, or hyphens.`
    );
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function summarizeWrite(write: {
  readonly path: string;
  readonly hash: string;
  readonly auditPath: string;
}): SimulationWriteSummary {
  return { path: write.path, hash: write.hash, auditPath: write.auditPath };
}
