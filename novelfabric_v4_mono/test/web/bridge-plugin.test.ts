import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PiSdkAgentSessionModule } from "../../src/agent-runtime/pi-adapter.js";
import {
  createAgentTask,
  setAgentTaskPiSdkModuleForTesting
} from "../../src/agent-runtime/tasks.js";
import { handleBridgeRequest } from "../../src/web/bridge-plugin.js";
import { writeWorkspaceFile } from "../../src/workspace/files.js";

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
});

describe("NovelFabric web bridge agent task routes", () => {
  it("returns bridge_disabled when bridge is not enabled", async () => {
    delete process.env["NOVELFABRIC_WEB_BRIDGE"];
    const fixture = fixtureWorkspace();
    const response = await postBridge("/api/bridge/agent/tasks/status", {
      workspacePath: fixture,
      actor: "main_agent",
      task: "missing-task"
    });

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("bridge_disabled");
    }
  });

  it("rejects workspace and actor mismatches", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    const workspaceMismatch = await postBridge("/api/bridge/agent/tasks/status", {
      workspacePath: path.join(workspacePath, "..", "other"),
      actor: "main_agent",
      task: "missing-task"
    });
    expect(workspaceMismatch.status).toBe(403);
    expect(workspaceMismatch.body.ok).toBe(false);
    if (!workspaceMismatch.body.ok) {
      expect(workspaceMismatch.body.error.code).toBe("bridge_workspace_mismatch");
    }

    const actorMismatch = await postBridge("/api/bridge/agent/tasks/status", {
      workspacePath,
      actor: "role_agent",
      task: "missing-task"
    });
    expect(actorMismatch.status).toBe(403);
    expect(actorMismatch.body.ok).toBe(false);
    if (!actorMismatch.body.ok) {
      expect(actorMismatch.body.error.code).toBe("bridge_actor_mismatch");
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

  it("runs web tasks through the shared pi-sdk service and returns a sanitized success summary", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });
    await writeTestRuntimeSettings(workspacePath);
    const secretModelOutput =
      '{"kind":"novelfabric.web.run-output","version":1,"summary":"secret raw model output should stay in result.json"}';
    const restoreSdkModule = setAgentTaskPiSdkModuleForTesting(
      fakePiSdkModuleForWebTest({ outputText: secretModelOutput })
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

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      if (response.body.ok) {
        expect(response.body.data).toMatchObject({
          taskId: "web-run-task",
          status: "completed",
          resultAvailable: true,
          eventsAvailable: true,
          writeCount: 2
        });
        expect(response.body.data["runtimeEvidence"]).toMatchObject({
          engine: "sdk",
          toolPolicy: "sdk-no-tools-all",
          sessionPolicy: "workspace-session-dir"
        });
        expectNoInternalTaskPaths(response.body.data, workspacePath);
      }
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("secret raw model output");
      expect(serialized).not.toContain("rawText");
      expect(serialized).not.toContain("parsedJson");
      expect(serialized).not.toContain("sessionFile");
      expect(serialized).not.toContain("/tmp/novelfabric-sdk-web-session.jsonl");
      expect(serialized).not.toContain(workspacePath);

      const resultFile = await fs.readFile(
        path.join(workspacePath, ".novelfabric", "tasks", "web-run-task", "result.json"),
        "utf8"
      );
      expect(resultFile).toContain("secret raw model output");
    } finally {
      restoreSdkModule();
    }
  });

  it("rejects path-like task ids from status and events routes", async () => {
    const workspacePath = await tempWorkspace();
    configureBridge({ workspacePath, actor: "main_agent" });

    for (const routePath of [
      "/api/bridge/agent/tasks/status",
      "/api/bridge/agent/tasks/events"
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

async function tempWorkspace(): Promise<string> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-bridge-agent-test-"));
  await fs.cp(fixtureWorkspace(), workspacePath, { recursive: true });
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
  message: string
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
      message
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

function fakePiSdkModuleForWebTest(input: {
  readonly outputText: string;
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
          prompt() {
            emit({ type: "model_output", text: input.outputText });
            return Promise.resolve();
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
    }
  };
}
