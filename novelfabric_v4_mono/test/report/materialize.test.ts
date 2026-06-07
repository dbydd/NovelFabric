import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyReportArtifact,
  materializeReportArtifactFromAgentTask,
  validateReportArtifact
} from "../../src/report/index.js";
import { stableJson } from "../../src/simulation/index.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

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

describe("report agent result materialization", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-report-materialize-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("materializes a completed pi task result into a valid and applicable report artifact", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/context/source.md",
      content: "# Source\n\n叶小伟在城市边缘听见钟声，第二章出现新的选择。\n",
      actor: "main_agent",
      reason: "seed report source"
    });
    const citation = await readWorkspaceFile({ workspacePath, path: "reports/context/source.md" });
    await writeCompletedTaskResult({
      taskId: "report-materialize",
      parsedJson: {
        kind: "novelfabric.workflow.report-output",
        version: 1,
        title: "钟声一致性报告",
        summary: "叶小伟听见钟声后，第二章的新选择与城市边缘线索保持一致。",
        markdown: "# 钟声一致性报告\n\n叶小伟在城市边缘听见钟声，第二章的新选择没有破坏既有线索。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟", "钟声", "第二章"]
      }
    });

    const materialized = await materializeReportArtifactFromAgentTask({
      workspacePath,
      taskId: "report-materialize",
      actor: "main_agent",
      reportKind: "consistency",
      session: "session-materialize"
    });
    expect(materialized.artifactPath).toMatch(/^reports\/artifacts\/consistency-/u);
    expect(materialized.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//u);

    const validation = await validateReportArtifact({
      workspacePath,
      artifactPath: materialized.artifactPath
    });
    expect(validation.valid).toBe(true);
    expect(validation.checked).toContain(citation.path);
    expect(validation.checked).toContain(".novelfabric/tasks/report-materialize/result.json");

    const applied = await applyReportArtifact({
      workspacePath,
      artifactPath: materialized.artifactPath,
      actor: "main_agent",
      outputPath: "reports/consistency-materialized.md"
    });
    expect(applied.reportPath).toBe("reports/consistency-materialized.md");
    const report = await readWorkspaceFile({ workspacePath, path: applied.reportPath });
    expect(report.content).toContain("叶小伟");
    expect(report.content).toContain("第二章");
  });

  it("rejects empty parsed JSON before report artifact writes", async () => {
    await writeCompletedTaskResult({ taskId: "report-empty", parsedJson: {} });

    await expectMaterializeRejects("report-empty", {
      code: "domain_materialization_output_invalid"
    });
  });

  it("rejects wrong domain kind, missing markdown, ungrounded anchors, and weak runtime evidence", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/context/negative.md",
      content: "# Source\n\n叶小伟在城市边缘听见钟声，第二章出现新的选择。\n",
      actor: "main_agent"
    });
    const base = {
      version: 1,
      title: "负向报告",
      summary: "叶小伟听见钟声后，第二章的新选择需要进入报告。",
      citations: ["reports/context/negative.md"],
      sourceAnchors: ["叶小伟", "钟声", "第二章"]
    } as const;

    await writeCompletedTaskResult({
      taskId: "report-wrong-kind",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.writing-output",
        markdown: "# 错误领域\n\n叶小伟听见钟声。"
      }
    });
    await expectMaterializeRejects("report-wrong-kind", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "report-missing-markdown",
      parsedJson: { ...base, kind: "novelfabric.workflow.report-output" }
    });
    await expectMaterializeRejects("report-missing-markdown", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "report-ungrounded-anchor",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.report-output",
        markdown: "# 报告\n\n叶小伟听见钟声。",
        sourceAnchors: ["不存在的报告锚点"]
      }
    });
    await expectMaterializeRejects("report-ungrounded-anchor", {
      code: "domain_materialization_anchor_not_found"
    });

    await writeCompletedTaskResult({
      taskId: "report-weak-runtime",
      runtimeEvidence: { provider: "axonhub", model: "generic-writer", stdoutBytes: 0 },
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.report-output",
        markdown: "# 报告\n\n叶小伟听见钟声。"
      }
    });
    await expectMaterializeRejects("report-weak-runtime", {
      code: "domain_materialization_invalid_agent_result"
    });
  });

  it("detects citation hash drift through report validation", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/context/drift.md",
      content: "# Source\n\n叶小伟在城市边缘听见钟声。\n",
      actor: "main_agent"
    });
    const citation = await readWorkspaceFile({ workspacePath, path: "reports/context/drift.md" });
    await writeCompletedTaskResult({
      taskId: "report-drift",
      parsedJson: {
        kind: "novelfabric.workflow.report-output",
        version: 1,
        title: "漂移报告",
        summary: "叶小伟听见钟声后，报告记录当前引用内容。",
        markdown: "# 漂移报告\n\n叶小伟在城市边缘听见钟声。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟", "钟声"]
      }
    });
    const materialized = await materializeReportArtifactFromAgentTask({
      workspacePath,
      taskId: "report-drift",
      actor: "main_agent",
      reportKind: "consistency"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: citation.path,
      content: "# Source\n\n引用内容已经改变。\n",
      actor: "main_agent"
    });

    const validation = await validateReportArtifact({
      workspacePath,
      artifactPath: materialized.artifactPath
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("citation_hash_mismatch");
  });

  async function expectMaterializeRejects(
    taskId: string,
    expected: { readonly code: string }
  ): Promise<void> {
    await expect(
      materializeReportArtifactFromAgentTask({
        workspacePath,
        taskId,
        actor: "main_agent",
        reportKind: "consistency"
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
      'allow = ["project.manage", "files.patch_protected"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}
