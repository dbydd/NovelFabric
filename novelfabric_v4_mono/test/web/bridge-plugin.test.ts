import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PiSdkAgentSessionModule } from "../../src/agent-runtime/pi-adapter.js";
import { clearAgentTaskRunStateForTesting } from "../../src/agent-runtime/task-runner.js";
import { clearWorkflowStepRunStateForTesting } from "../../src/agent-runtime/workflow-runner.js";
import {
  createAgentTask,
  setAgentTaskPiSdkModuleForTesting
} from "../../src/agent-runtime/tasks.js";
import {
  getActiveAgentTaskStreamCountForTesting,
  handleBridgeRequest
} from "../../src/web/bridge-plugin.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

type BridgeEnvelope =
  | { readonly ok: true; readonly data: BridgeRuntimePrepareData }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

type GenericBridgeEnvelope =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

type BridgeRuntimePrepareData = {
  readonly actor: string;
  readonly workspacePath: string;
  readonly runtimeRoot: string;
  readonly policyProfile: "web-safe";
  readonly requestedTools: readonly string[];
  readonly allowedTools: readonly string[];
  readonly deniedRawTools: readonly string[];
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly rawBuiltinToolsEnabled: false;
  readonly sdk: {
    readonly packageName: string;
    readonly available: boolean;
    readonly version: string | null;
    readonly missingExports: readonly string[];
  };
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearAgentTaskRunStateForTesting();
  clearWorkflowStepRunStateForTesting();
});

describe("external swarm REST adapter", () => {
  it("POST returns the frozen external swarm response shape and preserves client_request_id idempotency", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });
    const request = externalSwarmRequest();

    const first = await postExternalSwarm(request);
    expect(first.status).toBe(200);
    expect(isRecord(first.body)).toBe(true);
    if (!isRecord(first.body)) throw new Error("Expected external swarm response object.");
    expect(first.body["ok"]).toBeUndefined();
    expect(first.body["inference_id"]).toEqual(
      expect.stringMatching(/^external-caller-stable-id-/u)
    );
    expect(first.body["project_slug"]).toBe("external-market-impact");
    expect(first.body["session_id"]).toEqual(expect.stringMatching(/^external-caller-stable-id-/u));
    expect(first.body["domain"]).toBe("market-impact");
    expect(first.body["title"]).toBe("Hermes market-impact fixture");
    expect(first.body["rounds_completed"]).toBe(1);
    expect(first.body["item_count"]).toBe(1);
    expect(isRecord(first.body["artifact_paths"])).toBe(true);
    const artifactPaths = requireRecord(first.body["artifact_paths"]);
    expect(artifactPaths["manifest"]).toEqual(
      expect.stringContaining("projects/external-market-impact/external/inferences/")
    );
    expect(artifactPaths["report"]).toEqual(
      expect.stringContaining("projects/external-market-impact/external/reports/")
    );
    expect(Array.isArray(artifactPaths["input_items"])).toBe(true);
    expect(artifactPaths["session"]).toEqual(
      expect.stringContaining("projects/external-market-impact/simulation/sessions/")
    );
    expect(Array.isArray(artifactPaths["swarm_rounds"])).toBe(true);
    expect(artifactPaths["context"]).toEqual(
      expect.stringContaining("projects/external-market-impact/external/context/")
    );
    expect(Array.isArray(artifactPaths["role_reasoning"])).toBe(true);
    expect(isRecord(first.body["context_requirements"])).toBe(true);
    const contextRequirements = requireRecord(first.body["context_requirements"]);
    expect(contextRequirements["is_ready"]).toBe(true);
    expect(Array.isArray(first.body["role_reasoning"])).toBe(true);
    expect((first.body["role_reasoning"] as readonly unknown[]).length).toBeGreaterThan(0);

    const second = await postExternalSwarm(request);
    expect(second.status).toBe(200);
    expect(requireRecord(second.body)["inference_id"]).toBe(first.body["inference_id"]);
    expect(requireRecord(second.body)["artifact_paths"]).toEqual(first.body["artifact_paths"]);
  });

  it("GET returns the persisted external swarm inference shape", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });
    const created = await postExternalSwarm(externalSwarmRequest());
    const inferenceId = String(requireRecord(created.body)["inference_id"]);

    const fetched = await getExternalSwarm(inferenceId);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  it("returns 403 when the configured bridge actor lacks external swarm capability", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("role_agent");
    configureBridge({ workspacePath, actor: "role_agent" });

    const response = await postExternalSwarm(externalSwarmRequest());
    expect(response.status).toBe(403);
    expect(isRecord(response.body)).toBe(true);
    const body = requireRecord(response.body);
    expect(body["ok"]).toBeUndefined();
    expect(requireRecord(body["error"])["code"]).toBe("capability_denied");
  });

  it("returns 400 for invalid external swarm requests", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postExternalSwarm({ ...externalSwarmRequest(), items: [] });
    expect(response.status).toBe(400);
    const body = requireRecord(response.body);
    expect(body["ok"]).toBeUndefined();
    expect(requireRecord(body["error"])["code"]).toBe("invalid_external_swarm_request");
  });

  it("returns 404 for missing external swarm inference ids", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await getExternalSwarm("external-missing-fixture");
    expect(response.status).toBe(404);
    const body = requireRecord(response.body);
    expect(body["ok"]).toBeUndefined();
    expect(requireRecord(body["error"])["code"]).toBe("external_swarm_not_found");
  });
});

describe("external swarm MCP adapter", () => {
  it("initialize returns NovelFabric server info", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    expect(response.status).toBe(200);
    expect(requireRecord(response.body)["jsonrpc"]).toBe("2.0");
    expect(requireRecord(response.body)["id"]).toBe(1);
    const result = requireRecord(requireRecord(response.body)["result"]);
    expect(result["serverInfo"]).toMatchObject({ name: "novelfabric" });
    expect(result["capabilities"]).toMatchObject({ tools: {} });
  });

  it("ping returns an empty JSON-RPC result", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({ jsonrpc: "2.0", id: "ping-1", method: "ping" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jsonrpc: "2.0", id: "ping-1", result: {} });
  });

  it("tools/list exposes the three frozen external swarm tools", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    expect(response.status).toBe(200);
    const result = requireRecord(requireRecord(response.body)["result"]);
    const tools = result["tools"];
    expect(Array.isArray(tools)).toBe(true);
    if (!Array.isArray(tools)) throw new Error("Expected MCP tools array.");
    expect(tools.map((tool) => requireRecord(tool)["name"])).toEqual([
      "external_swarm_infer",
      "external_swarm_require_context",
      "external_swarm_get"
    ]);
    const inferTool = requireRecord(tools[0]);
    const inputSchema = requireRecord(inferTool["inputSchema"]);
    const properties = requireRecord(inputSchema["properties"]);
    expect(properties["context"]).toBeDefined();
  });

  it("tools/call external_swarm_infer returns the frozen MCP structured shape", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "infer-1",
      method: "tools/call",
      params: { name: "external_swarm_infer", arguments: externalSwarmRequest() }
    });

    expect(response.status).toBe(200);
    const result = requireRecord(requireRecord(response.body)["result"]);
    assertMcpStructuredResult(result);
    const structured = requireRecord(result["structuredContent"]);
    expect(structured["inference_id"]).toEqual(
      expect.stringMatching(/^external-caller-stable-id-/u)
    );
    expect(structured["project_slug"]).toBe("external-market-impact");
    expect(structured["domain"]).toBe("market-impact");
    expect(structured["title"]).toBe("Hermes market-impact fixture");
    expect(requireRecord(structured["artifact_paths"])["context"]).toEqual(
      expect.stringContaining("projects/external-market-impact/external/context/")
    );
    expect(Array.isArray(structured["role_reasoning"])).toBe(true);
    const text = requireRecord((result["content"] as readonly unknown[])[0])["text"];
    expect(typeof text).toBe("string");
    expect(text).toContain("Hermes market-impact fixture");
  });

  it("tools/call external_swarm_get returns a persisted inference", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });
    const created = await postMcp({
      jsonrpc: "2.0",
      id: "infer-then-get",
      method: "tools/call",
      params: { name: "external_swarm_infer", arguments: externalSwarmRequest() }
    });
    const inferenceId = String(
      requireRecord(requireRecord(requireRecord(created.body)["result"])["structuredContent"])[
        "inference_id"
      ]
    );

    const fetched = await postMcp({
      jsonrpc: "2.0",
      id: "get-1",
      method: "tools/call",
      params: { name: "external_swarm_get", arguments: { inference_id: inferenceId } }
    });

    expect(fetched.status).toBe(200);
    const fetchedResult = requireRecord(requireRecord(fetched.body)["result"]);
    assertMcpStructuredResult(fetchedResult);
    expect(requireRecord(fetchedResult["structuredContent"])["inference_id"]).toBe(inferenceId);
    expect(fetchedResult["structuredContent"]).toEqual(
      requireRecord(requireRecord(created.body)["result"])["structuredContent"]
    );
  });

  it("tools/call external_swarm_require_context returns missing context requirements", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });
    const underspecified = { ...externalSwarmRequest() };
    delete underspecified["context"];

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "require-context-1",
      method: "tools/call",
      params: { name: "external_swarm_require_context", arguments: underspecified }
    });

    expect(response.status).toBe(200);
    const result = requireRecord(requireRecord(response.body)["result"]);
    assertMcpStructuredResult(result);
    const structured = requireRecord(result["structuredContent"]);
    expect(structured["is_ready"]).toBe(false);
    expect(structured["missing_required_keys"]).toEqual(["entity_cards", "background"]);
  });

  it("unknown MCP tools return JSON-RPC errors", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "unknown-tool",
      method: "tools/call",
      params: { name: "external_swarm_missing", arguments: {} }
    });

    expect(response.status).toBe(200);
    const error = requireRecord(requireRecord(response.body)["error"]);
    expect(error["code"]).toBe(-32601);
    expect(requireRecord(error["data"])["code"]).toBe("mcp_unknown_tool");
  });

  it("invalid MCP tool arguments return JSON-RPC errors", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("main_agent");
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "bad-args",
      method: "tools/call",
      params: { name: "external_swarm_infer", arguments: { ...externalSwarmRequest(), items: [] } }
    });

    expect(response.status).toBe(200);
    const error = requireRecord(requireRecord(response.body)["error"]);
    expect(error["code"]).toBe(-32602);
    expect(requireRecord(error["data"])["code"]).toBe("mcp_invalid_tool_arguments");
  });

  it("capability denials return JSON-RPC errors", async () => {
    const workspacePath = await tempExternalSwarmWorkspace("role_agent");
    configureBridge({ workspacePath, actor: "role_agent" });

    const response = await postMcp({
      jsonrpc: "2.0",
      id: "denied",
      method: "tools/call",
      params: { name: "external_swarm_infer", arguments: externalSwarmRequest() }
    });

    expect(response.status).toBe(200);
    const error = requireRecord(requireRecord(response.body)["error"]);
    expect(error["code"]).toBe(-32003);
    expect(requireRecord(error["data"])["code"]).toBe("capability_denied");
  });
});

