---
title: "Real business workflow gap closure"
status: draft
created: "2026-06-05T14:09:08.022Z"
type: feature
---

# Real Business Workflow Gap Closure

## Goal

Move the browser workflow from deterministic template artifacts to a true NovelFabric business loop that performs semantic work for: import/chapterization, card extraction, role reasoning, swarm orchestration, report generation, and chapter drafting.

## Phase 1 — Workflow Contract And Schemas

- Define workflow job schemas for import jobs, card proposals, context packs, role actions, swarm rounds, reports, and chapters.
- Add CLI workflow commands for start/status/continue.
- Keep all writes routed through shared services, safe path checks, protected policy, and audit.

### Verification

- Unit tests for schemas and command envelopes.
- CLI fixture tests for job creation/status.

## Phase 2 — LLM Provider / Agent Execution Adapter

- Add typed provider/model configuration loaded from XDG config with env fallback only.
- Add health check and structured-output execution helpers.
- Add prompt templates and validation for import, cards, role reasoning, swarm report, and chapter drafting.
- Record provider/model/prompt/output evidence in audit logs.

### Verification

- Provider health command.
- Mocked provider tests.
- Real-provider smoke when config/credentials exist.

## Phase 3 — Import + Card Extraction

- Implement long-text chunking and chapter segmentation.
- Generate card proposals with citations.
- Add review/apply files and browser controls for import retries and stage inspection.

### Verification

- `test_novel.txt` produces source chunks, chapter candidates, card proposals, and citations.
- A synthetic non-`test_novel.txt` fixture also passes.

## Phase 4 — StoryRAG + Context Pack

- Build derived index files under `knowledge/`.
- Add quick_search / panorama_search / insight_forge services.
- Build role-scoped context packs with evidence panes.

### Verification

- Retrieval outputs include file paths, excerpts, entities, relations, and timeline data.

## Phase 5 — Role Reasoning + StorySwarm

- Add role action proposal schema and memory recall/redaction.
- Implement round order: characters -> random-event -> world-maintainer -> kp -> project-auditor.
- Persist session/memory/timepoint/branch artifacts.

### Verification

- One run with an existing role.
- One run with a custom role.
- Artifacts contain real LLM output and citations.

## Phase 6 — ReportAgent + Chapter Generation

- Add consistency audit and branch impact reports.
- Draft chapters from accepted swarm/report outputs.
- Validate chapter metadata/evidence.

### Verification

- Chapter output cites cards/session/report artifacts and is not template-only.

## Phase 7 — Browser Acceptance Re-run

- Use Playwright-only browser controls.
- No console or API shortcuts.
- Run 10 loops and record blockers without sample-specific branching.
- Prove backend model/agent execution with evidence logs.

### Verification

- At least one full loop with `test_novel.txt`.
- At least one full loop with a different fixture.
- Ten-loop browser run passes without unresolved blockers.
- All writes audited.
