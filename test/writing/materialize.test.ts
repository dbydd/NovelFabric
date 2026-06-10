import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stableJson } from "../../src/simulation/index.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";
import {
  applyWritingDraft,
  materializeWritingDraftFromAgentTask,
  reviewChapter,
  validateWritingDraftArtifact
} from "../../src/writing/index.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const TEST_RUNTIME_EVIDENCE = {
  runtimeRoot: "/tmp/novelfabric-pi-test",
  provider: "axonhub",
  model: "generic-writer",
  modelPurpose: "production",
  piBin: "pi",
  toolPolicy: "--no-tools",
  sessionPolicy: "--no-session",
  contextPolicy: "--no-context-files",
  stdoutBytes: 128,
  stderrBytes: 0
} as const;

describe("writing agent result materialization", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-writing-materialize-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("materializes a completed pi task result into a valid draft and applicable chapter", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/context/source.md",
      content: "# Source\n\n叶小伟醒来，城市边缘传来钟声。第二章里新的选择被摆在桌面。\n",
      actor: "main_agent",
      reason: "seed writing source"
    });
    const citation = await readWorkspaceFile({ workspacePath, path: "writing/context/source.md" });
    await writeCompletedTaskResult({
      taskId: "writing-materialize",
      parsedJson: {
        kind: "novelfabric.workflow.writing-output",
        version: 1,
        title: "钟声之后",
        summary: "叶小伟在钟声中醒来，并在第二章面对城市边缘的新选择。",
        markdown:
          "# 钟声之后\n\n叶小伟醒来时，城市边缘的钟声仍在回荡。第二章的新选择被摆在桌面，他必须决定是否追随那道声音。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声", "第二章"]
      }
    });

    const materialized = await materializeWritingDraftFromAgentTask({
      workspacePath,
      taskId: "writing-materialize",
      actor: "main_agent"
    });
    expect(materialized.draftPath).toMatch(/^writing\/drafts\/.*\.json$/u);
    expect(materialized.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//u);

    const validation = await validateWritingDraftArtifact(workspacePath, materialized.draftPath);
    expect(validation.valid).toBe(true);
    expect(validation.checked).toContain(citation.path);
    expect(validation.checked).toContain(".novelfabric/tasks/writing-materialize/result.json");

    const applied = await applyWritingDraft({
      workspacePath,
      actor: "main_agent",
      draftPath: materialized.draftPath,
      outputPath: "writing/chapters/chapter-materialized.md"
    });
    expect(applied.chapterPath).toBe("writing/chapters/chapter-materialized.md");

    const review = await reviewChapter({ workspacePath, chapterPath: applied.chapterPath });
    expect(review.valid).toBe(true);
    const chapter = await readWorkspaceFile({ workspacePath, path: applied.chapterPath });
    expect(chapter.content).toContain("# 钟声之后");
    expect(chapter.content).toContain("## Source Anchors");
    expect(chapter.content).toContain("## Citations");
    expect(chapter.content).toContain("## Provenance");
    expect(chapter.content).toContain("叶小伟");
    expect(chapter.content).toContain("第二章");
  });

  it("normalizes title while preserving explicit source anchors for legacy-shaped drafts", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/context/legacy.md",
      content: "# Source\n\n叶小伟醒来，城市边缘传来钟声。\n",
      actor: "main_agent",
      reason: "legacy draft source"
    });
    const citation = await readWorkspaceFile({ workspacePath, path: "writing/context/legacy.md" });
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/drafts/legacy.json",
      actor: "main_agent",
      reason: "legacy draft fixture",
      content: stableJson({
        kind: "novelfabric.writing.draft",
        version: 1,
        title: "Chapter 1: The Starting Point",
        markdown: "叶小伟醒来时听见城市边缘传来钟声。",
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声"],
        citations: [{ path: citation.path, hash: citation.hash }]
      })
    });

    const applied = await applyWritingDraft({
      workspacePath,
      actor: "main_agent",
      draftPath: "writing/drafts/legacy.json",
      outputPath: "writing/chapters/legacy.md"
    });
    const chapter = await readWorkspaceFile({ workspacePath, path: applied.chapterPath });
    expect(chapter.content).toContain("# 章节草稿");
    expect(chapter.content).toContain("## Source Anchors\n- 叶小伟醒来");
    expect(chapter.content).toContain(`${citation.path} @ ${citation.hash}`);
  });

  it("rejects placeholder markdown before writing draft artifacts", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/context/source.md",
      content: "# Source\n\n真实引用。\n",
      actor: "main_agent"
    });
    await writeCompletedTaskResult({
      taskId: "writing-placeholder",
      parsedJson: {
        kind: "novelfabric.workflow.writing-output",
        version: 1,
        title: "占位章节",
        summary: "placeholder summary should not become a draft artifact",
        markdown: "Replace this text with real chapter content.",
        citations: ["writing/context/source.md"],
        sourceAnchors: ["真实引用"]
      }
    });

    await expectMaterializeRejects("writing-placeholder", {
      code: "domain_materialization_output_invalid"
    });
  });

  it("rejects wrong domain kind, missing markdown, and ungrounded anchors", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/context/negative.md",
      content: "# Source\n\n叶小伟醒来，城市边缘传来钟声。第二章里新的选择被摆在桌面。\n",
      actor: "main_agent"
    });
    const base = {
      version: 1,
      title: "负向章节",
      summary: "叶小伟醒来后继续追随钟声，并在第二章面对新的选择。",
      citations: ["writing/context/negative.md"],
      sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声", "第二章"]
    } as const;

    await writeCompletedTaskResult({
      taskId: "writing-wrong-kind",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.report-output",
        markdown: "# 错误领域\n\n叶小伟醒来后继续追随钟声。"
      }
    });
    await expectMaterializeRejects("writing-wrong-kind", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "writing-missing-markdown",
      parsedJson: { ...base, kind: "novelfabric.workflow.writing-output" }
    });
    await expectMaterializeRejects("writing-missing-markdown", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "writing-ungrounded-anchor",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.writing-output",
        markdown: "# 章节\n\n叶小伟醒来后继续追随钟声。",
        sourceAnchors: ["不存在的章节锚点"]
      }
    });
    await expectMaterializeRejects("writing-ungrounded-anchor", {
      code: "domain_materialization_anchor_not_found"
    });
  });

  it("detects citation hash drift through draft validation", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/context/drift.md",
      content: "# Source\n\n叶小伟醒来，城市边缘传来钟声。\n",
      actor: "main_agent"
    });
    const citation = await readWorkspaceFile({ workspacePath, path: "writing/context/drift.md" });
    await writeCompletedTaskResult({
      taskId: "writing-drift",
      parsedJson: {
        kind: "novelfabric.workflow.writing-output",
        version: 1,
        title: "漂移章节",
        summary: "叶小伟醒来后继续追随钟声，并记录引用内容。",
        markdown: "# 漂移章节\n\n叶小伟醒来，城市边缘传来钟声。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声"]
      }
    });
    const materialized = await materializeWritingDraftFromAgentTask({
      workspacePath,
      taskId: "writing-drift",
      actor: "main_agent"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: citation.path,
      content: "# Source\n\n引用内容已经改变。\n",
      actor: "main_agent"
    });

    const validation = await validateWritingDraftArtifact(workspacePath, materialized.draftPath);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("citation_hash_mismatch");
  });

  async function expectMaterializeRejects(
    taskId: string,
    expected: { readonly code: string }
  ): Promise<void> {
    await expect(
      materializeWritingDraftFromAgentTask({
        workspacePath,
        taskId,
        actor: "main_agent"
      })
    ).rejects.toMatchObject(expected);
  }

  async function writeCompletedTaskResult(request: {
    readonly taskId: string;
    readonly parsedJson: Record<string, unknown>;
    readonly runtimeEvidence?: Record<string, unknown>;
  }): Promise<void> {
    const rawText = JSON.stringify(request.parsedJson, null, 2);
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/tasks/${request.taskId}/result.json`,
      actor: "main_agent",
      reason: "seed synthetic agent result",
      content: stableJson({
        kind: "novelfabric.agent.task.result",
        version: 1,
        taskId: request.taskId,
        status: "completed",
        runtime: "pi",
        actor: "main_agent",
        updatedAt: "2026-06-07T00:00:00.000Z",
        piSdk: { adapter: "@earendil-works/pi-coding-agent", available: true },
        runtimeEvidence: request.runtimeEvidence ?? TEST_RUNTIME_EVIDENCE,
        output: {
          kind: "novelfabric.agent.task.output",
          version: 1,
          format: "json",
          rawText,
          parsedJson: request.parsedJson
        },
        notes: []
      })
    });
  }
});

async function grantProtectedTaskWrite(workspacePath: string): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      'allow = ["project.manage", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}
