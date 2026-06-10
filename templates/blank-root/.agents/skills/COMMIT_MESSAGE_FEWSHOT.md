# Commit Message Fewshot

Use this contract when protected control files change in `WORKSPACE_NAME`.

## Trigger

Apply when the diff touches `AGENTS.md`, `SOUL.md`, `template.json`, or `.agents/skills/**`.

## Required shape

Subject:
- `<area>: <intent>`

Body blocks, in order:
- `Trigger:` what caused the change now
- `Scope:` exact files or rule surfaces changed
- `Evidence:` what was read, observed, or requested
- `Verify:` commands run and observed result

## Subject rules

Required action:
- keep `<area>` concrete: `root`, `skills`, `template`, `docs`, or a real path cluster;
- keep `<intent>` action-oriented and specific.

Forbidden shortcut:
- do not use subjects like `update files`, `misc cleanup`, `tweak prompts`, or `fix stuff`.

## Few-shot example A

Subject:
- `template: tighten blank-root protected surfaces`

Body:
- `Trigger: the blank-root template needed an explicit audit boundary for control files.`
- `Scope: templates/blank-root/AGENTS.md templates/blank-root/template.json templates/blank-root/.agents/skills/COMMIT_MESSAGE_FEWSHOT.md`
- `Evidence: the workspace is a root-first harness and protected text must stay reviewable.`
- `Verify: reviewed protected-path diffs and parsed template.json successfully.`

## Few-shot example B

Subject:
- `skills: narrow context-pack scope rules`

Body:
- `Trigger: oversized packs were encouraging vague workspace-wide assumptions.`
- `Scope: templates/blank-root/.agents/skills/CONTEXT_PACKING_GUIDE.md templates/blank-root/.agents/skills/PACK_SCOPE_CONVENTIONS.md`
- `Evidence: blank-root must stay minimal but specific, with named boundaries instead of broad summaries.`
- `Verify: inspected rendered diffs and confirmed the target file set stayed unchanged.`

## Verification

A good commit message lets a reviewer predict the diff before opening it.
