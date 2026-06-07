import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentTask, validateAgentOutput } from "../../src/agent-runtime/tasks.js";
import { validateReportArtifact } from "../../src/report/index.js";
import { createSimulationSession } from "../../src/simulation/index.js";
import { validateSwarmOutput } from "../../src/swarm/index.js";
import {
  cancelWorkflow,
  listWorkflowArtifacts,
  peekWorkflow,
  planWorkflow,
  startWorkflow,
  stepWorkflow,
  verifyWorkflow,
  workflowStages
} from "../../src/workflow/index.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";
import { validateWritingDraftArtifact } from "../../src/writing/index.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function completedStagesBefore(index: number, completedAt: string) {
  return workflowStages()
    .slice(0, index)
    .map((stage) => ({ stage: stage.id, completedAt }));
}

function parseAgentTaskResult(content: string): {
  readonly status: string;
  readonly outputText: string;
  readonly sourceAnchors: readonly string[];
} {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected agent task result object.");
  }
  const record = parsed as Record<string, unknown>;
  const output = record["output"];
  const outputRecord =
    typeof output === "object" && output !== null && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : {};
  const outputText = typeof outputRecord["rawText"] === "string" ? outputRecord["rawText"] : "";
  const parsedJson = outputRecord["parsedJson"];
  const parsedRecord =
    typeof parsedJson === "object" && parsedJson !== null && !Array.isArray(parsedJson)
      ? (parsedJson as Record<string, unknown>)
      : {};
  const sourceAnchors = Array.isArray(parsedRecord["sourceAnchors"])
    ? parsedRecord["sourceAnchors"].filter((item): item is string => typeof item === "string")
    : [];
  return {
    status: typeof record["status"] === "string" ? record["status"] : "",
    outputText,
    sourceAnchors
  };
}

function parseJsonRecord(content: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected ${label} object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseWorkflowArtifacts(content: string): {
  readonly items: readonly { readonly name: string; readonly [key: string]: unknown }[];
  readonly [key: string]: unknown;
} {
  const record = parseJsonRecord(content, "workflow artifacts");
  const items = record["items"];
  if (!Array.isArray(items)) throw new Error("Expected workflow artifacts items array.");
  const narrowedItems = items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Expected workflow artifact item object.");
    }
    const itemRecord = item as Record<string, unknown>;
    if (typeof itemRecord["name"] !== "string") {
      throw new Error("Expected workflow artifact item name.");
    }
    return itemRecord as { readonly name: string; readonly [key: string]: unknown };
  });
  return { ...record, items: narrowedItems };
}

