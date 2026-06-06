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
