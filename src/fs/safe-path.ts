import path from "node:path";

import { CommandFailure } from "../errors.js";

export type ResolvedInsideRoot = {
  readonly root: string;
  readonly target: string;
  readonly relativePath: string;
};

export function resolveInsideRoot(rootPath: string, requestedPath: string): ResolvedInsideRoot {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, requestedPath);
  const relativePath = path.relative(root, target);

  if (relativePath === "" || isInsideRelativePath(relativePath)) {
    return { root, target, relativePath };
  }

  throw new CommandFailure(
    "path_outside_workspace",
    `Path '${requestedPath}' resolves outside workspace root '${root}'.`
  );
}

function isInsideRelativePath(relativePath: string): boolean {
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
