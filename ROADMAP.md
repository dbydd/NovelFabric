# ROADMAP

## Phase 0 — Bootstrap and planning backbone
- Create repo skeleton for backend, frontend, docker, planning, and data roots.
- Establish architecture and verification rules.

## Phase 1 — Backend foundation
- Scaffold Rust backend app with axum.
- Add config, tracing, typed errors, and safe filesystem primitives.
- Implement project CRUD and canonical per-project bootstrap.

## Phase 2 — Core text-backed domain
- Implement card CRUD for character/rule/world cards.
- Implement layered memory CRUD and indexing.
- Implement timeline/timepoint primitives and agent artifacts.

## Phase 3 — Book import pipeline
- Implement txt upload/import.
- Add encoding normalization to UTF-8.
- Split chapters and produce import reports.
- Extract initial cards, memory, and timeline artifacts.

## Phase 4 — Simulation backend
- Implement simulation sessions, rounds, role orchestration, possession, and text logs.

## Phase 5 — Writing and branching backend
- Implement chapter writing workflow.
- Enforce current-chapter-only editing.
- Implement rollback and timeline branching with git-backed project history.

## Phase 6 — Frontend shell
- Scaffold Vue app with router, Pinia, shared API client, and accessible project management UI.

## Phase 7 — Feature workspace UI
- Implement simulation, writing, settings, and memory views.

## Phase 8 — Integration and acceptance
- Add Docker deployment.
- Run final browser-only Playwright acceptance with `test_novel.txt`.

## Phase 9 — v3 usability repair
- Use `docs/architecture/v3-usability-plan.md` as the v3 entry plan before starting ultragoal execution.
- Replace semantic book-splitting fallback with LLM-first / LLM-required card, agent, and skill generation.
- Add LLM healthcheck and user-visible provider/model diagnostics.
- Prove agent skill-card invocation through parsed skill contracts and runtime evidence.
- Ensure settings/import/card/agent/skill buttons provide loading, success, and error feedback.
