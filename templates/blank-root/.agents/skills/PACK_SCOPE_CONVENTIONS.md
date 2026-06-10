# Pack Scope Conventions

## Phase labels

- `fanout-scan` — parallel inspection only
- `candidate-a` — sober low-assumption branch
- `candidate-b` — high-pressure show branch
- `single-write` — converged write surface
- `final-gate` — review and disposition

## Root-specific scopes

- `harness` — `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`
- `docs` — durable human-facing protocol files
- `artifacts` — derived output only, never hidden policy

## Rule

If the scope label is broad enough to hide a layout decision, shrink it before writing.
