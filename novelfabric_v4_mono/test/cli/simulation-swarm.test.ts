import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addSimulationCommands } from "../../src/commands/simulation.js";
import { addSwarmCommands } from "../../src/commands/swarm.js";
import { SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION, stableJson } from "../../src/simulation/index.js";
import { writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    sessionPath: z.string().optional(),
    sessionId: z.string().optional(),
    turnCount: z.number().optional(),
    nextRound: z.number().optional(),
    plannedTasks: z.array(z.looseObject({ stage: z.string() })).optional(),
    taskPath: z.string().optional(),
    proposalPath: z.string().optional(),
    artifactPath: z.string().optional(),
    valid: z.boolean().optional(),
    turnPath: z.string().optional(),
    outputPath: z.string().optional(),
    completedStages: z.array(z.string()).optional()
  })
});

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("simulation and swarm command registrations", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-sim-swarm-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("runs the deterministic simulation and swarm command flow through commander", async () => {
    const created = await runRegisteredCommand([
      "simulation",
      "session",
      "create",
      "--workspace",
      workspacePath,
      "--objective",
      "跑团调查雨城",
      "--timeline",
      "main",
      "--actor",
      "main_agent",
      "--session",
      "session-cli-flow",
      "--json"
    ]);
    expect(created.command).toBe("simulation session create");
    expect(created.data.sessionPath).toBe("simulation/sessions/session-cli-flow/session.json");

    const inspected = await runRegisteredCommand([
      "simulation",
      "session",
      "inspect",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--json"
    ]);
    expect(inspected.command).toBe("simulation session inspect");
    expect(inspected.data.turnCount).toBe(0);
    expect(inspected.data.nextRound).toBe(1);

    const plan = await runRegisteredCommand([
      "swarm",
      "plan",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--round",
      "1",
      "--json"
    ]);
    expect(plan.command).toBe("swarm plan");
    expect(plan.data.plannedTasks?.map((task) => task.stage)).toEqual([
      "characters",
      "random-event",
      "world-maintainer",
      "kp",
      "project-auditor"
    ]);

    const task = await runRegisteredCommand([
      "swarm",
      "task",
      "create",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--round",
      "1",
      "--agent",
      "kp",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(task.command).toBe("swarm task create");
    expect(task.data.taskPath).toBe(
      "simulation/sessions/session-cli-flow/swarm/round-001/tasks/kp.json"
    );
    expect(task.data.proposalPath).toBe(
      "simulation/sessions/session-cli-flow/swarm/round-001/proposals/kp.json"
    );

    const pending = await runRegisteredCommand([
      "swarm",
      "output",
      "validate",
      "--workspace",
      workspacePath,
      "--artifact",
      task.data.proposalPath ?? "",
      "--json"
    ]);
    expect(pending.command).toBe("swarm output validate");
    expect(pending.data.valid).toBe(false);

    await writeWorkspaceFile({
      workspacePath,
      path: task.data.proposalPath ?? "missing.json",
      actor: "main_agent",
      content: stableJson({
        schemaVersion: SIMULATION_TURN_PROPOSAL_SCHEMA_VERSION,
        sessionId: "session-cli-flow",
        round: 1,
        agent: "kp",
        stage: "kp",
        summary: "KP 推动 Aria 发现钟楼回声。",
        action: { kind: "scene-advance", text: "Aria 进入钟楼并记录回声源。" },
        citations: ["project.md"],
        evidence: [task.data.taskPath ?? ""]
      })
    });

    const valid = await runRegisteredCommand([
      "swarm",
      "output",
      "validate",
      "--workspace",
      workspacePath,
      "--artifact",
      task.data.proposalPath ?? "",
      "--json"
    ]);
    expect(valid.data.valid).toBe(true);

    const applied = await runRegisteredCommand([
      "swarm",
      "output",
      "apply",
      "--workspace",
      workspacePath,
      "--artifact",
      task.data.proposalPath ?? "",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(applied.command).toBe("swarm output apply");
    expect(applied.data.turnPath).toBe("simulation/turns/session-cli-flow/round-001-001-kp.json");

    const finalized = await runRegisteredCommand([
      "swarm",
      "round",
      "finalize",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--round",
      "1",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(finalized.command).toBe("swarm round finalize");
    expect(finalized.data.outputPath).toBe(
      "simulation/sessions/session-cli-flow/swarm/round-001/finalize.json"
    );
    expect(finalized.data.completedStages).toContain("kp");

    const contextPack = await runRegisteredCommand([
      "simulation",
      "context-pack",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--agent",
      "kp",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(contextPack.command).toBe("simulation context-pack");
    expect(contextPack.data.outputPath).toBe("simulation/context-packs/session-cli-flow/kp.json");

    const validation = await runRegisteredCommand([
      "simulation",
      "validate",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--json"
    ]);
    expect(validation.command).toBe("simulation validate");
    expect(validation.data.valid).toBe(true);

    const report = await runRegisteredCommand([
      "simulation",
      "report",
      "--workspace",
      workspacePath,
      "--session",
      "session-cli-flow",
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(report.command).toBe("simulation report");
    expect(report.data.outputPath).toBe("reports/simulation-session-cli-flow.md");
  });
});

async function runRegisteredCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.name("novelfabric-test").exitOverride();
  addSimulationCommands(program);
  addSwarmCommands(program);

  let stdout = "";
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  try {
    await program.parseAsync(["node", "novelfabric-test", ...args], { from: "node" });
  } finally {
    writeSpy.mockRestore();
  }
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}
