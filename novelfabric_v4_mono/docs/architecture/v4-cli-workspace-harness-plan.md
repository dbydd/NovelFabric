# NovelFabric V4 CLI Workspace Harness Plan

> Active V4 architecture plan. This document is the canonical replacement for the earlier fullstack/custom-provider workflow drafts.

## 1. Corrected Positioning

NovelFabric V4 is a **CLI-first text workspace harness** with an embedded **pi agent SDK runtime wrapper** for the mono app.

It is not a NovelFabric-owned OpenAI/Anthropic/provider backend. The mono app does, however, need to run LLM-backed tasks for nontechnical Web users. That runtime must be a controlled wrapper around pi agent SDK, with NovelFabric-owned config paths, extensions, tool policy, workspace guardrails, and audit.

```text
Web user / CLI user
  → NovelFabric mono app / novelfabric CLI
  → NovelFabric pi SDK runtime wrapper
  → NovelFabric skills / AGENTS / soul / capability text constraints
  → novelfabric CLI commands and custom pi tools
  → shared TypeScript workspace services
  → workspace files + audit
```

NovelFabric owns the workspace boundary: layout, CLI contracts, context packs, validation, protected writes, audit, derived indexes, reports, artifact manifests, and the safe pi runtime envelope. Open-ended semantic work is executed by pi agent SDK / Hermes under NovelFabric skills and capabilities.

## 2. Active Companion Documents

| Document                                             | Purpose                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `v4-cli-command-contract.md`                         | Detailed CLI command surface, JSON envelopes, error codes, capability names, runtime commands, and bridge mapping. |
| `v4-mono-frontend-plan.md` / `.zh.md`                | Current Web shell integration rules and UI behavior.                                                               |
| `../research/frontend-reference-study.md`            | UI/reference project lessons for the Web shell.                                                                    |
| root `AGENTS.md` and `novelfabric_v4_mono/AGENTS.md` | Binding agent-facing project constraints.                                                                          |

Historical documents that proposed a NovelFabric-owned provider registry or general LLM backend have been removed or merged here. Do not revive `src/llm/provider.ts` or a separate NovelFabric model/provider stack as the V4 mainline.

## 3. Non-Negotiable Principles

1. **CLI before Web** — Every meaningful operation must have a `novelfabric` CLI shape before it is exposed as a Web control.
2. **Mono app wraps pi SDK** — Web users should not configure or operate raw pi/bash. The mono app provides a controlled pi SDK runtime using NovelFabric config, extensions, tool allowlists, and audit.
3. **NovelFabric config owns the wrapped runtime** — The mono app must redirect pi runtime state/config for NovelFabric sessions into `XDG_CONFIG_HOME/novelfabric` or `$HOME/.config/novelfabric`, not silently depend on a user’s regular global pi environment.
4. **No raw dangerous tools for nontechnical Web users** — Web-initiated agent sessions must not expose unrestricted `bash`, raw `write`, raw `edit`, arbitrary network, or arbitrary path access. Use NovelFabric custom tools/extensions that call CLI primitives.
5. **Files are truth** — Markdown / JSON / JSONL / TOML workspace files remain canonical. Graphs, RAG indexes, reports, and job state are derived or auditable artifacts.
6. **One write path** — Durable writes route through shared workspace services with safe path checks, capability checks, protected path policy, conflict detection, atomic writes, and audit.
7. **Skills before code branches** — If behavior can be expressed as an agent instruction, skill, role profile, soul, or capability rule, prefer text constraints over hidden TypeScript control flow.
8. **Proposal before apply** — Agent outputs become proposals or task artifacts first. CLI validators decide whether they can be applied to canonical files.
9. **Derived indexes only** — StoryGraph / StoryRAG artifacts can always be rebuilt from workspace source files.
10. **No fixture branches** — No logic may special-case `test_novel.txt` or any acceptance fixture.
11. **Frozen external swarm compatibility** — Existing REST/MCP shape remains compatible; new capabilities must be additive or versioned.
12. **Browser acceptance uses controls only** — Playwright may click UI and inspect visible artifacts, but must not use browser console or direct API calls to bypass UI flows.

## 4. NovelFabric pi Runtime Envelope

The mono app runtime is allowed and required to run LLM-backed tasks, but only inside this envelope:

```text
NovelFabric runtime config root
  → bundled/approved pi settings
  → NovelFabric pi extensions
  → sandbox / permission gate / CLI-only write tools
  → pi AgentSession
  → task package + skills
  → validated proposals
  → CLI apply
```

### Config paths

Use NovelFabric-owned config roots:

