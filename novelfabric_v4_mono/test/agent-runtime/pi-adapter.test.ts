import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWebSafePiSessionOptions,
  inspectPiSdkAvailability,
  normalizePiSdkEvent,
  piSdkAvailabilityDiagnostic,
  resolveNovelFabricPiRuntimeRoot,
  webSafePiPolicyProfile,
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
});
