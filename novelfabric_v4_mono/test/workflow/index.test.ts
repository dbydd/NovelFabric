import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentTask, validateAgentOutput } from "../../src/agent-runtime/tasks.js";
import { createSimulationSession } from "../../src/simulation/index.js";
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
    expect(executed.issues).toEqual([]);
    expect(executed.valid).toBe(true);

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

    await writeWorkflowRuntimeFixture({
      jobId,
      now: new Date().toISOString(),
      nextStageIndex: writingContextIndex,
      completedStages: completedStagesBefore(writingContextIndex, now),
      artifacts: simulationContextStep.artifacts
    });

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
  }, 60000);

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
