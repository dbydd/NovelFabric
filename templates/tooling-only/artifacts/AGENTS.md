# AGENTS.md

Scope: `templates/tooling-only/artifacts/`

## Purpose

- This subtree stores disposable output, audit residue, logs, and one-off findings.

## Rules

- Every artifact should reveal how it was generated and whether it can be regenerated.
- Artifacts may document tool behavior, but they may not become the only source of truth for a durable tool contract.
- If an artifact becomes repeatedly reused, promote the logic into `tools/` or harness files deliberately.

## Stop conditions

- A hidden reusable workflow buried here fails review.
- A disposable file misclassified as tooling must be reclassified before exit.
