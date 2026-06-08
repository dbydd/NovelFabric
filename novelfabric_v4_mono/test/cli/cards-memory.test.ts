import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addCardCommands } from "../../src/commands/cards.js";
import { addMemoryCommands } from "../../src/commands/memory.js";
import { addTimelineCommands } from "../../src/commands/timeline.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    cardCount: z.number().optional(),
    proposalPath: z.string().optional(),
    valid: z.boolean().optional(),
    appliedCount: z.number().optional(),
    resultCount: z.number().optional(),
    path: z.string().optional(),
    targetPath: z.string().optional(),
    writes: z.array(z.looseObject({ path: z.string() })).optional()
  })
});

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("cards and memory command registrations", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cards-memory-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "cards.propose", "cards.apply", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]\n',
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, "imports", "source", "cli-source.md"),
      "# CLI Source\n\n阿莉娅在星门雨城发现钟楼规则。\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, "memory", "global", "shared.md"),
      "# Shared Memory\n\n星门雨城初始事实。\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("exposes cards proposal/apply commands without src/cli.ts integration", async () => {
    const proposed = await runRegisteredCommand([
      "cards",
      "propose",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--citation",
      "imports/source/cli-source.md",
      "--kind",
      "world",
      "--title",
      "CLI 雨城",
      "--target-path",
      "cards/world/cli-rain-city.md",
      "--content",
      "# CLI 雨城\n\n由 CLI proposal 写入。\n",
      "--json"
    ]);
    expect(proposed.command).toBe("cards propose");
    const proposalPath = proposed.data.proposalPath;
    expect(proposalPath).toMatch(/^proposals\/cards\/card-/);

    const validation = await runRegisteredCommand([
      "cards",
      "validate",
      "--workspace",
      workspacePath,
      "--proposal",
      String(proposalPath),
      "--json"
    ]);
    expect(validation.command).toBe("cards validate");
    expect(validation.data.valid).toBe(true);

    const applied = await runRegisteredCommand([
      "cards",
      "apply",
      "--workspace",
      workspacePath,
      "--proposal",
      String(proposalPath),
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(applied.command).toBe("cards apply");
    expect(applied.data.appliedCount).toBe(1);

    const list = await runRegisteredCommand([
      "cards",
      "list",
      "--workspace",
      workspacePath,
      "--kind",
      "world",
      "--json"
    ]);
    expect(list.command).toBe("cards list");
    expect(list.data.cardCount).toBeGreaterThan(0);
  });

  it("exposes semantic-backed card, memory, and timeline materialization commands", async () => {
    const semanticPath = await writeSemanticImportArtifact(workspacePath);

    const proposed = await runRegisteredCommand([
      "cards",
      "propose",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--semantic-import",
      semanticPath,
      "--output",
      "proposals/cards/cli-canonical.json",
      "--json"
    ]);
    expect(proposed.command).toBe("cards propose");
    expect(proposed.data.cardCount).toBeGreaterThanOrEqual(4);

    const memory = await runRegisteredCommand([
      "memory",
      "materialize",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--semantic-import",
      semanticPath,
      "--session",
      "cli-session",
      "--role-agent",
      "main_agent",
      "--json"
    ]);
    expect(memory.command).toBe("memory materialize");
    expect(memory.data.writes?.some((write) => write.path.startsWith("memory/global/"))).toBe(true);

    const timeline = await runRegisteredCommand([
      "timeline",
      "materialize",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--semantic-import",
      semanticPath,
      "--session",
      "cli-session",
      "--json"
    ]);
    expect(timeline.command).toBe("timeline materialize");
    expect(timeline.data.writes?.some((write) => write.path === "timeline/index.json")).toBe(true);
  });

  it("exposes memory recall/append/proposal commands without src/cli.ts integration", async () => {
    const recall = await runRegisteredCommand([
      "memory",
      "recall",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--profile",
      "main_agent",
      "--query",
      "星门 雨城",
      "--json"
    ]);
    expect(recall.command).toBe("memory recall");
    expect(recall.data.resultCount).toBeGreaterThan(0);

    const append = await runRegisteredCommand([
      "memory",
      "append",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--profile",
      "main_agent",
      "--content",
      "CLI append memory entry.",
      "--json"
    ]);
    expect(append.command).toBe("memory append");
    expect(append.data.path).toBe("memory/agents/main_agent.md");

    const proposed = await runRegisteredCommand([
      "memory",
      "propose-shared",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--citation",
      "imports/source/cli-source.md",
      "--content",
      "共享事实来自 CLI source。",
      "--json"
    ]);
    expect(proposed.command).toBe("memory propose-shared");
    const proposalPath = proposed.data.proposalPath;
    expect(proposalPath).toMatch(/^proposals\/memory\/shared-/);

    const validation = await runRegisteredCommand([
      "memory",
      "validate-proposal",
      "--workspace",
      workspacePath,
      "--proposal",
      String(proposalPath),
      "--json"
    ]);
    expect(validation.command).toBe("memory validate-proposal");
    expect(validation.data.valid).toBe(true);

    const applied = await runRegisteredCommand([
      "memory",
      "apply-proposal",
      "--workspace",
      workspacePath,
      "--proposal",
      String(proposalPath),
      "--actor",
      "main_agent",
      "--json"
    ]);
    expect(applied.command).toBe("memory apply-proposal");
    expect(applied.data.targetPath).toBe("memory/global/shared.md");
  });
});

