# NovelFabric V4 CLI Workspace Harness Plan

> Active V4 architecture plan. This document is the canonical replacement for the earlier fullstack/custom-LLM workflow drafts.

## 1. Corrected Positioning

NovelFabric V4 is a **CLI-first text workspace harness**, not a custom LLM backend.

```text
pi / Hermes / pi agent SDK
  → NovelFabric skills / AGENTS text constraints
  → novelfabric CLI commands
  → shared TypeScript workspace services
  → workspace files + audit
  → optional Web shell as control/review surface
```

NovelFabric owns the workspace boundary: layout, CLI contracts, context packs, validation, protected writes, audit, derived indexes, reports, and artifact manifests. Open-ended semantic work belongs to pi agent SDK / external agents operating under NovelFabric skills and capabilities.

## 2. Active Companion Documents

| Document                                             | Purpose                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `v4-cli-command-contract.md`                         | Detailed CLI command surface, JSON envelopes, error codes, capability names, and bridge mapping. |
| `v4-mono-frontend-plan.md` / `.zh.md`                | Current Web shell integration rules and UI behavior.                                             |
| `../research/frontend-reference-study.md`            | UI/reference project lessons for the Web shell.                                                  |
| root `AGENTS.md` and `novelfabric_v4_mono/AGENTS.md` | Binding agent-facing project constraints.                                                        |

Historical documents that proposed NovelFabric-owned LLM/provider runtime have been removed or superseded. Do not revive `src/llm/provider.ts` or a NovelFabric model registry as the V4 mainline.

## 3. Non-Negotiable Principles

1. **CLI before Web** — Every meaningful operation must have a `novelfabric` CLI shape before it is exposed as a Web control.
2. **Files are truth** — Markdown / JSON / JSONL / TOML workspace files remain canonical. Graphs, RAG indexes, reports, and job state are derived or auditable artifacts.
3. **One write path** — Durable writes route through shared workspace services with safe path checks, capability checks, protected path policy, conflict detection, atomic writes, and audit.
4. **Skills before code branches** — If behavior can be expressed as an agent instruction, skill, role profile, or capability rule, prefer text constraints over hidden TypeScript control flow.
5. **pi SDK owns semantics** — LLM reasoning, role play, extraction interpretation, ReportAgent analysis, and chapter drafting are pi/Hermes tasks. NovelFabric prepares context and validates/applies outputs.
6. **Proposal before apply** — Agent outputs become proposals or task artifacts first. CLI validators decide whether they can be applied to canonical files.
7. **Derived indexes only** — StoryGraph / StoryRAG artifacts can always be rebuilt from workspace source files.
8. **No fixture branches** — No logic may special-case `test_novel.txt` or any acceptance fixture.
9. **Frozen external swarm compatibility** — Existing REST/MCP shape remains compatible; new capabilities must be additive or versioned.
10. **Browser acceptance uses controls only** — Playwright may click UI and inspect visible artifacts, but must not use browser console or direct API calls to bypass UI flows.

## 4. Reference Project Lessons Consolidated

### OpenAlice

Absorb:

- workspace as the capability boundary;
- template materialization and context injection;
- external agent runtime / pi adapter rather than custom provider ownership;
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

Avoid:

- copying game engine DSLs or GalGame-specific mechanics.

### Auto-PPT

Absorb:

- one durable artifact per file or fixed file set;
- manifest controls order/visibility/status;
- `SKILL.md` as harness contract;
- content loop separated from visual/browser loop;
- headless CLI as semantic truth and browser as inspection surface.

Avoid:

- copying PPT/React implementation patterns into the novel workspace core.

## 5. Target Workspace Model

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

## 6. Target CLI Families

The detailed command surface lives in `v4-cli-command-contract.md`. The high-level families are:

```text
workspace / project
files
agents / skills
agent task / pi SDK
import / chapterize
cards / memory
knowledge / recall / context-pack
simulation / swarm
report / writing
workflow wrapper
external-swarm compatibility
```

