import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addContextPackCommands } from "../../src/commands/context-pack.js";
import { addKnowledgeCommands } from "../../src/commands/knowledge.js";
import { addRecallCommands } from "../../src/commands/recall.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    sourceCount: z.number().optional(),
    nodeCount: z.number().optional(),
    edgeCount: z.number().optional(),
    episodeCount: z.number().optional(),
    valid: z.boolean().optional(),
    outputPath: z.string().optional(),
    citationCount: z.number().optional(),
    mode: z.string().optional()
  })
});

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("knowledge, recall, and context-pack command registrations", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-knowledge-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "cards", "characters", "aria.md"),
      "# 阿莉娅\n阿莉娅穿过星门城市，记录雨城线索。\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("exposes knowledge source, rebuild, validate, and graph inspection commands", async () => {
    const sources = await runRegisteredCommand([
      "knowledge",
      "sources",
      "list",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(sources.command).toBe("knowledge sources list");
    expect(sources.data.sourceCount).toBeGreaterThan(0);

    const rebuild = await runRegisteredCommand([
      "knowledge",
      "rebuild",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(rebuild.command).toBe("knowledge rebuild");
    expect(rebuild.data.nodeCount).toBeGreaterThan(0);

    const nodes = await runRegisteredCommand([
      "knowledge",
      "graph",
      "nodes",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(nodes.command).toBe("knowledge graph nodes");
    expect(nodes.data.nodeCount).toBeGreaterThan(0);

    const edges = await runRegisteredCommand([
      "knowledge",
      "graph",
      "edges",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(edges.command).toBe("knowledge graph edges");
    expect(edges.data.edgeCount).toBeGreaterThan(0);

    const episodes = await runRegisteredCommand([
      "knowledge",
      "graph",
      "episodes",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(episodes.command).toBe("knowledge graph episodes");
    expect(episodes.data.episodeCount).toBeGreaterThan(0);

    const validation = await runRegisteredCommand([
      "knowledge",
      "validate",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(validation.command).toBe("knowledge validate");
    expect(validation.data.valid).toBe(true);
  });

  it("exposes recall and context-pack commands without requiring src/cli.ts integration", async () => {
    const recall = await runRegisteredCommand([
      "recall",
      "quick",
      "--workspace",
      workspacePath,
      "--query",
      "星门城市 阿莉娅",
      "--json"
    ]);
    expect(recall.command).toBe("recall quick");
    expect(recall.data.mode).toBe("quick");

    const built = await runRegisteredCommand([
      "context-pack",
      "build",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--kind",
      "role-turn",
      "--query",
      "星门城市 阿莉娅",
      "--output",
      "knowledge/context-packs/cli-role-turn.json",
      "--json"
    ]);
    expect(built.command).toBe("context-pack build");
    expect(built.data.outputPath).toBe("knowledge/context-packs/cli-role-turn.json");
    expect(built.data.citationCount).toBeGreaterThan(0);

    const validation = await runRegisteredCommand([
      "context-pack",
      "validate",
      "--workspace",
      workspacePath,
      "--path",
      "knowledge/context-packs/cli-role-turn.json",
      "--json"
    ]);
    expect(validation.command).toBe("context-pack validate");
    expect(validation.data.valid).toBe(true);
  });
});

async function runRegisteredCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.name("novelfabric-test").exitOverride();
  addKnowledgeCommands(program);
  addRecallCommands(program);
  addContextPackCommands(program);

  let stdout = "";
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  try {
    await program.parseAsync(["node", "novelfabric-test", ...args], { from: "node" });
  } finally {
    writeSpy.mockRestore();
  }
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}
