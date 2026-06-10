# NovelFabric

## Overview
NovelFabric 当前主线是一个位于仓库根目录的 V4 TypeScript mono app。它把 `novelfabric` CLI、可选 Vue Web shell、pi agent bridge 与共享 workspace services 放在同一目录演进，并继续把所有可变项目资源落为文本或可审计结构化文件。

## Product source of truth
- Primary specification: `PRODUCT_SPEC.md`
- v2 runtime constraint: `PRODUCT_SPEC_2.md`
- Project handoff state: `CODEX_INFO.md`
- Project-level agent injection context: `AGENTS.md`
- MiroFish fusion architecture: `docs/architecture/mirofish-fusion-plan.md`
- StoryGraph / StoryRAG constraints: `docs/architecture/story-graph-rag.md`
- StorySwarm / ReportAgent constraints: `docs/architecture/story-swarm-runtime.md`
- Story systems implementation roadmap: `docs/architecture/implementation-roadmap-story-systems.md`
- Generic external swarm API boundary: `docs/architecture/external-swarm-api.md`
- Remote MCP tool boundary for external swarm: `docs/architecture/external-swarm-mcp.md`
- v3 usability repair plan: `docs/architecture/v3-usability-plan.md`
- Canonical fixture for import and browser acceptance: `test_novel.txt`

## Locked architectural decisions
- Root-level V4 mono app is the active product line; the former `novelfabric_v4_mono/` staging directory has been folded into the repository root.
- V4 TypeScript remains the only active implementation language for the mono app; old Rust/Vue code is migration input or archived history, not the current mainline.
- V4 web UI remains Vue but lives in the same mono app as an optional CLI-started shell instead of a separate package.
- All mutable project resources persisted as text files on disk.
- CLI-first delivery with optional Web/UI adapters.
- No unchecked type-system escape hatches in new TypeScript backend code (`any`, `unknown`, wildcard types, lint suppressions, or unchecked casts).
- TypeScript mono app gates (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) must be clean for V4 work; optional web changes also require `npm run web:build`.
- Final acceptance must be browser-only via Playwright when browser/UI behavior is in scope.

## Recommended stacks
### V4 mono app
- TypeScript at repository root for the active V4 mono app (old staging names: `backend_v2/`, `novelfabric_v4_mono/`)
- Volta-managed Node/npm
- commander for CLI entry points
- zod for schema validation at dynamic boundaries
- vitest for tests
- eslint + typescript-eslint + prettier for diagnostics

### Frontend / optional web shell
- Vue 3
- Vite
- TypeScript
- Optional CLI startup through `novelfabric web ...`
- Vue Router 4 / Pinia when routing/state complexity requires them
- Vitest
- Playwright for browser behavior once the UI is connected beyond layout-only demo

## Canonical project data layout
```text
data/projects/{project-slug}/
├─ project.md
├─ project.json
├─ import/
├─ cards/
│  ├─ characters/
│  ├─ rules/
│  └─ world/
├─ memory/
│  ├─ global/
│  ├─ branches/
│  ├─ chapters/
│  └─ agents/
├─ writing/
├─ simulation/
├─ timeline/
├─ agents/
├─ history/
└─ .git/
```

## External integration boundary
External callers use NovelFabric through generic HTTP APIs, scripts, and skills. They must not import backend code or write directly into the data directory. External source material is accepted as caller-provided text/JSON, persisted under the target project, and then processed by StoryRAG / StorySwarm / ReportAgent.

## Definition of done
A phase is complete only when:
1. Relevant automated tests pass.
2. Changed files are diagnostics-clean.
3. Required root-level V4 verification commands are green for the changed surface.
4. Required manual QA for the phase is executed.
5. State artifacts are updated with evidence.
