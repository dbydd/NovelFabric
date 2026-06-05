# AGENTS.md

> NovelFabric V4 mono app handoff. This directory is the active TypeScript staging area for the CLI-first mono app before it replaces or absorbs pieces of the current `backend/` and legacy separate frontend paths.

## 1. Phase Position

This directory is the V4 mono app direction after being renamed from the old `backend_v2/` staging path:

- NovelFabric projects must be directly operable by pi / Hermes style coding agents.
- Character scheduling and role reasoning are no longer owned by the backend runtime.
- Core responsibilities shrink to text-first workspace management, protected file operations, deterministic simulation/state primitives, reports, indexes, small CLI tools, and optional web surfaces in the same package.
- The optional web UI is started explicitly through CLI/web scripts and must remain layout-only until a CLI-backed bridge is implemented.
- LLM provider adaptation in the backend is deprecated. CLI users should invoke their own agent client; web users should go through a pi SDK/local bridge that still routes mutations through NovelFabric CLI primitives.
- Templates and workspace defaults live in the XDG config directory, normally `~/.config/novelfabric`. Environment variables are fallback-only overrides.
- Latest V4 construction direction for this directory is TypeScript. Older repository documents that describe a Rust `backend_v2` plan are historical planning inputs until they are migrated.

## 2. Read Before Implementing

From the repository root, read these before editing this directory:

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `AGENTS.md`
7. `novelfabric_v4_mono/novelfabric_v2backend_workspace_style_backend.md`
8. `novelfabric_v4_mono/novelfabric_v2backend_workspace_style_backend.zh.md` if it exists

When changing StoryGraph / StoryRAG / StorySwarm / ReportAgent semantics, also read and update the relevant files under `docs/architecture/`.

## 3. Hard Constraints

- Implement new mono app runtime/web/bridge code in TypeScript. Do not add Rust crates, Cargo workspaces, or Rust-only verification gates for this directory.
- Use Volta-managed Node/npm from the current environment. Do not pin a different local toolchain unless the user explicitly asks.
- Initialize programming support files with language tooling (`npm init`, `tsc --init`, package-manager install commands) before editing them.
- TypeScript must stay strict and explicit. Do not use `any`, `unknown`, wildcard type escapes, unchecked casts, lint suppression comments, or loose JavaScript patterns to bypass the type system.
- Keep all mutable project facts in auditable text or structured files. Do not introduce a database as the only source of truth.
- Do not give NovelFabric-managed character agents implicit shell, arbitrary network, or arbitrary path access.
- Prefer a single `novelfabric` CLI with capability-scoped subcommands and JSON/JSONL or Markdown IO over a large opaque service API.
- CLI tools must be safe for external agents to call repeatedly and must produce machine-readable status/error output.
- Do not extend the deprecated backend LLM adapter path unless the V4 planning document explicitly reopens that scope.
- Keep frontend code in this same package (`src/web/`) for the V4 mono app; do not create a separate frontend package for new V4 work.
- Layout-only web demos must use static/mock data and must not call backend APIs.
- The future `@earendil-works/pi-coding-agent` bridge must not bypass NovelFabric CLI/capability checks for protected writes.
- Do not break the current external swarm HTTP/MCP API shape. Existing Hermes/OpenAlice/TraderAlice profiles may depend on it.
- Do not add special-case fallback code to hide invalid state. Report validation failures clearly and let callers repair the input.
- Implement general workspace primitives rather than case-specific behavior for one fixture or one user path.

## 4. Config, Ports, And Runtime Environment

- New CLI commands must read configuration from `~/.config/novelfabric` by default. If `XDG_CONFIG_HOME` is present, resolve the config root as `$XDG_CONFIG_HOME/novelfabric`; otherwise use `$HOME/.config/novelfabric`.
- Environment variables are fallback-only for missing configuration values or explicit automation overrides. CLI flags are per-invocation overrides and must be visible in JSON diagnostics where relevant.
- If a command starts a server for testing or bridge work, never bind default occupied ports such as `3000`, `8080`, or an unspecified framework default. Use explicit `50000+` ports or an explicitly passed test port.
- Tests must not rely on hidden global state. When they need a home/config directory, provide an explicit temp HOME/XDG config root and assert the resolved path.

## 5. Workspace Harness Patterns To Preserve

V4 should absorb the proven workspace patterns from OpenAlice, autogal/RPG-Harness, and Auto-PPT:

