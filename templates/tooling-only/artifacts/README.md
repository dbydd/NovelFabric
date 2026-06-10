# Artifacts

Use `artifacts/` for disposable or derived output in this workspace.

## Belongs here

- run logs and captured command output
- one-off findings, comparisons, and audit notes
- generated output that can be recreated from a tool or protocol

## Does not belong here

- the only copy of a reusable script or config
- operator rules that should persist in harness files
- hidden source-of-truth for how a tool is supposed to behave

## Inspect first

Before writing here, confirm the result is derived or temporary. If another operator should reuse it as a tool, it belongs in `tools/` instead.
