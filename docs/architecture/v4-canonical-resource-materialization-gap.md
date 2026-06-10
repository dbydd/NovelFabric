# NovelFabric V4 Gap: Agent-Generated Workspace Resource Filling

> Active V4 gap document after the scope reset. NovelFabric must provide the workspace, tools, constraints, validation, and audit path. It must not encode novel-understanding, card extraction, memory synthesis, timeline reasoning, or writing judgment as hidden TypeScript business logic when those rules can be expressed in `AGENTS.md`, workspace skills, task prompts, schemas, and capability manifests.

## 1. Reset Summary

The previous canonical materialization direction drifted off-course: it encouraged TypeScript code to project semantic import JSON into character/world/rule/scene cards, memory, timeline entries, and simulation evidence. That is the wrong ownership boundary.

The correct V4 boundary is:

- **Code owns tools and guardrails**: workspace layout, safe path resolution, protected writes, capability checks, proposal/apply primitives, context packs, pi task packaging, model-run evidence, validation envelopes, audit logs, Web bridge adapters, and derived indexes.
- **Agent text assets own semantic work**: book splitting judgment, card extraction, memory synthesis, timeline interpretation, character reasoning, KP/world/project-audit behavior, report writing, chapter drafting, and review criteria.
- **Tests own evidence checks**: directory creation, required files, non-empty/substantive content, source citations, proposal/apply audit records, and proof that content came from a model-backed task rather than deterministic source-text projection.

This gap stays open until a real path run proves that the workspace is populated by model/agent outputs under NovelFabric constraints, not by programmatic extraction heuristics in the core CLI.

## 2. Non-Negotiable Design Rules

1. If a behavior can live in `AGENTS.md`, a workspace skill, a role `soul.md`, a prompt template, or a capability manifest, it must not be hard-coded as TypeScript domain logic.
2. Deterministic code may normalize/chunk text, create directories, build context packs, validate schemas/citations/hashes, apply approved proposals, rebuild indexes, and write audit logs.
3. Deterministic code must not decide that a semantic item is a rule/world/scene card by keyword heuristics, synthesize memory facts from semantic JSON, or convert events into timeline meaning.
4. CLI commands may create agent tasks and validate/apply their outputs. They should not silently generate canonical story content themselves.
5. Web UI may keep UI-only orchestration/state code that is hard to remove, but that code belongs under `src/web/` or the Web bridge adapter layer. It must not become the core business runtime.
6. A passing workflow/status flag is not business success. Business success requires model-run evidence plus validated workspace artifacts.

## 3. Required Workspace Resources

A complete imported project must still populate the canonical directories:

```text
cards/characters/
cards/rules/
cards/scenes/
cards/world/
memory/global/
memory/chapters/
memory/agents/
timeline/branches/
simulation/turns/
simulation/logs/
writing/chapters/
```

The difference is ownership: these files must be authored by a constrained model/agent task or by the user through proposal/apply tools. The CLI can validate and apply the result, but it should not manufacture the content by deterministic projection.

## 4. Test Layers

### 4.1 Directory And File Presence

Tests must prove that project initialization and workflow execution create the required directory skeleton and that the expected directories become populated when the relevant agent task completes.

These tests may be deterministic, but they only check filesystem shape and audit plumbing.

### 4.2 Content Correctness

Tests must inspect the written files for:

- non-empty, substantive Markdown/JSON content;
- required headings or schema fields for the resource type;
- citations/source anchors back to workspace files;
- provenance pointing to a proposal, task result, or user action;
- absence of generic template shells.

These checks do not judge literary quality. They judge whether the right kind of information was placed in the right file with traceable evidence.

### 4.3 Model-Generation Evidence

For semantic resources produced from an import, tests must prove that a model-backed agent task ran and that the applied resource can be traced to that task. Acceptable evidence includes:

- `.novelfabric/tasks/<task-id>/result.json` with runtime evidence;
- model/provider/session metadata from the NovelFabric pi runtime envelope;
- schema-valid model output containing the resource content;
- a proposal artifact referencing the task result;
- audit entries from applying the proposal through CLI/shared services.

A deterministic command that directly copies, summarizes, classifies, or reshapes source text into cards/memory/timeline is not acceptable evidence.

## 5. Implementation Direction

The active implementation should remove or avoid core code that performs deterministic story-resource synthesis. Keep and harden:

- `workspace`, `project`, `files`, `runtime`, `agent`, `skills`, `context-pack`, and proposal/apply commands;
- safe path, protected write, capability, conflict, hash, citation, schema, and audit checks;
- pi task creation/running/output validation;
- Web bridge code as thin adapters over the same tools;
- optional Web-only state and rendering under `src/web/`.

Move semantic instructions into workspace text assets:

- root/workspace `AGENTS.md` for global NovelFabric rules;
- `agents/<agent-id>/soul.md` and `skills/*.md` for role behavior;
- task `allowed-commands.md` and `output.schema.json` for execution constraints;
- acceptance docs for what validators must check.

## 6. Acceptance Standard

A future real-path run is acceptable only when it proves all of the following:

- required directories exist;
- expected files are populated after the relevant task stages;
- populated files have correct resource type, citations, source anchors, and provenance;
- model-backed task evidence exists for semantic content;
- deterministic stages are labeled as harness/tooling only;
- no core TypeScript path contains keyword-based or template-based story extraction that substitutes for agent work;
- Web UI paths do not bypass CLI proposal/apply, validation, or audit.

## 7. Non-Goals

- No TypeScript novel-understanding engine.
- No keyword classifier for rule/world/scene/character resource generation in the core CLI.
- No deterministic memory or timeline synthesis from semantic JSON in the core CLI.
- No judging prose quality in automated tests.
- No Web-only persistence path for business resources.
- No fixture-specific logic for `test_novel.txt` or any acceptance fixture.

## 8. Current Status

Status after the scope reset:

- the previous canonical-materialization plan is superseded by this agent-generated resource filling gap;
- deterministic canonical projection code should be removed from the core surface;
- the next valid implementation slice is to keep basic tools and make model/agent-generated proposals the only path for semantic workspace content.
