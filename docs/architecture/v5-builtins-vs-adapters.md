# V5 Built-ins vs Adapters

## Status

Active V5 boundary split for built-ins, skills, and external adapters.

## Decision rule

When deciding where a capability should live, use this priority order:

1. text constraint in `AGENTS.md` / `SOUL.md`
2. local or reusable skill
3. Rust built-in primitive
4. external adapter

Do not invert this order without a clear reason.

## Built-ins in phase one

These belong in the product core:

- `new/init`
- `guard/apply`
- `pack`
- `template.json` loading
- git-backed protected mutation flow

Why:

- they are low-level primitives
- multiple templates depend on them
- they define the harness boundary itself

## Skills in phase one

These should default to skills instead of Rust built-ins:

- workspace management helpers beyond the minimal core
- template-specific authoring workflows
- markdown shaping for `pack` outputs
- role prompts and local role-specific operations
- future user-template convenience flows

Why:

- they vary by template or role
- they are mostly policy, not primitive infrastructure
- they should remain editable as text

## Agent/CLI relation

The intended execution model is:

- the agent reads workspace-local constraints and skills
- the agent runs inside the workspace (for example: `cd workspace && pi`)
- the agent calls `novelfabric` as a tool
- `novelfabric` does not act as an agent orchestrator that shells out to another agent by default

## External adapters in phase one

These are outside the current product core:

- MiroFish integration
- any remote inference service coupling
- any MCP compatibility bridge carried over from V2/V4
- any future browser shell or code-server-like wrapper

Why:

- they are optional attachments
- they should not determine the V5 core shape
- they may carry different operational and compatibility risks

## Anti-overbuild rule

Do not move something from skill or adapter into Rust just because it is useful.
Move it only if all are true:

- multiple templates need it
- behavior should be stable across templates
- text-only constraints are insufficient
- it is infrastructural rather than domain-specific
