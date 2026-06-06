import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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
    const jobId = "pi-evidence-job";
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
        completedStages: [{ stage: "swarm.task.create", completedAt: now }],
        failedStage: null,
        updatedAt: now,
        cancelledAt: null
      }),
      reason: "test workflow state fixture"
    });
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
            artifactKind: "novelfabric.agent.task.result"
          }
        ]
      }),
      reason: "test workflow artifacts fixture"
    });
    await writeAgentTaskResult(paths.result, "pending-pi-runtime");

    const unexecuted = await verifyWorkflow({ workspacePath, jobId });
    expect(unexecuted.valid).toBe(false);
    expect(unexecuted.issues).toContainEqual(
      expect.objectContaining({ code: "workflow_pi_task_unexecuted", path: paths.result })
    );

    await writeAgentTaskResult(paths.result, "completed");

    const executed = await verifyWorkflow({ workspacePath, jobId });
    expect(executed.valid).toBe(true);

    async function writeAgentTaskResult(
      resultPath: string,
      status: "pending-pi-runtime" | "completed"
    ) {
      await writeWorkspaceFile({
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
          notes: [`Test fixture status: ${status}`]
        }),
        reason: `test ${status} pi task evidence`
      });
    }
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
});
