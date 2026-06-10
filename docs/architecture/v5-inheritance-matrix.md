# V5 Inheritance Matrix

## Status

Active V5 inheritance / deprecation matrix.

## Fully adopted in V5

- text-first source of truth
- file-first auditable workflows
- constrained agent behavior through explicit text instructions
- heavy use of skills instead of overbuilding runtime code
- git-backed reversibility for important mutations

## Adopted with reinterpretation

- workspace-first pattern
  - kept, but narrowed to single-template single-workspace default
- agent role shaping through soul/skills
  - kept, but moved even more strongly into template-local text constraints
- external capability integration
  - kept only as optional skill-oriented attachment points

## Explicitly not inherited from V2/V4

- WebUI as product core
- front/back separated app architecture
- NovelFabric-owned StorySwarm runtime
- internal StoryGraph / StoryRAG / ReportAgent implementation as current core
- legacy HTTP API compatibility
- legacy MCP / external swarm compatibility promises
- default multi-project manager root model

## Historical-only references

The following remain useful as historical inputs, not active commitments:

- `archived_docs/PRODUCT_SPEC.md`
- `archived_docs/PRODUCT_SPEC_2.md`
- `archived_docs/docs/architecture/story-swarm-runtime.md`
- `archived_docs/docs/architecture/story-graph-rag.md`
- `archived_docs/docs/architecture/implementation-roadmap-story-systems.md`
- `archived_docs/docs/architecture/v4-*.md`
- `archived_docs/docs/architecture/external-swarm-*.md`

## Current interpretation rule

When old documents conflict with any `docs/architecture/v5-*.md` file or root-level active document, the V5 active document wins.
