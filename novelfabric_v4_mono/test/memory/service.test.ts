import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CommandFailure } from "../../src/errors.js";
import {
  appendMemory,
  applySharedMemoryProposal,
  proposeSharedMemory,
  recallMemory,
  validateSharedMemoryProposal
} from "../../src/memory/service.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("memory services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-memory-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "memory", "global", "shared.md"),
      "# Shared Memory\n\n星门雨城有钟楼规则。\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, "project.md"),
      "# Project\n\n阿莉娅记录星门雨城。\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("recalls visible memory and appends profile memory through shared write service", async () => {
    const recall = await recallMemory({
      workspacePath,
      actor: "main_agent",
      profile: "main_agent",
      query: "星门 雨城"
    });
    expect(recall.resultCount).toBeGreaterThan(0);
    expect(recall.results[0]?.path).toBe("memory/global/shared.md");

    const append = await appendMemory({
      workspacePath,
      actor: "main_agent",
      profile: "main_agent",
      content: "主代理观察到雨城钟楼节律。"
    });
    expect(append.path).toBe("memory/agents/main_agent.md");
    const saved = await fs.readFile(path.join(workspacePath, append.path), "utf8");
    expect(saved).toContain("主代理观察");
  });

  it("proposes, validates, and applies shared memory with citations", async () => {
    const proposal = await proposeSharedMemory({
      workspacePath,
      actor: "main_agent",
      content: "共享事实：阿莉娅与星门雨城存在当前章节关联。",
      citations: ["project.md"]
    });
    expect(proposal.proposalPath).toMatch(/^proposals\/memory\/shared-/);
    expect(proposal.citationCount).toBe(1);

    const validation = await validateSharedMemoryProposal({
      workspacePath,
      proposalPath: proposal.proposalPath
    });
    expect(validation.valid).toBe(true);

    const apply = await applySharedMemoryProposal({
      workspacePath,
      proposalPath: proposal.proposalPath,
      actor: "main_agent"
    });
    expect(apply.targetPath).toBe("memory/global/shared.md");
    const shared = await fs.readFile(
      path.join(workspacePath, "memory", "global", "shared.md"),
      "utf8"
    );
    expect(shared).toContain("共享事实");
    expect(shared).toContain("project.md:1-3");
  });

  it("denies role agent shared memory apply and detects stale citations", async () => {
    const proposal = await proposeSharedMemory({
      workspacePath,
      actor: "main_agent",
      content: "共享事实会被 citation 校验保护。",
      citations: ["project.md"]
    });
    await expect(
      applySharedMemoryProposal({
        workspacePath,
        proposalPath: proposal.proposalPath,
        actor: "role_agent"
      })
    ).rejects.toMatchObject({ code: "capability_denied" } satisfies Partial<CommandFailure>);

    await fs.writeFile(path.join(workspacePath, "project.md"), "# Changed\n", "utf8");
    const validation = await validateSharedMemoryProposal({
      workspacePath,
      proposalPath: proposal.proposalPath
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "citation_hash_mismatch")).toBe(true);
  });
});
