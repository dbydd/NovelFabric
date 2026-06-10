# AGENTS.md

Scope: `templates/tooling-only/.agents/`

## Purpose

- This subtree governs operator-facing protocol, tool admission rules, and rollback discipline.

## Rules

- Protocol here must reduce ambiguity around reusable tools vs disposable artifacts.
- If a rule affects durable tooling behavior, it must strengthen owner, I/O, smoke-test, or rollback clarity.
- Do not let this subtree turn into a mini platform spec.

## Stop conditions

- A protocol that normalizes vague automation is rejected.
- A rule that widens product/runtime drift under the banner of tooling fails the gate.
