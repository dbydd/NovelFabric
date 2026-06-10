# V5 Rust Tool Surface

## Status

Active V5 minimal tool surface.

## Phase-one built-ins

Required built-ins under one binary entry:

- `new`
- `guard/apply`
- `pack`

Not required in phase one:

- `validate`
- internal adapter layers for MiroFish
- graph/rag/swarm/report tools

## Tool contracts

### `new/init`

Responsibilities:

- copy a built-in template into a target path
- apply simple key-value template substitutions
- rename text-targeted files/directories as needed
- initialize git
- create initial commit

### `guard/apply`

Responsibilities:

- mediate writes to template-declared `protectList`
- support relative paths and glob-based protection rules
- treat one apply as one commit transaction
- leave an automatic git commit after protected updates

The global system does not define a default protect list.
Templates decide.

### `pack`

Responsibilities:

- emit a single markdown context artifact
- gather selected files/ranges into one agent-readable output

Non-responsibilities:

- do not hardcode markdown chapter structure
- do not impose one universal presentation layout

Markdown organization should be delegated to:

- template constraints
- `AGENTS.md`
- subagent-local instructions

## CLI shape

Phase one prefers one binary entrypoint, with subcommands for the minimal built-ins.

## Early implementation bias

Phase-one implementation should prefer concentration over early abstraction.

Default bias:

- write the first complete logic in a small number of files
- avoid premature layer splitting
- split modules later only after the end-to-end behavior is stable

## Default sink policy

If something can be implemented as a skill, do not add it to the Rust surface by default.
