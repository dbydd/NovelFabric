import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentTask, validateAgentOutput } from "../../src/agent-runtime/tasks.js";
import { validateSemanticImportArtifact } from "../../src/import/semantic.js";
import { validateReportArtifact } from "../../src/report/index.js";
import { createSimulationSession } from "../../src/simulation/index.js";
import { validateSwarmOutput } from "../../src/swarm/index.js";
import {
  cancelWorkflow,
  listWorkflowArtifacts,
  peekWorkflow,
  planWorkflow,
  startWorkflow,
  retryWorkflow,
  stepWorkflow,
  verifyWorkflow,
  workflowStages
} from "../../src/workflow/index.js";
import type { WorkflowStageId } from "../../src/workflow/index.js";
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

const REAL_LLM_STAGE_ATTEMPTS = 3;
const RETRYABLE_REAL_LLM_FAILURE_CODES = new Set([
  "agent_task_output_schema_mismatch",
  "pi_runtime_failed",
  "pi_sdk_empty_output",
  "workflow_pi_task_output_invalid",
  "workflow_agent_task_result_missing",
  "invalid_json_artifact"
]);

function isRetryableRealLlmFailure(step: { readonly output: Record<string, unknown> }): boolean {
  const code = step.output["code"];
  if (typeof code === "string" && RETRYABLE_REAL_LLM_FAILURE_CODES.has(code)) return true;
  const message = typeof step.output["message"] === "string" ? step.output["message"] : "";
  return (
    message.includes("output.schema.json") ||
    message.includes("schema") ||
    message.includes("ETIMEDOUT") ||
    message.includes("timeout") ||
    message.includes("upstream") ||
    message.includes("status=400") ||
    message.includes("status=429") ||
    message.includes("status=500") ||
    message.includes("status=502") ||
    message.includes("status=503") ||
    message.includes("status=504")
  );
}

async function stepWorkflowWithRealLlmRetry(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly jobId: string;
  readonly stage: WorkflowStageId;
  readonly attempts?: number;
}) {
  const attempts = request.attempts ?? REAL_LLM_STAGE_ATTEMPTS;
  const diagnostics: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const step = await stepWorkflow({
      workspacePath: request.workspacePath,
      actor: request.actor,
      jobId: request.jobId,
      input: { stage: request.stage },
      reason: `workflow real LLM test stage ${request.stage} attempt ${attempt.toString()}`
    });
    if (step.stageStatus === "completed") return step;
    const code = typeof step.output["code"] === "string" ? step.output["code"] : "unknown";
    const message = typeof step.output["message"] === "string" ? step.output["message"] : "";
    diagnostics.push(`attempt ${attempt.toString()}: ${code}: ${message}`);
    if (!isRetryableRealLlmFailure(step) || attempt >= attempts) break;
    await retryWorkflow({
      workspacePath: request.workspacePath,
      actor: request.actor,
      jobId: request.jobId,
      stage: request.stage,
      reason: `workflow real LLM test retry ${request.stage} after ${code}`
    });
  }
  throw new Error(
    `Workflow real LLM stage '${request.stage}' did not complete after ${attempts.toString()} attempts. ${diagnostics.join(" | ")}`
  );
}

