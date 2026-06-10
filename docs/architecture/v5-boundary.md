# V5 Boundary

## Status

Active V5 architecture boundary document.

## Core boundary

NovelFabric V5 is a **workspace harness**, not a product runtime.

Built-in responsibility stops at:

- template instantiation
- protected mutation
- context packing
- git-backed reproducibility for protected files
- text-first workspace constraints via `AGENTS.md`, `SOUL.md`, and skills

## Explicit non-goals

V5 current scope excludes:

- WebUI
- front/back separated application shell
- NovelFabric-owned long-running runtime
- internal StorySwarm loop
- internal StoryGraph / StoryRAG / ReportAgent services
- legacy HTTP API / MCP compatibility carried over from V2/V4
- MiroFish as a product-core dependency

## MiroFish boundary

MiroFish is not part of the phase-one core.

If introduced later, it should be:

- external
- skill-oriented
- subordinate to workspace constraints
- optional rather than required for core operation

## Build-vs-skill rule

Default policy:

- if a capability can live as a skill, prefer skill
- only sink it into Rust when it is a stable, low-level, reusable primitive

## Reproducibility rule

Every template instance must be a git repository.

Any update touching template-declared `protectList` entries must:

- go through protected mutation flow
- end with an automatic commit per apply transaction
- remain auditable and revertible
