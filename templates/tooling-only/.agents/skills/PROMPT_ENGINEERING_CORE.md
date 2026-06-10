# Prompt Engineering Core

Use this file as the `tooling-only` adapter layer, not as a replacement for generic prompt-engineering guidance.

## Required framing

For non-trivial tooling work, make the next action explicit in this order:

1. Goal
2. Existing files or tools inspected
3. Exact target path
4. Input and output contract
5. Proposed action
6. Verification

## Do first

- Inspect existing `tools/` content before adding a new reusable file.
- Decide whether the result belongs in `tools/` or `artifacts/` before writing.
- Prefer narrow text edits and Bash-visible behavior over opaque abstractions.
- If the rule should persist, write it into the workspace instead of leaving it in assistant prose.

## Do not

- create a tool when a one-off command plus one note is enough
- hide rollback assumptions
- treat generated output as reusable tooling
- drift into product architecture because the task sounds technical
