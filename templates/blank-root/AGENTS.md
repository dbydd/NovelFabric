# AGENTS.md

This is the `blank-root` template for a low-assumption standalone workspace.

## Hard boundary

- This workspace is a harness, not a product app, WebUI, backend, runtime, API surface, or internal swarm.
- Root-first is the default. Extra structure must earn its existence.
- If the task can be completed by tightening one root file or one local skill, do that before creating directories, scripts, or scaffolding.

## Before acting

1. Read `AGENTS.md`, `SOUL.md`, and `template.json`.
2. Read `.agents/skills/README.md`, then only the skill files that own the current stage.
3. Classify the task as one of: `harness`, `docs`, `analysis`, `scripts`, or `materialization`.
4. Name the exact write surface before editing.

## Root-growth gate

- Trigger: you want a new top-level directory. Scope: root layout. Required action: state artifact type, owner, regeneration path, and why root is no longer sufficient. Forbidden shortcut: pre-scaffolding `src/`, `docs/`, `scripts/`, `data/`, `research/`, or `ops/` from habit. Verification: if you cannot defend the new directory in one sentence, fail the gate and stay at root.
- Trigger: the workspace shape starts to drift toward a domain-specific template. Scope: structure decisions. Required action: stop the line and either tighten root rules or explicitly choose a different template. Forbidden shortcut: quietly turning `blank-root` into a weak version of another template.

## Protected surfaces

- Protected paths are declared by `template.json`; the root harness files and `.agents/skills/**` are always high-pressure surfaces.
- For protected edits, inspect the current file first, keep the diff single-purpose, and make intent visible in the diff and commit subject.
- If the policy change cannot be explained plainly, rollback and restate it before touching the file again.

## Rejection rules

- Hidden assumptions in file names, directory layout, or prompt rules fail review.
- Generic motivational wording without an operating consequence gets rejected or rewritten.
- New persistent rules that live only in assistant prose do not ship; write them into files or drop them.

## Completion evidence

Before claiming completion, show:
- changed file paths
- why they were the smallest correct scope
- diff or commit evidence for protected files
- what remains unverified, if anything
