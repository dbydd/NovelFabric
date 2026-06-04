export type LayoutEntryKind = "file" | "directory";

export type LayoutEntry = {
  readonly path: string;
  readonly kind: LayoutEntryKind;
  readonly surface: "content" | "scaffold" | "derived";
  readonly required: true;
};

export const canonicalLayout: readonly LayoutEntry[] = [
  { path: "AGENTS.md", kind: "file", surface: "scaffold", required: true },
  { path: "project.md", kind: "file", surface: "content", required: true },
  { path: "project.json", kind: "file", surface: "content", required: true },
  { path: ".novelfabric", kind: "directory", surface: "scaffold", required: true },
  { path: ".novelfabric/workspace.json", kind: "file", surface: "scaffold", required: true },
  {
    path: ".novelfabric/template-manifest.json",
    kind: "file",
    surface: "scaffold",
    required: true
  },
  { path: "cards", kind: "directory", surface: "content", required: true },
  { path: "cards/characters", kind: "directory", surface: "content", required: true },
  { path: "cards/rules", kind: "directory", surface: "content", required: true },
  { path: "cards/world", kind: "directory", surface: "content", required: true },
  { path: "memory", kind: "directory", surface: "content", required: true },
  { path: "memory/global", kind: "directory", surface: "content", required: true },
  { path: "memory/agents", kind: "directory", surface: "content", required: true },
  { path: "timeline", kind: "directory", surface: "content", required: true },
  { path: "timeline/index.json", kind: "file", surface: "content", required: true },
  { path: "writing", kind: "directory", surface: "content", required: true },
  { path: "writing/chapters", kind: "directory", surface: "content", required: true },
  { path: "simulation", kind: "directory", surface: "content", required: true },
  { path: "simulation/sessions", kind: "directory", surface: "content", required: true },
  { path: "simulation/turns", kind: "directory", surface: "content", required: true },
  { path: "agents", kind: "directory", surface: "content", required: true },
  { path: "knowledge", kind: "directory", surface: "derived", required: true },
  { path: "reports", kind: "directory", surface: "content", required: true },
  { path: "history", kind: "directory", surface: "scaffold", required: true }
];
