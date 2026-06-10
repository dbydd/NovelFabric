# Context Packing Guide

Pack context when analysis work will pause, fork, hand off, or span multiple evidence files.

## Required fields

A useful pack must include:

- current goal
- evidence files already inspected
- notes or artifacts already touched
- unresolved questions or unsupported claims
- next safe action
- rollback point

## Scope hints

Common `analysis-research` packs:

- `sources` — imported evidence and provenance-bearing files
- `notes` — working interpretation and comparisons
- `artifacts` — derived outputs and reviewable summaries
- `harness` — root control files and local skills

## Assembly order

1. `AGENTS.md`
2. `SOUL.md`
3. `template.json`
4. relevant local skill files
5. supporting `sources/`, `notes/`, and `artifacts/` files in that order

## Anti-patterns

- collapsing disagreements between sources into one smooth paragraph
- losing which file supported which conclusion
- carrying forward a claim without saying what still needs to be checked
