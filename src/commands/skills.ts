import type { Command } from "commander";

import { resolveConfigRoot } from "../config/config-root.js";
import { readProcessEnvironment } from "../environment.js";
import { writeJson } from "../output.js";
import {
  listWorkspaceSkills,
  readWorkspaceSkill,
  validateWorkspaceSkills
} from "../workspace/skills.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addSkillCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("Inspect NovelFabric workspace and NovelFabric-owned pi skill text assets");

  skills
    .command("list")
    .description("List workspace, agent-local, and optional config-root skills")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--config-root <path>", "NovelFabric config root; defaults to resolved config root")
    .option("--no-global", "Only inspect workspace-local and agent-local skills")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SkillsWorkspaceOptions) => {
      const result = await listWorkspaceSkills(makeSkillsRequest(options));
      writeJson({
        ok: true,
        command: "skills list",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  skills
    .command("read")
    .description("Read one skill by name or qualified name")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--skill <skill-name>", "Skill name or qualified name")
    .option("--config-root <path>", "NovelFabric config root; defaults to resolved config root")
    .option("--no-global", "Only inspect workspace-local and agent-local skills")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SkillsReadOptions) => {
      const result = await readWorkspaceSkill({
        ...makeSkillsRequest(options),
        skill: options.skill
      });
      writeJson({
        ok: true,
        command: "skills read",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  skills
    .command("validate")
    .description("Validate workspace, agent-local, and optional config-root skills")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--config-root <path>", "NovelFabric config root; defaults to resolved config root")
    .option("--no-global", "Only inspect workspace-local and agent-local skills")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: SkillsWorkspaceOptions) => {
      const result = await validateWorkspaceSkills(makeSkillsRequest(options));
      writeJson({
        ok: true,
        command: "skills validate",
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

type SkillsWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
  readonly configRoot?: string;
  readonly global?: boolean;
};

type SkillsReadOptions = SkillsWorkspaceOptions & {
  readonly skill: string;
};

function makeSkillsRequest(options: SkillsWorkspaceOptions): {
  readonly workspacePath: string;
  readonly configRoot?: string;
} {
  const configRoot = resolveOptionalConfigRoot(options);
  return configRoot === undefined
    ? { workspacePath: options.workspace }
    : { workspacePath: options.workspace, configRoot };
}

function resolveOptionalConfigRoot(options: SkillsWorkspaceOptions): string | undefined {
  if (options.global === false) return undefined;
  if (options.configRoot !== undefined) return options.configRoot;
  try {
    return resolveConfigRoot(readProcessEnvironment()).configRoot;
  } catch {
    return undefined;
  }
}
