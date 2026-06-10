# AGENTS.md

Scope: `templates/` catalog only.

## Purpose

- This subtree defines and stores workspace templates.
- Changes here are template-contract changes, not ordinary content edits.

## Rules

- Edit a template only if the change improves its workspace harness behavior or directory semantics.
- Keep shared skill-stack expectations recognizable across templates unless a template-specific boundary requires a divergence.
- Do not sneak product/runtime/API assumptions into template text.
- If a rule is generic enough to fit every template unchanged, prefer the shared root docs or the common skill stack over template-local duplication.

## Stop conditions

- If a change weakens a template's directory contract, fail the gate.
- If a change makes two templates more similar without adding clarity, re-review before shipping.
