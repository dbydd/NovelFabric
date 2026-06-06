import type { Command } from "commander";

import { CommandFailure } from "../errors.js";
import {
  appendSimulationTurn,
  buildSimulationContextPack,
  createSimulationSession,
  inspectSimulationSession,
  renderSimulationReport,
  validateSimulationSession
} from "../simulation/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addSimulationCommands(program: Command): void {
  const simulation = program
    .command("simulation")
    .description("Deterministic simulation session, turn, context-pack, and report tools");

  const session = simulation
    .command("session")
    .description("Create and inspect simulation sessions");

  session
    .command("create")
    .description("Create an audited simulation session manifest")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--objective <text>", "Simulation objective")
    .requiredOption("--timeline <name>", "Timeline name, usually main")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--session <id>", "Explicit session id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationSessionCreateOptions) => {
      const result = await createSimulationSession({
        workspacePath: options.workspace,
        objective: options.objective,
        timeline: options.timeline,
        actor: options.actor,
        ...(options.session === undefined ? {} : { sessionId: options.session }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "simulation session create",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  session
    .command("inspect")
    .description("Inspect a simulation session manifest")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationSessionInspectOptions) => {
      const result = await inspectSimulationSession({
        workspacePath: options.workspace,
        session: options.session
      });
      writeJson({
        ok: true,
        command: "simulation session inspect",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  simulation
    .command("context-pack")
    .description("Build an audited simulation context pack for a pi-agent task")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--agent <agent-id>", "Agent id for the context pack")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--output <path>", "Workspace output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationContextPackOptions) => {
      const result = await buildSimulationContextPack({
        workspacePath: options.workspace,
        session: options.session,
        agent: options.agent,
        actor: options.actor,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "simulation context-pack",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  simulation
    .command("append-turn")
    .description("Validate and append an audited turn from a proposal artifact")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--proposal <path>", "Workspace proposal artifact path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationAppendTurnOptions) => {
      const result = await appendSimulationTurn({
        workspacePath: options.workspace,
        session: options.session,
        proposalPath: options.proposal,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "simulation append-turn",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  simulation
    .command("validate")
    .description("Validate a simulation session manifest and turn hashes")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationSessionInspectOptions) => {
      const result = await validateSimulationSession({
        workspacePath: options.workspace,
        session: options.session
      });
      writeJson({
        ok: true,
        command: "simulation validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  simulation
    .command("report")
    .description("Render an audited deterministic simulation report")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--session <id>", "Simulation session id")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--output <path>", "Workspace output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SimulationReportOptions) => {
      const result = await renderSimulationReport({
        workspacePath: options.workspace,
        session: options.session,
        actor: options.actor,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "simulation report",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type SimulationSessionCreateOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly objective: string;
  readonly timeline: string;
  readonly actor: string;
  readonly session?: string;
  readonly reason?: string;
};

type SimulationSessionInspectOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly session: string;
};

type SimulationContextPackOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly session: string;
  readonly agent: string;
  readonly actor: string;
  readonly output?: string;
  readonly reason?: string;
};

type SimulationAppendTurnOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly session: string;
  readonly proposal: string;
  readonly actor: string;
  readonly reason?: string;
};

type SimulationReportOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly session: string;
  readonly actor: string;
  readonly output?: string;
  readonly reason?: string;
};

export function parsePositiveIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed.toString() !== value || parsed < 1) {
    throw new CommandFailure(
      "invalid_integer_option",
      `Expected positive integer option, got '${value}'.`
    );
  }
  return parsed;
}
