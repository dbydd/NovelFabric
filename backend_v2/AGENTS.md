# AGENTS.md

> NovelFabric V4 backend workspace handoff. This directory is the staging area for the workspace-style backend before it replaces or absorbs pieces of the current `backend/` tree.

## 1. Phase Position

`backend_v2/` targets the V4 direction:

- NovelFabric projects must be directly operable by pi / Hermes style coding agents.
- Character scheduling and role reasoning are no longer owned by the backend runtime.
- Backend responsibilities shrink to text-first workspace management, protected file operations, deterministic simulation/state primitives, reports, indexes, and small CLI tools.
- LLM provider adaptation in the backend is deprecated. CLI users should invoke their own agent client; web users should go through the pi agent SDK boundary.
- Templates and workspace defaults live in the XDG config directory, normally `~/.config/novelfabric`. Environment variables are fallback-only overrides.

## 2. Read Before Implementing

From the repository root, read these before editing this directory:

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `AGENTS.md`
7. `backend_v2/novelfabric_v2backend_workspace_style_backend.md`
8. `backend_v2/novelfabric_v2backend_workspace_style_backend.zh.md` if it exists

When changing StoryGraph / StoryRAG / StorySwarm / ReportAgent semantics, also read and update the relevant files under `docs/architecture/`.

## 3. Hard Constraints

- Keep Rust as the backend implementation language.
- Keep all mutable project facts in auditable text or structured files.
- Do not introduce a database as the only source of truth.
- Do not give NovelFabric-managed character agents implicit shell, arbitrary network, or arbitrary path access.
- Prefer minimal CLI executables with JSON/JSONL or Markdown IO over a large opaque service API.
- CLI tools must be safe for external agents to call repeatedly and must produce machine-readable status/error output.
- Do not extend the deprecated backend LLM adapter path unless the V4 planning document explicitly reopens that scope.
- Do not break the current external swarm HTTP/MCP API shape. Existing Hermes/OpenAlice/TraderAlice profiles may depend on it.

## 4. Workspace Harness Patterns To Preserve

V4 should absorb the proven workspace patterns from OpenAlice, autogal/RPG-Harness, and Auto-PPT:

- Treat a workspace as the capability boundary. Add new capability through a template, skill, satellite workspace, or CLI primitive before adding core runtime complexity.
- Keep the engine small and deterministic. Core code should validate, transform state, rebuild indexes, render reports, and apply audited writes; it should not perform open-ended role reasoning.
- Make content authoring file-native. Prefer one durable asset per file or a small fixed file set, with explicit order/visibility/config manifests.
- Provide headless loops for agents: read-state command, single-step command, validation command, fixture/test command, and artifact/report command.
- Keep the write path singular and auditable. If state changes, it must flow through the protected CLI/library primitive, not ad hoc filesystem edits.
- Separate content loops from visual/product loops. Text/content edits should be verified by headless CLI output; layout/export/browser surfaces need their own explicit verification route.
- Keep AGENTS/SKILL/docs in sync with harness changes. A changed CLI contract, template layout, config format, or skill schema must update the relevant agent-facing docs in the same change.

## 5. API Compatibility And Authorization

- Treat external swarm inference as a frozen V4 compatibility surface: REST endpoints, MCP tools, response fields, artifact path semantics, idempotency, and `structuredContent` shape must remain compatible.
- Before replacing old swarm internals, add or preserve golden fixture tests for serializer output, HTTP `POST`/`GET`, MCP `tools/list`, and MCP `tools/call`.
- Prefer one `novelfabric` CLI with capability-scoped subcommands over many unrelated binaries. Subcommands should be thin wrappers over shared Rust services.
- Skill-facing commands should stay coarse and stable: `context-pack`, `recall`, `propose-action`, `append-turn`, `validate`, `report`, `workspace doctor`.
- Implement authorization through a workspace capability manifest, not by scattering ad hoc checks in skills. Planned capabilities include `project.manage`, `knowledge.rebuild`, `swarm.run`, `external_swarm.run`, `memory.recall`, `memory.write_own`, `memory.propose_shared`, and `files.patch_allowed`.
- Main-agent capabilities and role-agent capabilities must be separate. Role agents are deny-by-default for project management, external swarm, global knowledge rebuilds, protected files, and other profiles' private memory.
- Memory recall must resolve actor/profile/card identity. Calling recall inside a workspace may infer the project, but must not infer permission to read every profile's memory.

## 6. Verification Expectations

For planning-only changes, state clearly that no runtime code was implemented.

For Rust implementation changes under this directory, run at minimum:

```bash
cargo fmt --manifest-path backend_v2/Cargo.toml --all --check
cargo test --manifest-path backend_v2/Cargo.toml -q
cargo clippy --manifest-path backend_v2/Cargo.toml --all-targets -- -D warnings
```

If `backend_v2` has not yet been initialized as a Cargo crate, verify by checking that documentation files exist and by reviewing their content.
