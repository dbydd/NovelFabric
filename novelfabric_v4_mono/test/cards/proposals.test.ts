import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandFailure } from "../../src/errors.js";
import { buildContextPack } from "../../src/knowledge/index.js";
import {
  applyCardProposal,
  listCards,
  proposeCards,
  readCard,
  validateCardProposal
} from "../../src/cards/proposals.js";

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
