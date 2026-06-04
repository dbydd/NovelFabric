import type { Command } from "commander";

import { resolveConfigRoot } from "../config/config-root.js";
import { expectedConfigDirectories, expectedConfigFiles } from "../config/layout.js";
import { readProcessEnvironment } from "../environment.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect NovelFabric V4 configuration");

  config
    .command("path")
    .description("Print the resolved NovelFabric config root")
    .option("--json", "Print machine-readable JSON")
    .action((options: JsonOutputOptions) => {
      const resolution = resolveConfigRoot(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "config path",
        data: {
          ...resolution,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  config
    .command("print")
    .description("Print configuration diagnostics")
    .option("--json", "Print machine-readable JSON")
    .action((options: JsonOutputOptions) => {
      const resolution = resolveConfigRoot(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "config print",
        data: {
          configRoot: resolution.configRoot,
          resolutionSource: resolution.source,
          expectedFiles: expectedConfigFiles,
          expectedDirectories: expectedConfigDirectories,
          outputMode: resolveOutputMode(options)
        }
      });
    });
}
