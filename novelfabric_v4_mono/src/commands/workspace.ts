import type { Command } from "commander";

import { canonicalLayout } from "../workspace/layout.js";
import { inspectWorkspace } from "../workspace/doctor.js";
import { materializeWorkspace } from "../workspace/project.js";
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
      await writeWorkspaceInspection("workspace doctor", options.path, options);
    });

  workspace
    .command("inspect")
    .description("Inspect a workspace path against the canonical V4 layout")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkspacePathOptions) => {
      await writeWorkspaceInspection("workspace inspect", options.workspace, options);
    });

  workspace
    .command("validate")
    .description("Validate a workspace path against the canonical V4 layout")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkspacePathOptions) => {
      await writeWorkspaceInspection("workspace validate", options.workspace, options);
    });

  workspace
    .command("materialize")
    .description("Materialize missing canonical V4 workspace layout entries")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--template <template>", "Workspace template id", "novel-project")
    .requiredOption("--actor <actor>", "Actor requesting workspace materialization")
    .option("--name <title>", "Project title to write when project metadata is missing")
    .option("--slug <slug>", "Project slug to write when project metadata is missing")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: WorkspaceMaterializeOptions) => {
      const result = await materializeWorkspace({
        workspacePath: options.workspace,
        template: options.template,
        actor: options.actor,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.slug === undefined ? {} : { slug: options.slug })
      });
      writeJson({
        ok: true,
        command: "workspace materialize",
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

async function writeWorkspaceInspection(
  command: "workspace doctor" | "workspace inspect" | "workspace validate",
  workspacePath: string,
  options: JsonOutputOptions
): Promise<void> {
  const report = await inspectWorkspace(workspacePath);
  writeJson({
    ok: true,
    command,
    data: {
      ...report,
      outputMode: resolveOutputMode(options)
    }
  });
  if (!report.valid) {
    process.exitCode = 2;
  }
}

type WorkspaceDoctorOptions = JsonOutputOptions & {
  readonly path: string;
};

type WorkspacePathOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type WorkspaceMaterializeOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly template: string;
  readonly actor: string;
  readonly name?: string;
  readonly slug?: string;
};
