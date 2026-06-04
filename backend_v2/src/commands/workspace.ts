import type { Command } from "commander";

import { canonicalLayout } from "../workspace/layout.js";
import { inspectWorkspace } from "../workspace/doctor.js";
import { writeJson } from "../output.js";

export function addWorkspaceCommands(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Inspect NovelFabric project workspaces");

  workspace
    .command("print-layout")
    .description("Print the canonical V4 workspace layout contract")
    .option("--json", "Print machine-readable JSON", true)
    .action(() => {
      writeJson({
        ok: true,
        command: "workspace print-layout",
        data: {
          version: "v4",
          entries: canonicalLayout
        }
      });
    });

  workspace
    .command("doctor")
    .description("Validate a workspace path against the canonical V4 layout")
    .requiredOption("--path <path>", "Workspace path to inspect")
    .option("--json", "Print machine-readable JSON", true)
    .action(async (options: WorkspaceDoctorOptions) => {
      const report = await inspectWorkspace(options.path);
      writeJson({
        ok: true,
        command: "workspace doctor",
        data: report
      });
      if (!report.valid) {
        process.exitCode = 2;
      }
    });
}

type WorkspaceDoctorOptions = {
  readonly path: string;
};
