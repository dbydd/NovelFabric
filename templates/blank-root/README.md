# `blank-root`

Low-assumption root-first workspace harness.

## Use this template when

- you want the smallest possible starting surface
- the domain is still unclear or likely to change
- most durable behavior should live in root files and local skills, not in prebuilt directories
- you want to resist accidental drift into product, research, or tooling scaffolding

## Do not start here when

- you already know the workspace is primarily narrative and needs `canon/` / `inbox/` / `artifacts/`
- you already know the workspace is mainly reusable tooling with a durable `tools/` surface
- you already know the workspace is evidence-driven analysis with `sources/` / `notes/` / `artifacts/`

## Layout contract

- root files carry most of the harness behavior
- extra top-level directories must be earned, not pre-scaffolded
- `.agents/skills/` is the local control stack for root-first operation

## First read order

1. `AGENTS.md`
2. `SOUL.md`
3. `template.json`
4. `.agents/skills/README.md`
5. the skill files that own the current phase

## Typical first moves

- tighten one root policy file before creating structure
- add or refine one local skill before adding scripts or scaffolding
- state the exact write surface before editing
- keep new durable structure reversible and explicit

## Protected and audited surfaces

Protected paths are declared in `template.json`.
In this template, the root harness files and `.agents/skills/**` are the main high-pressure surfaces and should change via a narrow, reviewable diff.

## Success condition

This template is working when the workspace stays legible at root, gains structure only with explicit justification, and never smuggles in a hidden domain shape.
