import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOrGetExternalSwarmInference,
  getExternalSwarmInference,
  requireExternalSwarmContext,
  toMcpStructuredResult,
  validateExternalSwarmInference,
  type ExternalSwarmInferenceRequest
} from "../../src/external-swarm/index.js";
import { readWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");
const ACTOR = "external_runner";

describe("external swarm compatibility service", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-external-swarm-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      `[${ACTOR}]\nallow = ["external_swarm.run", "files.write"]\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("creates frozen-shape artifacts and reads them back", async () => {
    const response = await createOrGetExternalSwarmInference({
      workspacePath,
      actor: ACTOR,
      request: fixtureRequest()
    });

    expect(response.inference_id).toMatch(/^external-run-001-/);
    expect(response.project_slug).toBe("external-market-impact");
    expect(response.session_id).toBe(response.inference_id);
    expect(response.rounds_completed).toBe(2);
    expect(response.item_count).toBe(2);
    expect(response.artifact_paths.manifest).toBe(
      `projects/external-market-impact/external/inferences/${response.inference_id}.json`
    );
    expect(response.artifact_paths.report).toBe(
      `projects/external-market-impact/external/reports/${response.inference_id}.md`
    );
    expect(response.artifact_paths.context).toBe(
      `projects/external-market-impact/external/context/${response.inference_id}.md`
    );
    expect(response.artifact_paths.input_items).toHaveLength(2);
    expect(response.artifact_paths.swarm_rounds).toHaveLength(2);
    expect(response.artifact_paths.role_reasoning).toHaveLength(4);
    expect(response.context_requirements.is_ready).toBe(false);
    expect(response.context_requirements.missing_required_keys).toContain("background");
    expect(response.role_reasoning[0]?.status).toBe("pi_runtime_not_invoked_deterministic");

    const globalManifest = await readWorkspaceFile({
      workspacePath,
      path: `external/inferences/${response.inference_id}.json`
    });
    expect(JSON.parse(globalManifest.content)).toMatchObject({
      client_request_id: "run-001",
      response: { inference_id: response.inference_id }
    });

    const readBack = await getExternalSwarmInference({
      workspacePath,
      actor: ACTOR,
      inferenceId: response.inference_id
    });
    expect(readBack).toEqual(response);

    const validation = await validateExternalSwarmInference({
      workspacePath,
      actor: ACTOR,
      inferenceId: response.inference_id
    });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("reuses client_request_id runs without writing duplicate audit entries", async () => {
    const first = await createOrGetExternalSwarmInference({
      workspacePath,
      actor: ACTOR,
      request: fixtureRequest()
    });
    const auditLineCountAfterFirst = await countAuditLines(workspacePath);

    const second = await createOrGetExternalSwarmInference({
      workspacePath,
      actor: ACTOR,
      request: { ...fixtureRequest(), title: "Changed title ignored by idempotent get" }
    });
    const auditLineCountAfterSecond = await countAuditLines(workspacePath);

    expect(second).toEqual(first);
    expect(auditLineCountAfterSecond).toBe(auditLineCountAfterFirst);
  });

  it("returns structuredContent-compatible MCP result wrappers", async () => {
    const requirements = await requireExternalSwarmContext({
      workspacePath,
      actor: ACTOR,
      request: fixtureRequest()
    });
    const mcp = toMcpStructuredResult(requirements);

    expect(mcp.structuredContent).toEqual(requirements);
    expect(mcp.content[0].type).toBe("text");
    expect(JSON.parse(mcp.content[0].text)).toEqual(requirements);
  });
});

function fixtureRequest(): ExternalSwarmInferenceRequest {
  return {
    client_request_id: "run-001",
    domain: "market-impact",
    title: "Supplier shock scenario",
    summary: "Two source items should be inferred together for downstream impact.",
    items: [
      {
        id: "item-a",
        title: "Supplier outage",
        content: "A critical supplier reported a regional outage.",
        source: "ops-feed",
        published_at: "2026-06-01T12:00:00Z",
        metadata: { symbol: "NFAB" }
      },
      {
        id: "item-b",
        title: "Logistics delay",
        content: "Ports reported delays that may compound the supplier outage.",
        source: "logistics-feed"
      }
    ],
    questions: ["What impacts are plausible?", "Which uncertainties should be monitored?"],
    context: {
      entity_cards: [
        {
          id: "entity-nfab",
          kind: "company",
          name: "Novel Fabrication",
          summary: "A fixture company exposed to supplier risk.",
          evidence: ["item-a"]
        }
      ]
    },
    rounds: 2
  };
}

async function countAuditLines(workspacePath: string): Promise<number> {
  const auditDir = path.join(workspacePath, ".novelfabric", "audit", "files");
  const entries = await fs.readdir(auditDir).catch(() => [] as string[]);
  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const content = await fs.readFile(path.join(auditDir, entry), "utf8");
    count += content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length;
  }
  return count;
}
