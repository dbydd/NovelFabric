import type { Command } from "commander";

import { canonicalLayout } from "../workspace/layout.js";
import { inspectWorkspace } from "../workspace/doctor.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addWorkspaceCommands(program: Command): void {
  const workspace = program
    .command("workspace")
    .description("Inspect NovelFabric project workspaces");

  workspace
    .command("print-layout")
    .description("Print the canonical V4 workspace layout contract")
    .option("--json", "Print machine-readable JSON")
    .action((options: JsonOutputOptions) => {
      writeJson({
        ok: true,
        command: "workspace print-layout",
        data: {
          version: "v4",
          entries: canonicalLayout,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  workspace
    .command("doctor")
    .description("Validate a workspace path against the canonical V4 layout")
    .requiredOption("--path <path>", "Workspace path to inspect")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkspaceDoctorOptions) => {
      const report = await inspectWorkspace(options.path);
      writeJson({
        ok: true,
        command: "workspace doctor",
        data: {
          ...report,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!report.valid) {
        process.exitCode = 2;
      }
    });
}

type WorkspaceDoctorOptions = JsonOutputOptions & {
  readonly path: string;
};