The key rule is that Web bridge routes are adapters over these command/service families, not a separate business runtime.

## 7. pi Agent SDK Integration Model

The future pi bridge should create task packages and sessions rather than call model providers directly.

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
  → pi agent SDK session with NovelFabric skills
  → agent reads allowed workspace context
  → agent outputs structured proposal/result
  → novelfabric validate
  → novelfabric domain apply / files write
  → audit + artifact manifest refresh
```

Do not allow pi built-in `write` / `edit` or unrestricted `bash` to become the normal mutation path for canonical NovelFabric facts. If a custom pi tool is added, it should call `novelfabric` CLI internally.

## 8. Skill / Agent Text Assets

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
- allowed CLI commands;
- readable file scope;
- writable proposal/apply paths;
- required output schema;
- citation/evidence requirements;
- validation commands to run before declaring success;
- forbidden shortcuts, including direct filesystem writes and fixture-specific logic.

## 9. Implementation Phases

### Phase 1 — CLI Contract Freeze

- Keep `v4-cli-command-contract.md` current.
- Ensure existing `config`, `workspace`, `files`, and `web` commands remain stable.
- Add command stubs only when their JSON envelope, capability, and artifact paths are documented.

### Phase 2 — Agent / Skill Materialization

- Materialize default agents and skills from XDG templates.
- Add `agents list/inspect/materialize/validate` and `skills list/read/validate`.
- Expand capability manifest templates for main/system/role agents.

### Phase 3 — Import / Chapterize CLI

- Add inbox, normalize, chunk, chapterize, context-pack, validate.
- Deterministic stages do not call LLM providers.
- Semantic extraction is pi skill output validated/applied by CLI.

### Phase 4 — Proposal / Apply Model

- Cards, memory, simulation, reports, and chapters use proposal → validate → apply.
- All apply commands use shared write services and audit.

### Phase 5 — StoryGraph / StoryRAG CLI

- Rebuild derived `knowledge/` artifacts from source files.
- Provide search/context-pack commands with file paths, excerpts, entity/relation metadata, and timeline information where available.

### Phase 6 — Simulation / StorySwarm CLI

- Add session state, context packs, turn append, validation, swarm plan/task/output/finalize.
- Default round order remains `characters → random-event → world-maintainer → kp → project-auditor`.
- Agent reasoning comes from pi skills; CLI applies only validated outputs.

### Phase 7 — Report / Writing CLI

- Add report task/validate/apply/list/show.
- Add writing context-pack, draft task, apply-draft, review, export.
- Chapters must cite accepted artifacts and pass validation before apply.

### Phase 8 — pi Agent SDK Bridge

- Implement `agent task create/inspect/run/output validate/status/abort`.
- Use pi SDK sessions and skills.
- Record session/task evidence without owning provider configuration.

### Phase 9 — Web Shell Rewire

- Replace template-only business paths with CLI-backed workflow/task calls.
- Display job stage, evidence, artifacts, validation errors, audit paths, and retry controls.

### Phase 10 — End-to-End Acceptance

- One full browser-controlled run with `test_novel.txt`.
- One full browser-controlled run with a different source fixture.
- Ten-loop browser run with pi-backed semantic evidence.
- No browser console, no direct API bypass, no fixture-specific code.

## 10. Success Criteria

A future business-flow test is successful only if:

- semantic work was executed by pi agent SDK / external agent under NovelFabric skills;
- cards, context packs, role actions, swarm outputs, reports, and chapter drafts are real artifacts, not UI templates;
- every applied write went through `novelfabric` CLI/shared services;
- all key outputs cite workspace evidence;
- capability/protected path rules were enforced;
- Web controls only orchestrated CLI-backed operations.

## 11. Explicit Non-Goals

- No NovelFabric-owned OpenAI/Anthropic provider layer as V4 mainline.
- No hidden database as the sole truth source.
- No role agent default shell/network/arbitrary path access.
- No Web-only business generation path.
- No copied reference-project implementation code.
- No breaking changes to frozen external swarm REST/MCP shape.