```text
$XDG_CONFIG_HOME/novelfabric/pi/
$XDG_CONFIG_HOME/novelfabric/pi/settings.json
$XDG_CONFIG_HOME/novelfabric/pi/extensions/
$XDG_CONFIG_HOME/novelfabric/pi/skills/
$XDG_CONFIG_HOME/novelfabric/pi/prompts/
```

If `XDG_CONFIG_HOME` is absent, resolve under:

```text
$HOME/.config/novelfabric/pi/
```

Project/workspace-local overlays may live under:

```text
<workspace>/.novelfabric/pi/
<workspace>/.pi/skills/
<workspace>/.pi/prompts/
```

The wrapped runtime may read the user’s global pi auth/model configuration only through explicit user opt-in or documented import/migration. NovelFabric-specific extensions and permissions should come from NovelFabric config, not the user’s normal pi agent setup.

### Model roles

NovelFabric runtime settings split workflow and acceptance models deliberately:

- `modelDefaults` / `novelFabricWorkflowModel` should point to `generic-writer`. This model drives real NovelFabric LLM workflow stages such as semantic import, writing, role reasoning, and report tasks.
- `testModelDefaults` / `novelFabricTestModel` should point to `flash-vibe`. This model is test-only and is used by hard acceptance gates to verify that workflow data is actually processed by an LLM agent.

Do not use `flash-vibe` as the default product workflow model. Do not let hard pi tests skip when these model settings or credentials are absent; missing runtime configuration is a failing state.

### Required runtime extensions

The wrapped runtime should support NovelFabric-provided pi extensions such as:

- sandbox / path guard;
- permission gate;
- `novelfabric_read_file`;
- `novelfabric_write_file`;
- `novelfabric_context_pack`;
- `novelfabric_validate`;
- `novelfabric_apply_proposal`;
- `novelfabric_report`.

These extensions call `novelfabric` CLI/shared services internally. They do not perform ad hoc filesystem writes.

### Tool policy

For Web-initiated sessions:

- default deny raw `bash`, raw `write`, raw `edit`;
- allow read/search tools only within workspace scope;
- expose mutations through NovelFabric custom tools or CLI commands;
- require actor/capability binding per task;
- record session id, task id, allowed tools, extensions, artifacts, and audit paths.

CLI power users may invoke their own external pi/Hermes agent, but any durable NovelFabric project mutation still has to pass through NovelFabric CLI primitives if it is to be treated as valid workspace state.

## 5. Reference Project Lessons Consolidated

### OpenAlice

Absorb:

- workspace as the capability boundary;
- template materialization and context injection;
- external agent runtime / pi adapter rather than provider ownership;
- skills as runtime contracts;
- inbox/artifact pushback for user review.

Avoid:

- turning NovelFabric into a generic PTY/session manager;
- copying AGPL code or trading-specific concepts.

### autogal / RPG-Harness

Absorb:

- “project is a folder”;
- CLI as the primary runtime;
- `peek` / `step` / `test` style headless loops;
- session state plus JSONL trace;
- one deterministic write path;
- fixture-driven business acceptance.

Avoid copying game engine DSLs or GalGame-specific mechanics.

### Auto-PPT

Absorb:

- one durable artifact per file or fixed file set;
- manifest controls order/visibility/status;
- `SKILL.md` as harness contract;
- content loop separated from visual/browser loop;
- headless CLI as semantic truth and browser as inspection surface.

Avoid copying PPT/React implementation patterns into the novel workspace core.

## 6. Target Workspace Model

A NovelFabric workspace should materialize and validate a layout like:

```text
project.md
project.json
AGENTS.md
.novelfabric/
  capabilities.toml
  manifests/
  tasks/
  proposals/
  audit/
  pi/
agents/<agent-id>/
  profile.json
  soul.md
  memory.md
  skills/*.md
imports/source/
imports/normalized/
imports/chunks/
cards/characters/
cards/scenes/
cards/world/
cards/rules/
knowledge/
memory/
simulation/
reports/
writing/chapters/
timeline/
```

This layout is a target contract. Implementation should grow command-by-command, with validators and fixtures preceding Web UI dependencies.

## 7. Target CLI Families

The detailed command surface lives in `v4-cli-command-contract.md`. The high-level families are:

```text
workspace / project
files
runtime / pi SDK
agents / skills
agent task
import / chapterize
cards / memory
knowledge / recall / context-pack
simulation / swarm
report / writing
workflow wrapper
external-swarm compatibility
```

The key rule is that Web bridge routes are adapters over these command/service families, not a separate business runtime.

## 8. Testing Gate Before More Surface Area

The current command surface is broad enough that future work must be test-led. Do not keep adding command families until the existing families have honest acceptance coverage.

Required gates:

