# AGENTS.md

Scope: `templates/blank-root/.agents/skills/`

## Purpose

- Each file here must own a real stage in the root-control workflow.
- The directory exists to route behavior, not to collect prompt folklore.

## Rules

- Every skill file should answer trigger, scope, required action, forbidden shortcut, and verification when relevant.
- Use dual-channel or fanout language only if it changes operator behavior and still converges to one write surface.
- If two files repeat the same rule, merge or narrow them.

## Stop conditions

- Skill files that only restate values language fail review.
- A new skill file with no unique owner role is rejected.
