import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readArchive(name: string): string {
  return readFileSync(path.join("docs", "architecture", "archive", name), "utf8");
}

describe("V4 full-usability acceptance contracts", () => {
  it("exposes the opt-in pi SDK AgentSession acceptance surface", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const archive = readArchive("v4-sdk-agent-session-opt-in-archive.md");

    expect(packageJson.scripts?.["test:pi-sdk-acceptance"]).toBe(
      "node scripts/pi-sdk-acceptance.mjs"
    );
    expect(archive).toContain("opt-in SDK AgentSession execution surface");
    expect(archive).toContain("Those follow-up foundations were completed later");
  });

  it("archives Web-safe runtime foundations for nontechnical browser users", () => {
    const toolsArchive = readArchive("v4-web-safe-sdk-tools-foundation-archive.md");
    const mutationArchive = readArchive("v4-web-safe-mutation-tools-foundation-archive.md");
    const streamArchive = readArchive("v4-structured-event-stream-foundation-archive.md");
    const asyncArchive = readArchive("v4-async-sse-foundation-archive.md");
    const uiArchive = readArchive("v4-browser-runtime-task-ui-foundation-archive.md");

    expect(toolsArchive).toContain("Web-safe");
    expect(mutationArchive).toContain("write");
    expect(streamArchive).toContain("sanitized");
    expect(asyncArchive).toContain("Persistent SSE");
    expect(uiArchive).toContain("Runtime policy gate");
  });

  it("archives Web workflow orchestration and Playwright UI-only acceptance", () => {
    const archive = readArchive("v4-web-workflow-orchestration-archive.md");
    const e2e = readFileSync(path.join("test", "e2e", "source-workflow.spec.ts"), "utf8");

    expect(archive).toContain("Web workflow orchestration");
    expect(archive).toContain("Playwright UI-only");
    expect(e2e).toContain("runs a source inbox workflow through the browser controls");
    expect(e2e).toContain("验证通过");
    expect(e2e).toContain("writing-draft");
  });

  it("archives semantic import materialization with source-grounded artifacts", () => {
    const archive = readArchive("v4-semantic-import-archive.md");
    const semanticTest = readFileSync(path.join("test", "import", "semantic.test.ts"), "utf8");

    expect(archive).toContain("Semantic Import");
    expect(archive).toContain("source anchors");
    expect(semanticTest).toContain("materializes source-grounded semantic import artifacts");
    expect(semanticTest).toContain("rejects semantic import artifacts with anchors not found");
  });

  it("archives role reasoning, StorySwarm, ReportAgent, and writing domain artifacts", () => {
    const archive = readArchive("v4-domain-artifact-materialization-archive.md");
    const workflowTest = readFileSync(path.join("test", "workflow", "index.test.ts"), "utf8");

    expect(archive).toContain("StorySwarm");
    expect(archive).toContain("ReportAgent");
    expect(archive).toContain("Writing");
    expect(workflowTest).toContain("swarm.task.create");
    expect(workflowTest).toContain("report.task.create");
    expect(workflowTest).toContain("writing.draft");
  });

  it("archives frozen external swarm REST and MCP adapter coverage", () => {
    const archive = readArchive("v4-external-swarm-adapters-archive.md");
    const bridgeTest = readFileSync(path.join("test", "web", "bridge-plugin.test.ts"), "utf8");

    expect(archive).toContain("POST /api/external/swarm-inferences");
    expect(archive).toContain("/mcp");
    expect(archive).toContain("structuredContent");
    expect(bridgeTest).toContain("tools/list exposes the three frozen external swarm tools");
    expect(bridgeTest).toContain("external_swarm_infer");
  });

  it("archives domain-specific capability tightening", () => {
    const archive = readArchive("v4-domain-capabilities-archive.md");
    const cardTest = readFileSync(path.join("test", "cards", "proposals.test.ts"), "utf8");
    const memoryTest = readFileSync(path.join("test", "memory", "service.test.ts"), "utf8");

    expect(archive).toContain("cards.propose");
    expect(archive).toContain("writing.apply");
    expect(cardTest).toContain("requires cards.propose instead of project.manage");
    expect(memoryTest).toContain("capability_denied");
  });

  it("records the latest real-path partial coverage evidence", () => {
    const archive = readArchive("v4-real-path-partial-coverage-2026-06-08.md");
    const acceptanceDoc = readFileSync(
      path.join("docs", "qa", "v4-full-usability-acceptance.md"),
      "utf8"
    );

    expect(archive).toContain("CLI pi-backed workflow spine smoke: PASS");
    expect(archive).toContain("Canonical NovelFabric business workspace coverage: incomplete");
    expect(archive).toContain("cards/rules");
    expect(archive).toContain("writing/chapters");
    expect(acceptanceDoc.toLowerCase()).toContain("canonical project resource materialization");
  });
});