describe("workflow acceptance state machine", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-workflow-acceptance-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run"]\n',
      "utf8"
    );
    await writeWorkspaceFile({
      workspacePath,
      path: "imports/source/acceptance-novel.txt",
      actor: "main_agent",
      content: "第一章 开端\n叶小伟醒来，城市边缘传来钟声。\n第二章 余波\n新的选择被摆在桌面。\n",
      reason: "workflow acceptance fixture"
    });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("declares pi-task stages instead of pretending every stage is deterministic", () => {
    const piStages = workflowStages().filter((stage) => stage.semanticRuntime === "pi-task");
    expect(piStages.map((stage) => stage.id)).toEqual([
      "swarm.task.create",
      "report.task.create",
      "writing.draft"
    ]);
  });

  it("requires executed pi task evidence before counting pi-task stages as verified", async () => {
    const jobId = `pi-evidence-job-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const paths = {
      plan: `.novelfabric/jobs/${jobId}/plan.json`,
      job: `.novelfabric/jobs/${jobId}/job.json`,
      state: `.novelfabric/jobs/${jobId}/state.json`,
      artifacts: `.novelfabric/jobs/${jobId}/artifacts.json`,
      result: `.novelfabric/tasks/workflow-${jobId}-swarm.task.create/result.json`
    };
    const stages = workflowStages();
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    expect(swarmStageIndex).toBeGreaterThan(0);

    await writeWorkspaceFile({
      workspacePath,
      path: paths.plan,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.plan",
        version: 1,
        planId: jobId,
        createdAt: now,
        sourcePath: "imports/source/acceptance-novel.txt",
        role: "main_agent",
        stages
      }),
      reason: "test workflow plan fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: paths.job,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.job",
        version: 1,
        jobId,
        planId: jobId,
        actor: "main_agent",
        sourcePath: "imports/source/acceptance-novel.txt",
        role: "main_agent",
        createdAt: now,
        updatedAt: now
      }),
      reason: "test workflow job fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: paths.state,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.state",
        version: 1,
        jobId,
        status: "running",
        nextStageIndex: swarmStageIndex + 1,
        completedStages: completedStagesBefore(swarmStageIndex + 1, now),
        failedStage: null,
        updatedAt: now,
        cancelledAt: null
      }),
      reason: "test workflow state fixture"
    });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      taskId: `workflow-${jobId}-swarm.task.create`,
      title: "Workflow pi evidence fixture",
      instruction: "Fixture task for workflow verification.",
      outputSchemaJson: JSON.stringify({ type: "string" })
    });
    const pendingWrite = await writeAgentTaskResult(paths.result, "pending-pi-runtime");
    await writeWorkflowEvidenceArtifacts(pendingWrite.hash);

    const unexecuted = await verifyWorkflow({ workspacePath, jobId });
    expect(unexecuted.valid).toBe(false);
    expect(unexecuted.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_pi_task_unexecuted", path: paths.result })
    );

    const completedWrite = await writeAgentTaskResult(paths.result, "completed");
    await writeWorkflowEvidenceArtifacts(completedWrite.hash);

    const executed = await verifyWorkflow({ workspacePath, jobId });
    expect(executed.valid).toBe(false);
    expect(executed.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_domain_artifact_missing" })
    );

    async function writeWorkflowEvidenceArtifacts(hash: string): Promise<void> {
      await writeWorkspaceFile({
        workspacePath,
        path: paths.artifacts,
        actor: "main_agent",
        content: stableJson({
          kind: "novelfabric.workflow.artifacts",
          version: 1,
          jobId,
          items: [
            {
              stage: "swarm.task.create",
              name: "agent-task-result",
              path: paths.result,
              hash,
              artifactKind: "novelfabric.agent.task.result"
            }
          ]
        }),
        reason: "test workflow artifacts fixture"
      });
    }

    async function writeAgentTaskResult(
      resultPath: string,
      status: "pending-pi-runtime" | "completed"
    ): Promise<{ readonly hash: string }> {
      return writeWorkspaceFile({
        workspacePath,
        path: resultPath,
        actor: "main_agent",
        content: stableJson({
          kind: "novelfabric.agent.task.result",
          version: 1,
          taskId: `workflow-${jobId}-swarm.task.create`,
          status,
          runtime: "pi",
          actor: "main_agent",
          updatedAt: new Date().toISOString(),
          piSdk: {
            adapter: "@earendil-works/pi-coding-agent",
            available: true
          },
          ...(status === "completed"
            ? {
                runtimeEvidence: {
                  runtimeRoot: "/tmp/novelfabric/pi",
                  provider: "axonhub",
                  model: "generic-writer",
                  modelPurpose: "production",
                  piBin: "pi",
                  toolPolicy: "--no-tools",
                  sessionPolicy: "--no-session",
                  contextPolicy: "--no-context-files",
                  stdoutBytes: 42,
                  stderrBytes: 0
                },
                output: {
                  kind: "novelfabric.agent.task.output",
                  version: 1,
                  format: "text",
                  rawText: "generic-writer completed the StorySwarm task with non-empty evidence."
                }
              }
            : {}),
          notes: [`Test fixture status: ${status}`]
        }),
        reason: `test ${status} pi task evidence`
      });
    }
  });

  it("rejects pi-task evidence from a different workflow task", async () => {
    const jobId = `pi-evidence-mismatch-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    expect(swarmStageIndex).toBeGreaterThan(0);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: swarmStageIndex + 1,
      completedStages: completedStagesBefore(swarmStageIndex + 1, now),
      artifacts: [
        {
          stage: "swarm.task.create",
          name: "agent-task-result",
          path: ".novelfabric/tasks/workflow-other-job-swarm.task.create/result.json",
          hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          artifactKind: "novelfabric.agent.task.result"
        }
      ]
    });

    const verification = await verifyWorkflow({ workspacePath, jobId });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_pi_task_evidence_mismatch" })
    );
  });

  it("rejects workflow state advanced past a pi-task without completed stage evidence", async () => {
    const jobId = `pi-stage-skip-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    expect(swarmStageIndex).toBeGreaterThan(0);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: swarmStageIndex + 1,
      completedStages: completedStagesBefore(swarmStageIndex, now),
      artifacts: []
    });

    const verification = await verifyWorkflow({ workspacePath, jobId });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_stage_completion_missing" })
    );
  });

  it("rejects duplicate or future completed workflow stages", async () => {
    const now = new Date().toISOString();
    const stages = workflowStages();
    const importIndex = stages.findIndex((stage) => stage.id === "import.normalize");
    expect(importIndex).toBe(0);

    const duplicateJobId = `stage-duplicate-${process.pid.toString()}-${Date.now().toString(36)}`;
    await writeWorkflowRuntimeFixture({
      jobId: duplicateJobId,
      now,
      nextStageIndex: 1,
      completedStages: [
        { stage: "import.normalize", completedAt: now },
        { stage: "import.normalize", completedAt: now }
      ],
      artifacts: []
    });
    const duplicate = await verifyWorkflow({ workspacePath, jobId: duplicateJobId });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_stage_completion_duplicate" })
    );

    const aheadJobId = `stage-ahead-${process.pid.toString()}-${Date.now().toString(36)}`;
    await writeWorkflowRuntimeFixture({
      jobId: aheadJobId,
      now,
      nextStageIndex: 0,
      completedStages: [{ stage: "import.normalize", completedAt: now }],
      artifacts: []
    });
    const ahead = await verifyWorkflow({ workspacePath, jobId: aheadJobId });
    expect(ahead.valid).toBe(false);
    expect(ahead.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_stage_completion_ahead" })
    );
  });

  it("rejects unknown completed workflow stages", async () => {
    const now = new Date().toISOString();
    const jobId = `stage-unknown-${process.pid.toString()}-${Date.now().toString(36)}`;

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: 0,
      completedStages: [{ stage: "nonexistent.stage", completedAt: now }],
      artifacts: []
    });

    const verification = await verifyWorkflow({ workspacePath, jobId });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_stage_completion_unknown" })
    );
  });

  it("rejects pi-task evidence without a completed result hash", async () => {
    const jobId = `pi-evidence-no-hash-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    const resultPath = `.novelfabric/tasks/workflow-${jobId}-swarm.task.create/result.json`;
    expect(swarmStageIndex).toBeGreaterThan(0);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: swarmStageIndex + 1,
      completedStages: completedStagesBefore(swarmStageIndex + 1, now),
      artifacts: [
        {
          stage: "swarm.task.create",
          name: "agent-task-result",
          path: resultPath,
          artifactKind: "novelfabric.agent.task.result"
        }
      ]
    });

    const verification = await verifyWorkflow({ workspacePath, jobId });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_pi_task_evidence_hash_missing" })
    );
  });

  it("fails a workflow pi-task stage when required context-pack evidence is missing", async () => {
    const jobId = `workflow-pi-missing-context-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    expect(swarmStageIndex).toBeGreaterThan(0);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: swarmStageIndex,
      completedStages: completedStagesBefore(swarmStageIndex, now),
      artifacts: []
    });
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: jobId,
      objective: "Fixture session missing context-pack evidence.",
      timeline: "main"
    });

    const stepResult = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.task.create" }
    });
    expect(stepResult.stageStatus).toBe("failed");
    expect(stepResult.output).toMatchObject({ code: "workflow_artifact_missing" });
    const status = await peekWorkflow({ workspacePath, jobId });
    expect(status.status).toBe("failed");
  });

  it("fails simulation.context-pack when objective references missing source file", async () => {
    const jobId = `workflow-source-read-fail-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const simulationContextIndex = stages.findIndex(
      (stage) => stage.id === "simulation.context-pack"
    );
    expect(simulationContextIndex).toBeGreaterThan(0);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: simulationContextIndex,
      completedStages: completedStagesBefore(simulationContextIndex, now),
      artifacts: []
    });
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: jobId,
      objective: "Bring main_agent through imports/source/nonexistent-novel.txt.",
      timeline: "main"
    });

    const contextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "simulation.context-pack" }
    });
    expect(contextStep.stageStatus).toBe("failed");
    expect(contextStep.output).toHaveProperty("code", "simulation_source_read_failed");
  });

  it("executes generated simulation context through a workflow pi-task stage", async () => {
    const jobId = `workflow-pi-step-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const simulationContextIndex = stages.findIndex(
      (stage) => stage.id === "simulation.context-pack"
    );
    const swarmStageIndex = stages.findIndex((stage) => stage.id === "swarm.task.create");
    expect(simulationContextIndex).toBeGreaterThan(0);
    expect(swarmStageIndex).toBeGreaterThan(simulationContextIndex);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: simulationContextIndex,
      completedStages: completedStagesBefore(simulationContextIndex, now),
      artifacts: []
    });
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: jobId,
      objective: "Bring main_agent through imports/source/acceptance-novel.txt.",
      timeline: "main"
    });

    const contextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "simulation.context-pack" }
    });
    expect(contextStep.stageStatus).toBe("completed");
    expect(contextStep.executedStage).toBe("simulation.context-pack");
    const contextArtifact = contextStep.artifacts.find(
      (a) =>
        a.name === "simulation-context-pack" &&
        a.artifactKind === "novelfabric.simulation.context-pack"
    );
    expect(contextArtifact).toBeDefined();
    if (contextArtifact === undefined) throw new Error("Missing simulation context artifact.");

    const contextRead = await readWorkspaceFile({ workspacePath, path: contextArtifact.path });
    expect(contextRead.content).toContain("叶小伟");
    expect(contextRead.content).toContain("钟声");
    expect(contextRead.content).toContain("第二章");

    const planStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.plan" }
    });
    expect(planStep.stageStatus).toBe("completed");
    expect(planStep.executedStage).toBe("swarm.plan");

    const swarmStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.task.create" }
    });
    expect(swarmStep.stageStatus).toBe("completed");
    expect(swarmStep.executedStage).toBe("swarm.task.create");
    const evidenceArtifact = swarmStep.artifacts.find(
      (a) => a.name === "agent-task-result" && a.artifactKind === "novelfabric.agent.task.result"
    );
    expect(evidenceArtifact).toBeDefined();
    if (evidenceArtifact === undefined) throw new Error("Missing evidence artifact.");
    expect(evidenceArtifact.hash).toMatch(/^sha256:/u);
    const swarmOutputArtifact = swarmStep.artifacts.find(
      (a) => a.name === "swarm-output" && a.artifactKind === "novelfabric.swarm.output"
    );
    expect(swarmOutputArtifact).toBeDefined();
    if (swarmOutputArtifact === undefined) throw new Error("Missing swarm output artifact.");
    expect(swarmOutputArtifact.hash).toMatch(/^sha256:/u);
    const swarmValidation = await validateSwarmOutput({
      workspacePath,
      artifactPath: swarmOutputArtifact.path
    });
    expect(swarmValidation.valid).toBe(true);
    expect(swarmValidation.issues).toEqual([]);

    const resultRead = await readWorkspaceFile({
      workspacePath,
      path: evidenceArtifact.path
    });
    const resultJson = parseAgentTaskResult(resultRead.content);
    expect(resultJson.status).toBe("completed");
    expect(resultJson.outputText.trim().length).toBeGreaterThan(0);
    for (const term of ["叶小伟醒来", "城市边缘传来钟声", "第二章"]) {
      expect(resultJson.sourceAnchors).toContain(term);
    }

    const verified = await verifyWorkflow({ workspacePath, jobId });
    expect(verified.valid).toBe(true);
    expect(verified.issues).toEqual([]);

    const artifactsRead = await readWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`
    });
    const artifactsRecord = parseWorkflowArtifacts(artifactsRead.content);
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`,
      actor: "main_agent",
      content: stableJson({
        ...artifactsRecord,
        items: artifactsRecord.items.filter((item) => item.name !== "swarm-output")
      }),
      reason: "test remove domain artifact evidence"
    });
    const missingDomain = await verifyWorkflow({ workspacePath, jobId });
    expect(missingDomain.valid).toBe(false);
    expect(missingDomain.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_domain_artifact_missing" })
    );
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`,
      actor: "main_agent",
      content: artifactsRead.content,
      reason: "test restore domain artifact evidence"
    });

    const swarmOutputRead = await readWorkspaceFile({
      workspacePath,
      path: swarmOutputArtifact.path
    });
    await writeWorkspaceFile({
      workspacePath,
      path: swarmOutputArtifact.path,
      actor: "main_agent",
      content: swarmOutputRead.content.replace("pi-agent-proposal", "tampered-proposal"),
      reason: "test domain artifact tamper"
    });
    const tamperedDomain = await verifyWorkflow({ workspacePath, jobId });
    expect(tamperedDomain.valid).toBe(false);
    expect(tamperedDomain.issues).toContainEqual(
      expect.objectContaining({
        code: "workflow_domain_artifact_hash_mismatch",
        path: swarmOutputArtifact.path
      })
    );
    await writeWorkspaceFile({
      workspacePath,
      path: swarmOutputArtifact.path,
      actor: "main_agent",
      content: swarmOutputRead.content,
      reason: "test restore domain artifact content"
    });

    const otherResultPath = `.novelfabric/tasks/workflow-other-job-swarm.task.create/result.json`;
    const otherResultWrite = await writeWorkspaceFile({
      workspacePath,
      path: otherResultPath,
      actor: "main_agent",
      content: resultRead.content,
      reason: "test other workflow result fixture"
    });
    const otherSwarmArtifactPath = `simulation/sessions/${jobId}/rounds/1/proposals/other-job-materialized.json`;
    const swarmOutputRecord = parseJsonRecord(swarmOutputRead.content, "swarm output");
    const otherSwarmWrite = await writeWorkspaceFile({
      workspacePath,
      path: otherSwarmArtifactPath,
      actor: "main_agent",
      content: stableJson({
        ...swarmOutputRecord,
        createdFromTask: otherResultPath,
        citationHashes: [
          { path: otherResultPath, hash: otherResultWrite.hash },
          ...(Array.isArray(swarmOutputRecord["citationHashes"])
            ? swarmOutputRecord["citationHashes"]
            : []
          ).filter((item): item is Record<string, unknown> => {
            if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
            const record = item as Record<string, unknown>;
            const citationPath = record["path"];
            return citationPath !== evidenceArtifact.path;
          })
        ]
      }),
      reason: "test other workflow swarm artifact fixture"
    });
    const restoredArtifactsRecord = parseWorkflowArtifacts(artifactsRead.content);
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`,
      actor: "main_agent",
      content: stableJson({
        ...restoredArtifactsRecord,
        items: restoredArtifactsRecord.items.map((item) =>
          item.name === "swarm-output"
            ? { ...item, path: otherSwarmWrite.path, hash: otherSwarmWrite.hash }
            : item
        )
      }),
      reason: "test replace domain artifact with other workflow artifact"
    });
    const otherWorkflowDomain = await verifyWorkflow({ workspacePath, jobId });
    expect(otherWorkflowDomain.valid).toBe(false);
    expect(otherWorkflowDomain.issues).toContainEqual(
      expect.objectContaining({
        code: "workflow_domain_artifact_evidence_mismatch",
        path: otherSwarmWrite.path
      })
    );
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`,
      actor: "main_agent",
      content: artifactsRead.content,
      reason: "test restore domain artifact evidence after mismatch"
    });

    await writeWorkspaceFile({
      workspacePath,
      path: evidenceArtifact.path,
      actor: "main_agent",
      content: resultRead.content.replace("completed", "completed-tampered"),
      reason: "test result evidence tamper"
    });
    const tampered = await verifyWorkflow({ workspacePath, jobId });
    expect(tampered.valid).toBe(false);
    expect(tampered.issues).toContainEqual(
      expect.objectContaining({
        code: "workflow_artifact_hash_mismatch",
        path: evidenceArtifact.path
      })
    );
  }, 60000);

  it("executes generated report context through a workflow pi-task stage", async () => {
    const jobId = `workflow-report-step-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const simulationContextIndex = stages.findIndex(
      (stage) => stage.id === "simulation.context-pack"
    );
    const reportTaskIndex = stages.findIndex((stage) => stage.id === "report.task.create");
    expect(simulationContextIndex).toBeGreaterThan(0);
    expect(reportTaskIndex).toBeGreaterThan(simulationContextIndex);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: simulationContextIndex,
      completedStages: completedStagesBefore(simulationContextIndex, now),
      artifacts: []
    });
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: jobId,
      objective: "Bring main_agent through imports/source/acceptance-novel.txt.",
      timeline: "main"
    });

    const contextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "simulation.context-pack" }
    });
    expect(contextStep.stageStatus).toBe("completed");
    expect(contextStep.executedStage).toBe("simulation.context-pack");

    const planStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.plan" }
    });
    expect(planStep.stageStatus).toBe("completed");
    expect(planStep.executedStage).toBe("swarm.plan");

    const swarmStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.task.create" }
    });
    expect(swarmStep.stageStatus).toBe("completed");
    expect(swarmStep.executedStage).toBe("swarm.task.create");

    const reportStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "report.task.create" }
    });
    expect(reportStep.stageStatus).toBe("completed");
    expect(reportStep.executedStage).toBe("report.task.create");
    const evidenceArtifact = reportStep.artifacts.find(
      (a) => a.name === "agent-task-result" && a.artifactKind === "novelfabric.agent.task.result"
    );
    expect(evidenceArtifact).toBeDefined();
    if (evidenceArtifact === undefined) throw new Error("Missing report evidence artifact.");
    expect(evidenceArtifact.hash).toMatch(/^sha256:/u);
    const reportArtifact = reportStep.artifacts.find(
      (a) => a.name === "report-artifact" && a.artifactKind === "novelfabric.report.artifact"
    );
    expect(reportArtifact).toBeDefined();
    if (reportArtifact === undefined) throw new Error("Missing report artifact.");
    expect(reportArtifact.hash).toMatch(/^sha256:/u);
    const reportValidation = await validateReportArtifact({
      workspacePath,
      artifactPath: reportArtifact.path
    });
    expect(reportValidation.valid).toBe(true);
    expect(reportValidation.issues).toEqual([]);

    const resultRead = await readWorkspaceFile({ workspacePath, path: evidenceArtifact.path });
    expect(evidenceArtifact.hash).toBe(resultRead.hash);
    const resultJson = parseAgentTaskResult(resultRead.content);
    expect(resultJson.status).toBe("completed");
    expect(resultJson.outputText.trim().length).toBeGreaterThan(0);
    for (const term of ["叶小伟醒来", "城市边缘传来钟声", "第二章"]) {
      expect(resultJson.sourceAnchors).toContain(term);
    }

    const validation = await validateAgentOutput({
      workspacePath,
      task: `workflow-${jobId}-report.task.create`
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    const verified = await verifyWorkflow({ workspacePath, jobId });
    expect(verified.valid).toBe(true);
    expect(verified.issues).toEqual([]);
  }, 60000);

  it("executes generated writing context through a workflow pi-task stage", async () => {
    const jobId = `workflow-writing-step-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const simulationContextIndex = stages.findIndex(
      (stage) => stage.id === "simulation.context-pack"
    );
    const writingContextIndex = stages.findIndex((stage) => stage.id === "writing.context-pack");
    expect(simulationContextIndex).toBeGreaterThan(0);
    expect(writingContextIndex).toBeGreaterThan(simulationContextIndex);

    await writeWorkflowRuntimeFixture({
      jobId,
      now,
      nextStageIndex: simulationContextIndex,
      completedStages: completedStagesBefore(simulationContextIndex, now),
      artifacts: []
    });
    await createSimulationSession({
      workspacePath,
      actor: "main_agent",
      sessionId: jobId,
      objective: "Bring main_agent through imports/source/acceptance-novel.txt.",
      timeline: "main"
    });

    const simulationContextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "simulation.context-pack" }
    });
    expect(simulationContextStep.stageStatus).toBe("completed");

    const planStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.plan" }
    });
    expect(planStep.stageStatus).toBe("completed");
    expect(planStep.executedStage).toBe("swarm.plan");

    const swarmStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "swarm.task.create" }
    });
    expect(swarmStep.stageStatus).toBe("completed");
    expect(swarmStep.executedStage).toBe("swarm.task.create");

    const reportStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "report.task.create" }
    });
    expect(reportStep.stageStatus).toBe("completed");
    expect(reportStep.executedStage).toBe("report.task.create");

    const writingContextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "writing.context-pack" }
    });
    expect(writingContextStep.stageStatus).toBe("completed");
    const writingContextArtifact = writingContextStep.artifacts.find(
      (a) => a.name === "writing-context-pack"
    );
    expect(writingContextArtifact).toBeDefined();
    if (writingContextArtifact === undefined) throw new Error("Missing writing context artifact.");
    const writingContextRead = await readWorkspaceFile({
      workspacePath,
      path: writingContextArtifact.path
    });
    expect(writingContextRead.content).toContain("叶小伟");
    expect(writingContextRead.content).toContain("钟声");

    const draftStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId,
      input: { stage: "writing.draft" }
    });
    expect(draftStep.stageStatus).toBe("completed");
    expect(draftStep.executedStage).toBe("writing.draft");
    const evidenceArtifact = draftStep.artifacts.find(
      (a) => a.name === "agent-task-result" && a.artifactKind === "novelfabric.agent.task.result"
    );
    expect(evidenceArtifact).toBeDefined();
    if (evidenceArtifact === undefined) throw new Error("Missing writing evidence artifact.");
    const writingDraftArtifact = draftStep.artifacts.find(
      (a) => a.name === "writing-draft" && a.artifactKind === "novelfabric.writing.draft"
    );
    expect(writingDraftArtifact).toBeDefined();
    if (writingDraftArtifact === undefined) throw new Error("Missing writing draft artifact.");
    const draftValidation = await validateWritingDraftArtifact(
      workspacePath,
      writingDraftArtifact.path
    );
    expect(draftValidation.valid).toBe(true);
    expect(draftValidation.issues).toEqual([]);

    const resultRead = await readWorkspaceFile({ workspacePath, path: evidenceArtifact.path });
    const resultJson = parseAgentTaskResult(resultRead.content);
    expect(resultJson.status).toBe("completed");
    expect(resultJson.outputText.trim().length).toBeGreaterThan(0);
    for (const term of ["叶小伟醒来", "城市边缘传来钟声"]) {
      expect(resultJson.sourceAnchors).toContain(term);
    }

    expect(evidenceArtifact.hash).toBe(resultRead.hash);

    const validation = await validateAgentOutput({
      workspacePath,
      task: `workflow-${jobId}-writing.draft`
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    const verified = await verifyWorkflow({ workspacePath, jobId });
    expect(verified.valid).toBe(true);
    expect(verified.issues).toEqual([]);
  }, 120000);

  it("builds canonical import context pack before proposing cards", async () => {
    const planned = await planWorkflow({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/acceptance-novel.txt",
      role: "main_agent",
      planId: `canonical-import-${process.pid.toString()}-${Date.now().toString(36)}`
    });
    const started = await startWorkflow({
      workspacePath,
      actor: "main_agent",
      planId: planned.planId
    });

    const normalizeStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.normalize" }
    });
    expect(normalizeStep.stageStatus).toBe("completed");

    const chapterizeStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.chapterize" }
    });
    expect(chapterizeStep.stageStatus).toBe("completed");

    const contextStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.context-pack" }
    });
    expect(contextStep.stageStatus).toBe("completed");
    expect(contextStep.executedStage).toBe("import.context-pack");
    const importContextArtifact = contextStep.artifacts.find(
      (artifact) =>
        artifact.name === "import-context-pack" &&
        artifact.artifactKind === "novelfabric.import.context-pack"
    );
    const canonicalContextArtifact = contextStep.artifacts.find(
      (artifact) =>
        artifact.name === "context-pack" && artifact.artifactKind === "novelfabric.context-pack"
    );
    expect(importContextArtifact).toBeDefined();
    expect(canonicalContextArtifact).toBeDefined();
    if (canonicalContextArtifact === undefined) {
      throw new Error("Missing canonical context-pack artifact.");
    }

    const canonicalRead = await readWorkspaceFile({
      workspacePath,
      path: canonicalContextArtifact.path
    });
    const canonical = parseJsonRecord(canonicalRead.content, "canonical import context-pack");
    expect(canonical["kind"]).toBe("novelfabric.context-pack");
    expect(canonical["version"]).toBe(1);
    expect(canonical["packKind"]).toBe("import-source");
    expect(canonical["agent"]).toBe("main_agent");
    expect(canonical["session"]).toBe(started.jobId);
    expect(canonical["query"]).toContain("imports/source/acceptance-novel.txt");
    expect(Array.isArray(canonical["citations"])).toBe(true);
    expect(Array.isArray(canonical["sources"])).toBe(true);
    expect(canonicalRead.content).toContain("叶小伟醒来");
    expect(canonicalRead.content).toContain("城市边缘传来钟声");

    const cardsStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "cards.propose" }
    });
    expect(cardsStep.stageStatus).toBe("completed");
    expect(cardsStep.executedStage).toBe("cards.propose");
    expect(
      cardsStep.artifacts.some(
        (artifact) =>
          artifact.name === "card-proposal" &&
          artifact.artifactKind === "novelfabric.cards.proposal"
      )
    ).toBe(true);
  });

  it("plans, starts, steps deterministic stages, verifies artifacts, and can be cancelled", async () => {
    const planned = await planWorkflow({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/acceptance-novel.txt",
      role: "main_agent",
      planId: "acceptance-job"
    });
    expect(planned.stageCount).toBeGreaterThan(10);
    expect(planned.stages[0]?.id).toBe("import.normalize");

    const started = await startWorkflow({
      workspacePath,
      actor: "main_agent",
      planId: planned.planId
    });
    expect(started.status).toBe("running");
    expect(started.nextStage?.id).toBe("import.normalize");

    const firstStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.normalize" }
    });
    expect(firstStep.stageStatus).toBe("completed");
    expect(firstStep.executedStage).toBe("import.normalize");
    expect(firstStep.nextStage?.id).toBe("import.chapterize");
    expect(firstStep.artifacts.some((artifact) => artifact.name === "normalized-source")).toBe(
      true
    );

    const secondStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.chapterize" }
    });
    expect(secondStep.stageStatus).toBe("completed");
    expect(secondStep.nextStage?.id).toBe("import.context-pack");

    const artifacts = await listWorkflowArtifacts({ workspacePath, jobId: started.jobId });
    expect(artifacts.artifactCount).toBeGreaterThanOrEqual(2);

    const verification = await verifyWorkflow({ workspacePath, jobId: started.jobId });
    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("running");

    const cancelled = await cancelWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId
    });
    expect(cancelled.status).toBe("cancelled");
    expect((await peekWorkflow({ workspacePath, jobId: started.jobId })).status).toBe("cancelled");
  });

  async function writeWorkflowRuntimeFixture(request: {
    readonly jobId: string;
    readonly now: string;
    readonly nextStageIndex: number;
    readonly completedStages: readonly { readonly stage: string; readonly completedAt: string }[];
    readonly artifacts: readonly unknown[];
  }): Promise<void> {
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${request.jobId}/plan.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.plan",
        version: 1,
        planId: request.jobId,
        createdAt: request.now,
        sourcePath: "imports/source/acceptance-novel.txt",
        role: "main_agent",
        stages: workflowStages()
      }),
      reason: "test workflow plan fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${request.jobId}/job.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.job",
        version: 1,
        jobId: request.jobId,
        planId: request.jobId,
        actor: "main_agent",
        sourcePath: "imports/source/acceptance-novel.txt",
        role: "main_agent",
        createdAt: request.now,
        updatedAt: request.now
      }),
      reason: "test workflow job fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${request.jobId}/state.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.state",
        version: 1,
        jobId: request.jobId,
        status: "running",
        nextStageIndex: request.nextStageIndex,
        completedStages: request.completedStages,
        failedStage: null,
        updatedAt: request.now,
        cancelledAt: null
      }),
      reason: "test workflow state fixture"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${request.jobId}/artifacts.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.artifacts",
        version: 1,
        jobId: request.jobId,
        items: request.artifacts
      }),
      reason: "test workflow artifacts fixture"
    });
  }
});
