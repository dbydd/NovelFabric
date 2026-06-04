import type { Command } from "commander";

import { resolveConfigRoot } from "../config/config-root.js";
import { readProcessEnvironment } from "../environment.js";
import { writeJson } from "../output.js";

export function addConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect NovelFabric V4 configuration");

  config
    .command("path")
    .description("Print the resolved NovelFabric config root")
    .option("--json", "Print machine-readable JSON", true)
    .action(() => {
      const resolution = resolveConfigRoot(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "config path",
        data: resolution
      });
    });

  config
    .command("print")
    .description("Print configuration diagnostics")
    .option("--json", "Print machine-readable JSON", true)
    .action(() => {
      const resolution = resolveConfigRoot(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "config print",
        data: {
          configRoot: resolution.configRoot,
          resolutionSource: resolution.source,
          expectedFiles: [
            "config.toml",
            "workspace-defaults.toml",
            "agent-clients.toml",
            "profiles/default.toml"
          ],
          expectedDirectories: [
            "templates",
            "templates/projects",
            "templates/agents",
            "templates/skills",
            "schema"
          ]
        }
      });
    });
}
