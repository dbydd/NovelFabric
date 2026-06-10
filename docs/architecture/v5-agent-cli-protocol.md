# V5 Agent ⇄ CLI Protocol

## Status

Active V5 protocol for how agents are expected to use `novelfabric`.

## Core model

NovelFabric does **not** assume the CLI is an agent orchestrator.

The intended flow is:

1. enter a workspace
2. let the agent read local constraint files
3. let the agent decide what action is needed
4. let the agent call `novelfabric` as a tool

Typical posture:

```bash
cd workspace
pi
```

Then the agent reads:

- `AGENTS.md`
- `SOUL.md`
- `template.json`
- `.agents/skills/**`

and uses `novelfabric` as a low-level harness.

## Command roles

### `novelfabric new`

Use when the agent needs to instantiate a workspace from a built-in template.

### `novelfabric guard`

Use when the agent has already decided an exact protected patch and wants the CLI to:

- enforce protection rules
- refuse dirty-tree situations
- apply one exact replacement
- create one protected commit

The agent may supply `--message` when it has generated a commit message from local few-shot guidance.

### `novelfabric pack`

Use when the agent wants a single markdown artifact for a scope.

The agent chooses a scope label using local conventions and lets the CLI gather files into one sequential markdown output.

## Local protocol files

Templates may provide agent-facing protocol files under `.agents/skills/`, such as:

- `COMMIT_MESSAGE_FEWSHOT.md`
- `PACK_SCOPE_CONVENTIONS.md`

These files are for the **calling agent**.
They are not mandatory schema inputs to the CLI.

## Design rule

If a behavior can remain as text protocol plus agent choice, prefer that over adding new schema fields or hardcoded Rust logic.
