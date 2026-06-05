import { describe, expect, it } from "vitest";
import type { WorkspaceTreeLikeNode } from "../../src/web/workspace-tree.js";
import { treeRowsForExpanded } from "../../src/web/workspace-tree.js";

type TestNode = WorkspaceTreeLikeNode;

describe("treeRowsForExpanded", () => {
  const baseNodes: readonly TestNode[] = [
    { path: ".", kind: "directory", label: "root" },
    { path: "cards", kind: "directory", label: "cards" },
    { path: "cards/characters", kind: "directory", label: "characters" },
    { path: "cards/characters/aria.md", kind: "file", label: "aria.md" },
    { path: "cards/world", kind: "directory", label: "world" },
    { path: "cards/scenes", kind: "directory", label: "scenes" },
    { path: "cards/scenes/west-gate-rain.md", kind: "file", label: "west-gate-rain.md" },
    { path: "project.md", kind: "file", label: "project.md" }
  ];

  function allRows(
    nodes: readonly TestNode[]
  ): { readonly node: TestNode; readonly depth: number }[] {
    return nodes.map((node) => ({
      node,
      depth: node.path === "." ? 0 : node.path.split("/").length
    }));
  }

  it("returns only root when nothing is expanded", () => {
    const result = treeRowsForExpanded(allRows(baseNodes), new Set<string>());
    expect(result).toHaveLength(1);
    expect(result[0]?.node.path).toBe(".");
  });

  it("returns root plus direct children when only root is expanded", () => {
    const result = treeRowsForExpanded(allRows(baseNodes), new Set(["."]));
    const paths = result.map((r) => r.node.path);
    expect(paths).toContain(".");
    expect(paths).toContain("cards");
    expect(paths).toContain("project.md");
    expect(paths).not.toContain("cards/characters");
    expect(paths).not.toContain("cards/scenes/west-gate-rain.md");
  });

  it("reveals deeper descendants when intermediate dirs are expanded", () => {
    const expanded = new Set([".", "cards", "cards/scenes"]);
    const result = treeRowsForExpanded(allRows(baseNodes), expanded);
    const paths = result.map((r) => r.node.path);
    expect(paths).toContain("cards/scenes/west-gate-rain.md");
    expect(paths).toContain("cards/characters");
    expect(paths).not.toContain("cards/characters/aria.md");
  });

  it("dynamically includes a newly added node once its ancestors are expanded", () => {
    const expanded = new Set([".", "cards", "cards/rules"]);
    const beforeRows = treeRowsForExpanded(allRows(baseNodes), expanded);
    expect(beforeRows.map((r) => r.node.path)).not.toContain("cards/rules/oath-lock.md");

    const extendedNodes: readonly TestNode[] = [
      ...baseNodes,
      { path: "cards/rules", kind: "directory", label: "rules" },
      { path: "cards/rules/oath-lock.md", kind: "file", label: "oath-lock.md" }
    ];
    const afterRows = treeRowsForExpanded(allRows(extendedNodes), expanded);
    expect(afterRows.map((r) => r.node.path)).toContain("cards/rules/oath-lock.md");
  });

  it("keeps collapsed directories when ancestors are expanded but they are not", () => {
    const expanded = new Set([".", "cards"]);
    const result = treeRowsForExpanded(allRows(baseNodes), expanded);
    const paths = result.map((r) => r.node.path);
    expect(paths).toContain("cards/characters");
    expect(paths).toContain("cards/world");
    expect(paths).toContain("cards/scenes");
    expect(paths).not.toContain("cards/characters/aria.md");
    expect(paths).not.toContain("cards/scenes/west-gate-rain.md");
  });

  it("handles the root-only collapse boundary correctly", () => {
    const expanded = new Set(["."]);
    const result = treeRowsForExpanded(allRows(baseNodes), expanded);
    const allNonRoot = result.filter((r) => r.node.path !== ".");
    expect(allNonRoot.every((r) => r.depth === 1)).toBe(true);
  });
});