- service tests for every shared workspace primitive;
- CLI tests for every command family with JSON envelope and failure behavior;
- workflow state tests that distinguish deterministic harness completion from pi-backed semantic completion;
- runtime policy tests proving NovelFabric-owned pi config roots and Web-safe tool denial;
- pending contract tests for unavailable real pi/Web business loops, kept visible until implemented;
- Playwright-only browser tests for Web surfaces, without console or direct API bypass.

The active QA contract is `../qa/v4-full-usability-acceptance.md`. A feature may be described as harness-complete only when deterministic CLI tests pass; it may be described as business-complete only when pi runtime evidence and browser/control evidence satisfy that QA contract.

## 9. pi Agent SDK Task Model

Recommended task package:

```text
.novelfabric/tasks/<task-id>/
  task.md
  input.json
  context-pack.json
  allowed-commands.md
  output.schema.json
  result.json
  events.jsonl
```

Agent execution flow:

```text
novelfabric context-pack / task create
  → NovelFabric pi SDK runtime wrapper
  → pi AgentSession with NovelFabric config/extensions/skills
  → agent reads allowed workspace context
  → agent outputs structured proposal/result
  → novelfabric validate
  → novelfabric domain apply / files write
  → audit + artifact manifest refresh
```

## 10. Skill / Agent Text Assets

Recommended skill families:

```text
novelfabric-import-book
novelfabric-card-extraction
novelfabric-character-turn
novelfabric-kp-adjudicate
novelfabric-world-update
novelfabric-project-audit
novelfabric-storyswarm-round
novelfabric-report-agent
novelfabric-author-draft
novelfabric-review-check
novelfabric-timeline-branch-proposal
```

Each skill should define:

- trigger condition and required inputs;
- allowed CLI/custom tool commands;
- readable file scope;
- writable proposal/apply paths;
- required output schema;
- citation/evidence requirements;
- validation commands to run before declaring success;
- forbidden shortcuts, including direct filesystem writes and fixture-specific logic.

## 11. Active Gap Plan And Test-First Gate

The completed pi-backed semantic evidence loop is archived in `archive/v4-pi-evidence-loop-archive.md`; completed domain artifact materialization is archived in `archive/v4-domain-artifact-materialization-archive.md`; completed opt-in SDK AgentSession execution is archived in `archive/v4-sdk-agent-session-opt-in-archive.md`; completed Web-safe read-only SDK tools foundation is archived in `archive/v4-web-safe-sdk-tools-foundation-archive.md`; completed Web-safe mutation tools foundation is archived in `archive/v4-web-safe-mutation-tools-foundation-archive.md`; completed structured event stream foundation is archived in `archive/v4-structured-event-stream-foundation-archive.md`; completed async Web bridge run registry + persistent SSE foundation is archived in `archive/v4-async-sse-foundation-archive.md`. Do not keep re-litigating completed hardening, materialization, opt-in SDK execution, SDK tool foundation, mutation tool foundation, structured event stream foundation, or async/SSE bridge foundation details in the active plan. This section tracks only the gaps still blocking a complete product/business loop.

### 11.1 Active Gaps In Priority Order

| Priority | Gap                                                                  | Required output                                                                                                                                                                          | Minimum test standard                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Browser runtime UI + Web workflow orchestration + Playwright UI gate | Browser-facing runtime UI consumes the archived async/SSE foundation, exposes start/status/stream/cancel/retry controls, renders denial/evidence events, and orchestrates workflow jobs. | Playwright tests use UI controls only, 50000+ ports, no console/API shortcuts, visible live updates, bounded/redacted rendering, no internal path/session leakage, and final artifact checks.    |
| 2        | Semantic import/materialization                                      | Source text becomes chapters, character/world/rule cards, timeline, memory, and context packs through pi-backed outputs with reversible apply.                                           | Acceptance tests use at least two source fixtures; generated assets must cite source excerpts, pass content-quality checks, and avoid fixture-specific hardcoding.                               |
| 3        | External swarm REST/MCP adapters                                     | Frozen external swarm REST/MCP endpoints/tools call shared TypeScript services and preserve existing request/response/idempotency/artifact semantics.                                    | Golden fixture tests cover REST POST/GET and MCP tools/list/tools/call, including Hermes/OpenAlice/TraderAlice-style payloads.                                                                   |
| 4        | Domain-specific capabilities                                         | Cards/memory/swarm/report/writing commands use narrow capability names instead of broad project/file write authority.                                                                    | Capability tests prove main agent can perform approved domain operations, role agents are denied cross-domain/protected operations, and audit records include actor/capability/reason/path/hash. |

### 11.2 Global Testing Policy