describe("NovelFabric web bridge agent task routes", () => {
  it("returns bridge_disabled when bridge is not enabled", async () => {
    delete process.env["NOVELFABRIC_WEB_BRIDGE"];
    const fixture = fixtureWorkspace();
    for (const routePath of [
      "/api/bridge/agent/tasks/status",
      "/api/bridge/agent/tasks/cancel",
      "/api/bridge/agent/tasks/retry",
      "/api/bridge/agent/tasks/stream"
    ] as const) {
      const response = await postBridge(routePath, {
        workspacePath: fixture,
        actor: "main_agent",
        task: "missing-task"
      });

      expect(response.status).toBe(404);
      expect(response.body.ok).toBe(false);
      if (!response.body.ok) {
        expect(response.body.error.code).toBe("bridge_disabled");
      }
    }
  });

  it("rejects workspace and actor mismatches", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    for (const routePath of [
      "/api/bridge/agent/tasks/status",
      "/api/bridge/agent/tasks/cancel",
      "/api/bridge/agent/tasks/retry",
      "/api/bridge/agent/tasks/stream"
    ] as const) {
      const workspaceMismatch = await postBridge(routePath, {
        workspacePath: path.join(workspacePath, "..", "other"),
        actor: "main_agent",
        task: "missing-task"
      });
      expect(workspaceMismatch.status).toBe(403);
      expect(workspaceMismatch.body.ok).toBe(false);
      if (!workspaceMismatch.body.ok) {
        expect(workspaceMismatch.body.error.code).toBe("bridge_workspace_mismatch");
      }

      const actorMismatch = await postBridge(routePath, {
        workspacePath,
        actor: "role_agent",
        task: "missing-task"
      });
      expect(actorMismatch.status).toBe(403);
      expect(actorMismatch.body.ok).toBe(false);
      if (!actorMismatch.body.ok) {
        expect(actorMismatch.body.error.code).toBe("bridge_actor_mismatch");
      }
    }
  });

  it("rejects any client-supplied allowed commands during web task creation", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    for (const allowedCommands of [["bash", "novelfabric files read"], []] as const) {
      const response = await postBridge("/api/bridge/agent/tasks/create", {
        workspacePath,
        actor: "main_agent",
        title: "Unsafe web task",
        instruction: "Return JSON.",
        allowedCommands
      });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      if (!response.body.ok) {
        expect(response.body.error.code).toBe("bridge_agent_allowed_commands_forbidden");
      }
    }
  });

  it("rejects path-like task ids from the create route", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postBridge("/api/bridge/agent/tasks/create", {
      workspacePath,
      actor: "main_agent",
      title: "Unsafe path-like task",
      instruction: "Return one JSON object.",
      taskId: "../../x"
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_agent_task_id_forbidden");
    }
  });

  it("creates task packages without accepting client command policy", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postBridge("/api/bridge/agent/tasks/create", {
      workspacePath,
      actor: "main_agent",
      title: "Web task",
      instruction: "Return one JSON object.",
      taskId: "web-task-001",
      inputJson: JSON.stringify({ source: "web" }),
      outputSchemaJson: JSON.stringify({ type: "object" })
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data).toMatchObject({
        taskId: "web-task-001",
        packageCreated: true,
        fileCount: 7,
        writeCount: 7
      });
      expect(JSON.stringify(response.body.data)).not.toContain("bash");
      expectNoInternalTaskPaths(response.body.data, workspacePath);
    }
  });

  it("rejects non-sdk runtime from the web run route", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Run policy task",
      instruction: "Return JSON.",
      taskId: "run-policy-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });

    for (const runtime of ["pi", "raw"] as const) {
      const response = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "run-policy-task",
        runtime
      });

      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      if (!response.body.ok) {
        expect(response.body.error.code).toBe("bridge_agent_runtime_forbidden");
      }
    }
  });

  it("rejects path-like task ids from the run route before invoking the run service", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postBridge("/api/bridge/agent/tasks/run", {
      workspacePath,
      actor: "main_agent",
      task: "../../x"
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_agent_task_id_forbidden");
    }
  });

  it("starts web tasks asynchronously through the shared pi-sdk service and returns a sanitized running summary", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const secretModelOutput =
      '{"kind":"novelfabric.web.run-output","version":1,"summary":"secret raw model output should stay in result.json"}';
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({ outputText: secretModelOutput, delayMs: 25 })
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Web Run Task",
        instruction: "Return web run JSON.",
        taskId: "web-run-task",
        outputSchemaJson: JSON.stringify({
          type: "object",
          required: ["kind", "version", "summary"],
          properties: {
            kind: { type: "string" },
            version: { type: "number" },
            summary: { type: "string", containsText: "secret raw model output" }
          }
        })
      });

      const response = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "web-run-task"
      });

      expect(response.status).toBe(202);
      expect(response.body.ok).toBe(true);
      if (response.body.ok) {
        expect(response.body.data).toMatchObject({
          taskId: "web-run-task",
          status: "running",
          eventStreamAvailable: true
        });
        expectNoInternalTaskPaths(response.body.data, workspacePath);
      }

      const immediateStatus = await postBridge("/api/bridge/agent/tasks/status", {
        workspacePath,
        actor: "main_agent",
        task: "web-run-task"
      });
      expect(immediateStatus.status).toBe(200);
      expect(immediateStatus.body.ok).toBe(true);
      if (immediateStatus.body.ok) {
        expect(immediateStatus.body.data).toMatchObject({
          taskId: "web-run-task",
          status: "running",
          resultAvailable: false
        });
        expectNoInternalTaskPaths(immediateStatus.body.data, workspacePath);
      }

      const pendingResultFile = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", "web-run-task", "result.json"),
        "utf8"
      );
      expect(pendingResultFile).toContain('"status": "pending-pi-runtime"');

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("secret raw model output");
      expect(serialized).not.toContain("rawText");
      expect(serialized).not.toContain("parsedJson");
      expect(serialized).not.toContain("sessionFile");
      expect(serialized).not.toContain("/tmp/novelfabric-sdk-web-session.jsonl");
      expect(serialized).not.toContain(workspacePath);

      const status = await waitForBridgeTaskStatus(workspacePath, "web-run-task", "completed");
      expect(status.body.ok).toBe(true);
      if (status.body.ok) {
        expect(status.body.data).toMatchObject({
          taskId: "web-run-task",
          status: "completed",
          resultAvailable: true,
          eventsAvailable: true
        });
        expect(status.body.data["runtimeEvidence"]).toMatchObject({
          engine: "sdk",
          toolPolicy: "sdk-web-safe-custom-tools",
          sessionPolicy: "workspace-session-dir"
        });
        expectNoInternalTaskPaths(status.body.data, workspacePath);
      }

      const resultFile = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", "web-run-task", "result.json"),
        "utf8"
      );
      expect(resultFile).toContain("secret raw model output");
    } finally {
      restoreSdkModule();
    }
  });

  it("prefers durable terminal status over an in-memory active run", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({
        outputText:
          '{"kind":"novelfabric.web.durable-terminal-output","version":1,"summary":"durable terminal output"}',
        delayMs: 80
      })
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Durable terminal status task",
        instruction: "Return durable terminal JSON.",
        taskId: "durable-terminal-status-task",
        outputSchemaJson: JSON.stringify({ type: "object" })
      });

      const run = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "durable-terminal-status-task"
      });
      expect(run.status).toBe(202);
      await writeSyntheticCompletedResult(workspacePath, "durable-terminal-status-task");

      const status = await postBridge("/api/bridge/agent/tasks/status", {
        workspacePath,
        actor: "main_agent",
        task: "durable-terminal-status-task"
      });
      expect(status.status).toBe(200);
      expect(status.body.ok).toBe(true);
      if (status.body.ok) {
        expect(status.body.data).toMatchObject({
          taskId: "durable-terminal-status-task",
          status: "completed",
          resultAvailable: true
        });
        expect(status.body.data["runState"]).toMatchObject({ status: "running" });
        expectNoInternalTaskPaths(status.body.data, workspacePath);
      }

      await waitForBridgeTaskStatus(workspacePath, "durable-terminal-status-task", "completed");
    } finally {
      restoreSdkModule();
    }
  });

  it("rejects duplicate active web task runs", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({
        outputText:
          '{"kind":"novelfabric.web.duplicate-run-output","version":1,"summary":"duplicate active run output"}',
        delayMs: 80
      })
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Duplicate run task",
        instruction: "Return duplicate run JSON.",
        taskId: "duplicate-run-task",
        outputSchemaJson: JSON.stringify({ type: "object" })
      });

      const [left, right] = await Promise.all([
        postBridge("/api/bridge/agent/tasks/run", {
          workspacePath,
          actor: "main_agent",
          task: "duplicate-run-task"
        }),
        postBridge("/api/bridge/agent/tasks/run", {
          workspacePath,
          actor: "main_agent",
          task: "duplicate-run-task"
        })
      ]);
      const responses = [left, right] as const;
      expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
      const duplicate = responses.find((response) => response.status === 409);
      expect(duplicate).toBeDefined();
      if (duplicate !== undefined) {
        expect(duplicate.body.ok).toBe(false);
        if (!duplicate.body.ok) {
          expect(duplicate.body.error.code).toBe("bridge_agent_task_already_running");
          expectNoInternalTaskPaths(duplicate.body.error, workspacePath);
        }
      }

      await waitForBridgeTaskStatus(workspacePath, "duplicate-run-task", "completed");
    } finally {
      restoreSdkModule();
    }
  });

  it("rejects starting completed web tasks again and leaves retry as the lifecycle path", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Completed run guard task",
      instruction: "Return JSON.",
      taskId: "completed-run-guard-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticCompletedResult(workspacePath, "completed-run-guard-task");

    const response = await postBridge("/api/bridge/agent/tasks/run", {
      workspacePath,
      actor: "main_agent",
      task: "completed-run-guard-task"
    });

    expect(response.status).toBe(409);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_agent_task_already_completed");
      expectNoInternalTaskPaths(response.body.error, workspacePath);
    }
  });

  it("rejects path-like task ids from status, events, and lifecycle routes", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    for (const routePath of [
      "/api/bridge/agent/tasks/status",
      "/api/bridge/agent/tasks/events",
      "/api/bridge/agent/tasks/cancel",
      "/api/bridge/agent/tasks/retry",
      "/api/bridge/agent/tasks/stream"
    ] as const) {
      const response = await postBridge(routePath, {
        workspacePath,
        actor: "main_agent",
        task: "../../x"
      });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
      if (!response.body.ok) {
        expect(response.body.error.code).toBe("bridge_agent_task_id_forbidden");
      }
    }
  });

  it("returns structured status and events for a completed task", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Completed web task",
      instruction: "Return JSON.",
      taskId: "completed-web-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticCompletedResult(workspacePath, "completed-web-task");

    const status = await postBridge("/api/bridge/agent/tasks/status", {
      workspacePath,
      actor: "main_agent",
      task: "completed-web-task"
    });
    expect(status.status).toBe(200);
    expect(status.body.ok).toBe(true);
    if (status.body.ok) {
      expect(status.body.data["taskId"]).toBe("completed-web-task");
      expect(status.body.data["status"]).toBe("completed");
      expect(status.body.data["resultAvailable"]).toBe(true);
      expect(status.body.data["eventsAvailable"]).toBe(true);
      expect(status.body.data["runtimeEvidence"]).toMatchObject({ engine: "sdk" });
      expect(JSON.stringify(status.body.data)).not.toContain("rawText");
      expect(JSON.stringify(status.body.data)).not.toContain("sessionFile");
      expect(JSON.stringify(status.body.data)).not.toContain(
        "/tmp/novelfabric-web-status-session.jsonl"
      );
      expectNoInternalTaskPaths(status.body.data, workspacePath);
    }

    const events = await postBridge("/api/bridge/agent/tasks/events", {
      workspacePath,
      actor: "main_agent",
      task: "completed-web-task"
    });
    expect(events.status).toBe(200);
    expect(events.body.ok).toBe(true);
    if (events.body.ok) {
      expect(events.body.data["taskId"]).toBe("completed-web-task");
      expect(events.body.data["eventsAvailable"]).toBe(true);
      expect(events.body.data["events"]).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "created" })])
      );
      expectNoInternalTaskPaths(events.body.data, workspacePath);
    }
  });

  it("does not return raw event messages or internal details from the events route", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Leaky event task",
      instruction: "Return JSON.",
      taskId: "leaky-event-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticEvent(
      workspacePath,
      "leaky-event-task",
      [
        "leak .novelfabric/tasks/leaky-event-task/result.json",
        "sessionFile=/tmp/novelfabric-sdk-session.jsonl",
        "rawText parsedJson",
        workspacePath,
        "Bearer secret-token sk-secret-token"
      ].join(" | ")
    );

    const events = await postBridge("/api/bridge/agent/tasks/events", {
      workspacePath,
      actor: "main_agent",
      task: "leaky-event-task"
    });

    expect(events.status).toBe(200);
    expect(events.body.ok).toBe(true);
    if (events.body.ok) {
      expect(events.body.data["events"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: "leaky-event-task",
            type: "pi-sdk-event",
            actor: "main_agent"
          })
        ])
      );
      expectNoInternalTaskPaths(events.body.data, workspacePath);
    }
    const serialized = JSON.stringify(events.body);
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("sk-secret-token");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("/tmp/novelfabric-sdk-session.jsonl");
  });

  it("does not leak internal task paths in missing task lifecycle errors", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    for (const routePath of [
      "/api/bridge/agent/tasks/status",
      "/api/bridge/agent/tasks/events",
      "/api/bridge/agent/tasks/cancel",
      "/api/bridge/agent/tasks/retry",
      "/api/bridge/agent/tasks/stream"
    ] as const) {
      const response =
        routePath === "/api/bridge/agent/tasks/stream"
          ? await postBridgeText(routePath, {
              workspacePath,
              actor: "main_agent",
              task: "missing-web-task"
            })
          : await postBridge(routePath, {
              workspacePath,
              actor: "main_agent",
              task: "missing-web-task"
            });
      const serialized =
        typeof response.body === "string" ? response.body : JSON.stringify(response.body);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(serialized).not.toContain(workspacePath);
      expect(serialized).not.toContain(".novelfabric/tasks/");
      expect(serialized).not.toContain("result.json");
      expect(serialized).not.toContain("events.jsonl");
      expect(serialized).not.toContain("sessionFile");
      expect(serialized).not.toContain("rawText");
      expect(serialized).not.toContain("parsedJson");
    }
  });

  it("cancels a task through the lifecycle route with a sanitized response", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Cancelable web task",
      instruction: "Return JSON.",
      taskId: "cancelable-web-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });

    const response = await postBridge("/api/bridge/agent/tasks/cancel", {
      workspacePath,
      actor: "main_agent",
      task: "cancelable-web-task",
      reason: "operator cancelled from web"
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data).toMatchObject({
        taskId: "cancelable-web-task",
        status: "aborted",
        resultAvailable: true,
        eventsAvailable: true,
        writeCount: 2
      });
      expectNoInternalTaskPaths(response.body.data, workspacePath);
    }
    const resultFile = await fs.readFile(
      path.join(workspacePath, ".novelfabric", "tasks", "cancelable-web-task", "result.json"),
      "utf8"
    );
    expect(resultFile).toContain('"status": "aborted"');
  });

  it("rejects cancel for completed tasks without overwriting result evidence", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Completed cancel guard task",
      instruction: "Return JSON.",
      taskId: "completed-cancel-guard-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticCompletedResult(workspacePath, "completed-cancel-guard-task");
    const resultPath = path.join(
      workspacePath,
      ".novelfabric",
      "tasks",
      "completed-cancel-guard-task",
      "result.json"
    );
    const before = await fs.readFile(resultPath, "utf8");
    const beforeHash = sha256(before);

    const response = await postBridge("/api/bridge/agent/tasks/cancel", {
      workspacePath,
      actor: "main_agent",
      task: "completed-cancel-guard-task",
      reason: "operator cancelled after completion"
    });

    expect(response.status).toBe(409);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_agent_task_already_completed");
      expectNoInternalTaskPaths(response.body.error, workspacePath);
    }
    const after = await fs.readFile(resultPath, "utf8");
    expect(after).toBe(before);
    expect(sha256(after)).toBe(beforeHash);
  });

  it("prepares retry tasks without overwriting previous evidence", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Retry source task",
      instruction: "Return JSON.",
      taskId: "retry-source-task",
      inputJson: JSON.stringify({ source: "retry" }),
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticCompletedResult(workspacePath, "retry-source-task");
    const originalResultPath = path.join(
      workspacePath,
      ".novelfabric",
      "tasks",
      "retry-source-task",
      "result.json"
    );
    const originalBefore = await fs.readFile(originalResultPath, "utf8");

    const response = await postBridge("/api/bridge/agent/tasks/retry", {
      workspacePath,
      actor: "main_agent",
      task: "retry-source-task",
      reason: "web retry preparation"
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data["originalTaskId"]).toBe("retry-source-task");
      expect(response.body.data["retryTaskId"]).toMatch(/^retry-source-task-retry-/u);
      expect(response.body.data["status"]).toBe("retry-prepared");
      expect(response.body.data["retryStatus"]).toBe("pending-pi-runtime");
      expect(response.body.data["previousEvidencePreserved"]).toBe(true);
      expectNoInternalTaskPaths(response.body.data, workspacePath);
      const retryTaskId = String(response.body.data["retryTaskId"]);
      const retryResult = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", retryTaskId, "result.json"),
        "utf8"
      );
      expect(retryResult).toContain('"status": "pending-pi-runtime"');
    }
    const originalAfter = await fs.readFile(originalResultPath, "utf8");
    expect(originalAfter).toBe(originalBefore);
  });

  it("streams an initial snapshot and cleans up when the request closes", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    process.env["NOVELFABRIC_WEB_BRIDGE_STREAM_POLL_MS"] = "25";
    process.env["NOVELFABRIC_WEB_BRIDGE_STREAM_MAX_MS"] = "500";
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Pending stream task",
      instruction: "Return JSON.",
      taskId: "pending-stream-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });

    const stream = await postBridgeStreamUntil(
      "/api/bridge/agent/tasks/stream",
      {
        workspacePath,
        actor: "main_agent",
        task: "pending-stream-task"
      },
      (body) => body.includes("event: snapshot"),
      { abortOnMatch: true }
    );

    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain("text/event-stream");
    expect(stream.body).toContain("event: snapshot");
    const snapshot = parseStreamFrame(stream.body, "snapshot");
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      expect(snapshot.data).toMatchObject({
        taskId: "pending-stream-task",
        cursor: 0,
        nextCursor: 1
      });
    }
    await waitForActiveStreams(0);
    expect(getActiveAgentTaskStreamCountForTesting()).toBe(0);
    expectNoInternalTaskPaths(stream.body, workspacePath);
  });

  it("keeps a stream open and emits terminal after async completion", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    process.env["NOVELFABRIC_WEB_BRIDGE_STREAM_POLL_MS"] = "25";
    process.env["NOVELFABRIC_WEB_BRIDGE_STREAM_MAX_MS"] = "3000";
    await writeTestRuntimeSettings(workspacePath);
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({
        outputText:
          '{"kind":"novelfabric.web.persistent-stream","version":1,"summary":"persistent stream completed"}',
        delayMs: 100
      })
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Persistent stream task",
        instruction: "Return persistent stream JSON.",
        taskId: "persistent-stream-task",
        outputSchemaJson: JSON.stringify({
          type: "object",
          required: ["kind", "version", "summary"],
          properties: {
            kind: { type: "string" },
            version: { type: "number" },
            summary: { type: "string", containsText: "persistent stream completed" }
          }
        })
      });

      const streamPromise = postBridgeStreamUntil(
        "/api/bridge/agent/tasks/stream",
        {
          workspacePath,
          actor: "main_agent",
          task: "persistent-stream-task"
        },
        (body) => body.includes("event: task.terminal")
      );
      const run = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "persistent-stream-task"
      });
      expect(run.status).toBe(202);
      const stream = await streamPromise;

      expect(stream.status).toBe(200);
      const hasSnapshotFrame = stream.body.includes("event: snapshot");
      const hasEventsFrame = stream.body.includes("event: events");
      expect(hasSnapshotFrame || hasEventsFrame).toBe(true);
      expect(stream.body).toContain("event: task.terminal");
      const terminal = parseStreamFrame(stream.body, "task.terminal");
      expect(terminal.ok).toBe(true);
      if (terminal.ok) {
        expect(terminal.data).toMatchObject({
          taskId: "persistent-stream-task",
          status: "completed"
        });
      }
      expect(stream.body).not.toContain("persistent stream completed");
      expectNoInternalTaskPaths(stream.body, workspacePath);
      await waitForActiveStreams(0);
    } finally {
      restoreSdkModule();
    }
  });

  it("streams structured runtime subtypes, supports cursor, and emits terminal task events", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const streamOutputText =
      '{"kind":"novelfabric.web.stream-output","version":1,"summary":"structured stream output"}';
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({
        outputText: streamOutputText,
        eventsBeforeOutput: [{ type: "tool.denied", toolName: "bash", reason: "raw tools denied" }]
      })
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Stream structured task",
        instruction: "Return stream JSON.",
        taskId: "stream-structured-task",
        outputSchemaJson: JSON.stringify({
          type: "object",
          required: ["kind", "version", "summary"],
          properties: {
            kind: { type: "string" },
            version: { type: "number" },
            summary: { type: "string", containsText: "structured stream output" }
          }
        })
      });

      const run = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "stream-structured-task"
      });
      expect(run.status).toBe(202);
      await waitForBridgeTaskStatus(workspacePath, "stream-structured-task", "completed");

      const stream = await postBridgeText("/api/bridge/agent/tasks/stream", {
        workspacePath,
        actor: "main_agent",
        task: "stream-structured-task",
        cursor: 2
      });

      expect(stream.status).toBe(200);
      expect(stream.contentType).toContain("text/event-stream");
      expect(stream.body).toContain("event: snapshot");
      expect(stream.body).toContain("event: task.terminal");
      const snapshot = parseStreamFrame(stream.body, "snapshot");
      expect(snapshot.ok).toBe(true);
      if (snapshot.ok) {
        expect(snapshot.data["cursor"]).toBe(2);
        expect(snapshot.data["nextCursor"]).toBeGreaterThan(2);
        expect(snapshot.data["events"]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "pi-sdk-event",
              runtimeEventType: "tool.denied",
              toolName: "bash",
              denialCode: "web_safe_policy_denied"
            }),
            expect.objectContaining({
              type: "pi-sdk-event",
              runtimeEventType: "model.output",
              textBytes: Buffer.byteLength(streamOutputText, "utf8")
            }),
            expect.objectContaining({
              type: "pi-completed",
              terminal: true
            })
          ])
        );
        expect(snapshot.data["events"]).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "created" })])
        );
      }
      const terminal = parseStreamFrame(stream.body, "task.terminal");
      expect(terminal.ok).toBe(true);
      if (terminal.ok) {
        expect(terminal.data).toMatchObject({
          taskId: "stream-structured-task",
          status: "completed"
        });
      }
      expect(stream.body).not.toContain("message");
      expect(stream.body).not.toContain("structured stream output");
      expectNoInternalTaskPaths(stream.body, workspacePath);
    } finally {
      restoreSdkModule();
    }
  });

  it("writes durable failed result and event records when web task run fails", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const leakySdkError = [
      `SDK failed at ${path.join(workspacePath, ".novelfabric", "tasks", "failing-web-task", "result.json")}`,
      "sessionFile=/tmp/novelfabric-failing-session.jsonl",
      "events.jsonl task.json",
      "Bearer secret-token sk-secret-token",
      "secret=internal-secret-token"
    ].join(" | ");
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakeFailingPiSdkModuleForWebTest(leakySdkError)
    );
    try {
      await createAgentTask({
        workspacePath,
        actor: "main_agent",
        title: "Failing web task",
        instruction: "Return JSON.",
        taskId: "failing-web-task",
        outputSchemaJson: JSON.stringify({ type: "object" })
      });

      const response = await postBridge("/api/bridge/agent/tasks/run", {
        workspacePath,
        actor: "main_agent",
        task: "failing-web-task"
      });

      expect(response.status).toBe(202);
      expect(response.body.ok).toBe(true);
      if (response.body.ok) {
        expect(response.body.data).toMatchObject({
          taskId: "failing-web-task",
          status: "running",
          eventStreamAvailable: true
        });
        expectNoInternalTaskPaths(response.body.data, workspacePath);
      }
      const failedStatus = await waitForBridgeTaskStatus(
        workspacePath,
        "failing-web-task",
        "failed"
      );
      expect(failedStatus.body.ok).toBe(true);
      if (failedStatus.body.ok) {
        expect(failedStatus.body.data).toMatchObject({
          taskId: "failing-web-task",
          status: "failed",
          resultAvailable: true,
          eventsAvailable: true
        });
        expectNoInternalTaskPaths(failedStatus.body.data, workspacePath);
      }
      const serializedResponse = JSON.stringify({
        response: response.body,
        failedStatus: failedStatus.body
      });
      expect(serializedResponse).not.toContain(workspacePath);
      expect(serializedResponse).not.toContain(".novelfabric/tasks/failing-web-task/result.json");
      expect(serializedResponse).not.toContain("/tmp/novelfabric-failing-session.jsonl");
      expect(serializedResponse).not.toContain("secret-token");
      expect(serializedResponse).not.toContain("sk-secret-token");
      expect(serializedResponse).not.toContain("internal-secret-token");
      const resultFile = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", "failing-web-task", "result.json"),
        "utf8"
      );
      expect(resultFile).toContain('"status": "failed"');
      expect(resultFile).not.toContain(workspacePath);
      expect(resultFile).not.toContain(".novelfabric/tasks/failing-web-task/result.json");
      expect(resultFile).not.toContain("/tmp/novelfabric-failing-session.jsonl");
      expect(resultFile).not.toContain("secret-token");
      expect(resultFile).not.toContain("sk-secret-token");
      expect(resultFile).not.toContain("internal-secret-token");
      const eventsFile = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", "failing-web-task", "events.jsonl"),
        "utf8"
      );
      expect(eventsFile).toContain('"type":"failed"');
      expect(eventsFile).toContain('"runtimeEventType":"session.failed"');
      expect(eventsFile).toContain('"terminal":true');
      expect(eventsFile).not.toContain(workspacePath);
      expect(eventsFile).not.toContain(".novelfabric/tasks/failing-web-task/result.json");
      expect(eventsFile).not.toContain("/tmp/novelfabric-failing-session.jsonl");
      expect(eventsFile).not.toContain("secret-token");
      expect(eventsFile).not.toContain("sk-secret-token");
      expect(eventsFile).not.toContain("internal-secret-token");
    } finally {
      restoreSdkModule();
    }
  });

  it("streams a sanitized event snapshot without raw messages or internal paths", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Stream web task",
      instruction: "Return JSON.",
      taskId: "stream-web-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticEvent(
      workspacePath,
      "stream-web-task",
      [
        "leak .novelfabric/tasks/stream-web-task/result.json",
        "sessionFile=/tmp/novelfabric-sdk-session.jsonl",
        "rawText parsedJson",
        workspacePath,
        "Bearer secret-token sk-secret-token"
      ].join(" | ")
    );

    const stream = await postBridgeStreamUntil(
      "/api/bridge/agent/tasks/stream",
      {
        workspacePath,
        actor: "main_agent",
        task: "stream-web-task"
      },
      (body) => body.includes("event: snapshot") && body.includes("stream-web-task"),
      { abortOnMatch: true }
    );

    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain("text/event-stream");
    expect(stream.body).toContain("event: snapshot");
    expect(stream.body).toContain("stream-web-task");
    expect(stream.body).not.toContain("message");
    expect(stream.body).not.toContain("secret-token");
    expect(stream.body).not.toContain("sk-secret-token");
    expect(stream.body).not.toContain("Bearer");
    expect(stream.body).not.toContain("/tmp/novelfabric-sdk-session.jsonl");
    expect(stream.body).not.toContain(workspacePath);
    expect(stream.body).not.toContain(".novelfabric/tasks/");
  });

  it("sanitizes structured event fields before SSE emission", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await createAgentTask({
      workspacePath,
      actor: "main_agent",
      title: "Structured leak stream task",
      instruction: "Return JSON.",
      taskId: "structured-leak-stream-task",
      outputSchemaJson: JSON.stringify({ type: "object" })
    });
    await writeSyntheticEvent(
      workspacePath,
      "structured-leak-stream-task",
      "structured fields should be sanitized",
      {
        runtimeEventType: "session.failed:/tmp/novelfabric-session.jsonl",
        toolName: `novelfabric_read_file ${path.join(
          workspacePath,
          ".novelfabric",
          "tasks",
          "structured-leak-stream-task",
          "result.json"
        )} Bearer secret-token sk-structured-secret`,
        denialCode: "secret=internal-secret-token /tmp/novelfabric-denial-session.jsonl"
      }
    );

    const stream = await postBridgeStreamUntil(
      "/api/bridge/agent/tasks/stream",
      {
        workspacePath,
        actor: "main_agent",
        task: "structured-leak-stream-task"
      },
      (body) => body.includes("event: snapshot") && body.includes("structured-leak-stream-task"),
      { abortOnMatch: true }
    );

    expect(stream.status).toBe(200);
    expect(stream.contentType).toContain("text/event-stream");
    expect(stream.body).toContain("event: snapshot");
    expect(stream.body).toContain("toolName");
    expect(stream.body).toContain("denialCode");
    expect(stream.body).not.toContain("runtimeEventType");
    expect(stream.body).not.toContain(workspacePath);
    expect(stream.body).not.toContain(".novelfabric/tasks/");
    expect(stream.body).not.toContain("result.json");
    expect(stream.body).not.toContain("secret-token");
    expect(stream.body).not.toContain("structured-secret");
    expect(stream.body).not.toContain("internal-secret-token");
    expect(stream.body).not.toContain("/tmp/novelfabric-session.jsonl");
    expect(stream.body).not.toContain("/tmp/novelfabric-denial-session.jsonl");
  });
});

