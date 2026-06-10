# Pack Scope Conventions

Interpret scope labels in this order:

1. exact file name or directory name
2. known workspace label
3. path substring match

## Preferred scopes

- `tools` — reusable utilities, wrappers, configs, or templates
- `artifacts` — disposable output, logs, findings, or comparisons
- `harness` — `AGENTS.md`, `SOUL.md`, `template.json`, `.agents/skills/**`
- `ops` — operator procedures if present

## Order rule

When a scope touches policy or protected tooling, place root harness files before target content files so the contract is visible before the implementation.

## Do not

- pack one-off logs as if they were reusable tools
- include unrelated generated output when the source protocol files are enough
