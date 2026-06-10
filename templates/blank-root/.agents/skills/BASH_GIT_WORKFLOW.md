# Bash + Git Workflow

`blank-root` runs on a `scan -> choose -> write -> diff -> verify -> decide` loop.

## Two-lane model

- `scan lane` — inspect root files, candidate directories, and existing constraints
- `write lane` — mutate exactly one converged write surface

Never stay in both lanes at once.

## Micro-loop

1. inspect narrowly
2. edit minimally
3. inspect per-file diff
4. run smallest validation
5. decide: continue, rollback, or stop the line

## Hard stops

- unjustified new top-level directory
- protected diff with mixed intent
- hidden assumption in file naming or layout
- validation omitted because the change “looks small”
