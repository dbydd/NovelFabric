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
- Canonical fixture for import and browser acceptance: `test_novel.txt`

## Locked architectural decisions
- Frontend/backend separated web architecture.
- Backend implemented in Rust.
- Frontend implemented in Vue.
- All mutable project resources persisted as text files on disk.
- Backend-first delivery.
- No `unsafe` in application code.
- Clippy warnings/errors must be zero.
- Final acceptance must be browser-only via Playwright.

## Recommended stacks
### Backend
- axum 0.8.x
- tokio
- serde + serde_json
- tower-http
- thiserror
- tracing + tracing-subscriber
- cargo-chef for Docker build caching

### Frontend
- Vue 3
- Vite
- TypeScript
- Vue Router 4
- Pinia
- Vitest
- Playwright

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

## Definition of done
A phase is complete only when:
1. Relevant automated tests pass.
2. Changed files are diagnostics-clean.
3. Backend clippy is zero-warning.
4. Required manual QA for the phase is executed.
5. State artifacts are updated with evidence.
