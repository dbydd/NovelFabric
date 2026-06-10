# Bash + Git Workflow

`tooling-only` assumes normal work can be completed with Bash, Git, and text edits.

## Default loop

1. Inspect the relevant `tools/`, `artifacts/`, and harness files.
2. Edit the minimum necessary text.
3. Review the file and then the diff.
4. Run the smallest command that proves the tool or document still matches scope.
5. If protected files changed, keep the audit trail clean and single-purpose.

## Preferred command classes

- `rg --files` or `find` for discovery
- `rg` for exact scope checks
- `git status --short` for tree state
- `git diff -- <path>` for review evidence

## Placement rule

If a result is disposable, keep it in `artifacts/`. If another operator should reuse it later, give it a durable home and explicit contract.

## Evidence rule

Before claiming completion, gather:

- inspected paths
- changed paths
- diff evidence for protected files
- the validation command that shows the result still fits its scope
