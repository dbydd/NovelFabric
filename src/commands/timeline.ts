import type { Command } from "commander";

export function addTimelineCommands(program: Command): void {
  program
    .command("timeline")
    .description(
      "Timeline semantic content should be produced through constrained agent/user proposals and applied via shared services; no deterministic core timeline materialization command is exposed."
    );
}
