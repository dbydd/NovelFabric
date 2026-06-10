# AGENTS.md

This is the `tooling-only` template for reusable tools, scripts, and operator-facing automation.

## Workspace boundary

- This workspace is a tooling harness, not a product app, WebUI, backend, runtime, API surface, or internal swarm.
- `tools/` is for reusable checked-in operator surfaces.
- `artifacts/` is for disposable output, audit residue, and one-off findings.
- If the boundary between them is unclear, default to `artifacts/` and do not promote the file yet.

## Before acting

1. Read `AGENTS.md`, `SOUL.md`, and `template.json`.
2. Read `.agents/skills/README.md`, then the skill files that own the current stage.
3. Inspect existing `tools/`, relevant protocols, and any nearby evidence before adding a new durable file.
4. Name whether this pass is `admission`, `rollback`, `artifact capture`, `protocol tightening`, or `tool refinement`.

## Tool admission gate

- Trigger: you want to create or enlarge a reusable tool surface. Scope: `tools/**`. Required action: inspect existing equivalents first, then name owner, inputs, outputs, dependencies, failure mode, smoke check, and rollback path. Forbidden shortcut: adding a new tool because it feels cleaner than a documented Bash sequence. Verification: if the contract is incomplete, admission is denied.
- Trigger: a result may be one-off. Scope: `artifacts/**` vs `tools/**`. Required action: keep it in `artifacts/` until reuse is proven. Forbidden shortcut: promoting disposable residue into the durable tool surface.

## Protected surfaces

- `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`, and `tools/**` are high-pressure surfaces.
- For protected changes, inspect first, keep one intent per diff, and make rollback expectations visible.
- If a tool change lacks fallback or reversal logic, stop the line before it lands.

## Rejection rules

- Repackaging an existing command without new operator value is rejected.
- One-off findings in `tools/` are reclassified back to `artifacts/`.
- Automation with vague I/O, vague ownership, or no rollback path does not ship.
- Product architecture drift under the banner of tooling is a hard fail.

## Completion evidence

Before claiming completion, report:
- changed files
- existing equivalents inspected
- why each result belongs in `tools/`, `artifacts/`, or the harness surface
- validation command and rollback path
