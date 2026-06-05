# NovelFabric

## Overview
NovelFabric v1 is a web-based LLM-assisted literary creation platform built with a Rust backend and a Vue frontend. It stores all mutable project resources as text files and supports project creation, txt novel import, card/memory management, TRPG-style simulation, writing workflows, and timeline branching.

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
- Frontend/backend separated web architecture.
- V4 TypeScript construction is moving from `backend_v2/` into the mono app directory `novelfabric_v4_mono/`. The existing Rust backend is legacy migration input until V4 coverage replaces it.
- V4 web UI remains Vue but lives in the mono app package as an optional CLI-started shell instead of a separate new package.
- All mutable project resources persisted as text files on disk.
- Backend-first delivery.
- No unchecked type-system escape hatches in new TypeScript backend code (`any`, `unknown`, wildcard types, lint suppressions, or unchecked casts).
- TypeScript mono app gates (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) must be clean for V4 work; optional web changes also require `npm run web:build`.
- Final acceptance must be browser-only via Playwright when browser/UI behavior is in scope.

## Recommended stacks
### V4 mono app
- TypeScript for V4 `novelfabric_v4_mono/` (old staging name: `backend_v2/`)
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
3. Backend clippy is zero-warning.
4. Required manual QA for the phase is executed.
5. State artifacts are updated with evidence.
