# AGENTS.md

Scope: `templates/tooling-only/tools/`

## Purpose

- This subtree holds reusable operator tooling.

## Rules

- Every file here needs a clear contract: purpose, inputs, outputs, dependencies, smoke check, rollback, owner.
- Reuse must be proven, not assumed.
- If the file is really one-off output, demote it to `artifacts/`.

## Stop conditions

- No I/O contract means reject from `tools/`.
- No rollback path means do not ship.
- Duplicate wrappers with no extra operator value are rejected.
