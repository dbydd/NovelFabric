# `tooling-only`

Workspace harness for reusable scripts, automation, and operator-facing tool surfaces.

## Use this template when

- you need durable helpers in `tools/`
- one-off findings, logs, and generated residue should stay in `artifacts/`
- the workspace should optimize for repeatable operator workflows rather than product architecture
- rollback, smoke checks, and explicit I/O matter for every durable tool surface

## Do not start here when

- the workspace should stay fully generic and root-first
- accepted story truth is the main durable asset
- the primary work is evidence collection and interpretation rather than reusable tooling

## Layout contract

- `tools/` is for reusable checked-in operator surfaces
- `artifacts/` is for disposable output, run residue, and one-off findings
- new durable tooling must earn admission with a clear operator contract

## First read order

1. `AGENTS.md`
2. `SOUL.md`
3. `template.json`
4. `.agents/skills/README.md`
5. `tools/README.md` and `artifacts/README.md`
6. the existing files closest to the current operator task

## Typical first moves

- inspect existing `tools/` before adding another durable helper
- keep disposable output in `artifacts/` until reuse is proven
- name inputs, outputs, smoke check, and rollback path before enlarging `tools/`
- prefer a documented Bash sequence over a premature wrapper when reuse is still unclear

## Protected and audited surfaces

Protected paths are declared in `template.json`.
In this template, the root harness files, `.agents/skills/**`, and `tools/**` are the main audited surfaces and should change with explicit operator value and rollback expectations.

## Success condition

This template is working when reusable tooling stays small and legible, disposable output stays disposable, and no pseudo-platform drift hides inside convenience automation.
