import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSemanticImportTask,
  materializeSemanticImportFromAgentTask,
  validateSemanticImportArtifact
} from "../../src/import/semantic.js";
import { buildImportContextPack, chapterizeImportSource } from "../../src/import/source.js";
import { writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const SOURCE_TEXT = "第一章 起点\n叶小伟抵达钟楼。\n第二章 回声\n城市边缘传来钟声。\n";

describe("semantic import materializer", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-semantic-import-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
    await fs.writeFile(
      path.join(workspacePath, "imports/source/semantic.txt"),
      SOURCE_TEXT,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("creates a pi task and materializes source-grounded semantic import artifacts", async () => {
    const chapterized = await chapterizeImportSource({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/semantic.txt"
    });
    const contextPack = await buildImportContextPack({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/semantic.txt",
      chapterManifestPath: chapterized.manifestPath
    });

    const task = await createSemanticImportTask({
      workspacePath,
      actor: "main_agent",
      taskId: "semantic-import-test",
      sourcePath: "imports/source/semantic.txt",
      contextPackPath: contextPack.outputPath
    });

    expect(task.requiredSourceAnchors.length).toBeGreaterThanOrEqual(2);
    expect(task.files.result).toBe(".novelfabric/tasks/semantic-import-test/result.json");

    await writeCompletedSemanticResult({
      workspacePath,
      taskId: task.taskId,
      resultPath: task.files.result,
      sourcePath: "imports/source/semantic.txt",
      contextPackPath: contextPack.outputPath,
      sourceAnchors: ["第一章 起点", "叶小伟抵达钟楼", "第二章 回声", "城市边缘传来钟声"]
    });

    const result = await materializeSemanticImportFromAgentTask({
      workspacePath,
      actor: "main_agent",
      taskId: task.taskId,
      sourcePath: "imports/source/semantic.txt",
      contextPackPath: contextPack.outputPath,
      outputPath: "imports/semantic/semantic.json"
    });

    expect(result.artifactPath).toBe("imports/semantic/semantic.json");
    expect(result.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//);

    const validation = await validateSemanticImportArtifact({
      workspacePath,
      artifactPath: result.artifactPath
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    const saved = JSON.parse(
      await fs.readFile(path.join(workspacePath, result.artifactPath), "utf8")
    ) as {
      readonly kind: string;
      readonly sourceAnchors: readonly string[];
      readonly chapters: readonly unknown[];
      readonly characters: readonly unknown[];
      readonly cardSeeds: readonly unknown[];
    };
    expect(saved.kind).toBe("novelfabric.import.semantic");
    expect(saved.sourceAnchors).toEqual(
      expect.arrayContaining(["叶小伟抵达钟楼", "城市边缘传来钟声"])
    );
    expect(saved.chapters).toHaveLength(2);
    expect(saved.characters).toHaveLength(1);
    expect(saved.cardSeeds).toHaveLength(2);
  });

  it("rejects semantic import artifacts with anchors not found in source text", async () => {
    const artifactPath = "imports/semantic/bad.json";
    await writeWorkspaceFile({
      workspacePath,
      path: artifactPath,
      actor: "main_agent",
      reason: "test bad semantic artifact",
      content: JSON.stringify(
        {
          kind: "novelfabric.import.semantic",
          version: 1,
          sourcePath: "imports/source/semantic.txt",
          sourceHash: "sha256:stale",
          contextPackPath: "simulation/context-packs/import-semantic.json",
          contextPackHash: "sha256:missing",
          summary: "这是一份足够长的语义拆书摘要，用于验证失败路径。",
          chapters: [
            { title: "坏章节", summary: "坏章节摘要足够长", sourceAnchors: ["不存在锚点"] }
          ],
          characters: [
            { name: "叶小伟", summary: "人物摘要足够长", sourceAnchors: ["不存在锚点"] }
          ],
          events: [{ title: "坏事件", summary: "事件摘要足够长", sourceAnchors: ["不存在锚点"] }],
          cardSeeds: [
            {
              kind: "character",
              title: "坏卡",
              summary: "卡片摘要足够长",
              sourceAnchors: ["不存在锚点"]
            }
          ],
          sourceAnchors: ["不存在锚点"],
          citations: [],
          createdFromTask: {
            taskId: "bad",
            resultPath: ".novelfabric/tasks/bad/result.json",
            resultHash: "sha256:bad"
          },
          materializedAt: new Date().toISOString()
        },
        null,
        2
      )
    });

    const validation = await validateSemanticImportArtifact({ workspacePath, artifactPath });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["source_anchor_not_found", "source_hash_mismatch"])
    );
  });
});

async function writeCompletedSemanticResult(request: {
  readonly workspacePath: string;
  readonly taskId: string;
  readonly resultPath: string;
  readonly sourcePath: string;
  readonly contextPackPath: string;
  readonly sourceAnchors: readonly string[];
}): Promise<void> {
  const parsedJson = {
    kind: "novelfabric.import.semantic-output",
    version: 1,
    summary: "叶小伟在钟楼附近进入故事，城市边缘的钟声推动第二章的选择。",
    chapters: [
      {
        title: "第一章 起点",
        summary: "叶小伟抵达钟楼并进入故事入口。",
        sourceAnchors: ["第一章 起点", "叶小伟抵达钟楼"]
      },
      {
        title: "第二章 回声",
        summary: "城市边缘的钟声形成新的事件压力。",
        sourceAnchors: ["第二章 回声", "城市边缘传来钟声"]
      }
    ],
    characters: [
      {
        name: "叶小伟",
        summary: "叶小伟是抵达钟楼并面对钟声事件的主要角色。",
        sourceAnchors: ["叶小伟抵达钟楼"]
      }
    ],
    events: [
      {
        title: "钟声响起",
        summary: "城市边缘传来的钟声推动后续选择。",
        sourceAnchors: ["城市边缘传来钟声"]
      }
    ],
    cardSeeds: [
      {
        kind: "character",
        title: "叶小伟",
        summary: "基于源文本生成的人物卡种子。",
        sourceAnchors: ["叶小伟抵达钟楼"]
      },
      {
        kind: "scene",
        title: "钟楼与城市边缘",
        summary: "基于钟楼和城市边缘钟声生成的场景卡种子。",
        sourceAnchors: ["城市边缘传来钟声"]
      }
    ],
    sourceAnchors: request.sourceAnchors,
    citations: [request.sourcePath, request.contextPackPath]
  };
  const result = {
    kind: "novelfabric.agent.task.result",
    version: 1,
    taskId: request.taskId,
    status: "completed",
    runtime: "pi",
    actor: "main_agent",
    updatedAt: new Date().toISOString(),
    piSdk: { adapter: "@earendil-works/pi-coding-agent", available: true },
    runtimeEvidence: {
      runtimeRoot: "/tmp/novelfabric-test-pi",
      provider: "axonhub",
      model: "generic-writer",
      modelPurpose: "production",
      engine: "cli",
      toolPolicy: "--no-tools",
      sessionPolicy: "--no-session",
      contextPolicy: "--no-context-files",
      stdoutBytes: 128,
      stderrBytes: 0
    },
    output: {
      kind: "novelfabric.agent.task.output",
      version: 1,
      format: "json",
      rawText: JSON.stringify(parsedJson),
      parsedJson
    },
    notes: []
  };
  await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.resultPath,
    actor: "main_agent",
    reason: "test semantic task result",
    content: `${JSON.stringify(result, null, 2)}\n`
  });
}

async function grantProtectedTaskWrite(workspacePath: string): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      'allow = ["project.manage", "files.patch_protected", "report.render", "knowledge.query"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}
