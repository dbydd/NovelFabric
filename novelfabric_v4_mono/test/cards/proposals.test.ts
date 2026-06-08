import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyCardProposal,
  listCards,
  proposeCards,
  readCard,
  validateCardProposal
} from "../../src/cards/proposals.js";
import type { CommandFailure } from "../../src/errors.js";
import { buildContextPack } from "../../src/knowledge/index.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("card proposal services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-cards-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "imports", "source", "chapter-one.md"),
      "# Chapter One\n\n阿莉娅抵达星门雨城，发现钟楼规则。\n",
      "utf8"
    );
    await writeCapabilities(workspacePath, ["project.manage", "cards.propose", "cards.apply"]);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("proposes, validates, applies, lists, and reads cards with citations", async () => {
    const pack = await buildContextPack({
      workspacePath,
      actor: "main_agent",
      kind: "world-card",
      query: "星门 雨城",
      outputPath: "knowledge/context-packs/world-card.json"
    });

    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      contextPackPath: pack.outputPath,
      kind: "world",
      title: "星门雨城",
      targetPath: "cards/world/star-rain-city.md",
      content: "# 星门雨城\n\n雨城由钟楼规则维持。\n"
    });
    expect(proposal.proposalPath).toMatch(/^proposals\/cards\/card-/);
    expect(proposal.cardCount).toBe(1);
    expect(proposal.citationCount).toBeGreaterThan(0);

    const validation = await validateCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath
    });
    expect(validation.valid).toBe(true);
    expect(validation.cardCount).toBe(1);

    const apply = await applyCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath,
      actor: "main_agent"
    });
    expect(apply.appliedCount).toBe(1);
    expect(apply.applied[0]?.path).toBe("cards/world/star-rain-city.md");

    const list = await listCards({ workspacePath, kind: "world" });
    expect(list.cards.some((card) => card.path === "cards/world/star-rain-city.md")).toBe(true);

    const read = await readCard({ workspacePath, path: "cards/world/star-rain-city.md" });
    expect(read.kind).toBe("world");
    expect(read.title).toBe("星门雨城");
    expect(read.content).toContain("钟楼规则");
  });

  it("materializes multiple canonical card kinds from semantic import evidence", async () => {
    const sourceRead = await readWorkspaceFile({
      workspacePath,
      path: "imports/source/chapter-one.md"
    });
    const semanticPath = "imports/semantic/chapter-one.json";
    await writeWorkspaceFile({
      workspacePath,
      path: semanticPath,
      actor: "main_agent",
      reason: "semantic card proposal test",
      content: stableJson({
        kind: "novelfabric.import.semantic",
        version: 1,
        sourcePath: sourceRead.path,
        sourceHash: sourceRead.hash,
        contextPackPath: sourceRead.path,
        contextPackHash: sourceRead.hash,
        summary:
          "阿莉娅抵达星门雨城并发现钟楼规则，城市设定、场景行动与规则约束需要分别沉淀为卡片。",
        chapters: [
          {
            title: "Chapter One",
            summary: "阿莉娅进入雨城，钟楼规则第一次显露。",
            sourceAnchors: ["阿莉娅抵达星门雨城", "钟楼规则"]
          }
        ],
        characters: [
          {
            name: "阿莉娅",
            summary: "阿莉娅是进入星门雨城的核心行动者，她发现钟楼规则并推动后续推演。",
            sourceAnchors: ["阿莉娅抵达星门雨城"]
          }
        ],
        events: [
          {
            title: "雨城入口",
            summary: "阿莉娅抵达星门雨城，在入口处感知钟楼规则对城市秩序的影响。",
            sourceAnchors: ["阿莉娅抵达星门雨城", "钟楼规则"]
          }
        ],
        cardSeeds: [
          {
            kind: "world",
            title: "星门雨城",
            summary: "星门雨城是被钟楼规则维持秩序的城市舞台，后续世界设定必须引用该来源。",
            sourceAnchors: ["星门雨城", "钟楼规则"]
          },
          {
            kind: "other",
            title: "钟楼规则",
            summary: "钟楼规则约束城市行动，角色推演必须保持与该规则一致。",
            sourceAnchors: ["钟楼规则"]
          },
          {
            kind: "plot",
            title: "雨城入口",
            summary: "阿莉娅进入雨城并发现钟楼规则，是后续章节与推演的起始场景。",
            sourceAnchors: ["阿莉娅抵达星门雨城"]
          }
        ],
        sourceAnchors: ["阿莉娅抵达星门雨城", "钟楼规则"],
        citations: [{ path: sourceRead.path, hash: sourceRead.hash }],
        createdFromTask: {
          taskId: "semantic-card-test",
          resultPath: sourceRead.path,
          resultHash: sourceRead.hash
        },
        materializedAt: new Date().toISOString()
      })
    });

    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      semanticImportPath: semanticPath,
      outputPath: "proposals/cards/chapter-one-canonical.json"
    });
    expect(proposal.cardCount).toBeGreaterThanOrEqual(4);

    const validation = await validateCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath
    });
    expect(validation.valid).toBe(true);

    const applied = await applyCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath,
      actor: "main_agent"
    });
    expect(applied.applied.map((card) => card.kind).sort()).toEqual(
      expect.arrayContaining(["character", "rule", "scene", "world"])
    );
    expect(applied.applied.some((card) => card.path === "cards/characters/阿莉娅.md")).toBe(true);

    const character = await readCard({ workspacePath, path: "cards/characters/阿莉娅.md" });
    expect(character.content).toContain("## Source Anchors");
    expect(character.content).toContain("阿莉娅抵达星门雨城");
    expect(character.content).toContain("imports/source/chapter-one.md");
    expect(character.content).not.toContain("Source Card");
  });

  it("requires cards.propose instead of project.manage for proposals", async () => {
    await writeCapabilities(workspacePath, ["project.manage"]);

    await expect(
      proposeCards({
        workspacePath,
        actor: "main_agent",
        citations: ["imports/source/chapter-one.md"],
        kind: "scene",
        title: "Project Manage Only",
        targetPath: "cards/scenes/project-manage-only.md"
      })
    ).rejects.toMatchObject({ code: "capability_denied" } satisfies Partial<CommandFailure>);
  });

  it("allows cards.propose alone to create a proposal and records capability audit", async () => {
    await writeCapabilities(workspacePath, ["cards.propose"]);

    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      citations: ["imports/source/chapter-one.md"],
      kind: "scene",
      title: "雨城入口",
      targetPath: "cards/scenes/rain-city-entry.md",
      reason: "card proposal capability test"
    });

    expect(proposal.proposalPath).toMatch(/^proposals\/cards\/card-/);
    const audit = await readLatestAuditEntry(workspacePath, proposal.write.auditPath);
    expect(audit).toMatchObject({
      actor: "main_agent",
      capability: "cards.propose",
      reason: "card proposal capability test",
      path: proposal.proposalPath,
      hash: proposal.write.hash
    });
  });

  it("requires cards.apply instead of project.manage for apply", async () => {
    await writeCapabilities(workspacePath, ["cards.propose"]);
    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      citations: ["imports/source/chapter-one.md"],
      kind: "world",
      title: "Apply Capability",
      targetPath: "cards/world/apply-capability.md"
    });

    await writeCapabilities(workspacePath, ["project.manage"]);
    await expect(
      applyCardProposal({ workspacePath, proposalPath: proposal.proposalPath, actor: "main_agent" })
    ).rejects.toMatchObject({ code: "capability_denied" } satisfies Partial<CommandFailure>);
  });

  it("allows cards.apply alone to apply a valid proposal", async () => {
    await writeCapabilities(workspacePath, ["cards.propose"]);
    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      citations: ["imports/source/chapter-one.md"],
      kind: "world",
      title: "Apply Alone",
      targetPath: "cards/world/apply-alone.md"
    });

    await writeCapabilities(workspacePath, ["cards.apply"]);
    const apply = await applyCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath,
      actor: "main_agent"
    });

    expect(apply.appliedCount).toBe(1);
    expect(apply.applied[0]?.path).toBe("cards/world/apply-alone.md");
  });

  it("does not let cards.apply authorize protected writes", async () => {
    await writeCapabilities(workspacePath, ["cards.apply"]);

    await expect(
      writeWorkspaceFile({
        workspacePath,
        path: ".novelfabric/capabilities.toml",
        content: '[main_agent]\nallow = ["cards.apply"]\n',
        actor: "main_agent",
        authorizedCapability: "cards.apply",
        reason: "cards apply protected write regression"
      })
    ).rejects.toMatchObject({ code: "capability_denied" } satisfies Partial<CommandFailure>);
  });

  it("rejects stale citation proposals before apply", async () => {
    const proposal = await proposeCards({
      workspacePath,
      actor: "main_agent",
      citations: ["imports/source/chapter-one.md"],
      kind: "scene",
      title: "雨城入口",
      targetPath: "cards/scenes/rain-city-entry.md"
    });
    await fs.writeFile(
      path.join(workspacePath, "imports", "source", "chapter-one.md"),
      "# Changed\n\nSource changed.\n",
      "utf8"
    );

    const validation = await validateCardProposal({
      workspacePath,
      proposalPath: proposal.proposalPath
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "citation_hash_mismatch")).toBe(true);
    await expect(
      applyCardProposal({ workspacePath, proposalPath: proposal.proposalPath, actor: "main_agent" })
    ).rejects.toMatchObject({ code: "invalid_card_proposal" } satisfies Partial<CommandFailure>);
  });
});

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeCapabilities(
  workspacePath: string,
  capabilities: readonly string[]
): Promise<void> {
  const serializedCapabilities = capabilities.map((capability) => `"${capability}"`).join(", ");
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    `[main_agent]\nallow = [${serializedCapabilities}]\n`,
    "utf8"
  );
}

async function readLatestAuditEntry(
  workspacePath: string,
  auditPath: string
): Promise<Record<string, unknown>> {
  const content = await fs.readFile(path.join(workspacePath, auditPath), "utf8");
  const lines = content.trim().split(/\r?\n/);
  const latest = lines.at(-1);
  if (latest === undefined) throw new Error(`Audit log '${auditPath}' is empty.`);
  const parsed: unknown = JSON.parse(latest);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Audit log '${auditPath}' did not contain an object entry.`);
  }
  return parsed as Record<string, unknown>;
}
