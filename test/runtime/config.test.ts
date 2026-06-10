import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Environment } from "../../src/environment.js";
import type { JsonObject } from "../../src/output.js";
import {
  doctorRuntimeConfig,
  getRuntimePolicy,
  inspectRuntimeConfig,
  listRuntimeExtensions,
  materializeRuntimeConfig,
  resolveRuntimeConfigPaths,
  validateRuntimeExtensions
} from "../../src/runtime/config.js";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    home: undefined,
    xdgConfigHome: undefined,
    platform: "linux" as const,
    ...overrides
  };
}

describe("NovelFabric pi runtime config services", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-runtime-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves runtime paths under $XDG_CONFIG_HOME/novelfabric/pi", () => {
    const paths = resolveRuntimeConfigPaths(
      makeEnvironment({ home: path.join(tempRoot, "home"), xdgConfigHome: tempRoot })
    );

    expect(paths.novelfabricConfigRoot).toBe(path.join(tempRoot, "novelfabric"));
    expect(paths.runtimeRoot).toBe(path.join(tempRoot, "novelfabric", "pi"));
    expect(paths.settingsPath).toBe(path.join(tempRoot, "novelfabric", "pi", "settings.json"));
    expect(paths.webSafePolicyPath).toBe(
      path.join(tempRoot, "novelfabric", "pi", "policies", "web-safe.json")
    );
    expect(paths.resolution.source).toBe("xdg-config-home");
  });

  it("falls back to $HOME/.config/novelfabric/pi when XDG_CONFIG_HOME is empty", () => {
    const home = path.join(tempRoot, "home");
    const paths = resolveRuntimeConfigPaths(makeEnvironment({ home, xdgConfigHome: "" }));

    expect(paths.runtimeRoot).toBe(path.join(home, ".config", "novelfabric", "pi"));
    expect(paths.resolution.source).toBe("home-default");
  });

  it("materializes settings, Web-safe policy, and placeholder extension metadata", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    const result = await materializeRuntimeConfig({ environment, actor: "main_agent" });

    expect(result.runtimeRoot).toBe(path.join(tempRoot, "novelfabric", "pi"));
    expect(result.actor).toBe("main_agent");
    expect(result.writtenFiles).toContain(result.settingsPath);
    expect(result.writtenFiles).toContain(result.policyPath);

    const settings = await readJsonObject(result.settingsPath);
    expect(settings["schemaVersion"]).toBe("novelfabric.pi.runtime.settings.v1");
    expect(settings["runtime"]).toBe("pi-agent-sdk");
    expect(settings["actor"]).toBe("main_agent");
    expect(settings["allowGlobalPiConfig"]).toBe(false);

    const policy = await readJsonObject(result.policyPath);
    expect(policy["schemaVersion"]).toBe("novelfabric.pi.runtime.policy.v1");
    expect(policy["profile"]).toBe("web-safe");
    expect(policy["defaultDecision"]).toBe("deny");
    expect(policy["deniedRawTools"]).toEqual(
      expect.arrayContaining(["bash", "write", "edit", "network", "arbitrary_path_access"])
    );

    for (const extension of listRuntimeExtensions()) {
      const metadataPath = path.join(result.runtimeRoot, extension.relativeMetadataPath);
      const metadata = await readJsonObject(metadataPath);
      expect(metadata["schemaVersion"]).toBe("novelfabric.pi.extension.metadata.v1");
      expect(metadata["id"]).toBe(extension.id);
      expect(metadata["implementation"]).toBe("placeholder-metadata-only");
    }
  });

  it("does not overwrite existing materialized files", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    const first = await materializeRuntimeConfig({ environment, actor: "main_agent" });
    await fs.writeFile(first.settingsPath, '{"schemaVersion":"custom"}\n', "utf8");

    const second = await materializeRuntimeConfig({ environment, actor: "role_agent" });
    expect(second.existingFiles).toContain(first.settingsPath);
    expect(await fs.readFile(first.settingsPath, "utf8")).toBe('{"schemaVersion":"custom"}\n');
  });

  it("reports doctor validity after materialization", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    const before = await doctorRuntimeConfig(environment);
    expect(before.valid).toBe(false);
    expect(before.missingCount).toBeGreaterThan(0);

    await materializeRuntimeConfig({ environment, actor: "main_agent" });
    const after = await doctorRuntimeConfig(environment);
    expect(after.valid).toBe(true);
    expect(after.missingCount).toBe(0);
    expect(after.invalidCount).toBe(0);
  });

  it("marks runtime doctor invalid when SDK diagnostics are invalid", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    await materializeRuntimeConfig({ environment, actor: "main_agent" });

    const after = await doctorRuntimeConfig(environment, [
      {
        path: "@earendil-works/pi-coding-agent",
        exists: true,
        valid: false,
        kind: "pi-sdk",
        packageName: "@earendil-works/pi-coding-agent",
        version: "1.2.3",
        reason: "missing_required_exports",
        missingExports: ["createAgentSession"]
      }
    ]);

    expect(after.valid).toBe(false);
    expect(after.missingCount).toBe(0);
    expect(after.invalidCount).toBe(1);
    expect(after.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pi-sdk",
          reason: "missing_required_exports",
          missingExports: ["createAgentSession"]
        })
      ])
    );
  });

  it("accepts NovelFabric-owned model defaults for pi acceptance", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    const materialized = await materializeRuntimeConfig({ environment, actor: "main_agent" });
    const settings = await readJsonObject(materialized.settingsPath);
    await fs.writeFile(
      materialized.settingsPath,
      `${JSON.stringify(
        {
          ...settings,
          modelsFile: "models.json",
          modelDefaults: {
            provider: "axonhub",
            model: "generic-writer",
            thinking: "medium",
            purpose: "production"
          },
          testModelDefaults: {
            provider: "axonhub",
            model: "flash-vibe",
            thinking: "medium",
            purpose: "testing"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const after = await doctorRuntimeConfig(environment);
    expect(after.valid).toBe(true);
    expect(after.invalidCount).toBe(0);
  });

  it("validates extension metadata after materialization", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    await materializeRuntimeConfig({ environment, actor: "main_agent" });

    const statuses = await validateRuntimeExtensions(environment);
    expect(statuses).toHaveLength(listRuntimeExtensions().length);
    expect(statuses.every((status) => status.exists && status.valid)).toBe(true);
  });

  it("exposes the Web-safe policy without running a custom LLM provider", () => {
    const policy = getRuntimePolicy("web-safe");
    expect(policy.profile).toBe("web-safe");
    expect(policy.defaultDecision).toBe("deny");
    expect(policy.deniedRawTools).toEqual(expect.arrayContaining(["bash", "write", "edit"]));
    expect(policy.allowedNovelFabricTools).toContain("novelfabric_write_file");
    expect(policy.constraints.durableWritesViaNovelFabricCli).toBe(true);
  });

  it("rejects unknown policy profiles", () => {
    expect(() => getRuntimePolicy("unsafe")).toThrow("Unsupported runtime policy profile");
  });

  it("marks invalid materialized JSON as invalid during inspect", async () => {
    const environment = makeEnvironment({ xdgConfigHome: tempRoot });
    const materialized = await materializeRuntimeConfig({ environment, actor: "main_agent" });
    await fs.writeFile(materialized.policyPath, "not-json", "utf8");

    const inspection = await inspectRuntimeConfig(environment);
    expect(inspection.policy.exists).toBe(true);
    expect(inspection.policy.valid).toBe(false);
    expect(inspection.policy.reason).toBe("invalid_json");
  });
});

async function readJsonObject(filePath: string): Promise<JsonObject> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonObject;
  }
  throw new Error(`Expected JSON object in ${filePath}`);
}
