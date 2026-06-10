# Context Packing Guide

Pack context when tooling work will pause, fork, hand off, or span multiple related files.

## Required fields

A useful pack must include:

- current goal
- files and directories already inspected
- active tool or script contracts
- assumptions still unverified
- next safe operator action
- rollback point

## Scope hints

Common `tooling-only` packs:

- `tools` — reusable scripts or configs plus their owning harness files
- `ops` — operator-facing procedures and related evidence
- `artifacts` — one-off findings, logs, or comparisons
- `harness` — root control files and local skills

## Assembly order

1. `AGENTS.md`
2. `SOUL.md`
3. `template.json`
4. relevant local skill files
5. target `tools/` or `artifacts/` files

## Anti-patterns

- packing generated noise with no operator value
- hiding which file is reusable and which is disposable
- carrying forward an assumption without saying how to verify it next
