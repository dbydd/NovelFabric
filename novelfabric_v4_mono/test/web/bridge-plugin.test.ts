import { createServer, type Server } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleBridgeRequest } from "../../src/web/bridge-plugin.js";

type BridgeEnvelope =
  | { readonly ok: true; readonly data: BridgeRuntimePrepareData }
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

function fixtureWorkspace(): string {
  return path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
}

function configureBridge(input: { readonly workspacePath: string; readonly actor: string }): void {
  process.env["NOVELFABRIC_WEB_BRIDGE"] = "1";
  process.env["NOVELFABRIC_WEB_BRIDGE_WORKSPACE"] = input.workspacePath;
  process.env["NOVELFABRIC_WEB_BRIDGE_ACTOR"] = input.actor;
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
