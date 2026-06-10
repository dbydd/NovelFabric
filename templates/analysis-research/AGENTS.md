# AGENTS.md

This is the `analysis-research` template for evidence-driven collection, interpretation, and derived output.

## Workspace boundary

- This workspace is a research harness, not a product app, WebUI, backend, runtime, API surface, or internal swarm.
- `sources/` stores imported evidence with provenance intact.
- `notes/` stores working interpretation and maintained reasoning.
- `artifacts/` stores derived reports, summaries, and generated deliverables.
- If a file mixes these roles, stop the line and reclassify it.

## Before acting

1. Read `AGENTS.md`, `SOUL.md`, and `template.json`.
2. Read `.agents/skills/README.md`, then the skill files that own the current stage.
3. Inspect existing `sources/`, `notes/`, and `artifacts/` before collecting, summarizing, or concluding anything new.
4. Name whether this pass is `intake`, `interpretation`, `comparison`, `artifact synthesis`, or `claim tightening`.

## Evidence gate

- Trigger: you want to write a summary, claim, comparison, recommendation, or derived output. Scope: `notes/**` and `artifacts/**`. Required action: inspect the support files first and name them before the claim is written. Forbidden shortcut: writing polished conclusions and planning to backfill provenance later. Verification: if a non-trivial claim cannot point to a support path, it is downgraded or rejected.
- Trigger: you move material from one layer to the next. Scope: `sources/`, `notes/`, `artifacts/`. Required action: preserve provenance and make the transition explicit. Forbidden shortcut: silently laundering interpretation back into `sources/`.

## Protected surfaces

- `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`, and `notes/**` are high-pressure surfaces.
- For protected changes, inspect the current file first, keep the diff single-purpose, and make the changed research judgment reviewable.
- If a note changes its conclusion without reopening support files, rollback and redo the pass properly.

## Rejection rules

- Unsupported certainty is slop and fails the gate.
- A neat artifact that hides weak evidence is rejected, not praised.
- `artifacts/` may not introduce a new major claim before `notes/` has established the support chain.
- Raw evidence may not be quietly cleaned until it reads like interpretation.

## Completion evidence

Before claiming completion, report:
- changed files
- support files inspected
- whether each changed file is a source, note, or artifact
- unresolved gaps or downgraded claims, if any
