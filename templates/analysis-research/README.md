# `analysis-research`

Workspace harness for evidence intake, maintained reasoning, and derived research outputs.

## Use this template when

- imported evidence should stay separate in `sources/`
- interpretation and working judgments belong in `notes/`
- presentable outputs, reports, and exports belong in `artifacts/`
- provenance and support paths matter for every non-trivial claim

## Do not start here when

- the workspace should stay fully generic and root-first
- the primary durable asset is story canon rather than evidence-backed analysis
- the main goal is reusable tooling rather than research reasoning

## Layout contract

- `sources/` stores imported evidence with provenance intact
- `notes/` stores maintained interpretation and working reasoning
- `artifacts/` stores derived outputs and handoff-ready deliverables
- major claims should move through these layers in order rather than skipping support

## First read order

1. `AGENTS.md`
2. `SOUL.md`
3. `template.json`
4. `.agents/skills/README.md`
5. `sources/README.md`, `notes/README.md`, and `artifacts/README.md`
6. the specific evidence and note files that support the current pass

## Typical first moves

- inspect support files before writing any summary or recommendation
- keep interpretation in `notes/` until it is ready for handoff
- keep raw evidence in `sources/` rather than cleaning it into prose
- downgrade or mark uncertainty instead of overstating the claim

## Protected and audited surfaces

Protected paths are declared in `template.json`.
In this template, the root harness files, `.agents/skills/**`, and `notes/**` are the main high-pressure surfaces and should change only with reopened evidence and reviewable reasoning.

## Success condition

This template is working when evidence remains traceable, notes remain reviewable, artifacts remain downstream of support, and polished prose never outruns provenance.
