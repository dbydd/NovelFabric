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
- acceptance contract tests that either prove archived completed foundations or explicitly name any newly opened gap;
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

Completed pi-evidence hardening is archived in `archive/v4-pi-evidence-loop-archive.md`; completed domain artifact materialization is archived in `archive/v4-domain-artifact-materialization-archive.md`; completed opt-in SDK AgentSession execution is archived in `archive/v4-sdk-agent-session-opt-in-archive.md`; completed Web-safe read-only SDK tools foundation is archived in `archive/v4-web-safe-sdk-tools-foundation-archive.md`; completed Web-safe mutation tools foundation is archived in `archive/v4-web-safe-mutation-tools-foundation-archive.md`; completed structured event stream foundation is archived in `archive/v4-structured-event-stream-foundation-archive.md`; completed async Web bridge run registry + persistent SSE foundation is archived in `archive/v4-async-sse-foundation-archive.md`; completed browser runtime task UI foundation is archived in `archive/v4-browser-runtime-task-ui-foundation-archive.md`; completed Web workflow orchestration + Playwright UI-only acceptance is archived in `archive/v4-web-workflow-orchestration-archive.md`; completed semantic import/materialization is archived in `archive/v4-semantic-import-archive.md`; completed external swarm REST/MCP adapters are archived in `archive/v4-external-swarm-adapters-archive.md`; completed domain-specific capabilities are archived in `archive/v4-domain-capabilities-archive.md`.

Do not keep re-litigating archived work in the active plan. The prior next-iteration ledger is closed: Web workflow orchestration, semantic import/materialization, external swarm REST/MCP adapters, and domain-specific capabilities have all reached their documented test standards.

### 11.1 Active Gap Ledger

There are currently **no open gaps from the previous V4 next-iteration ledger**. However, the latest `test_novel.txt` real-path run reopened a fresh business-completeness gap: the workflow spine and pi-backed domain artifacts succeeded, but canonical project resources were incomplete. New work must create a fresh gap entry before implementation, including:

- the affected CLI/Web/runtime families;
- expected workspace artifacts and audit/evidence paths;
- acceptance tests that validate content, not only file existence;
- reviewer/verifier criteria for archiving the gap once complete.

## 12. Fresh Active Gap: Canonical Project Resource Materialization

Fresh active gap opened after the 2026-06-08 `test_novel.txt` real-path run.

- **Gap name:** Canonical project resource materialization and validation.
- **Observable failure:** workflow completed 15/15 and produced semantic import, card proposal, knowledge indexes, swarm/report/writing artifacts, but canonical workspace directories remained incomplete. `cards/rules`, `cards/scenes`, and `cards/world` were empty; `memory/**`, `timeline/branches`, `simulation/turns`, `simulation/logs`, and `writing/chapters` were empty or incomplete; the single applied character card used a generic role-title card (`aria Source Card`) instead of protagonist-backed extracted character content.
- **Canonical gap document:** `docs/architecture/v4-canonical-resource-materialization-gap.md`
- **Acceptance tests required before closing:**
  1. a real-path test proves that a novel import produces `cards/characters`, `cards/rules`, `cards/scenes`, and `cards/world` with substantive, source-cited content;
  2. semantic `cardSeeds` map to canonical card kinds instead of collapsing into one generic character card;
  3. memory artifacts are materialized for at least one of global/chapter/agent memory with source anchors;
  4. timeline artifacts are materialized from extracted events/chapters;
  5. simulation turns/logs evidence exists for completed simulation work;
  6. writing path proves draft → review/audit → canonical chapter apply, not only `writing/drafts`;
  7. `workflow verify` rejects missing canonical resource categories when semantic evidence says those resources should exist;
  8. Playwright and CLI acceptance check workspace completeness, not only job/task completion.
- **Reviewer/verifier archival criteria:** close this gap only after the real-path run produces non-empty canonical resource directories with content-quality evidence and the acceptance tests above remain green.

### 11.2 Regression Gate For Archived Work

Archived gaps stay accepted only while their regression gates remain green:

- Web workflow orchestration stays covered by Playwright UI-only workflow tests on 50000+ ports with no console/API shortcuts.
- Semantic import stays covered by source-grounded semantic import service, CLI, workflow, and browser workflow tests.
- External swarm REST/MCP compatibility stays covered by REST/MCP golden tests and shared service idempotency tests.
- Domain-specific capabilities stay covered by success/denial/audit tests for cards, memory, swarm, report, and writing operations.
- `workflow verify` must keep requiring both validated pi task evidence and corresponding domain artifact evidence for pi-task stages.
- `npm run test:pi-acceptance` remains a hard content gate and must fail, not skip, when NovelFabric pi config or LLM credentials are unavailable.

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

- Treat the opt-in `agent run --runtime pi-sdk` AgentSession path, Web-safe SDK tools foundations, mutation tools foundation, structured event stream foundation, async/SSE bridge foundation, and browser runtime task UI foundation as archived completed foundations.
- Treat Web workflow orchestration over browser runtime task UI, sanitized SSE/evidence envelopes, cancellation/retry controls, and visible event rendering as archived in `archive/v4-web-workflow-orchestration-archive.md`.
- Preserve the existing `agent task create/inspect/run/output validate/status/abort` command contract and SDK-backed evidence envelopes when adding future runtime features.
- New runtime bridge work must open a fresh active gap with tests; do not restate archived Web orchestration or SDK bridge foundations as pending work.

### Phase 10 — Web Shell Rewire

- Treat the replacement of template-only business paths with Web workflow orchestration controls as completed and archived in `archive/v4-web-workflow-orchestration-archive.md`.
- Keep job stage, evidence, artifacts, validation errors, audit paths, runtime policy, retry/cancel controls, and final domain artifact visibility covered by regression tests rather than active planning text.
- Future Web UI expansion must add a fresh gap entry and Playwright UI-only acceptance before implementation; do not reopen archived workflow start/status/stream/cancel/retry coverage as an unfinished Phase 10 item.

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
- canonical workspace resources were materially populated, including at least one `cards/world`, `cards/rules`, `cards/scenes`, memory, and timeline path when semantic evidence indicates those resource types should exist;
- writing reached canonical chapter apply instead of remaining in draft/task-only evidence;
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
