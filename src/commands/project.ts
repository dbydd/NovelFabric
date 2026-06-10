import type { Command } from "commander";

import {
  initProject,
  inspectProject,
  listProjects,
  validateProject
} from "../workspace/project.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addProjectCommands(program: Command): void {
  const project = program.command("project").description("Create and inspect NovelFabric projects");

  project
    .command("init")
    .description("Create a new canonical V4 project workspace")
    .requiredOption("--path <path>", "Workspace path to create")
    .requiredOption("--name <title>", "Human-readable project title")
    .option("--slug <slug>", "ASCII project slug")
    .option("--template <template>", "Workspace template id", "novel-project")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ProjectInitOptions) => {
      const result = await initProject({
        path: options.path,
        name: options.name,
        ...(options.slug === undefined ? {} : { slug: options.slug }),
        template: options.template
      });
      writeJson({
        ok: true,
        command: "project init",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  project
    .command("inspect")
    .description("Inspect project metadata and layout status")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ProjectWorkspaceOptions) => {
      const result = await inspectProject(options.workspace);
      writeJson({
        ok: true,
        command: "project inspect",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  project
    .command("validate")
    .description("Validate project metadata and canonical layout")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ProjectWorkspaceOptions) => {
      const result = await validateProject(options.workspace);
      writeJson({
        ok: true,
        command: "project validate",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!result.valid) {
        process.exitCode = 2;
      }
    });

  project
    .command("list")
    .description("List project workspaces under a root directory")
    .requiredOption("--root <path>", "Root directory to scan")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ProjectListOptions) => {
      const result = await listProjects(options.root);
      writeJson({
        ok: true,
        command: "project list",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });
}

type ProjectInitOptions = JsonOutputOptions & {
  readonly path: string;
  readonly name: string;
  readonly slug?: string;
  readonly template: string;
};

type ProjectWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type ProjectListOptions = JsonOutputOptions & {
  readonly root: string;
};
