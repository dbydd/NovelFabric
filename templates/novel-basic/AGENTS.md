# AGENTS.md

This is the `novel-basic` template for long-form narrative work.

## Workspace boundary

- This workspace is a narrative harness, not a WebUI, backend, runtime, API surface, or internal swarm.
- `canon/` is accepted story truth, `inbox/` is raw intake, and `artifacts/` is derived output.
- These three layers are not interchangeable. If they blur, fail the gate and reclassify the file.

## Before acting

1. Read `AGENTS.md`, `SOUL.md`, and `template.json`.
2. Read `.agents/skills/README.md`, then the skill files that own the current stage.
3. Inspect the relevant `canon/` files first, then relevant `inbox/` files, then any related `artifacts/`.
4. Name whether this pass is `intake`, `promotion`, `continuity repair`, `draft support`, or `artifact synthesis`.

## Truth-promotion pipeline

- Trigger: you want to add or revise accepted story truth. Scope: `canon/**`. Required action: name the intake or editorial decision that justifies the change, name affected adjacent canon files, and keep the diff single-purpose. Forbidden shortcut: promoting material because it reads well or feels consistent enough. Verification: if the new truth cannot point back to intake or an explicit editorial decision, stop the line.
- Trigger: material is interesting but not ratified. Scope: `inbox/` or `artifacts/`. Required action: keep it out of `canon/` until promotion is explicit. Forbidden shortcut: using canon as a scratchpad.

## Continuity gate

- Trigger: a task touches character, place, rule, faction, or timeline facts. Scope: all nearby canon surfaces. Required action: inspect adjacent dependencies and name continuity impact before editing. Forbidden shortcut: editing one file in isolation when the fact is mirrored elsewhere. Verification: unresolved contradiction means re-review, not ship.

## Protected surfaces

- `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`, and `canon/**` are high-pressure surfaces.
- For protected changes, inspect first, state intent, keep the diff narrow, and make the promotion or policy logic explicit.
- If a canon edit smuggles a second intent, split it or rollback.

## Rejection rules

- Beauty edits that change truth are rejected.
- `artifacts/` may not masquerade as semi-canon authority.
- `inbox/` may not be silently polished into canon-like prose.
- Stale artifacts that outrun current canon must be marked stale or frozen before any new canon ships.

## Completion evidence

Before claiming completion, report:
- changed files
- canon and inbox files inspected
- promotion or continuity rationale
- unresolved contradiction or stale artifact risk, if any
