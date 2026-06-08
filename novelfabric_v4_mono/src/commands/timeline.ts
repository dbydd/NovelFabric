import type { Command } from "commander";

import { materializeCanonicalTimeline } from "../canonical/materialization.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addTimelineCommands(program: Command): void {
  const timeline = program
    .command("timeline")
    .description("Materialize and inspect canonical timeline resources");

  timeline
    .command("materialize")
    .description("Materialize semantic import events into canonical timeline files")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--semantic-import <path>", "Workspace semantic import artifact path")
    .requiredOption("--session <id>", "Workflow or simulation session id")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: TimelineMaterializeOptions) => {
      const result = await materializeCanonicalTimeline({
        workspacePath: options.workspace,
        actor: options.actor,
        semanticPath: options.semanticImport,
        sessionId: options.session,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "timeline materialize",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type TimelineMaterializeOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly actor: string;
  readonly semanticImport: string;
  readonly session: string;
  readonly reason?: string;
};
