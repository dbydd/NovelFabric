import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildContextPack,
  listKnowledgeSources,
  readKnowledgeGraphEdges,
  readKnowledgeGraphEpisodes,
  readKnowledgeGraphNodes,
  recallKnowledge,
  rebuildKnowledgeIndex,
  validateContextPack,
  validateKnowledgeIndex
} from "../../src/knowledge/index.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("deterministic knowledge and context-pack services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-knowledge-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "cards", "world", "star-gate.md"),
      "# 星门城市\n星门城市连接雨城。阿莉娅在星门城市寻找旧地图。\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(workspacePath, "timeline", "branches", "main.md"),
      "# 主时间线\n星门城市开启后，雨城出现回声。\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("lists deterministic source files without including derived knowledge artifacts", async () => {
    await fs.writeFile(
      path.join(workspacePath, "knowledge", "graph", "ignored.md"),
      "# derived\n",
      "utf8"
    );

    const result = await listKnowledgeSources({ workspacePath });

    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.sources.some((source) => source.path === "cards/world/star-gate.md")).toBe(true);
    expect(result.sources.some((source) => source.path.startsWith("knowledge/"))).toBe(false);
    expect(result.sources.every((source) => source.hash.startsWith("sha256:"))).toBe(true);
  });

  it("rebuilds derived graph artifacts with audited workspace writes and validates source hashes", async () => {
    const rebuilt = await rebuildKnowledgeIndex({ workspacePath, actor: "main_agent" });

    expect(rebuilt.sourceCount).toBeGreaterThan(0);
    expect(rebuilt.nodeCount).toBeGreaterThan(0);
    expect(rebuilt.edgeCount).toBeGreaterThan(0);
    expect(rebuilt.episodeCount).toBeGreaterThan(0);
    expect(rebuilt.writes.map((write) => write.path)).toEqual([
      "knowledge/indexes/sources.json",
      "knowledge/graph/nodes.json",
      "knowledge/graph/edges.json",
      "knowledge/graph/episodes.json",
      "knowledge/indexes/manifest.json"
    ]);
    expect(
      rebuilt.writes.every((write) => write.auditPath.startsWith(".novelfabric/audit/files/"))
    ).toBe(true);

    const nodes = await readKnowledgeGraphNodes({ workspacePath });
    const edges = await readKnowledgeGraphEdges({ workspacePath });
    const episodes = await readKnowledgeGraphEpisodes({ workspacePath });
    expect(nodes.nodes.some((node) => node.label.includes("星门城市"))).toBe(true);
    expect(edges.edges.some((edge) => edge.sourcePath === "cards/world/star-gate.md")).toBe(true);
    expect(
      episodes.episodes.some((episode) => episode.sourcePath === "cards/world/star-gate.md")
    ).toBe(true);

    const validation = await validateKnowledgeIndex({ workspacePath });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    await fs.appendFile(
      path.join(workspacePath, "cards", "world", "star-gate.md"),
      "新变化。\n",
      "utf8"
    );
    const staleValidation = await validateKnowledgeIndex({ workspacePath });
    expect(staleValidation.valid).toBe(false);
    expect(
      staleValidation.issues.some((issue) => issue.code === "knowledge_source_hash_mismatch")
    ).toBe(true);
  });

  it("runs quick, panorama, and insight recall with deterministic citations", async () => {
    const quick = await recallKnowledge({ workspacePath, mode: "quick", query: "星门城市 阿莉娅" });
    expect(quick.results.length).toBeGreaterThan(0);
    expect(quick.citations[0]?.sourcePath).toBe("cards/world/star-gate.md");
    expect(quick.expandedQuery).toContain("星门");

    const panorama = await recallKnowledge({
      workspacePath,
      mode: "panorama",
      query: "星门城市",
      timeline: "main"
    });
    expect(panorama.timeline).toBe("main");
    expect(panorama.results.some((hit) => hit.sourcePath.startsWith("timeline/"))).toBe(true);

    const insight = await recallKnowledge({ workspacePath, mode: "insight", query: "星门城市" });
    expect(insight.insights?.map((item) => item.code)).toEqual([
      "source_diversity",
      "recurring_terms"
    ]);
    expect(insight.citations.every((citation) => citation.hash.startsWith("sha256:"))).toBe(true);
  });

  it("builds and validates a citation-backed context pack", async () => {
    const built = await buildContextPack({
      workspacePath,
      actor: "main_agent",
      kind: "role-turn",
      query: "星门城市 阿莉娅",
      agent: "main_agent",
      session: "session-001",
      outputPath: "knowledge/context-packs/role-turn-test.json"
    });

    expect(built.outputPath).toBe("knowledge/context-packs/role-turn-test.json");
    expect(built.citationCount).toBeGreaterThan(0);
    expect(built.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//);

    const validation = await validateContextPack({ workspacePath, path: built.outputPath });
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);

    await fs.appendFile(
      path.join(workspacePath, "cards", "world", "star-gate.md"),
      "上下文包失效。\n",
      "utf8"
    );
    const staleValidation = await validateContextPack({ workspacePath, path: built.outputPath });
    expect(staleValidation.valid).toBe(false);
    expect(
      staleValidation.issues.some((issue) => issue.code === "context_pack_source_hash_mismatch")
    ).toBe(true);
  });
});