describe("NovelFabric web bridge runtime session prepare route", () => {
  it("returns bridge_disabled when bridge is not enabled", async () => {
    delete process.env["NOVELFABRIC_WEB_BRIDGE"];
    const fixture = fixtureWorkspace();
    const response = await postRuntimePrepare({
      workspacePath: fixture,
      actor: "main_agent",
      requestedTools: ["novelfabric_read_file"]
    });

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_disabled");
    }
  });

  it("rejects workspace mismatches", async () => {
    const fixture = fixtureWorkspace();
    configureBridge({ workspacePath: fixture, actor: "main_agent" });

    const response = await postRuntimePrepare({
      workspacePath: path.join(fixture, "..", "other"),
      actor: "main_agent",
      requestedTools: ["novelfabric_read_file"]
    });

    expect(response.status).toBe(403);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_workspace_mismatch");
    }
  });

  it("rejects actor mismatches", async () => {
    const fixture = fixtureWorkspace();
    configureBridge({ workspacePath: fixture, actor: "main_agent" });

    const response = await postRuntimePrepare({
      workspacePath: fixture,
      actor: "role_agent",
      requestedTools: ["novelfabric_read_file"]
    });

    expect(response.status).toBe(403);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_actor_mismatch");
    }
  });

  it("denies raw builtin tools in the web-safe policy", async () => {
    const fixture = fixtureWorkspace();
    configureBridge({ workspacePath: fixture, actor: "main_agent" });

    const response = await postRuntimePrepare({
      workspacePath: fixture,
      actor: "main_agent",
      requestedTools: ["bash", "write", "edit", "network"]
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data.valid).toBe(false);
      expect(response.body.data.rawBuiltinToolsEnabled).toBe(false);
      expect(response.body.data.deniedRawTools).toEqual(
        expect.arrayContaining(["bash", "write", "edit", "network"])
      );
      expect(response.body.data.violations).toEqual([
        expect.stringContaining("bash"),
        expect.stringContaining("write"),
        expect.stringContaining("edit"),
        expect.stringContaining("network")
      ]);
    }
  });

  it("allows only NovelFabric web-safe tools", async () => {
    const fixture = fixtureWorkspace();
    configureBridge({ workspacePath: fixture, actor: "main_agent" });

    const response = await postRuntimePrepare({
      workspacePath: fixture,
      actor: "main_agent",
      requestedTools: ["novelfabric_read_file", "novelfabric_context_pack"]
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data.valid).toBe(true);
      expect(response.body.data.violations).toEqual([]);
      expect(response.body.data.policyProfile).toBe("web-safe");
      expect(response.body.data.actor).toBe("main_agent");
      expect(response.body.data.workspacePath).toBe(fixture);
      expect(response.body.data.allowedTools).toEqual(
        expect.arrayContaining(["novelfabric_read_file", "novelfabric_context_pack"])
      );
      expect(response.body.data.sdk.packageName).toBe("@earendil-works/pi-coding-agent");
    }
  });

  it("returns a sanitized SDK availability summary", async () => {
    const fixture = fixtureWorkspace();
    configureBridge({ workspacePath: fixture, actor: "main_agent" });
    process.env["OPENAI_API_KEY"] = "sk-secret-should-not-appear";
    process.env["AUTHORIZATION"] = "Bearer secret-should-not-appear";

    const response = await postRuntimePrepare({
      workspacePath: fixture,
      actor: "main_agent",
      requestedTools: ["novelfabric_validate"]
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("sk-secret-should-not-appear");
    expect(serialized).not.toContain("secret-should-not-appear");
    expect(serialized.toLowerCase()).not.toContain("api_key");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    if (response.body.ok) {
      expect(Object.keys(response.body.data.sdk).sort()).toEqual([
        "available",
        "missingExports",
        "packageName",
        "version"
      ]);
    }
  });
});

