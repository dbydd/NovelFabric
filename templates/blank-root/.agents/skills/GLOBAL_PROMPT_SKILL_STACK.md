# Global Prompt Skill Stack

Use global prompt skills for generic prompting problems. Use local files here for root-control behavior, branch comparison, and final gatekeeping.

## Stage ownership

1. `AGENTS.md` / `SOUL.md` — boundary and tone
2. `README.md` — route the phase
3. `PROMPT_ENGINEERING_CORE.md` — generate `candidate-a` and `candidate-b`
4. `BASH_GIT_WORKFLOW.md` — inspect and mutate
5. `CONTEXT_PACKING_GUIDE.md` / `PACK_SCOPE_CONVENTIONS.md` — pack and shrink scope
6. `REVIEW_LOOP.md` — decide pass, reject, rollback, or re-review

## Fanout rule

Parallel discovery is allowed. Parallel writing is not. After scan, collapse to one `single-write` surface.

## Bounce map

- boundary failure → back to `AGENTS.md` or `PACK_SCOPE_CONVENTIONS.md`
- vague prompt failure → back to `PROMPT_ENGINEERING_CORE.md`
- dirty diff or execution failure → back to `BASH_GIT_WORKFLOW.md`
- handoff failure → back to `CONTEXT_PACKING_GUIDE.md`
