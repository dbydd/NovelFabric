import type { Command } from "commander";

import {
  listKnowledgeSources,
  readKnowledgeGraphEdges,
  readKnowledgeGraphEpisodes,
  readKnowledgeGraphNodes,
  rebuildKnowledgeIndex,
  validateKnowledgeIndex
} from "../knowledge/index.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

export function addKnowledgeCommands(program: Command): void {
  const knowledge = program
    .command("knowledge")
    .description("Deterministic StoryRAG source and graph index tools");

  const sources = knowledge.command("sources").description("Inspect knowledge source documents");
  sources
    .command("list")
    .description("List deterministic source files used by knowledge rebuild")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeWorkspaceOptions) => {
      const result = await listKnowledgeSources({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "knowledge sources list",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  knowledge
    .command("rebuild")
    .description("Rebuild deterministic derived knowledge indexes under knowledge/")
    .requiredOption("--workspace <path>", "Workspace root path")
    .requiredOption("--actor <actor>", "Capability manifest actor name")
    .option("--reason <reason>", "Audit log reason")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeRebuildOptions) => {
      const result = await rebuildKnowledgeIndex({
        workspacePath: options.workspace,
        actor: options.actor,
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeJson({
        ok: true,
        command: "knowledge rebuild",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  knowledge
    .command("validate")
    .description("Validate derived knowledge indexes against source files")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeWorkspaceOptions) => {
      const result = await validateKnowledgeIndex({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "knowledge validate",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  const graph = knowledge.command("graph").description("Inspect derived knowledge graph artifacts");
  graph
    .command("nodes")
    .description("List derived knowledge graph nodes")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeWorkspaceOptions) => {
      const result = await readKnowledgeGraphNodes({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "knowledge graph nodes",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  graph
    .command("edges")
    .description("List derived knowledge graph edges")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeWorkspaceOptions) => {
      const result = await readKnowledgeGraphEdges({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "knowledge graph edges",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });

  graph
    .command("episodes")
    .description("List derived knowledge graph episodes")
    .requiredOption("--workspace <path>", "Workspace root path")
    .option("--json", "Print machine-readable JSON")
    .action(async (options: KnowledgeWorkspaceOptions) => {
      const result = await readKnowledgeGraphEpisodes({ workspacePath: options.workspace });
      writeJson({
        ok: true,
        command: "knowledge graph episodes",
        data: { ...result, outputMode: resolveOutputMode(options) }
      });
    });
}

type KnowledgeWorkspaceOptions = JsonOutputOptions & {
  readonly workspace: string;
};

type KnowledgeRebuildOptions = KnowledgeWorkspaceOptions & {
  readonly actor: string;
  readonly reason?: string;
};
