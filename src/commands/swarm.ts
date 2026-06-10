import type { Command } from "commander";

import {
  applySwarmOutput,
  createSwarmTask,
  finalizeSwarmRound,
  planSwarmRound,
  validateSwarmOutput
} from "../swarm/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";
import { parsePositiveIntegerOption } from "./simulation.js";

export function addSwarmCommands(program: Command): void {
  const swarm = program
    .command("swarm")
    .description(
      "Deterministic StorySwarm planning, task package, proposal validation, and apply tools"
    );

  swarm
    .command("plan")
    .description("Plan the fixed StorySwarm round order for a simulation session")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--round <n>", "Round number", parsePositiveIntegerOption)
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SwarmPlanOptions) => {
      const result = await planSwarmRound({
        workspacePath: options.workspace,
        session: options.session,
        round: options.round
      });
      writeJson({
        ok: true,
        command: "swarm plan",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  const task = swarm.command("task").description("Create pi-agent task packages for swarm rounds");
  task
    .command("create")
    .description("Create an audited task package and proposal template artifact")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--round <n>", "Round number", parsePositiveIntegerOption)
    .requiredOption("--agent <agent-id>", "Agent id for the task")
    .option("--actor <actor>", "Capability manifest actor name", "main_agent")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SwarmTaskCreateOptions) => {
      const result = await createSwarmTask({
        workspacePath: options.workspace,
        session: options.session,
        round: options.round,
        agent: options.agent,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "swarm task create",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  const output = swarm.command("output").description("Validate and apply swarm output artifacts");
  output
    .command("validate")
    .description("Validate a pi-agent generated swarm proposal artifact")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--artifact <path>", "Workspace output artifact path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SwarmOutputValidateOptions) => {
      const result = await validateSwarmOutput({
        workspacePath: options.workspace,
        artifactPath: options.artifact
      });
      writeJson({
        ok: true,
        command: "swarm output validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  output
    .command("apply")
    .description("Apply a validated swarm proposal as an audited simulation turn")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--artifact <path>", "Workspace output artifact path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SwarmOutputApplyOptions) => {
      const result = await applySwarmOutput({
        workspacePath: options.workspace,
        artifactPath: options.artifact,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "swarm output apply",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  const round = swarm.command("round").description("Finalize and inspect swarm rounds");
  round
    .command("finalize")
    .description("Write an audited round-finalize artifact for a simulation round")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--round <n>", "Round number", parsePositiveIntegerOption)
    .option("--actor <actor>", "Capability manifest actor name", "main_agent")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SwarmRoundFinalizeOptions) => {
      const result = await finalizeSwarmRound({
        workspacePath: options.workspace,
        session: options.session,
        round: options.round,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "swarm round finalize",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type SwarmPlanOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly session: string;
  readonly round: number;
};

type SwarmTaskCreateOptions = SwarmPlanOptions & {
  readonly agent: string;
  readonly actor: string;
  readonly reason?: string;
};

type SwarmOutputValidateOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly artifact: string;
};

type SwarmOutputApplyOptions = SwarmOutputValidateOptions & {
  readonly actor: string;
  readonly reason?: string;
};

type SwarmRoundFinalizeOptions = SwarmPlanOptions & {
  readonly actor: string;
  readonly reason?: string;
};