describe("NovelFabric web bridge workflow routes", () => {
  it("returns bridge_disabled when workflow bridge is not enabled", async () => {
    delete process.env["NOVELFABRIC_WEB_BRIDGE"];
    const response = await postBridge("/api/bridge/workflow/plan", {
      workspacePath: fixtureWorkspace(),
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria"
    });

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_disabled");
    }
  });

  it("rejects workflow workspace mismatches", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const response = await postBridge("/api/bridge/workflow/peek", {
      workspacePath: path.join(workspacePath, "..", "other"),
      actor: "main_agent",
      jobId: "workflow-missing"
    });

    expect(response.status).toBe(403);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_workspace_mismatch");
    }
  });

  it("rejects workflow actor mismatches for mutating routes", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await postBridge("/api/bridge/workflow/plan", {
      workspacePath,
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria",
      planId: "actor-mismatch-workflow"
    });
    await postBridge("/api/bridge/workflow/start", {
      workspacePath,
      actor: "main_agent",
      planId: "actor-mismatch-workflow"
    });

    for (const [routePath, body] of [
      [
        "/api/bridge/workflow/plan",
        { workspacePath, actor: "role_agent", sourcePath: "project.md", role: "Aria" }
      ],
      [
        "/api/bridge/workflow/start",
        { workspacePath, actor: "role_agent", planId: "actor-mismatch-workflow" }
      ],
      [
        "/api/bridge/workflow/cancel",
        { workspacePath, actor: "role_agent", jobId: "actor-mismatch-workflow" }
      ]
    ] as const) {
      const response = await postBridge(routePath, body);
      expect(response.status).toBe(403);
      expect(response.body.ok).toBe(false);
      if (!response.body.ok) {
        expect(response.body.error.code).toBe("bridge_actor_mismatch");
      }
    }
  });

  it("plans, starts, reads, verifies, lists artifacts, and cancels workflow jobs", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const plan = await postBridge("/api/bridge/workflow/plan", {
      workspacePath,
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria",
      planId: "web-workflow-001"
    });
    expect(plan.status).toBe(200);
    expect(plan.body.ok).toBe(true);
    if (plan.body.ok) {
      expect(plan.body.data).toMatchObject({
        planId: "web-workflow-001",
        sourcePath: "project.md",
        role: "Aria"
      });
      expect(plan.body.data["stageCount"]).toBeGreaterThan(0);
      expect(plan.body.data["stages"]).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "swarm.task.create" })])
      );
      expectNoInternalTaskPaths(plan.body.data, workspacePath);
    }

    const start = await postBridge("/api/bridge/workflow/start", {
      workspacePath,
      actor: "main_agent",
      planId: "web-workflow-001"
    });
    expect(start.status).toBe(200);
    expect(start.body.ok).toBe(true);
    if (start.body.ok) {
      expect(start.body.data).toMatchObject({
        jobId: "web-workflow-001",
        status: "running",
        completedStages: [],
        nextStage: "import.normalize",
        progress: { completed: 0, total: 15 }
      });
      expectNoInternalTaskPaths(start.body.data, workspacePath);
    }

    for (const routePath of ["/api/bridge/workflow/peek", "/api/bridge/workflow/status"] as const) {
      const response = await postBridge(routePath, {
        workspacePath,
        actor: "main_agent",
        jobId: "web-workflow-001"
      });
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      if (response.body.ok) {
        expect(response.body.data).toMatchObject({
          jobId: "web-workflow-001",
          status: "running",
          completedStages: [],
          nextStage: "import.normalize"
        });
        expectNoInternalTaskPaths(response.body.data, workspacePath);
      }
    }

    const artifacts = await postBridge("/api/bridge/workflow/artifacts", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-001"
    });
    expect(artifacts.status).toBe(200);
    expect(artifacts.body.ok).toBe(true);
    if (artifacts.body.ok) {
      expect(artifacts.body.data).toMatchObject({
        jobId: "web-workflow-001",
        artifactCount: 0,
        artifacts: []
      });
      expectNoInternalTaskPaths(artifacts.body.data, workspacePath);
    }

    const verify = await postBridge("/api/bridge/workflow/verify", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-001"
    });
    expect(verify.status).toBe(200);
    expect(verify.body.ok).toBe(true);
    if (verify.body.ok) {
      expect(verify.body.data).toEqual({ valid: true, issues: [] });
      expectNoInternalTaskPaths(verify.body.data, workspacePath);
    }

    const cancel = await postBridge("/api/bridge/workflow/cancel", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-001",
      reason: "web operator cancelled"
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);
    if (cancel.body.ok) {
      expect(cancel.body.data).toEqual({ jobId: "web-workflow-001", status: "cancelled" });
      expectNoInternalTaskPaths(cancel.body.data, workspacePath);
    }
  });

  it("starts workflow steps asynchronously and exposes running status", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    process.env["NOVELFABRIC_WEB_BRIDGE_WORKFLOW_STEP_DELAY_MS"] = "150";
    await postBridge("/api/bridge/workflow/plan", {
      workspacePath,
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria",
      planId: "web-workflow-step-async"
    });
    await postBridge("/api/bridge/workflow/start", {
      workspacePath,
      actor: "main_agent",
      planId: "web-workflow-step-async"
    });

    const startedAt = Date.now();
    const step = await postBridge("/api/bridge/workflow/step", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-step-async"
    });
    expect(Date.now() - startedAt).toBeLessThan(120);
    expect(step.status).toBe(202);
    expect(step.body.ok).toBe(true);
    if (step.body.ok) {
      expect(step.body.data).toMatchObject({
        jobId: "web-workflow-step-async",
        status: "running",
        eventStreamAvailable: true
      });
      expect(step.body.data["runStartedAt"]).toEqual(expect.any(String));
      expectNoInternalTaskPaths(step.body.data, workspacePath);
    }

    const duplicate = await postBridge("/api/bridge/workflow/step", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-step-async"
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.ok).toBe(false);
    if (!duplicate.body.ok) {
      expect(duplicate.body.error.code).toBe("bridge_workflow_step_already_running");
      expectNoInternalTaskPaths(duplicate.body.error, workspacePath);
    }

    const running = await postBridge("/api/bridge/workflow/step/status", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-step-async"
    });
    expect(running.status).toBe(200);
    expect(running.body.ok).toBe(true);
    if (running.body.ok) {
      expect(running.body.data).toMatchObject({
        jobId: "web-workflow-step-async",
        workflowStatus: "running",
        nextStage: "import.normalize",
        stepRun: { status: "running" }
      });
      expectNoInternalTaskPaths(running.body.data, workspacePath);
    }

    const completed = await waitForBridgeWorkflowStepStatus(
      workspacePath,
      "web-workflow-step-async",
      "completed"
    );
    expect(completed.body.ok).toBe(true);
    if (completed.body.ok) {
      expect(completed.body.data).toMatchObject({
        jobId: "web-workflow-step-async",
        workflowStatus: "running",
        completedStages: ["import.normalize"],
        nextStage: "import.chapterize",
        stepRun: { status: "completed" }
      });
      expectNoInternalTaskPaths(completed.body.data, workspacePath);
    }

    const status = await postBridge("/api/bridge/workflow/status", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-step-async"
    });
    expect(status.status).toBe(200);
    expect(status.body.ok).toBe(true);
    if (status.body.ok) {
      expect(status.body.data).toMatchObject({
        jobId: "web-workflow-step-async",
        status: "running",
        completedStages: ["import.normalize"],
        nextStage: "import.chapterize",
        stepRun: { status: "completed" }
      });
      expectNoInternalTaskPaths(status.body.data, workspacePath);
    }
  });

  it("writes sanitized non-protected failure evidence for failed async workflow steps", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await postBridge("/api/bridge/workflow/plan", {
      workspacePath,
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria",
      planId: "web-workflow-step-failure"
    });
    await postBridge("/api/bridge/workflow/start", {
      workspacePath,
      actor: "main_agent",
      planId: "web-workflow-step-failure"
    });

    const step = await postBridge("/api/bridge/workflow/step", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-step-failure",
      input: { stage: "import.chapterize" }
    });
    expect(step.status).toBe(202);

    const failed = await waitForBridgeWorkflowStepStatus(
      workspacePath,
      "web-workflow-step-failure",
      "failed"
    );
    expect(failed.body.ok).toBe(true);
    if (failed.body.ok) {
      expect(failed.body.data).toMatchObject({
        jobId: "web-workflow-step-failure",
        stepRun: { status: "failed" }
      });
      expectNoInternalTaskPaths(failed.body.data, workspacePath);
    }

    const evidence = await readWorkspaceFile({
      workspacePath,
      path: "reports/workflow-step-failures/web-workflow-step-failure.json"
    });
    expect(evidence.path).toBe("reports/workflow-step-failures/web-workflow-step-failure.json");
    const evidenceJson = JSON.parse(evidence.content) as Record<string, unknown>;
    expect(evidenceJson).toMatchObject({
      kind: "novelfabric.workflow.async-step-failure",
      version: 1,
      jobId: "web-workflow-step-failure",
      status: "failed",
      actor: "main_agent"
    });
    expect(evidenceJson["errorCode"]).toEqual(expect.any(String));
    expect(evidenceJson["failedAt"]).toEqual(expect.any(String));
    expect(evidence.content).not.toContain(".novelfabric/jobs/");
    expect(evidence.content).not.toContain(".novelfabric/tasks/");
    expect(evidence.content).not.toContain(workspacePath);
    expect(evidence.content).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it("sanitizes raw task paths from workflow artifact summaries", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await postBridge("/api/bridge/workflow/plan", {
      workspacePath,
      actor: "main_agent",
      sourcePath: "project.md",
      role: "Aria",
      planId: "web-workflow-artifacts"
    });
    await postBridge("/api/bridge/workflow/start", {
      workspacePath,
      actor: "main_agent",
      planId: "web-workflow-artifacts"
    });
    await writeWorkspaceFile({
      workspacePath,
      actor: "main_agent",
      path: ".novelfabric/jobs/web-workflow-artifacts/artifacts.json",
      reason: "inject internal workflow artifact for bridge sanitization",
      content: JSON.stringify(
        {
          kind: "novelfabric.workflow.artifacts",
          version: 1,
          jobId: "web-workflow-artifacts",
          items: [
            {
              stage: "swarm.task.create",
              name: "agent-task-result",
              path: ".novelfabric/tasks/workflow-web-workflow-artifacts-swarm-task-create/result.json",
              hash: "sha256:test",
              artifactKind: "novelfabric.agent.task.result"
            }
          ]
        },
        null,
        2
      )
    });

    const response = await postBridge("/api/bridge/workflow/artifacts", {
      workspacePath,
      actor: "main_agent",
      jobId: "web-workflow-artifacts"
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    if (response.body.ok) {
      expect(response.body.data["artifacts"]).toEqual([
        {
          stage: "swarm.task.create",
          name: "agent-task-result",
          path: "[internal-task-artifact]",
          hash: "sha256:test"
        }
      ]);
      expectNoInternalTaskPaths(response.body.data, workspacePath);
    }
  });
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function waitForBridgeTaskStatus(
  workspacePath: string,
  taskId: string,
  expectedStatus: string,
  timeoutMs = 3000
): Promise<{ readonly status: number; readonly body: GenericBridgeEnvelope }> {
  const started = Date.now();
  let last: { readonly status: number; readonly body: GenericBridgeEnvelope } | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await postBridge("/api/bridge/agent/tasks/status", {
      workspacePath,
      actor: "main_agent",
      task: taskId
    });
    if (last.body.ok && last.body.data["status"] === expectedStatus) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (last !== undefined) return last;
  throw new Error(`Timed out waiting for ${taskId} to reach ${expectedStatus}.`);
}

async function waitForBridgeWorkflowStepStatus(
  workspacePath: string,
  jobId: string,
  expectedStatus: string,
  timeoutMs = 3000
): Promise<{ readonly status: number; readonly body: GenericBridgeEnvelope }> {
  const started = Date.now();
  let last: { readonly status: number; readonly body: GenericBridgeEnvelope } | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await postBridge("/api/bridge/workflow/step/status", {
      workspacePath,
      actor: "main_agent",
      jobId
    });
    if (
      last.body.ok &&
      isRecord(last.body.data["stepRun"]) &&
      last.body.data["stepRun"]["status"] === expectedStatus
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (last !== undefined) return last;
  throw new Error(`Timed out waiting for workflow ${jobId} step run to reach ${expectedStatus}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected JSON object.");
  return value;
}

function parseStreamFrame(body: string, eventName: string): GenericBridgeEnvelope {
  const marker = `event: ${eventName}\ndata: `;
  const start = body.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const dataStart = start + marker.length;
  const dataEnd = body.indexOf("\n\n", dataStart);
  expect(dataEnd).toBeGreaterThan(dataStart);
  return JSON.parse(body.slice(dataStart, dataEnd)) as GenericBridgeEnvelope;
}

function expectNoInternalTaskPaths(value: unknown, workspacePath?: string): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    ".novelfabric/tasks/",
    "result.json",
    "events.jsonl",
    "auditPath",
    "packagePath",
    "resultPath",
    "eventsPath",
    "sessionFile",
    "rawText",
    "parsedJson",
    "files",
    "writes"
  ] as const) {
    expect(serialized).not.toContain(forbidden);
  }
  if (workspacePath !== undefined) {
    expect(serialized).not.toContain(workspacePath);
  }
}

function fixtureWorkspace(): string {
  return path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
}

function externalSwarmRequest(): Record<string, unknown> {
  return {
    client_request_id: "caller-stable-id",
    domain: "market-impact",
    title: "Hermes market-impact fixture",
    summary: "Infer plausible effects from a caller-provided market signal.",
    items: [
      {
        id: "signal-001",
        title: "Factory outage signal",
        content:
          "A supplier reported a temporary factory outage that may affect Example Corp deliveries.",
        published_at: "2026-06-01T12:00:00Z",
        source: "Hermes fixture",
        metadata: { symbol: "EXM" }
      }
    ],
    questions: ["Which impacts are plausible?", "What should be monitored next?"],
    context: {
      entity_cards: [
        {
          id: "entity-example-corp",
          kind: "company",
          name: "Example Corp",
          summary: "A caller-provided company card for the affected entity.",
          evidence: ["signal-001"]
        }
      ],
      background: "Caller-provided context says Example Corp depends on this supplier.",
      worldview: "Supply disruptions can affect delivery timing and risk sentiment.",
      research_notes: ["Treat single-source claims as uncertain until corroborated."]
    },
    rounds: 1
  };
}

async function tempExternalSwarmWorkspace(actor: "main_agent" | "role_agent"): Promise<string> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-external-swarm-rest-test-"));
  await fs.cp(fixtureWorkspace(), workspacePath, { recursive: true });
  const mainAllow =
    actor === "main_agent"
      ? 'allow = ["project.manage", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]'
      : 'allow = ["project.manage", "files.patch_protected", "external_swarm.run", "report.render", "report.apply", "knowledge.query", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]';
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      mainAllow,
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
  return workspacePath;
}

async function tempWorkspace(): Promise<string> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-bridge-agent-test-"));
  await fs.cp(fixtureWorkspace(), workspacePath, { recursive: true });
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
  return workspacePath;
}

async function writeSyntheticCompletedResult(workspacePath: string, taskId: string): Promise<void> {
  await writeWorkspaceFile({
    workspacePath,
    actor: "main_agent",
    path: `.novelfabric/tasks/${taskId}/result.json`,
    reason: "bridge synthetic completed task result",
    content: JSON.stringify(
      {
        kind: "novelfabric.agent.task.result",
        version: 1,
        taskId,
        status: "completed",
        runtime: "pi-sdk",
        actor: "main_agent",
        updatedAt: new Date().toISOString(),
        piSdk: { adapter: "@earendil-works/pi-coding-agent", available: true },
        runtimeEvidence: {
          runtimeRoot: "/tmp/novelfabric/pi",
          provider: "axonhub",
          model: "generic-writer",
          modelPurpose: "production",
          engine: "sdk",
          toolPolicy: "sdk-no-tools-all",
          sessionPolicy: "workspace-session-dir",
          contextPolicy: "sdk-no-context-files",
          stdoutBytes: 64,
          stderrBytes: 0,
          sessionId: "web-test-session",
          sessionFile: "/tmp/novelfabric-web-status-session.jsonl"
        },
        output: {
          kind: "novelfabric.agent.task.output",
          version: 1,
          format: "json",
          rawText: '{"kind":"novelfabric.web.synthetic","version":1}',
          parsedJson: { kind: "novelfabric.web.synthetic", version: 1 }
        },
        notes: []
      },
      null,
      2
    )
  });
}

async function writeSyntheticEvent(
  workspacePath: string,
  taskId: string,
  message: string,
  fields: Record<string, unknown> = {}
): Promise<void> {
  await fs.appendFile(
    path.join(workspacePath, ".novelfabric", "tasks", taskId, "events.jsonl"),
    `${JSON.stringify({
      kind: "novelfabric.agent.task.event",
      version: 1,
      taskId,
      type: "pi-sdk-event",
      actor: "main_agent",
      timestamp: new Date().toISOString(),
      message,
      ...fields
    })}\n`,
    "utf8"
  );
}

async function writeTestRuntimeSettings(workspacePath: string): Promise<void> {
  const configHome = path.join(workspacePath, ".test-config");
  const runtimeRoot = path.join(configHome, "novelfabric", "pi");
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.writeFile(
    path.join(runtimeRoot, "settings.json"),
    JSON.stringify(
      {
        schemaVersion: "novelfabric.pi.runtime.settings.v1",
        runtime: "pi-agent-sdk",
        owner: "novelfabric",
        actor: "main_agent",
        policyProfile: "web-safe",
        allowGlobalPiConfig: false,
        directories: {
          extensions: "extensions",
          skills: "skills",
          prompts: "prompts",
          policies: "policies"
        },
        modelDefaults: {
          provider: "axonhub",
          model: "generic-writer",
          thinking: "medium",
          purpose: "production"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  process.env["XDG_CONFIG_HOME"] = configHome;
}

function configureBridge(input: { readonly workspacePath: string; readonly actor: string }): void {
  process.env["NOVELFABRIC_WEB_BRIDGE"] = "1";
  process.env["NOVELFABRIC_WEB_BRIDGE_WORKSPACE"] = input.workspacePath;
  process.env["NOVELFABRIC_WEB_BRIDGE_ACTOR"] = input.actor;
}

function assertMcpStructuredResult(result: Record<string, unknown>): void {
  expect(Array.isArray(result["content"])).toBe(true);
  const content = result["content"];
  if (!Array.isArray(content)) throw new Error("Expected MCP content array.");
  expect(content).toHaveLength(1);
  expect(requireRecord(content[0])["type"]).toBe("text");
  expect(typeof requireRecord(content[0])["text"]).toBe("string");
  expect(isRecord(result["structuredContent"])).toBe(true);
}

async function postMcp(
  body: Record<string, unknown>
): Promise<{ readonly status: number; readonly body: unknown }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(`http://127.0.0.1:${address.port.toString()}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await closeServer(server);
  }
}

async function postExternalSwarm(
  body: Record<string, unknown>
): Promise<{ readonly status: number; readonly body: unknown }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port.toString()}/api/external/swarm-inferences`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
  } finally {
    await closeServer(server);
  }
}

async function getExternalSwarm(
  inferenceId: string
): Promise<{ readonly status: number; readonly body: unknown }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port.toString()}/api/external/swarm-inferences/${encodeURIComponent(inferenceId)}`,
      { method: "GET" }
    );
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
  } finally {
    await closeServer(server);
  }
}