- Treat a workspace as the capability boundary. Add new capability through a template, skill, satellite workspace, or CLI primitive before adding core runtime complexity.
- Keep the engine small and deterministic. Core code should validate, transform state, rebuild indexes, render reports, and apply audited writes; it should not perform open-ended role reasoning.
- Make content authoring file-native. Prefer one durable asset per file or a small fixed file set, with explicit order/visibility/config manifests.
- Raw source files for future book import/chapterization enter the workspace through `imports/source/`; later CLI/agent import primitives should read from that canonical inbox before producing chapters, cards, memory, or reports.
- Cards are organized by durable content type: `cards/characters/`, `cards/rules/`, `cards/scenes/`, and `cards/world/`. Scene/storyboard cards must not be hidden in UI-only data; if a manager references `cards/scenes/<name>.md`, the file manager must show that path.
- Workspace UI file trees must cover every demo-openable workspace path used by manager data, editor data, report artifacts, context packs, and protected scaffold files. Do not let manager cards link to paths that are invisible in the file manager.
- Provide headless loops for agents: read-state command, single-step command, validation command, fixture/test command, and artifact/report command.
- Keep the write path singular and auditable. If state changes, it must flow through the protected CLI/library primitive, not ad hoc filesystem edits.
- Separate content loops from visual/product loops. Text/content edits should be verified by headless CLI output; layout/export/browser surfaces need their own explicit verification route.
- Keep AGENTS/SKILL/docs in sync with harness changes. A changed CLI contract, template layout, config format, or skill schema must update the relevant agent-facing docs in the same change.

## 6. API Compatibility And Authorization

- Treat external swarm inference as a frozen V4 compatibility surface: REST endpoints, MCP tools, response fields, artifact path semantics, idempotency, and `structuredContent` shape must remain compatible.
- Before replacing old swarm internals, add or preserve golden fixture tests for serializer output, HTTP `POST`/`GET`, MCP `tools/list`, and MCP `tools/call`.
- Prefer one `novelfabric` CLI with capability-scoped subcommands over many unrelated binaries. Subcommands should be thin wrappers over shared TypeScript services.
- Skill-facing commands should stay coarse and stable: `context-pack`, `recall`, `propose-action`, `append-turn`, `validate`, `report`, `workspace doctor`, and capability-checked `files read` / `files write` for editor-grade workspace file operations.
- `files read` / `files write` must route through the shared TypeScript workspace file service, not ad hoc filesystem access. Writes require actor capability checks, safe path containment, protected-file policy, optional base-hash conflict detection, atomic replacement, and `.novelfabric/audit/files/*.jsonl` audit records.
- Implement authorization through a workspace capability manifest, not by scattering ad hoc checks in skills. Planned capabilities include `project.manage`, `knowledge.rebuild`, `swarm.run`, `external_swarm.run`, `memory.recall`, `memory.write_own`, `memory.propose_shared`, `files.write`, `files.patch_allowed`, and `files.patch_protected`.
- Main-agent capabilities and role-agent capabilities must be separate. Role agents are deny-by-default for project management, external swarm, global knowledge rebuilds, protected files, and other profiles' private memory.
- Memory recall must resolve actor/profile/card identity. Calling recall inside a workspace may infer the project, but must not infer permission to read every profile's memory.

## 7. Subagent, Testing, And Review Expectations

- Use planning, review, and verification subagents for multi-step implementation. The parent agent may implement code, but clean-context subagents should verify the behavior against this file and the V4 planning documents.
- Code-related tests should be designed or reviewed by a clean-context testing subagent before final acceptance. Do not rely on the same implementation pass to self-certify behavior.
- Continue hardening while reviewer or verifier agents identify actionable usability, correctness, typing, or contract issues.
- Do not use wording that implies a barely-usable target, and do not treat a thin skeleton as acceptable if known improvements remain for the current phase.

## 8. Verification Expectations

For planning-only changes, state clearly that no runtime code was implemented.

For TypeScript implementation changes under this directory, run at minimum:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

For optional web/layout changes, also run:

```bash
npm run web:build
npm run cli -- web demo --port 50021 --dry-run --json
```

For CLI-backed editor / web bridge changes, also run:

```bash
npm run cli -- files read --workspace fixtures/workspaces/valid-basic --path project.md --json
npm run cli -- web bridge --workspace fixtures/workspaces/valid-basic --port 50023 --actor main_agent --dry-run --json
```

When verifying real bridge writes, use a temporary copy of `fixtures/workspaces/valid-basic`; never write smoke-test edits directly into the canonical fixture.

For CLI behavior, also run direct smoke checks such as:

```bash
npm run cli -- config path --json
npm run cli -- workspace doctor --path fixtures/workspaces/valid-basic --json
```

Use explicit non-default ports for any future server or browser verification. If a phase changes contracts, update the relevant docs in the same phase.

## 9. Git Phase Rules

- Commit every coherent phase before continuing to the next phase so rollback remains available.
- Keep commits focused: contract update, workspace initialization, CLI foundation, workspace doctor, tests, hardening, and documentation sync should be separate when they are separate phases.
- Before each commit, inspect `git status --short` and avoid committing unrelated files.
