import type { Command } from "commander";

import {
  inspectPiSdkAvailability,
  piSdkAvailabilityDiagnostic
} from "../agent-runtime/pi-adapter.js";
import { readProcessEnvironment } from "../environment.js";
import { writeJson } from "../output.js";
import {
  doctorRuntimeConfig,
  getRuntimePolicy,
  inspectRuntimeConfig,
  listRuntimeExtensions,
  materializeRuntimeConfig,
  resolveRuntimeConfigPaths,
  validateRuntimeExtensions
} from "../runtime/config.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addRuntimeCommands(program: Command): void {
  const runtime = program
    .command("runtime")
    .description("Manage the NovelFabric-wrapped pi SDK runtime envelope");

  runtime
    .command("doctor")
    .description("Validate NovelFabric pi runtime config, policy, and extension metadata")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: JsonOutputOptions) => {
      const sdk = await inspectPiSdkAvailability();
      const report = await doctorRuntimeConfig(readProcessEnvironment(), [
        piSdkAvailabilityDiagnostic(sdk)
      ]);
      writeJson({
        ok: true,
        command: "runtime doctor",
        data: {
          ...report,
          sdk,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!report.valid) {
        process.exitCode = 2;
      }
    });

  const config = runtime.command("config").description("Inspect wrapped pi runtime paths");

  config
    .command("path")
    .description("Print the NovelFabric-owned pi runtime config root")
    .option("--json", "Print machine-readable JSON")
    .action((options: JsonOutputOptions) => {
      const paths = resolveRuntimeConfigPaths(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "runtime config path",
        data: {
          ...paths,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  config
    .command("inspect")
    .description("Inspect materialized NovelFabric pi runtime settings and policy")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: JsonOutputOptions) => {
      const inspection = await inspectRuntimeConfig(readProcessEnvironment());
      writeJson({
        ok: true,
        command: "runtime config inspect",
        data: {
          ...inspection,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  runtime
    .command("materialize")
    .description("Materialize safe NovelFabric pi runtime settings, policy, and extension metadata")
    .requiredOption("--actor <actor>", "Default actor for generated runtime settings")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: RuntimeMaterializeOptions) => {
      const result = await materializeRuntimeConfig({
        environment: readProcessEnvironment(),
        actor: options.actor
      });
      writeJson({
        ok: true,
        command: "runtime materialize",
        data: {
          ...result,
          outputMode: resolveOutputMode(options)
        }
      });
    });

  const extensions = runtime
    .command("extensions")
    .description("Inspect NovelFabric pi runtime extension metadata");

  extensions
    .command("list")
    .description("List bundled NovelFabric runtime extension metadata placeholders")
    .option("--json", "Print machine-readable JSON")
    .action((options: JsonOutputOptions) => {
      writeJson({
        ok: true,
        command: "runtime extensions list",
        data: {
          extensions: listRuntimeExtensions(),
          outputMode: resolveOutputMode(options)
        }
      });
    });

  extensions
    .command("validate")
    .description("Validate materialized NovelFabric runtime extension metadata files")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: JsonOutputOptions) => {
      const extensionsStatus = await validateRuntimeExtensions(readProcessEnvironment());
      const missingCount = extensionsStatus.filter((status) => !status.exists).length;
      const invalidCount = extensionsStatus.filter(
        (status) => status.exists && !status.valid
      ).length;
      const valid = missingCount === 0 && invalidCount === 0;
      writeJson({
        ok: true,
        command: "runtime extensions validate",
        data: {
          valid,
          missingCount,
          invalidCount,
          extensions: extensionsStatus,
          outputMode: resolveOutputMode(options)
        }
      });
      if (!valid) {
        process.exitCode = 2;
      }
    });

  const policy = runtime
    .command("policy")
    .description("Inspect NovelFabric runtime tool policy profiles");

  policy
    .command("inspect")
    .description("Print a runtime tool policy profile")
    .requiredOption("--profile <profile>", "Policy profile name; currently only web-safe")
    .option("--json", "Print machine-readable JSON")
    .action((options: RuntimePolicyInspectOptions) => {
      writeJson({
        ok: true,
        command: "runtime policy inspect",
        data: {
          policy: getRuntimePolicy(options.profile),
          outputMode: resolveOutputMode(options)
        }
      });
    });
}

type RuntimeMaterializeOptions = JsonOutputOptions & {
  readonly actor: string;
};

type RuntimePolicyInspectOptions = JsonOutputOptions & {
  readonly profile: string;
};
