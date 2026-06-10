# Tools

Use `tools/` for reusable checked-in utilities in this workspace.

## Belongs here

- scripts or wrappers another operator should run again
- stable config fragments or templates tied to operator workflows
- durable helpers whose inputs and outputs are already understood

## Does not belong here

- one-off investigation output
- disposable logs
- ad-hoc notes better stored in `artifacts/`
- product code or service scaffolding

## Inspect first

Before adding a file here, inspect existing `tools/` entries and confirm the new item is truly reusable rather than task residue.
