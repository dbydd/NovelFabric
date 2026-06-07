import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildWebSafePiSessionOptions,
  inspectPiSdkAvailability,
  normalizePiSdkEvent,
  piAgentRuntimeAdapter,
  piSdkAvailabilityDiagnostic,
  resolveNovelFabricPiRuntimeRoot,
  runPiSdkAgentTask,
  webSafePiPolicyProfile,
  type PiSdkAgentSessionModule,
  type PiSdkAvailability
} from "../../src/agent-runtime/pi-adapter.js";
import type { Environment } from "../../src/environment.js";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    home: undefined,
    xdgConfigHome: undefined,
    platform: "linux",
    ...overrides
  };
}

describe("pi SDK adapter skeleton", () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempPaths.splice(0).map((tempPath) => fs.rm(tempPath, { recursive: true, force: true }))
    );
  });

  it("resolves NovelFabric-owned pi runtime root under XDG config, not global pi", () => {
    const environment = makeEnvironment({
      home: "/tmp/example-home",
      xdgConfigHome: "/tmp/example-xdg"
    });

    const resolved = resolveNovelFabricPiRuntimeRoot(environment);

    expect(resolved.runtimeRoot).toBe(path.join("/tmp/example-xdg", "novelfabric", "pi"));
    expect(resolved.settingsPath).toBe(
      path.join("/tmp/example-xdg", "novelfabric", "pi", "settings.json")
    );
    expect(resolved.globalPiAgentRoot).toBe(path.join("/tmp/example-home", ".pi", "agent"));
    expect(resolved.usesGlobalPiAgentRoot).toBe(false);
  });

  it("falls back to HOME/.config/novelfabric/pi and still avoids global pi agent root", () => {
    const home = "/tmp/example-home";
    const resolved = resolveNovelFabricPiRuntimeRoot(
      makeEnvironment({ home, xdgConfigHome: undefined })
    );

    expect(resolved.runtimeRoot).toBe(path.join(home, ".config", "novelfabric", "pi"));
    expect(resolved.globalPiAgentRoot).toBe(path.join(home, ".pi", "agent"));
    expect(resolved.usesGlobalPiAgentRoot).toBe(false);
  });

  it("describes the pi SDK bridge as partial after opt-in AgentSession execution landed", () => {
    const plan = piAgentRuntimeAdapter.describeLaunchPlan("/tmp/workspace");

    expect(plan.status).toBe("partial");
    expect(plan.notes.join("\n")).toContain("Opt-in pi SDK AgentSession execution is implemented");
    expect(plan.notes.join("\n")).toContain("Web-safe NovelFabric extensions");
  });

  it("builds a web-safe policy that denies raw tools and allows only NovelFabric adapters", () => {
    const policy = webSafePiPolicyProfile();

    expect(policy.profile).toBe("web-safe");
    expect(policy.defaultDecision).toBe("deny");
    expect(policy.deniedRawTools).toEqual(
      expect.arrayContaining(["bash", "write", "edit", "read", "network", "arbitrary_path_access"])
    );
    expect(policy.allowedNovelFabricTools).toEqual(
      expect.arrayContaining([
        "novelfabric_read_file",
        "novelfabric_write_file",
        "novelfabric_context_pack",
        "novelfabric_validate",
        "novelfabric_apply_proposal",
        "novelfabric_report"
      ])
    );
  });

  it("rejects raw builtin tools from web-safe session options", () => {
    const options = buildWebSafePiSessionOptions({
      environment: makeEnvironment({ home: "/tmp/home" }),
      actor: "main_agent",
      requestedTools: ["novelfabric_read_file", "bash", "write", "unknown_tool"]
    });

    expect(options.rawBuiltinToolsEnabled).toBe(false);
    expect(options.valid).toBe(false);
    expect(options.violations).toEqual(
      expect.arrayContaining([
        "raw tool 'bash' is denied by the NovelFabric web-safe runtime policy",
        "raw tool 'write' is denied by the NovelFabric web-safe runtime policy",
        "tool 'unknown_tool' is not in the NovelFabric web-safe allowlist"
      ])
    );
  });

  it("accepts only NovelFabric adapter tool names for web-safe session options", () => {
    const options = buildWebSafePiSessionOptions({
      environment: makeEnvironment({ xdgConfigHome: "/tmp/xdg" }),
      actor: "main_agent",
      requestedTools: ["novelfabric_read_file", "novelfabric_write_file", "novelfabric_validate"]
    });

    expect(options.valid).toBe(true);
    expect(options.violations).toEqual([]);
    expect(options.allowedTools).toContain("novelfabric_write_file");
    expect(options.deniedRawTools).toContain("bash");
  });

  it("inspects SDK availability without returning configuration secrets", async () => {
    const availability = await inspectPiSdkAvailability();

    expect(availability.packageName).toBe("@earendil-works/pi-coding-agent");
    expect(availability.available).toBe(true);
    expect(availability.exports.createAgentSession).toBe(true);
    expect(availability.exports.AuthStorage).toBe(true);
    expect(availability.exports.ModelRegistry).toBe(true);
    expect(availability.exports.SessionManager).toBe(true);
    expect(JSON.stringify(availability)).not.toMatch(/api[_-]?key|authorization|token|secret/i);
  });

  it("turns missing SDK exports into a runtime doctor diagnostic without secrets", () => {
    const availability: PiSdkAvailability = {
      packageName: "@earendil-works/pi-coding-agent",
      available: false,
      version: "1.2.3",
      exports: {
        createAgentSession: true,
        AuthStorage: true,
        ModelRegistry: false,
        SettingsManager: true,
        SessionManager: true,
        DefaultResourceLoader: true,
        defineTool: false
      },
      error: "authorization=super-secret-token should not leak"
    };

    const diagnostic = piSdkAvailabilityDiagnostic(availability);

    expect(diagnostic.valid).toBe(false);
    expect(diagnostic.kind).toBe("pi-sdk");
    expect(diagnostic.reason).toBe("package_unavailable");
    expect(diagnostic.packageName).toBe("@earendil-works/pi-coding-agent");
    expect(diagnostic.missingExports).toEqual(["ModelRegistry", "defineTool"]);
    expect(JSON.stringify(diagnostic)).not.toContain("super-secret-token");
    expect(JSON.stringify(diagnostic)).toContain("<redacted>");
  });

  it("turns missing SDK exports without import errors into invalid diagnostics", () => {
    const availability: PiSdkAvailability = {
      packageName: "@earendil-works/pi-coding-agent",
      available: false,
      version: "1.2.3",
      exports: {
        createAgentSession: true,
        AuthStorage: true,
        ModelRegistry: true,
        SettingsManager: true,
        SessionManager: false,
        DefaultResourceLoader: true,
        defineTool: true
      }
    };

    const diagnostic = piSdkAvailabilityDiagnostic(availability);

    expect(diagnostic.exists).toBe(true);
    expect(diagnostic.valid).toBe(false);
    expect(diagnostic.reason).toBe("missing_required_exports");
    expect(diagnostic.missingExports).toEqual(["SessionManager"]);
  });

  it("normalizes known SDK event shapes", () => {
    expect(normalizePiSdkEvent({ type: "session_started", sessionId: "s1" })).toEqual({
      type: "session.started",
      sessionId: "s1"
    });
    expect(normalizePiSdkEvent({ type: "model_output", text: "hello" })).toEqual({
      type: "model.output",
      text: "hello"
    });
    expect(normalizePiSdkEvent({ type: "tool_call", name: "bash" })).toEqual({
      type: "tool.requested",
      toolName: "bash"
    });
    expect(normalizePiSdkEvent({ type: "validation_completed", valid: true })).toEqual({
      type: "validation.completed",
      valid: true
    });
  });

  it("turns unknown raw SDK events into safe failed events", () => {
    expect(normalizePiSdkEvent({ type: "surprising", payload: { nested: true } })).toEqual({
      type: "session.failed",
      message: "Unrecognized pi SDK event."
    });
    expect(normalizePiSdkEvent("not-an-event")).toEqual({
      type: "session.failed",
      message: "Unrecognized pi SDK event."
    });
  });

  it("runs a web-safe SDK agent task through the injectable SDK seam", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-workspace-"));
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-runtime-"));
    tempPaths.push(workspacePath, runtimeRoot);
    let capturedPrompt = "";
    let subscribed = false;
    let capturedSessionOptions: Readonly<Record<string, unknown>> | undefined;
    const capturedSettingsCalls: { cwd: string; agentDir?: string }[] = [];
    const capturedSessionManagerCalls: { cwd: string; sessionDir?: string }[] = [];
    const capturedResourceLoaderOptions: Readonly<Record<string, unknown>>[] = [];
    let emit: (event: unknown) => void = () => {
      throw new Error("subscribe must install emit before prompt");
    };
    const sdkModule: PiSdkAgentSessionModule = {
      createAgentSession: (options) => {
        capturedSessionOptions = options;
        return Promise.resolve({
          session: {
            sessionId: "sdk-session-1",
            sessionFile: path.join(
              workspacePath,
              ".novelfabric",
              "pi-sessions",
              "sdk-session-1.jsonl"
            ),
            subscribe(listener) {
              subscribed = true;
              emit = listener;
              return () => {
                subscribed = false;
              };
            },
            prompt(prompt) {
              capturedPrompt = prompt;
              emit({ type: "model_output", text: '{"kind":"novelfabric.test","version":1}' });
              return Promise.resolve();
            },
            dispose() {
              subscribed = false;
            }
          }
        });
      },
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
          capturedSettingsCalls.push({ cwd, ...(agentDir === undefined ? {} : { agentDir }) });
          return { kind: "settings-manager", cwd, agentDir };
        }
      },
      SessionManager: {
        create(cwd, sessionDir) {
          capturedSessionManagerCalls.push({
            cwd,
            ...(sessionDir === undefined ? {} : { sessionDir })
          });
          return { kind: "session-manager", cwd, sessionDir };
        },
        inMemory(cwd) {
          return { cwd };
        }
      },
      DefaultResourceLoader: class {
        constructor(options: Readonly<Record<string, unknown>>) {
          capturedResourceLoaderOptions.push(options);
        }

        async reload(): Promise<void> {
          await Promise.resolve();
        }
      }
    };

    const result = await runPiSdkAgentTask({
      workspacePath,
      taskId: "sdk-task",
      prompt: "Return JSON only.",
      runtime: {
        runtimeRoot,
        provider: "axonhub",
        model: "generic-writer",
        thinking: "medium"
      },
      sdkModule
    });

    expect(capturedPrompt).toBe("Return JSON only.");
    expect(subscribed).toBe(false);
    expect(capturedSettingsCalls).toEqual([{ cwd: workspacePath, agentDir: runtimeRoot }]);
    expect(capturedSessionManagerCalls).toHaveLength(1);
    expect(capturedSessionManagerCalls[0]?.cwd).toBe(workspacePath);
    expect(capturedSessionManagerCalls[0]?.sessionDir).toBe(result.sessionDirectory);
    expect(capturedSessionManagerCalls[0]?.sessionDir).toContain(
      path.join(workspacePath, ".novelfabric", "pi-sessions", "sdk-task")
    );
    expect(capturedResourceLoaderOptions).toEqual([
      expect.objectContaining({
        cwd: workspacePath,
        agentDir: runtimeRoot,
        noExtensions: true,
        noContextFiles: true
      })
    ]);
    const sessionOptions = capturedSessionOptions;
    if (sessionOptions === undefined) throw new Error("Expected SDK session options.");
    expect(sessionOptions["cwd"]).toBe(workspacePath);
    expect(sessionOptions["agentDir"]).toBe(runtimeRoot);
    expect(sessionOptions["noTools"]).toBe("all");
    expect(sessionOptions["tools"]).toEqual([]);
    expect(sessionOptions["customTools"]).toEqual([]);
    expect(sessionOptions["thinkingLevel"]).toBe("medium");
    expect(recordValue(sessionOptions["authStorage"])["authPath"]).toBe(
      path.join(runtimeRoot, "auth.json")
    );
    expect(recordValue(sessionOptions["settingsManager"])).toMatchObject({
      kind: "settings-manager",
      cwd: workspacePath,
      agentDir: runtimeRoot
    });
    expect(recordValue(sessionOptions["resourceLoader"])).toBeDefined();
    expect(recordValue(sessionOptions["sessionManager"])).toMatchObject({
      kind: "session-manager",
      cwd: workspacePath,
      sessionDir: result.sessionDirectory
    });
    expect(result.engine).toBe("sdk");
    expect(result.outputText).toContain("novelfabric.test");
    expect(result.sessionId).toBe("sdk-session-1");
    expect(result.normalizedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.started", sessionId: "sdk-session-1" }),
        expect.objectContaining({
          type: "model.output",
          text: '{"kind":"novelfabric.test","version":1}'
        }),
        expect.objectContaining({ type: "session.completed" })
      ])
    );
  });

  it("rejects getLastAssistantText fallback when SDK messages are unavailable", async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "nf-pi-sdk-unavailable-messages-workspace-")
    );
    const runtimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "nf-pi-sdk-unavailable-messages-runtime-")
    );
    tempPaths.push(workspacePath, runtimeRoot);

    const sdkModule = fakeSdkModuleWithSession({
      getLastAssistantText: () => "stale assistant text from a previous prompt",
      prompt: () => Promise.resolve()
    });

    await expect(
      runPiSdkAgentTask({
        workspacePath,
        taskId: "unavailable-messages-sdk-task",
        prompt: "Return current JSON only.",
        runtime: {
          runtimeRoot,
          provider: "axonhub",
          model: "generic-writer"
        },
        sdkModule
      })
    ).rejects.toMatchObject({ code: "pi_sdk_empty_output" });
  });

  it("does not reuse stale assistant messages as pi-sdk output", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-stale-workspace-"));
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-stale-runtime-"));
    tempPaths.push(workspacePath, runtimeRoot);

    const messages: unknown[] = [
      { role: "assistant", content: "stale assistant text from a previous prompt" }
    ];
    const sdkModule = fakeSdkModuleWithSession({
      messages,
      getLastAssistantText: () => "stale assistant text from a previous prompt",
      prompt: () => Promise.resolve()
    });

    await expect(
      runPiSdkAgentTask({
        workspacePath,
        taskId: "stale-sdk-task",
        prompt: "Return current JSON only.",
        runtime: {
          runtimeRoot,
          provider: "axonhub",
          model: "generic-writer"
        },
        sdkModule
      })
    ).rejects.toMatchObject({ code: "pi_sdk_empty_output" });
  });

  it("uses assistant messages appended by the current pi-sdk prompt as fallback output", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-current-workspace-"));
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-current-runtime-"));
    tempPaths.push(workspacePath, runtimeRoot);

    const messages: unknown[] = [
      { role: "assistant", content: "stale assistant text from a previous prompt" }
    ];
    const sdkModule = fakeSdkModuleWithSession({
      messages,
      getLastAssistantText: () => "stale assistant text from a previous prompt",
      prompt: () => {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: '{"kind":"novelfabric.current-prompt"}' }]
        });
        return Promise.resolve();
      }
    });

    const result = await runPiSdkAgentTask({
      workspacePath,
      taskId: "current-sdk-task",
      prompt: "Return current JSON only.",
      runtime: {
        runtimeRoot,
        provider: "axonhub",
        model: "generic-writer"
      },
      sdkModule
    });

    expect(result.outputText).toContain("novelfabric.current-prompt");
    expect(result.outputText).not.toContain("stale assistant text");
    expect(result.normalizedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "model.output",
          text: '{"kind":"novelfabric.current-prompt"}'
        })
      ])
    );
  });

  it("accepts class-shaped SDK exports with static factory methods", async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-class-workspace-"));
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-class-runtime-"));
    tempPaths.push(workspacePath, runtimeRoot);
    const staticCalls: string[] = [];
    let capturedSessionOptions: Readonly<Record<string, unknown>> | undefined;
    let capturedPrompt = "";
    let emit: (event: unknown) => void = () => {
      throw new Error("subscribe must install emit before prompt");
    };

    const AuthStorageExport = Object.assign(
      function AuthStorageExport(): void {
        return undefined;
      },
      {
        create(authPath?: string): Record<string, unknown> {
          staticCalls.push("AuthStorage.create");
          return { authPath };
        }
      }
    );

    class ModelRegistryValue {
      readonly providerModelPairs: string[] = [];

      find(provider: string, modelId: string): Record<string, string> {
        this.providerModelPairs.push(`${provider}/${modelId}`);
        return { provider, modelId };
      }
    }

    const ModelRegistryExport = Object.assign(
      function ModelRegistryExport(): void {
        return undefined;
      },
      {
        create(): ModelRegistryValue {
          staticCalls.push("ModelRegistry.create");
          return new ModelRegistryValue();
        }
      }
    );

    const SettingsManagerExport = Object.assign(
      function SettingsManagerExport(): void {
        return undefined;
      },
      {
        create(cwd: string, agentDir?: string): Record<string, unknown> {
          staticCalls.push("SettingsManager.create");
          return { cwd, agentDir };
        }
      }
    );

    const SessionManagerExport = Object.assign(
      function SessionManagerExport(): void {
        return undefined;
      },
      {
        create(cwd: string, sessionDir?: string): Record<string, unknown> {
          staticCalls.push("SessionManager.create");
          return { cwd, sessionDir };
        },
        inMemory(cwd?: string): Record<string, unknown> {
          staticCalls.push("SessionManager.inMemory");
          return { cwd };
        }
      }
    );

    class DefaultResourceLoaderExport {
      readonly options: Readonly<Record<string, unknown>>;

      constructor(options: Readonly<Record<string, unknown>>) {
        this.options = options;
      }

      async reload(): Promise<void> {
        await Promise.resolve();
      }
    }

    const sdkExports = {
      createAgentSession(options: Readonly<Record<string, unknown>>) {
        capturedSessionOptions = options;
        return Promise.resolve({
          session: {
            sessionId: "class-sdk-session",
            subscribe(listener: (event: unknown) => void) {
              emit = listener;
              return () => undefined;
            },
            prompt(prompt: string) {
              capturedPrompt = prompt;
              emit({ type: "model_output", text: '{"kind":"novelfabric.class-test"}' });
              return Promise.resolve();
            },
            dispose() {
              return undefined;
            }
          }
        });
      },
      AuthStorage: AuthStorageExport,
      ModelRegistry: ModelRegistryExport,
      SettingsManager: SettingsManagerExport,
      SessionManager: SessionManagerExport,
      DefaultResourceLoader: DefaultResourceLoaderExport,
      defineTool() {
        return undefined;
      }
    };

    const result = await runPiSdkAgentTask({
      workspacePath,
      taskId: "class-sdk-task",
      prompt: "Return class SDK JSON only.",
      runtime: {
        runtimeRoot,
        provider: "axonhub",
        model: "generic-writer"
      },
      sdkModule: sdkExports
    });

    expect(staticCalls).toEqual([
      "AuthStorage.create",
      "ModelRegistry.create",
      "SettingsManager.create",
      "SessionManager.create"
    ]);
    expect(capturedPrompt).toBe("Return class SDK JSON only.");
    expect(result.engine).toBe("sdk");
    expect(result.outputText).toContain("novelfabric.class-test");
    expect(result.sessionId).toBe("class-sdk-session");
    const sessionOptions = capturedSessionOptions;
    if (sessionOptions === undefined) throw new Error("Expected SDK session options.");
    expect(sessionOptions["noTools"]).toBe("all");
    expect(sessionOptions["tools"]).toEqual([]);
    expect(sessionOptions["customTools"]).toEqual([]);
    expect(recordValue(sessionOptions["sessionManager"])["sessionDir"]).toBe(
      result.sessionDirectory
    );
  });

  function fakeSdkModuleWithSession(input: {
    readonly messages?: readonly unknown[];
    readonly getLastAssistantText?: () => string | undefined;
    readonly prompt: (prompt: string) => Promise<void>;
  }): PiSdkAgentSessionModule {
    return {
      createAgentSession: () =>
        Promise.resolve({
          session: {
            sessionId: "fallback-sdk-session",
            ...(input.messages === undefined ? {} : { messages: input.messages }),
            ...(input.getLastAssistantText === undefined
              ? {}
              : { getLastAssistantText: input.getLastAssistantText }),
            subscribe() {
              return () => undefined;
            },
            prompt(prompt) {
              return input.prompt(prompt);
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

  function recordValue(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Expected object value.");
    }
    return value as Record<string, unknown>;
  }
});
