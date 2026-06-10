# COMMIT_MESSAGE_FEWSHOT

Use these patterns when a change touches protected paths in `WORKSPACE_NAME`.

## Subject line pattern

- `canon: promote <subject> from inbox evidence`
- `canon: reconcile <subject> continuity`
- `harness: tighten <protocol-name>`
- `skills: refine <skill-name> audit rules`

Keep the subject concrete. Avoid `update files`, `misc fixes`, or `cleanup` for protected work.

## Body pattern

```text
Intent:
- one clear change goal

Evidence inspected:
- canon/... 
- inbox/... 
- artifacts/... (if any)

Why this path:
- why the change belongs in canon, harness, or skills

Checks:
- diff reviewed
- validation run
```

## Examples

```text
canon: promote harbor oath from inbox evidence
```

```text
Intent:
- accept the harbor oath wording for Mira after comparing raw intake against current canon

Evidence inspected:
- canon/characters/mira.md
- canon/factions/harbor-circle.md
- inbox/2026-06-10-mira-oath-note.md
- artifacts/mira-oath-comparison.md

Why this path:
- the inbox note resolves an explicit placeholder in canon and needs a stable source of truth

Checks:
- diff reviewed
- canon dependency re-read completed
```

```text
harness: tighten canon promotion protocol
```

```text
Intent:
- make promotion steps explicit before canon edits

Evidence inspected:
- AGENTS.md
- .agents/skills/PROMPT_ENGINEERING_CORE.md
- .agents/skills/REVIEW_LOOP.md

Why this path:
- protected workflow rules changed; the harness must carry the new contract

Checks:
- diff reviewed
- target files cross-checked
```
