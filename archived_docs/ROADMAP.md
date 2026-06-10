# ROADMAP

## Phase 0 — Rewrite framing

- Re-read retained product, runtime, architecture, and QA documents.
- Decide which V4 constraints remain binding for V5.
- Write a fresh V5 architecture and acceptance entry plan before adding code.

## Phase 1 — Workspace contract

- Define the V5 repository layout.
- Re-establish the canonical project/workspace data model.
- Specify capability boundaries for project manager, role agents, and external adapters.

## Phase 2 — Core execution surface

- Pick the implementation language and runtime model.
- Rebuild the minimum trusted primitives for text-backed project operations.
- Define how validation, audit, and protected writes work in V5.

## Phase 3 — Story systems

- Reintroduce StoryGraph, StoryRAG, StorySwarm, and ReportAgent only after their V5 contracts are explicit.
- Separate inherited ideas from inherited implementation assumptions.

## Phase 4 — User-facing surfaces

- Decide the relationship between CLI, optional Web shell, and agent bridge.
- Rebuild only the user surfaces justified by the V5 architecture.

## Phase 5 — Verification and usability

- Define V5 verification commands from scratch.
- Rebuild acceptance around real usability instead of legacy command continuity.
- Re-establish browser-only acceptance if a browser surface remains in scope.
