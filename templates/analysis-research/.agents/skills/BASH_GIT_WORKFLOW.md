# Bash + Git Workflow

`analysis-research` assumes normal work can be completed with Bash, Git, and text edits.

## Default loop

1. Inspect the relevant `sources/`, `notes/`, `artifacts/`, and harness files.
2. Edit the minimum necessary text.
3. Review the file and then the diff.
4. Run the smallest command that proves the result is still in the right directory and retains its support chain.
5. If protected files changed, keep the audit trail clean and single-purpose.

## Preferred command classes

- `rg --files` or `find` for discovery
- `rg` for exact evidence-path checks
- `git status --short` for tree state
- `git diff -- <path>` for review evidence

## Provenance rule

If a sentence depends on named support files, keep those paths recoverable in the note or artifact instead of hiding them in memory.

## Evidence rule

Before claiming completion, gather:

- inspected support paths
- changed paths
- diff evidence for protected files
- the validation command that shows the result still fits its evidence class
