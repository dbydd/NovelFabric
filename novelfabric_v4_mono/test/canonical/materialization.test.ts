import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCanonicalCardDrafts,
  verifyCanonicalWorkflowCompleteness
} from "../../src/canonical/materialization.js";
import type { NovelFabricSemanticImportArtifact } from "../../src/import/semantic.js";
import { stableJson } from "../../src/simulation/index.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("canonical materialization verification", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-canonical-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "writing.apply", "simulation.append_turn"]\n',
      "utf8"
    );
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/canonical.txt",
      actor: "main_agent",
      content: "第一章\n叶小伟醒来，城市边缘传来钟声。张岚进入办公室。\n",
      reason: "canonical test source"
    });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("does not synthesize a generic rule card without rule evidence", async () => {
    const semantic = await writeSemanticImport({ includeRuleEvidence: false });
    const drafts = buildCanonicalCardDrafts(semantic);
    expect(drafts.map((draft) => draft.kind)).toEqual(
      expect.arrayContaining(["character", "scene", "world"])
    );
    expect(drafts.some((draft) => draft.kind === "rule")).toBe(false);
  });

  it("rejects malformed simulation turn and log resources", async () => {
    const semantic = await writeSemanticImport({ includeRuleEvidence: true });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/turns/session-a/bad.json",
      actor: "main_agent",
      content: "{}",
      reason: "malformed turn fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/logs/session-a.jsonl",
      actor: "main_agent",
      content: `${JSON.stringify({
        kind: "not-a-simulation-log",
        turnPath: "simulation/turns/session-a/bad.json"
      })}\n`,
      reason: "malformed log fixture"
    });

    const result = await verifyCanonicalWorkflowCompleteness({
      workspacePath,
      semanticPath: "imports/semantic/canonical.json",
      completedStageIds: ["swarm.task.create"]
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "canonical_simulation_turn_invalid",
        "canonical_simulation_turn_missing_action",
        "canonical_simulation_log_invalid"
      ])
    );
    expect(semantic.kind).toBe("novelfabric.import.semantic");
  });

  it("rejects chapter citations that are declared but not workspace-grounded", async () => {
    await writeSemanticImport({ includeRuleEvidence: true });
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/chapters/fake.md",
      actor: "main_agent",
      content: [
        "# 伪造章节",
        "",
        "叶小伟醒来后重新整理线索，并准备与张岚沟通。这个章节足够长，但引用故意指向不存在的文件，以证明 verify 不会只看章节里是否写了 Citations 小节。",
        "",
        "## Source Anchors",
        "- 叶小伟醒来",
        "",
        "## Citations",
        "- missing/fake.md @ sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "",
        "## Provenance",
        "- source_draft: writing/drafts/fake.json",
        ""
      ].join("\n"),
      reason: "fake chapter fixture"
    });

    const result = await verifyCanonicalWorkflowCompleteness({
      workspacePath,
      semanticPath: "imports/semantic/canonical.json",
      completedStageIds: ["writing.apply"]
    });
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "canonical_chapter_citation_unreadable")
    ).toBe(true);
  });

  async function writeSemanticImport(request: {
    readonly includeRuleEvidence: boolean;
  }): Promise<NovelFabricSemanticImportArtifact> {
    const source = await readWorkspaceFile({ workspacePath, path: "imports/source/canonical.txt" });
    const semantic: NovelFabricSemanticImportArtifact = {
      kind: "novelfabric.import.semantic",
      version: 1,
      sourcePath: source.path,
      sourceHash: source.hash,
      contextPackPath: source.path,
      contextPackHash: source.hash,
      summary: "叶小伟醒来并听到钟声，张岚进入办公室，人物、场景和世界信息需要结构化沉淀。",
      chapters: [
        {
          title: "第一章",
          summary: "叶小伟醒来后听见钟声，张岚进入办公室。",
          sourceAnchors: ["叶小伟醒来", "张岚进入办公室"]
        }
      ],
      characters: [
        {
          name: "叶小伟",
          summary: "叶小伟是醒来后面对异常环境的核心人物。",
          sourceAnchors: ["叶小伟醒来"]
        }
      ],
      events: [
        {
          title: request.includeRuleEvidence ? "身份对峙" : "办公室相遇",
          summary: request.includeRuleEvidence
            ? "张岚进入办公室后形成身份对峙，公安身份约束了双方行动。"
            : "张岚进入办公室后与叶小伟相遇，场景推动后续行动。",
          sourceAnchors: ["张岚进入办公室"]
        }
      ],
      cardSeeds: [
        {
          kind: "world",
          title: "钟声城市",
          summary: "城市边缘传来钟声，为故事提供世界氛围和行动背景。",
          sourceAnchors: ["城市边缘传来钟声"]
        },
        {
          kind: "plot",
          title: "办公室相遇",
          summary: "叶小伟醒来之后与张岚在办公室场景中发生接触。",
          sourceAnchors: ["叶小伟醒来", "张岚进入办公室"]
        },
        ...(request.includeRuleEvidence
          ? [
              {
                kind: "other" as const,
                title: "公安身份约束",
                summary: "公安身份和办公室对峙约束双方行动，后续推演不得绕过该身份规则。",
                sourceAnchors: ["张岚进入办公室"]
              }
            ]
          : [])
      ],
      sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声", "张岚进入办公室"],
      citations: [{ path: source.path, hash: source.hash }],
      createdFromTask: {
        taskId: "canonical-test",
        resultPath: source.path,
        resultHash: source.hash
      },
      materializedAt: new Date().toISOString()
    };
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/semantic/canonical.json",
      actor: "main_agent",
      content: stableJson(semantic),
      reason: "canonical semantic fixture"
    });
    return semantic;
  }
});