describe("workflow acceptance state machine", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-workflow-acceptance-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run", "cards.propose", "cards.apply", "report.render", "report.apply", "knowledge.query", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]\n',
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
      "import.semantic",
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
      expect.objectContaining({ code: "workflow_domain_artifact_missing" })
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
      sourcePath: "imports/source/nonexistent-novel.txt",
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
      sourcePath: "imports/source/acceptance-novel.txt",
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

    const swarmStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "swarm.task.create"
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
      (a) =>
        a.name.startsWith("swarm-output-") &&
        !a.name.includes("template") &&
        a.artifactKind === "novelfabric.swarm.output"
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
        items: artifactsRecord.items.filter(
          (item) => item["artifactKind"] !== "novelfabric.swarm.output"
        )
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
          item["artifactKind"] === "novelfabric.swarm.output"
            ? { ...item, path: otherSwarmWrite.path, hash: otherSwarmWrite.hash }
            : item
        )
      }),
      reason: "test replace domain artifact with other workflow artifact"
    });
    const otherWorkflowDomain = await verifyWorkflow({ workspacePath, jobId });
    expect(otherWorkflowDomain.valid).toBe(false);
    const hasHashMismatch = otherWorkflowDomain.issues.some(
      (issue) => issue.code === "workflow_domain_artifact_hash_mismatch"
    );
    const hasInvalid = otherWorkflowDomain.issues.some(
      (issue) => issue.code === "workflow_domain_artifact_invalid"
    );
    expect(hasHashMismatch || hasInvalid).toBe(true);
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
  }, 420000);

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
      sourcePath: "imports/source/acceptance-novel.txt",
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

    const swarmStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "swarm.task.create"
    });
    expect(swarmStep.stageStatus).toBe("completed");
    expect(swarmStep.executedStage).toBe("swarm.task.create");

    const reportStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "report.task.create"
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
  }, 360000);

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
      sourcePath: "imports/source/acceptance-novel.txt",
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

    const swarmStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "swarm.task.create"
    });
    expect(swarmStep.stageStatus).toBe("completed");
    expect(swarmStep.executedStage).toBe("swarm.task.create");
    expect(swarmStep.output["turnCount"]).toBe(5);
    expect(
      swarmStep.artifacts.filter((artifact) => artifact.name.startsWith("simulation-turn-")).length
    ).toBe(5);

    const reportStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "report.task.create"
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

    const draftStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId,
      stage: "writing.draft"
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
  }, 420000);

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
    expect(canonical["query"]).toContain(`imports/normalized/${started.jobId}.txt`);
    expect(Array.isArray(canonical["citations"])).toBe(true);
    expect(Array.isArray(canonical["sources"])).toBe(true);
    expect(canonicalRead.content).toContain("叶小伟醒来");
    expect(canonicalRead.content).toContain("城市边缘传来钟声");

    const semanticStep = await stepWorkflowWithRealLlmRetry({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      stage: "import.semantic"
    });
    expect(semanticStep.stageStatus).toBe("completed");
    expect(semanticStep.executedStage).toBe("import.semantic");
    const semanticArtifact = semanticStep.artifacts.find(
      (artifact) =>
        artifact.name === "semantic-import" &&
        artifact.artifactKind === "novelfabric.import.semantic"
    );
    expect(semanticArtifact).toBeDefined();
    if (semanticArtifact === undefined) {
      throw new Error("Missing semantic import artifact.");
    }
    expect(semanticArtifact.hash).toMatch(/^sha256:/u);
    const semanticValidation = await validateSemanticImportArtifact({
      workspacePath,
      artifactPath: semanticArtifact.path
    });
    expect(semanticValidation.valid).toBe(true);
    expect(semanticValidation.issues).toEqual([]);

    const cardsStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "cards.propose" }
    });
    expect(cardsStep.stageStatus).toBe("completed");
    expect(cardsStep.executedStage).toBe("cards.propose");
    const cardProposalArtifact = cardsStep.artifacts.find(
      (artifact) =>
        artifact.name === "card-proposal" && artifact.artifactKind === "novelfabric.cards.proposal"
    );
    expect(cardProposalArtifact).toBeDefined();
    if (cardProposalArtifact === undefined) throw new Error("Missing card proposal artifact.");
    const proposalRead = await readWorkspaceFile({
      workspacePath,
      path: cardProposalArtifact.path
    });
    expect(proposalRead.content).toContain("cards/world/");
    expect(proposalRead.content).toContain(`Import source 'imports/normalized/${started.jobId}.txt' for main_agent`);
    expect(proposalRead.content).not.toContain("Source Card");

    const applyStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "cards.apply" }
    });
    expect(applyStep.stageStatus).toBe("completed");
    expect(applyStep.artifacts.map((artifact) => artifact.name)).toEqual(
      expect.arrayContaining(["card-world"])
    );

    const verification = await verifyWorkflow({ workspacePath, jobId: started.jobId });
    expect(verification.valid).toBe(true);

    const worldArtifact = applyStep.artifacts.find((artifact) => artifact.name === "card-world");
    expect(worldArtifact).toBeDefined();
    if (worldArtifact === undefined) throw new Error("Missing world card artifact.");
    await fs.rm(path.join(workspacePath, worldArtifact.path));
    const brokenVerification = await verifyWorkflow({ workspacePath, jobId: started.jobId });
    expect(brokenVerification.valid).toBe(false);
    expect(
      brokenVerification.issues.some((issue) => issue.code === "workflow_artifact_unreadable")
    ).toBe(true);
  }, 300000);

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
    expect(firstStep.nextStage?.id).toBe("import.context-pack");
    expect(firstStep.artifacts.some((artifact) => artifact.name === "normalized-source")).toBe(
      true
    );

    const secondStep = await stepWorkflow({
      workspacePath,
      actor: "main_agent",
      jobId: started.jobId,
      input: { stage: "import.context-pack" }
    });
    expect(secondStep.stageStatus).toBe("completed");
    expect(secondStep.nextStage?.id).toBe("import.semantic");

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

  it("does not fail mutable workflow artifacts when canonical log and session content grow", async () => {
    const jobId = `mutable-artifact-${process.pid.toString()}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const stages = workflowStages();
    const reportIndex = stages.findIndex((stage) => stage.id === "report.task.create");
    expect(reportIndex).toBeGreaterThan(0);

    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/logs/mutable-session.jsonl",
      actor: "main_agent",
      content: `${stableJson({ kind: "novelfabric.simulation.log-entry", version: 1, sessionId: jobId })}\n`,
      reason: "seed mutable canonical log"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/sessions/mutable-session/session.json",
      actor: "main_agent",
      content: stableJson({ kind: "novelfabric.simulation.session", id: jobId }),
      reason: "seed mutable canonical session"
    });
    const reportPath = `reports/${jobId}-consistency.json`;
    await writeWorkspaceFile({
      workspacePath,
      path: reportPath,
      actor: "main_agent",
      content: stableJson({ kind: "novelfabric.report.artifact", version: 1 }),
      reason: "seed immutable report artifact"
    });

    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/plan.json`,
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
      reason: "mutable artifact test plan"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/job.json`,
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
      reason: "mutable artifact test job"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/state.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.state",
        version: 1,
        jobId,
        status: "running",
        nextStageIndex: reportIndex + 1,
        completedStages: stages
          .slice(0, reportIndex + 1)
          .map((stage) => ({ stage: stage.id, completedAt: now })),
        failedStage: null,
        updatedAt: now,
        cancelledAt: null
      }),
      reason: "mutable artifact test state"
    });

    const mutableLogRead = await readWorkspaceFile({
      workspacePath,
      path: "simulation/logs/mutable-session.jsonl"
    });
    const mutableSessionRead = await readWorkspaceFile({
      workspacePath,
      path: "simulation/sessions/mutable-session/session.json"
    });
    const immutableReportRead = await readWorkspaceFile({ workspacePath, path: reportPath });
    await writeWorkspaceFile({
      workspacePath,
      path: `.novelfabric/jobs/${jobId}/artifacts.json`,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.workflow.artifacts",
        version: 1,
        jobId,
        items: [
          {
            stage: "swarm.task.create",
            name: "simulation-session-main_agent",
            path: mutableSessionRead.path,
            hash: mutableSessionRead.hash,
            artifactKind: "novelfabric.simulation.session"
          },
          {
            stage: "swarm.task.create",
            name: "simulation-log-main_agent",
            path: mutableLogRead.path,
            hash: mutableLogRead.hash,
            artifactKind: "novelfabric.simulation.log"
          },
          {
            stage: "report.task.create",
            name: "report-artifact",
            path: immutableReportRead.path,
            hash: immutableReportRead.hash,
            artifactKind: "novelfabric.report.artifact"
          }
        ]
      }),
      reason: "mutable artifact test artifacts"
    });

    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/logs/mutable-session.jsonl",
      actor: "main_agent",
      content: `${mutableLogRead.content}${stableJson({ kind: "novelfabric.simulation.log-entry", version: 1, sessionId: jobId, appended: true })}`,
      reason: "append mutable canonical log"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/sessions/mutable-session/session.json",
      actor: "main_agent",
      content: stableJson({ kind: "novelfabric.simulation.session", id: jobId, updatedAt: now }),
      reason: "update mutable canonical session"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: reportPath,
      actor: "main_agent",
      content: stableJson({ kind: "novelfabric.report.artifact", version: 1, tampered: true }),
      reason: "tamper immutable report artifact"
    });

    const verification = await verifyWorkflow({ workspacePath, jobId });
    expect(verification.valid).toBe(false);
    expect(verification.issues).toContainEqual(
      expect.objectContaining({
        code: "workflow_artifact_hash_mismatch",
        path: reportPath
      })
    );
    expect(
      verification.issues.some(
        (issue) =>
          issue.code === "workflow_artifact_hash_mismatch" &&
          (issue.path === mutableSessionRead.path || issue.path === mutableLogRead.path)
      )
    ).toBe(false);
  });

  async function writeWorkflowRuntimeFixture(request: {
    readonly jobId: string;
    readonly now: string;
    readonly nextStageIndex: number;
    readonly completedStages: readonly { readonly stage: string; readonly completedAt: string }[];
    readonly artifacts: readonly unknown[];
  }): Promise<void> {
    const semanticImportPath = `imports/semantic/${request.jobId}.json`;
    const semanticImportWrite = await writeWorkspaceFile({
      workspacePath,
      path: semanticImportPath,
      actor: "main_agent",
      content: stableJson({
        kind: "novelfabric.import.semantic",
        version: 1,
        sourcePath: "imports/source/acceptance-novel.txt",
        sourceHash: "sha256:test-source",
        contextPackPath: `simulation/context-packs/import-${request.jobId}.json`,
        contextPackHash: "sha256:test-context-pack",
        summary: "Workflow semantic import fixture with explicit source anchors.",
        chapters: [],
        characters: [],
        events: [],
        cardSeeds: [],
        sourceAnchors: ["叶小伟醒来", "城市边缘传来钟声", "第二章"],
        citations: [{ path: ".novelfabric/tasks/workflow-fixture/result.json", hash: "sha256:test-result" }],
        createdFromTask: {
          taskId: "workflow-fixture",
          resultPath: ".novelfabric/tasks/workflow-fixture/result.json",
          resultHash: "sha256:test-result"
        },
        materializedAt: request.now
      }),
      reason: "test workflow semantic import fixture"
    });
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
        items: [
          {
            stage: "import.semantic",
            name: "semantic-import",
            path: semanticImportWrite.path,
            hash: semanticImportWrite.hash,
            artifactKind: "novelfabric.import.semantic"
          },
          ...request.artifacts
        ]
      }),
      reason: "test workflow artifacts fixture"
    });
  }
});
