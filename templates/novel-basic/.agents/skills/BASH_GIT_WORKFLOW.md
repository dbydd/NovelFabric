# BASH_GIT_WORKFLOW

This template runs a `scan -> classify -> write -> diff -> continuity check -> decide` loop.

## Two-lane model

- `scan lane` — inspect canon, inbox, and dependency files
- `write lane` — apply one converged promotion, repair, or artifact update

## Micro-loop

1. inspect narrow truth surfaces
2. edit minimally
3. review per-file diff
4. rerun continuity check
5. decide: continue, freeze, rollback, or re-review

## Hard stops

- canon change with no named intake or editorial basis
- unresolved contradiction hidden inside prose cleanup
- artifact that outruns canon without freeze or stale marker
- protected change with more than one intent
