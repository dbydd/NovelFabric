import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("V4 full-usability acceptance contracts", () => {
  it("exposes the opt-in pi SDK AgentSession acceptance surface", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const archivePath = path.join(
      "docs",
      "architecture",
      "archive",
      "v4-sdk-agent-session-opt-in-archive.md"
    );

    expect(packageJson.scripts?.["test:pi-sdk-acceptance"]).toBe(
      "node scripts/pi-sdk-acceptance.mjs"
    );
    const archive = readFileSync(archivePath, "utf8");
    expect(archive).toContain("opt-in SDK AgentSession execution surface");
    expect(archive).toContain("Web-safe runtime extensions and Web bridge session orchestration");
  });

  it.todo(
    "orchestrates Web-safe pi SDK sessions with NovelFabric extensions, denied raw tools, browser-visible event trace, and bridge lifecycle controls"
  );

  it.todo(
    "lets a nontechnical Web user complete import -> semantic book split -> card proposals -> apply without seeing raw bash/write/edit"
  );

  it.todo(
    "runs role reasoning and StorySwarm turns from pi task evidence rather than deterministic templates"
  );

  it.todo(
    "creates ReportAgent and chapter draft artifacts with pi trace, context-pack hashes, citations, validation, apply audit, and final chapter files"
  );

  it.todo(
    "drives the full workflow through visible Playwright controls only, with screenshots/traces and no console or direct API bypass"
  );

  it.todo(
    "serves frozen external swarm REST endpoints and MCP tools using the shared external-swarm CLI service and golden fixtures"
  );
});
