# V4 Real Path Partial Coverage — 2026-06-08

> Archive note for the `test_novel.txt` real-path work completed on 2026-06-08.

## What The Real Path Proved

By 2026-06-08, NovelFabric V4 had demonstrated a real CLI-backed workflow spine over `../test_novel.txt`:

- `project init` created a canonical workspace with capability-compatible defaults.
- `import add` ingested the source novel into the canonical inbox.
- `workflow plan / start / step` executed the full deterministic + pi-task spine.
- `import.semantic` produced a source-grounded semantic import artifact.
- `cards.propose / cards.apply` produced at least one character card artifact.
- `knowledge.rebuild` produced derived graph/index artifacts.
- `simulation.session.create`, `simulation.context-pack`, `swarm.plan`, and `swarm.task.create` executed with real NovelFabric pi runtime evidence.
- `report.task.create` produced a pi-backed report artifact.
- `writing.context-pack` and `writing.draft` produced a pi-backed chapter draft.
- `workflow verify` passed with hashed, job/stage-bound evidence.

## What The Real Path Did Not Prove

The same real path did **not** prove full business completeness for a canonical NovelFabric project:

- `cards/rules/`, `cards/scenes/`, `cards/world/`, and multi-character card coverage were not satisfied.
- `memory/global/`, `memory/agents/`, `memory/branches/`, and `memory/chapters/` remained empty.
- `timeline/branches/` remained empty.
- `simulation/turns/` and `simulation/logs/` remained empty.
- `writing/chapters/` remained empty because the loop stopped at `writing.draft` instead of applying a final canonical chapter.

## Correct Status Classification

For archival purposes, the real path result should be read as:

```text
CLI pi-backed workflow spine smoke: PASS
Canonical NovelFabric business workspace coverage: incomplete
```

This archive preserves the completed workflow-spine evidence while making clear that the prior ledger closure referred to the previous iteration's framework/architecture gaps, not to full product completeness.

## Commit References

Representative commits in this slice:

- `582aa69` — `fix: harden real novel workflow path`
- `baef196` — `test: retry real llm workflow stages`

## Why This Was Archived Separately

This note was added to prevent future agents from reading the completed-framework ledgers as proof that a full business loop was already achieved. The active gap ledger must continue tracking canonical resource materialization, not only workflow/domain artifact plumbing.
