export function isProtectedWorkspacePath(relativePath: string): boolean {
  const normalized = normalizeWorkspacePath(relativePath);
  if (normalized === "AGENTS.md") return true;
  if (normalized === ".novelfabric" || normalized.startsWith(".novelfabric/")) return true;
  if (/^agents\/[^/]+\/(soul|memory)\.md$/.test(normalized)) return true;
  return false;
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}
