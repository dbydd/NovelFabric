import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendSimulationTurn,
  buildSimulationContextPack,
  createSimulationSession,
  DEFAULT_SWARM_ROUND_ORDER,
  inspectSimulationSession,
  renderSimulationReport,
  SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
  stableJson,
  validateSimulationSession
} from "../../src/simulation/index.js";
import {
  createSwarmTask,
  finalizeSwarmRound,
  planSwarmRound,
  validateSwarmOutput
} from "../../src/swarm/index.js";
import { writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("deterministic simulation and swarm services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-simulation-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("creates sessions, task packages, validated turns, finalizers, context packs, and reports", async () => {
    const created = await createSimulationSession({
      workspacePath,
      objective: "让 Aria 调查雨城回声",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-rain-city"
    });
    expect(created.sessionPath).toBe("simulation/sessions/session-rain-city/session.json");
    expect(created.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//);
    expect(created.session.roundOrder).toEqual(DEFAULT_SWARM_ROUND_ORDER);

    const plan = await planSwarmRound({ workspacePath, session: "session-rain-city", round: 1 });
    expect(plan.plannedTasks.map((task) => task.stage)).toEqual(DEFAULT_SWARM_ROUND_ORDER);
    expect(plan.plannedTasks[0]?.taskPath).toBe(
      "simulation/sessions/session-rain-city/swarm/round-001/tasks/characters.json"
    );

    const task = await createSwarmTask({
      workspacePath,
      session: "session-rain-city",
      round: 1,
      agent: "kp",
      actor: "main_agent"
    });
    expect(task.taskPath).toBe(
      "simulation/sessions/session-rain-city/swarm/round-001/tasks/kp.json"
    );
    expect(task.proposalPath).toBe(
      "simulation/sessions/session-rain-city/swarm/round-001/proposals/kp.json"
    );

    const pendingValidation = await validateSwarmOutput({
      workspacePath,
      artifactPath: task.proposalPath
    });
    expect(pendingValidation.valid).toBe(false);
    expect(pendingValidation.issues.map((issue) => issue.code)).toContain(
      "swarm_output_pending_template"
    );

    await writeWorkspaceFile({
      workspacePath,
      path: task.proposalPath,
      actor: "main_agent",
      content: stableJson({
        schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
        sessionId: "session-rain-city",
        round: 1,
        agent: "kp",
        stage: "kp",
        summary: "KP 让 Aria 在雨城钟楼发现回声源。",
        action: {
          kind: "scene-advance",
          text: "Aria 进入钟楼，确认回声来自被封存的时间齿轮。"
        },
        citations: ["project.md"],
        evidence: [task.taskPath],
        createdFromTask: task.taskPath
      }),
      reason: "test replaces swarm proposal template"
    });

    const validation = await validateSwarmOutput({
      workspacePath,
      artifactPath: task.proposalPath
    });
    expect(validation.valid).toBe(true);
    expect(validation.agent).toBe("kp");

    const appended = await appendSimulationTurn({
      workspacePath,
      session: "session-rain-city",
      proposalPath: task.proposalPath,
      actor: "main_agent"
    });
    expect(appended.turnPath).toBe("simulation/turns/session-rain-city/round-001-001-kp.json");
    expect(appended.sessionWrite.auditPath).toMatch(/^\.novelfabric\/audit\/files\//);

    const inspected = await inspectSimulationSession({
      workspacePath,
      session: "session-rain-city"
    });
    expect(inspected.turnCount).toBe(1);
    expect(inspected.nextRound).toBe(2);

    const sessionValidation = await validateSimulationSession({
      workspacePath,
      session: "session-rain-city"
    });
    expect(sessionValidation.valid).toBe(true);

    const finalized = await finalizeSwarmRound({
      workspacePath,
      session: "session-rain-city",
      round: 1,
      actor: "main_agent"
    });
    expect(finalized.outputPath).toBe(
      "simulation/sessions/session-rain-city/swarm/round-001/finalize.json"
    );
    expect(finalized.completedStages).toContain("kp");
    expect(finalized.missingStages).toContain("characters");

    const contextPack = await buildSimulationContextPack({
      workspacePath,
      session: "session-rain-city",
      agent: "kp",
      actor: "main_agent"
    });
    expect(contextPack.outputPath).toBe("simulation/context-packs/session-rain-city/kp.json");
    expect(contextPack.turnCount).toBe(1);

    const report = await renderSimulationReport({
      workspacePath,
      session: "session-rain-city",
      actor: "main_agent"
    });
    expect(report.outputPath).toBe("reports/simulation-session-rain-city.md");
    expect(report.turnCount).toBe(1);
  });

  it("detects stale turn hashes during session validation", async () => {
    const created = await createSimulationSession({
      workspacePath,
      objective: "验证 hash",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-stale-turn"
    });
    expect(created.session.id).toBe("session-stale-turn");

    const task = await createSwarmTask({
      workspacePath,
      session: "session-stale-turn",
      round: 1,
      agent: "characters",
      actor: "main_agent"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: task.proposalPath,
      actor: "main_agent",
      content: stableJson({
        schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
        sessionId: "session-stale-turn",
        round: 1,
        agent: "characters",
        stage: "characters",
        summary: "角色完成行动。",
        action: { kind: "role-action", text: "角色记录线索。" },
        citations: [],
        evidence: [task.taskPath]
      })
    });
    const appended = await appendSimulationTurn({
      workspacePath,
      session: "session-stale-turn",
      proposalPath: task.proposalPath,
      actor: "main_agent"
    });
    await fs.appendFile(path.join(workspacePath, appended.turnPath), "\n", "utf8");

    const validation = await validateSimulationSession({
      workspacePath,
      session: "session-stale-turn"
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("simulation_turn_hash_mismatch");
  });
});
