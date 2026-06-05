export type WorkspaceTreeLikeNode = {
  readonly label: string;
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly children?: readonly WorkspaceTreeLikeNode[];
};

export type WorkspaceTreeLikeRow<TNode extends WorkspaceTreeLikeNode> = {
  readonly node: TNode;
  readonly depth: number;
};

export function treeRowsForExpanded<TNode extends WorkspaceTreeLikeNode>(
  allRows: readonly WorkspaceTreeLikeRow<TNode>[],
  expanded: ReadonlySet<string>
): readonly WorkspaceTreeLikeRow<TNode>[] {
  return allRows.filter((row) => {
    if (row.depth === 0) return true;
    if (!expanded.has(".")) return false;

    const pathParts = row.node.path.split("/");
    for (let parentDepth = 1; parentDepth < row.depth; parentDepth += 1) {
      const parentPath = pathParts.slice(0, parentDepth).join("/");
      if (!expanded.has(parentPath)) return false;
    }
    return true;
  });
}

export function insertWorkspaceFile<TNode extends WorkspaceTreeLikeNode>(
  tree: readonly TNode[],
  fileNode: TNode
): readonly WorkspaceTreeLikeNode[] {
  const pathParts = fileNode.path.split("/");
  if (pathParts.length === 0) return tree;

  const addToNodes = (
    nodes: readonly WorkspaceTreeLikeNode[],
    depth: number
  ): readonly WorkspaceTreeLikeNode[] => {
    const parentPath = pathParts.slice(0, depth).join("/");
    const isFinalParent = depth === pathParts.length - 1;
    return nodes.map((node) => {
      if (node.path !== parentPath || node.kind !== "directory") return node;
      const children: readonly WorkspaceTreeLikeNode[] = node.children ?? [];
      if (isFinalParent) {
        if (children.some((child) => child.path === fileNode.path)) return node;
        return withSortedChildren(node, [...children, fileNode]);
      }
      const nextPath = pathParts.slice(0, depth + 1).join("/");
      if (!children.some((child) => child.path === nextPath)) return node;
      return withSortedChildren(node, addToNodes(children, depth + 1));
    });
  };

  if (pathParts.length === 1) {
    if (tree.some((node) => node.path === fileNode.path)) return tree;
    return sortNodes([...tree, fileNode]);
  }

  return addToNodes(tree, 1);
}

function withSortedChildren(
  node: WorkspaceTreeLikeNode,
  children: readonly WorkspaceTreeLikeNode[]
): WorkspaceTreeLikeNode {
  return { ...node, children: sortNodes(children) };
}

function sortNodes(nodes: readonly WorkspaceTreeLikeNode[]): readonly WorkspaceTreeLikeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.label.localeCompare(right.label, "zh-Hans-CN");
  });
}
