# GLOBAL_PROMPT_SKILL_STACK

Apply local skills in this order.

## Stage ownership

1. `AGENTS.md` / `SOUL.md` — truth hierarchy and tone
2. `README.md` — route the phase
3. `PROMPT_ENGINEERING_CORE.md` — build `candidate-a` and `candidate-b`
4. `BASH_GIT_WORKFLOW.md` — inspect, mutate, diff
5. `CONTEXT_PACKING_GUIDE.md` / `PACK_SCOPE_CONVENTIONS.md` — pack continuity state
6. `REVIEW_LOOP.md` — promotion, contradiction, stale-artifact gate

## Fanout rule

Parallel inspection is allowed. Parallel truth mutation is not. Choose one write surface before canon changes land.

## Bounce map

- canon uncertainty → back to `PROMPT_ENGINEERING_CORE.md`
- placement uncertainty → back to `PACK_SCOPE_CONVENTIONS.md`
- dirty or mixed canon diff → back to `BASH_GIT_WORKFLOW.md`
- unresolved contradiction at exit → back to `REVIEW_LOOP.md` and freeze the move
