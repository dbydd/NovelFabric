import type { Command } from "commander";

import { writeJson } from "../output.js";
import {
  inspectWorkspaceAgent,
  listWorkspaceAgents,
  validateWorkspaceAgents
} from "../workspace/agents.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addAgentCommands(program: Command): void {
  const agents = program
    .command("agents")
    .description("Inspect NovelFabric workspace agent text assets");

  agents
    .command("list")
    .description("List workspace agents under agents/<id>")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentsWorkspaceOptions) => {
      const result = await listWorkspaceAgents(options.workspace);
      writeJson({
        ok: true,
        command: "agents list",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  agents
    .command("inspect")
    .description("Inspect one workspace agent's profile, soul, memory, and local skills")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--agent <agent-id>", "Agent id under agents/<id>")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentsInspectOptions) => {
      const result = await inspectWorkspaceAgent(options.workspace, options.agent);
      writeJson({
        ok: true,
        command: "agents inspect",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  agents
    .command("validate")
    .description("Validate workspace agent text assets")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: AgentsWorkspaceOptions) => {
      const result = await validateWorkspaceAgents(options.workspace);
      writeJson({
        ok: true,
        command: "agents validate",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!result.valid) {
        process.exitCode = 2;
      }
    });
}

type AgentsWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type AgentsInspectOptions = AgentsWorkspaceOptions & {
  readonly agent: string;
};
