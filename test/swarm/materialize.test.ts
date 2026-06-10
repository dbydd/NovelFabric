import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSimulationSession, stableJson } from "../../src/simulation/index.js";
import {
  applySwarmOutput,
  materializeSwarmOutputFromAgentTask,
  validateSwarmOutput
} from "../../src/swarm/index.js";
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

describe("swarm agent result materialization", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-swarm-materialize-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("materializes a completed pi task result into a valid and applicable swarm proposal", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/materialize.txt",
      content: "第一章 开端\n叶小伟醒来，城市边缘传来钟声。\n第二章 余波\n新的选择被摆在桌面。\n",
      actor: "main_agent",
      reason: "seed source"
    });
    const citation = await readWorkspaceFile({
      workspacePath,
      path: "imports/source/materialize.txt"
    });
    await createSimulationSession({
      workspacePath,
      objective: "Bring main_agent through imports/source/materialize.txt.",
      sourcePath: "imports/source/materialize.txt",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-materialize"
    });
    await writeCompletedTaskResult({
      taskId: "swarm-materialize",
      parsedJson: {
        kind: "novelfabric.workflow.swarm-output",
        version: 1,
        title: "钟声行动",
        summary: "叶小伟在钟声后确认城市边缘出现新的行动线索，队伍需要推进调查。",
        actionText: "叶小伟跟随钟声进入城市边缘，记录第二章余波中的新选择。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声", "第二章"]
      }
    });

    const materialized = await materializeSwarmOutputFromAgentTask({
      workspacePath,
      taskId: "swarm-materialize",
      session: "session-materialize",
      round: 1,
      agent: "kp",
      actor: "main_agent"
    });
    expect(materialized.artifactPath).toMatch(
      /^simulation\/sessions\/session-materialize\/swarm\/round-001\/proposals\/kp-materialized\.json$/u
    );
    expect(materialized.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//u);

    const validation = await validateSwarmOutput({
      workspacePath,
      artifactPath: materialized.artifactPath
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    const applied = await applySwarmOutput({
      workspacePath,
      artifactPath: materialized.artifactPath,
      actor: "main_agent"
    });
    expect(applied.turn.summary).toContain("叶小伟");
    expect(applied.turn.action.text).toContain("第二章");
    expect(applied.sessionWrite.auditPath).toMatch(/^\.novelfabric\/audit\/files\//u);
  });

  it("rejects incomplete or placeholder agent results before writing swarm artifacts", async () => {
    await writeCompletedTaskResult({
      taskId: "swarm-placeholder",
      status: "pending-pi-runtime",
      parsedJson: {
        kind: "novelfabric.workflow.swarm-output",
        version: 1,
        summary: "placeholder pending output",
        actionText: "Replace this text with real output.",
        citations: ["project.md"],
        sourceAnchors: ["placeholder"]
      }
    });
    await createSimulationSession({
      workspacePath,
      objective: "验证 materializer 拒绝 pending 结果",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-placeholder"
    });

    await expectMaterializeRejects("swarm-placeholder", "session-placeholder", {
      code: "domain_materialization_invalid_agent_result"
    });
  });

  it("detects citation hash drift through swarm validation", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/swarm-drift.txt",
      content: "叶小伟醒来，城市边缘传来钟声。",
      actor: "main_agent"
    });
    const citation = await readWorkspaceFile({
      workspacePath,
      path: "imports/source/swarm-drift.txt"
    });
    await createSimulationSession({
      workspacePath,
      objective: "drift materializer case",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-drift"
    });
    await writeCompletedTaskResult({
      taskId: "swarm-drift",
      parsedJson: {
        kind: "novelfabric.workflow.swarm-output",
        version: 1,
        summary: "叶小伟在钟声后准备继续行动并记录引用内容。",
        actionText: "叶小伟跟随钟声进入城市边缘。",
        citations: [citation.path],
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声"]
      }
    });
    const materialized = await materializeSwarmOutputFromAgentTask({
      workspacePath,
      taskId: "swarm-drift",
      session: "session-drift",
      round: 1,
      agent: "kp",
      actor: "main_agent"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: citation.path,
      content: "引用内容已经改变。",
      actor: "main_agent"
    });

    const validation = await validateSwarmOutput({
      workspacePath,
      artifactPath: materialized.artifactPath
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("citation_hash_mismatch");
  });

  it("rejects wrong domain kind, missing action text, and ungrounded anchors", async () => {
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/swarm-negative.txt",
      content: "叶小伟醒来，城市边缘传来钟声。",
      actor: "main_agent"
    });
    await createSimulationSession({
      workspacePath,
      objective: "negative materializer cases",
      timeline: "main",
      actor: "main_agent",
      sessionId: "session-negative"
    });
    const base = {
      version: 1,
      summary: "叶小伟在钟声之后准备继续行动并保持证据链。",
      citations: ["imports/source/swarm-negative.txt"],
      sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声"]
    } as const;

    await writeCompletedTaskResult({
      taskId: "swarm-wrong-kind",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.report-output",
        actionText: "叶小伟继续追踪钟声。"
      }
    });
    await expectMaterializeRejects("swarm-wrong-kind", "session-negative", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "swarm-missing-action",
      parsedJson: { ...base, kind: "novelfabric.workflow.swarm-output" }
    });
    await expectMaterializeRejects("swarm-missing-action", "session-negative", {
      code: "domain_materialization_output_invalid"
    });

    await writeCompletedTaskResult({
      taskId: "swarm-ungrounded-anchor",
      parsedJson: {
        ...base,
        kind: "novelfabric.workflow.swarm-output",
        actionText: "叶小伟继续追踪钟声并记录城市边缘的新线索。",
        sourceAnchors: ["不存在的外部锚点"]
      }
    });
    await expectMaterializeRejects("swarm-ungrounded-anchor", "session-negative", {
      code: "domain_materialization_anchor_not_found"
    });
  });

  async function expectMaterializeRejects(
    taskId: string,
    session: string,
    expected: { readonly code: string }
  ): Promise<void> {
    await expect(
      materializeSwarmOutputFromAgentTask({
        workspacePath,
        taskId,
        session,
        round: 1,
        agent: "kp",
        actor: "main_agent"
      })
    ).rejects.toMatchObject(expected);
  }

  async function writeCompletedTaskResult(request: {
    readonly taskId: string;
    readonly parsedJson: Record<string, unknown>;
    readonly status?: "completed" | "pending-pi-runtime";
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
        status: request.status ?? "completed",
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