async function writeSemanticImportArtifact(workspacePath: string): Promise<string> {
  const sourcePath = path.join(workspacePath, "imports", "source", "cli-source.md");
  const sourceContent = await fs.readFile(sourcePath, "utf8");
  const sourceHash = `sha256:${Buffer.from(sourceContent).toString("hex").slice(0, 64)}`;
  const semanticPath = "imports/semantic/cli-source.json";
  await fs.mkdir(path.join(workspacePath, "imports", "semantic"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, semanticPath),
    `${JSON.stringify(
      {
        kind: "novelfabric.import.semantic",
        version: 1,
        sourcePath: "imports/source/cli-source.md",
        sourceHash,
        contextPackPath: "imports/source/cli-source.md",
        contextPackHash: sourceHash,
        summary:
          "阿莉娅在星门雨城发现钟楼规则，人物、世界、规则与场景都需要进入 canonical workspace 资源。",
        chapters: [
          {
            title: "CLI Source",
            summary: "阿莉娅在星门雨城发现钟楼规则，形成导入后的章节记忆。",
            sourceAnchors: ["阿莉娅在星门雨城", "钟楼规则"]
          }
        ],
        characters: [
          {
            name: "阿莉娅",
            summary:
              "阿莉娅是发现钟楼规则的行动者，她的角色卡必须来自导入语义而不是 workflow role。",
            sourceAnchors: ["阿莉娅在星门雨城"]
          }
        ],
        events: [
          {
            title: "发现钟楼规则",
            summary: "阿莉娅在星门雨城发现钟楼规则，这个事件提供场景和后续推演依据。",
            sourceAnchors: ["阿莉娅在星门雨城", "钟楼规则"]
          }
        ],
        cardSeeds: [
          {
            kind: "world",
            title: "星门雨城",
            summary: "星门雨城是钟楼规则发生作用的世界舞台，后续设定需要引用导入证据。",
            sourceAnchors: ["星门雨城", "钟楼规则"]
          },
          {
            kind: "other",
            title: "钟楼规则",
            summary: "钟楼规则是约束角色行动和城市秩序的规则，不得被推演绕过。",
            sourceAnchors: ["钟楼规则"]
          },
          {
            kind: "plot",
            title: "发现钟楼规则",
            summary: "阿莉娅发现钟楼规则的场景，是后续章节和推演的起点。",
            sourceAnchors: ["阿莉娅在星门雨城"]
          }
        ],
        sourceAnchors: ["阿莉娅在星门雨城", "钟楼规则"],
        citations: [{ path: "imports/source/cli-source.md", hash: sourceHash }],
        createdFromTask: {
          taskId: "cli-semantic",
          resultPath: "imports/source/cli-source.md",
          resultHash: sourceHash
        },
        materializedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return semanticPath;
}

async function runRegisteredCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.name("novelfabric-test").exitOverride();
  addCardCommands(program);
  addMemoryCommands(program);
  addTimelineCommands(program);

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
