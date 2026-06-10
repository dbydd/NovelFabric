# V5 Workspace Contract

## Status

Active V5 workspace contract.

## Default shape

A single template fork produces a single workspace.

V5 does not default to a `projects/*` multi-project manager root.

## Required root entries

Every template instance must include:

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `template.json`

Optional root entries:

- `.pi/`
- any domain-specific content directories

## Nested constraint model

The following may appear again inside subdirectories:

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `.pi/`

Purpose:

- inject local constraints
- inject local skills
- narrow role framing for subagents
- preserve template-level flexibility without one rigid global structure

## Directory skeleton policy

There is no globally required content skeleton such as:

- `canon/`
- `artifacts/`
- `inbox/`

Those are template-defined, not globally enforced.

## Template-defined control surface

Each template declares its own:

- protected file set
- variable set
- content layout
- role-specific constraints

Rust tools should read those rules, not invent a separate global domain model.
