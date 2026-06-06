import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addExternalSwarmCommands } from "../../src/commands/external-swarm.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
const ACTOR = "external_runner";

const cliEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    inference_id: z.string().optional(),
    project_slug: z.string().optional(),
    artifact_paths: z
      .looseObject({
        manifest: z.string().optional(),
        context: z.string().nullable().optional(),
        role_reasoning: z.array(z.string()).optional()
      })
      .optional(),
    context_requirements: z.looseObject({ is_ready: z.boolean().optional() }).optional(),
    mcp: z.looseObject({ structuredContent: z.unknown().optional() }).optional(),
    valid: z.boolean().optional()
  })
});

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("external-swarm CLI registrar", () => {
  let workspacePath: string;
  let requestPath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-external-swarm-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      `[${ACTOR}]\nallow = ["external_swarm.run", "files.write"]\n`,
      "utf8"
    );
    requestPath = path.join(workspacePath, "request.json");
    await fs.writeFile(requestPath, JSON.stringify(fixtureRequest(), null, 2), "utf8");
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("runs infer/get/require-context/validate and preserves MCP structuredContent shape", async () => {
    const infer = await runRegisteredCommand([
      "external-swarm",
      "infer",
      "--workspace",
      workspacePath,
      "--actor",
      ACTOR,
      "--request",
      requestPath,
      "--json"
    ]);
    expect(infer.command).toBe("external-swarm infer");
    expect(infer.data.inference_id).toMatch(/^external-cli-run-001-/);
    expect(infer.data.project_slug).toBe("external-incident-response");
    expect(infer.data.artifact_paths?.manifest).toContain("projects/external-incident-response");
    expect(infer.data.artifact_paths?.context).toContain("external/context");
    expect(infer.data.artifact_paths?.role_reasoning).toHaveLength(4);
    expect(infer.data.mcp?.structuredContent).toMatchObject({
      inference_id: infer.data.inference_id
    });

    const secondInfer = await runRegisteredCommand([
      "external-swarm",
      "infer",
      "--workspace",
      workspacePath,
      "--actor",
      ACTOR,
      "--request",
      requestPath,
      "--json"
    ]);
    expect(secondInfer.data.inference_id).toBe(infer.data.inference_id);
    expect(secondInfer.data.artifact_paths).toEqual(infer.data.artifact_paths);

    const get = await runRegisteredCommand([
      "external-swarm",
      "get",
      "--workspace",
      workspacePath,
      "--actor",
      ACTOR,
      "--inference-id",
      infer.data.inference_id ?? "",
      "--json"
    ]);
    expect(get.command).toBe("external-swarm get");
    expect(get.data.inference_id).toBe(infer.data.inference_id);
    expect(get.data.mcp?.structuredContent).toMatchObject({
      inference_id: infer.data.inference_id
    });

    const requirements = await runRegisteredCommand([
      "external-swarm",
      "require-context",
      "--workspace",
      workspacePath,
      "--actor",
      ACTOR,
      "--request",
      requestPath,
      "--json"
    ]);
    expect(requirements.command).toBe("external-swarm require-context");
    expect(requirements.data.context_requirements).toBeUndefined();
    expect(requirements.data["is_ready"]).toBe(false);
    expect(requirements.data.mcp?.structuredContent).toMatchObject({ is_ready: false });

    const validation = await runRegisteredCommand([
      "external-swarm",
      "validate",
      "--workspace",
      workspacePath,
      "--actor",
      ACTOR,
      "--inference-id",
      infer.data.inference_id ?? "",
      "--json"
    ]);
    expect(validation.command).toBe("external-swarm validate");
    expect(validation.data.valid).toBe(true);
  });
});

async function runRegisteredCommand(args: readonly string[]): Promise<CliEnvelope> {
  const program = new Command();
  program.name("novelfabric-test").exitOverride();
  addExternalSwarmCommands(program);

  let stdout = "";
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
  try {
    await program.parseAsync(["node", "novelfabric-test", ...args], { from: "node" });
  } finally {
    writeSpy.mockRestore();
  }
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}

function fixtureRequest(): unknown {
  return {
    client_request_id: "cli-run-001",
    domain: "incident-response",
    title: "Incident update scenario",
    summary: "Operations wants a compatibility inference over incoming incident updates.",
    items: [
      {
        id: "incident-a",
        title: "Power loss",
        content: "A facility reported power loss and degraded service.",
        source: "incident-feed"
      }
    ],
    questions: ["What operational impacts are plausible?"],
    context: {
      research_notes: ["Watch cascading regional effects."]
    },
    rounds: 1
  };
}
