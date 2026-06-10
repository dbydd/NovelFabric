import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

type PiModelRolesModule = {
  readonly expectedAcceptanceModel: string;
  readonly expectedWorkflowModel: string;
  readonly resolvePiModelRoles: (
    settings: Record<string, unknown>,
    settingsPath?: string
  ) => {
    readonly workflowProvider: string;
    readonly workflowModel: string;
    readonly workflowThinking?: string;
    readonly acceptanceProvider: string;
    readonly acceptanceModel: string;
    readonly acceptanceThinking?: string;
  };
};

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
let roleModule: PiModelRolesModule;

function validSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "novelfabric.pi.runtime.settings.v1",
    runtime: "pi-agent-sdk",
    owner: "novelfabric",
    actor: "main_agent",
    policyProfile: "web-safe",
    allowGlobalPiConfig: false,
    defaultProvider: "axonhub",
    defaultModel: roleModule.expectedWorkflowModel,
    defaultThinkingLevel: "medium",
    modelDefaults: {
      provider: "axonhub",
      model: roleModule.expectedWorkflowModel,
      thinking: "medium",
      purpose: "production"
    },
    testModelDefaults: {
      provider: "axonhub",
      model: roleModule.expectedAcceptanceModel,
      thinking: "medium",
      purpose: "testing"
    },
    ...overrides
  };
}

describe("pi content acceptance model roles", () => {
  let tempRoot: string;

  beforeAll(async () => {
    roleModule = (await import(
      pathToFileURL(path.join(repoRoot, "scripts", "pi-model-roles.mjs")).href
    )) as PiModelRolesModule;
  });

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-acceptance-config-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("selects generic-writer for workflow runtime and flash-vibe for acceptance", () => {
    const roles = roleModule.resolvePiModelRoles(validSettings(), "settings.json");

    expect(roles.workflowProvider).toBe("axonhub");
    expect(roles.workflowModel).toBe("generic-writer");
    expect(roles.workflowThinking).toBe("medium");
    expect(roles.acceptanceProvider).toBe("axonhub");
    expect(roles.acceptanceModel).toBe("flash-vibe");
    expect(roles.acceptanceThinking).toBe("medium");
  });

  it("rejects flash-vibe as the workflow runtime default", () => {
    expect(() =>
      roleModule.resolvePiModelRoles(
        validSettings({
          defaultModel: "flash-vibe",
          modelDefaults: {
            provider: "axonhub",
            model: "flash-vibe",
            thinking: "medium",
            purpose: "production"
          }
        }),
        "settings.json"
      )
    ).toThrow("generic-writer");
  });

  it("rejects acceptance configs that do not use flash-vibe", () => {
    expect(() =>
      roleModule.resolvePiModelRoles(
        validSettings({
          testModelDefaults: {
            provider: "axonhub",
            model: "generic-writer",
            thinking: "medium",
            purpose: "testing"
          }
        }),
        "settings.json"
      )
    ).toThrow("flash-vibe");
  });

  it("rejects missing test model defaults instead of falling back to workflow model", () => {
    const settings = validSettings();
    delete settings["testModelDefaults"];

    expect(() => roleModule.resolvePiModelRoles(settings, "settings.json")).toThrow(
      "testModelDefaults"
    );
  });

  it("hard-fails instead of skipping when NovelFabric pi settings are missing", () => {
    const result = spawnSync("node", ["scripts/pi-content-acceptance.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: tempRoot,
        HOME: path.join(tempRoot, "home"),
        PI_SKIP_VERSION_CHECK: "1"
      },
      encoding: "utf8",
      timeout: 30000
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[pi-acceptance]");
    expect(result.stderr).toContain("NovelFabric pi acceptance requires");
  });
});
