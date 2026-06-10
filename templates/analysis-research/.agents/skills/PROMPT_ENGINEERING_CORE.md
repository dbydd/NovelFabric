# Prompt Engineering Core

Use this file as the `analysis-research` adapter layer, not as a replacement for generic prompt-engineering guidance.

## Required framing

For non-trivial analysis work, make the next action explicit in this order:

1. Goal
2. Files inspected as evidence
3. Exact target path
4. Evidence class: source, note, or artifact
5. Proposed action
6. Verification

## Do first

- Inspect supporting files before drafting any conclusion.
- Decide whether the new text belongs in `notes/` or `artifacts/` before writing.
- Preserve provenance when moving from source to note to artifact.
- If a durable rule should persist, write it into the workspace rather than hiding it in assistant prose.

## Do not

- write a claim before naming support files
- merge raw evidence and interpretation into one undifferentiated file
- present unresolved uncertainty as settled analysis
- drift into implementation work when the task is evidence handling or synthesis
