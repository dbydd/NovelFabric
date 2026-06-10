# AGENTS.md

Scope: `templates/tooling-only/.agents/skills/`

## Purpose

- These skill files own tool admission, artifact demotion, rollback review, and operator handoff loops.

## Rules

- Every skill here should strengthen inspect -> admit/reject -> diff -> verify -> rollback/review flow.
- Fanout is allowed for evaluation, but final edits must converge to one durable write surface.
- If a skill adds more branches, it must also add clearer rejection and recovery rules.

## Stop conditions

- New skill text with no operator consequence is rejected.
- A skill that permits durable tooling without rollback logic does not ship.
