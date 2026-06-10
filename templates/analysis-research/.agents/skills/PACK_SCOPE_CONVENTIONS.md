# Pack Scope Conventions

Interpret scope labels in this order:

1. exact file name or directory name
2. known workspace label
3. path substring match

## Preferred scopes

- `sources` — imported evidence with provenance intact
- `notes` — working interpretation and structured comparisons
- `artifacts` — derived reports, summaries, or audits
- `harness` — `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`

## Order rule

When a scope touches analysis policy or protected notes, place root harness files before target evidence files so the contract is visible before the content.

## Do not

- pack a polished artifact without the supporting note or source context when the claim trail matters
- treat raw evidence and interpretation as interchangeable scope labels