async function postBridge(
  routePath: string,
  body: Record<string, unknown>
): Promise<{ readonly status: number; readonly body: GenericBridgeEnvelope }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(`http://127.0.0.1:${address.port.toString()}${routePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const parsed = (await response.json()) as GenericBridgeEnvelope;
    return { status: response.status, body: parsed };
  } finally {
    await closeServer(server);
  }
}

async function postBridgeText(
  routePath: string,
  body: Record<string, unknown>
): Promise<{ readonly status: number; readonly body: string; readonly contentType: string }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(`http://127.0.0.1:${address.port.toString()}${routePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get("content-type") ?? ""
    };
  } finally {
    await closeServer(server);
  }
}

function requireReadableResponseBody(
  body: ReadableStream<Uint8Array> | null
): ReadableStream<Uint8Array> {
  if (body === null) throw new Error("Expected bridge stream response body to be readable.");
  return body;
}

async function postBridgeStreamUntil(
  routePath: string,
  body: Record<string, unknown>,
  predicate: (body: string) => boolean,
  options: { readonly abortOnMatch?: boolean; readonly timeoutMs?: number } = {}
): Promise<{ readonly status: number; readonly body: string; readonly contentType: string }> {
  const server = await listenBridgeServer();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 5000);
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(`http://127.0.0.1:${address.port.toString()}${routePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const reader: ReadableStreamDefaultReader<Uint8Array> = requireReadableResponseBody(
      response.body
    ).getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const chunk = await reader.read();
      if (!chunk.done) {
        buffered += decoder.decode(chunk.value, { stream: true });
      }
      if (predicate(buffered)) {
        if (options.abortOnMatch === true) controller.abort();
        break;
      }
      if (chunk.done) break;
    }
    return {
      status: response.status,
      body: buffered,
      contentType: response.headers.get("content-type") ?? ""
    };
  } catch (error: unknown) {
    if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new Error("Bridge stream aborted before the expected frame was observed.", {
        cause: error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await closeServer(server);
  }
}

async function waitForActiveStreams(expectedCount: number, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (getActiveAgentTaskStreamCountForTesting() === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(getActiveAgentTaskStreamCountForTesting()).toBe(expectedCount);
}

async function postRuntimePrepare(body: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly requestedTools?: readonly string[];
}): Promise<{ readonly status: number; readonly body: BridgeEnvelope }> {
  const server = await listenBridgeServer();
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected bridge test server to listen on a TCP port.");
    }
    const response = await fetch(
      `http://127.0.0.1:${address.port.toString()}/api/bridge/runtime/session/prepare`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const parsed = (await response.json()) as BridgeEnvelope;
    return { status: response.status, body: parsed };
  } finally {
    await closeServer(server);
  }
}