- deterministic harness tests must pass in CI;
- `npm run test:pi-acceptance` is a hard content gate and must fail, not skip, when NovelFabric pi config or LLM credentials are unavailable;
- true pi/Web acceptance tests should exist as pending contract tests until implemented;
- no deterministic shell may be described as semantic business success without completed pi runtime evidence and content validation;
- `workflow verify` must keep requiring both validated pi task evidence and corresponding domain artifact evidence for pi-task stages; this completed materialization requirement is archived, not removed.

## 12. Implementation Phases

### Phase 1 — CLI Contract And Test Freeze

- Keep `v4-cli-command-contract.md` current.
- Ensure existing `config`, `workspace`, `files`, and `web` commands remain stable.
- Add or change commands only with service tests, CLI tests, and QA contract status updates.
- Treat deterministic shells as harness progress, not semantic business success.

### Phase 2 — Runtime Config / Extension Envelope

- Add `runtime doctor/config/materialize` commands for NovelFabric-owned pi config.
- Materialize default pi settings, extensions, skills, and prompts under NovelFabric config roots.
- Define Web-safe tool policies that block raw bash/write/edit for nontechnical sessions.

### Phase 3 — Agent / Skill Materialization

- Materialize default agents and skills from XDG templates.
- Add `agents list/inspect/materialize/validate` and `skills list/read/validate`.
- Expand capability manifest templates for main/system/role agents.

### Phase 4 — Import / Chapterize CLI

- Add inbox, normalize, chunk, chapterize, context-pack, validate.
- Deterministic stages do not call provider APIs directly.
- Semantic extraction is pi skill output validated/applied by CLI.

### Phase 5 — Proposal / Apply Model

- Cards, memory, simulation, reports, and chapters use proposal → validate → apply.
- All apply commands use shared write services and audit.

### Phase 6 — StoryGraph / StoryRAG CLI

- Rebuild derived `knowledge/` artifacts from source files.
- Provide search/context-pack commands with file paths, excerpts, entity/relation metadata, and timeline information where available.

### Phase 7 — Simulation / StorySwarm CLI

- Add session state, context packs, turn append, validation, swarm plan/task/output/finalize.
- Default round order remains `characters → random-event → world-maintainer → kp → project-auditor`.
- Agent reasoning comes from pi skills; CLI applies only validated outputs.

### Phase 8 — Report / Writing CLI

- Add report task/validate/apply/list/show.
- Add writing context-pack, draft task, apply-draft, review, export.
- Chapters must cite accepted artifacts and pass validation before apply.

### Phase 9 — Web-Safe pi SDK Runtime Bridge

- Build on the archived opt-in `agent run --runtime pi-sdk` AgentSession path, archived Web-safe SDK tools foundations, archived mutation tools foundation, archived structured event stream foundation, and archived async/SSE bridge foundation rather than treating SDK execution, tool coverage, event shaping, or stream delivery as absent.
- Implement browser runtime UI state, visible event rendering, cancellation/retry controls, and Web workflow orchestration over the existing sanitized SSE/evidence envelope.
- Preserve the existing `agent task create/inspect/run/output validate/status/abort` command contract while routing Web sessions through SDK-backed evidence envelopes.
- Record session/task evidence without owning a separate provider stack or exposing raw dangerous tools to Web users.

### Phase 10 — Web Shell Rewire

- Replace template-only business paths with CLI-backed workflow/task calls that consume the archived SSE stream through visible controls.
- Display job stage, evidence, artifacts, validation errors, audit paths, runtime policy, and retry controls.
- Add Playwright UI-only acceptance for start/status/stream/cancel/retry and final domain artifact visibility before claiming Web workflow completion.

### Phase 11 — End-to-End Acceptance

- One full browser-controlled run with `test_novel.txt`.
- One full browser-controlled run with a different source fixture.
- Ten-loop browser run with pi-backed semantic evidence.
- No browser console, no direct API bypass, no fixture-specific code.

## 13. Success Criteria

A future business-flow test is successful only if:

- semantic work was executed by the NovelFabric pi SDK runtime wrapper under NovelFabric skills;
- raw dangerous tools were not exposed to nontechnical Web sessions;
- cards, context packs, role actions, swarm outputs, reports, and chapter drafts are real artifacts, not UI templates;
- every applied write went through `novelfabric` CLI/shared services;
- all key outputs cite workspace evidence;
- capability/protected path rules were enforced;
- Web controls only orchestrated CLI-backed operations.

## 14. Explicit Non-Goals

- No NovelFabric-owned OpenAI/Anthropic provider layer as V4 mainline.
- No dependence on a user’s ordinary global pi extension set for mono app safety.
- No hidden database as the sole truth source.
- No role agent default shell/network/arbitrary path access.
- No Web-only business generation path.
- No copied reference-project implementation code.
- No breaking changes to frozen external swarm REST/MCP shape.
