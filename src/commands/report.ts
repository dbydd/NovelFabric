import type { Command } from "commander";

import {
  applyReportArtifact,
  createReportTask,
  listReports,
  showReport,
  validateReportArtifact
} from "../report/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addReportCommands(program: Command): void {
  const report = program
    .command("report")
    .description("Create, validate, apply, and inspect report artifacts");

  const task = report.command("task").description("Manage report agent task artifacts");
  task
    .command("create")
    .description("Create a report task artifact for the wrapped pi runtime")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .requiredOption("--session <id>", "Simulation/session id")
    .requiredOption("--kind <kind>", "Report kind, such as consistency")
    .option("--context-pack <path>", "Workspace context-pack path for the report task")
    .option("--output <path>", "Expected report output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ReportTaskCreateOptions) => {
      const result = await createReportTask({
        workspacePath: options.workspace,
        actor: options.actor,
        session: options.session,
        kind: options.kind,
        ...(options.contextPack === undefined ? {} : { contextPackPath: options.contextPack }),
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "report task create",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  report
    .command("validate")
    .description("Validate a report artifact before applying it")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--artifact <path>", "Workspace report artifact path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ReportValidateOptions) => {
      const result = await validateReportArtifact({
        workspacePath: options.workspace,
        artifactPath: options.artifact
      });
      writeJson({
        ok: true,
        command: "report validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  report
    .command("apply")
    .description("Apply a validated report artifact to reports/")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--artifact <path>", "Workspace report artifact path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--output <path>", "Workspace report output path")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ReportApplyOptions) => {
      const result = await applyReportArtifact({
        workspacePath: options.workspace,
        artifactPath: options.artifact,
        actor: options.actor,
        ...(options.output === undefined ? {} : { outputPath: options.output }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "report apply",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  report
    .command("list")
    .description("List materialized Markdown reports")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ReportWorkspaceOptions) => {
      const result = await listReports({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "report list",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  report
    .command("show")
    .description("Read a materialized report")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--path <path>", "Workspace report path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: ReportShowOptions) => {
      const result = await showReport({ workspacePath: options.workspace, path: options.path });
      writeJson({
        ok: true,
        command: "report show",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type ReportWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type ReportTaskCreateOptions = ReportWorkspaceOptions & {
  readonly actor: string;
  readonly session: string;
  readonly kind: string;
  readonly contextPack?: string;
  readonly output?: string;
  readonly reason?: string;
};

type ReportValidateOptions = ReportWorkspaceOptions & {
  readonly artifact: string;
};

type ReportApplyOptions = ReportValidateOptions & {
  readonly actor: string;
  readonly output?: string;
  readonly reason?: string;
};

type ReportShowOptions = ReportWorkspaceOptions & {
  readonly path: string;
};