async function listenBridgeServer(): Promise<Server> {
  const server = createServer((request, response) => {
    void handleBridgeRequest(request, response, () => {
      response.statusCode = 404;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({ ok: false, error: { code: "not_found", message: "Not found" } })
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

function fakeFailingPiSdkModuleForWebTest(errorMessage: string): PiSdkAgentSessionModule {
  return {
    ...fakePiSdkModuleForWebTest({ outputText: "{}" }),
    createAgentSession: () =>
      Promise.resolve({
        session: {
          sessionId: "sdk-failing-web-session",
          sessionFile: "/tmp/novelfabric-failing-session.jsonl",
          messages: [],
          subscribe() {
            return () => undefined;
          },
          prompt() {
            return Promise.reject(new Error(errorMessage));
          },
          dispose() {
            return undefined;
          }
        }
      })
  };
}

function fakePiSdkModuleForWebTest(input: {
  readonly outputText: string;
  readonly eventsBeforeOutput?: readonly Record<string, unknown>[];
  readonly delayMs?: number;
}): PiSdkAgentSessionModule {
  let emit: (event: unknown) => void = () => undefined;
  return {
    createAgentSession: () =>
      Promise.resolve({
        session: {
          sessionId: "sdk-web-session",
          sessionFile: "/tmp/novelfabric-sdk-web-session.jsonl",
          messages: [],
          subscribe(listener) {
            emit = listener;
            return () => undefined;
          },
          async prompt() {
            if (input.delayMs !== undefined && input.delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, input.delayMs));
            }
            for (const event of input.eventsBeforeOutput ?? []) {
              emit(event);
            }
            emit({ type: "model_output", text: input.outputText });
          },
          dispose() {
            return undefined;
          }
        }
      }),
    AuthStorage: {
      create(authPath) {
        return { authPath };
      }
    },
    ModelRegistry: {
      create() {
        return {
          raw: { registry: true },
          find(provider, modelId) {
            return { provider, modelId };
          }
        };
      }
    },
    SettingsManager: {
      create(cwd, agentDir) {
        return { cwd, agentDir };
      }
    },
    SessionManager: {
      create(cwd, sessionDir) {
        return { cwd, sessionDir };
      },
      inMemory(cwd) {
        return { cwd };
      }
    },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {
        await Promise.resolve();
      }
    },
    defineTool(tool) {
      return tool;
    }
  };
}
