# NovelFabric V4 Workspace-Style Backend Plan

> Status: V4 construction active. `backend_v2` now contains the first TypeScript CLI foundation.
>
> Scope: redesign NovelFabric so a project can be directly taken over by pi / Hermes style agents. The backend becomes a set of small TypeScript CLI primitives plus a thin optional web bridge, while character reasoning and scheduling move to external agents and skills.

## 1. V4 Direction

V4 changes the main control model.

Older v2/v3 direction:

```text
NovelFabric web/backend -> backend-owned agent runtime -> backend-owned LLM provider adapter -> structured writes
```

V4 target direction:

```text
pi / Hermes / web pi SDK agent -> NovelFabric skills -> small NovelFabric CLI tools -> text-first workspace files
```

The V4 backend is implemented in TypeScript under `backend_v2/`. Older Rust planning language in this document is historical migration context and should be interpreted as shared-service/CLI intent, not as an instruction to add Cargo crates in `backend_v2`.

The backend no longer owns character intelligence, role scheduling, model routing, or provider health checks. It owns the things a writing workspace needs to be safe and repeatable:

- project and template materialization
- constrained file IO
- import normalization and chapter splitting
- card / memory / timeline / writing file operations
- deterministic simulation state transitions
- StoryGraph / StoryRAG derived indexes
- report rendering from existing text evidence
- audit logs, validation, rollback hooks
- optional HTTP bridge for the Vue app and pi agent SDK calls

This makes NovelFabric itself an agent workspace rather than an agent platform competing with pi/Hermes.

## 2. Design Principles

1. **pi-operable workspace first**
   A NovelFabric project must be useful when opened by a coding agent in its project directory. The workspace should contain enough `AGENTS.md`, skill contracts, templates, and CLI affordances for an agent to continue work without hidden backend state.

2. **CLI primitives before HTTP APIs**
   Every backend capability should first be expressible as a small executable or subcommand with stable JSON/JSONL/Markdown IO. HTTP endpoints become adapters over these primitives, not the source of truth.

3. **Agent scheduling leaves the backend**
   Character decisions, KP interpretation, world maintainer reasoning, project audit reasoning, author drafting, and reviewer judgement are external agent work. NovelFabric provides context packs, protected writes, validation, and audit.

4. **Templates live outside project data**
   Built-in and user-customized templates should live under the XDG config directory, normally `~/.config/novelfabric`. Project workspaces materialize copies or references as needed. Environment variables are fallback-only, not primary configuration UX.

5. **Text remains the source of truth**
   Indexes, caches, graph files, and generated context packs are derived artifacts. Project facts remain in text or auditable structured files.

6. **Backend LLM integration is deprecated**
   Existing backend `llm.rs`, LLM config endpoints, role model config, and LLM-driven import extraction are migration inputs only. V4 should not extend them as product-facing infrastructure.

## 3. Reference Workspace Patterns

The V4 plan should intentionally absorb the workspace patterns proven by these reference projects:

- `github.com/TraderAlice/OpenAlice`
- `github.com/luokerenx4/autogal`
- `github.com/Ame-X/Auto-PPT`

The goal is not to copy their products. The goal is to absorb their engineering harness: how they make a repo or folder directly operable by an AI agent without hiding the important state in an opaque service.

### 3.1 OpenAlice Pattern

OpenAlice frames its core as a workspace launcher plus context injector:

- Native agent CLIs run inside managed workspaces.
- Capability expansion ships as workspace templates and satellite repos, not ever-growing core code.
- Tools and context enter the workspace through explicit registries/MCP, not by giving every feature a bespoke backend path.
- Persistent state is file-based.
- Sensitive domains are split into a separate process with a narrow protocol boundary.
- The workspace can push artifacts back to the user through an inbox-style handoff, keeping the user review loop attached to generated files.

NovelFabric V4 absorption:

- Treat each story project as the capability workspace.
- Treat NovelFabric CLI tools as the context and state injector.
- Do not make the new backend a universal PTY/session manager; pi/Hermes already owns that layer.
- Add new story capabilities through templates, skills, and optional external adapters before touching core runtime code.
- Keep any future web bridge thin: UI actions should hand off to agent tasks and refresh files/artifacts.

### 3.2 autogal / RPG-Harness Pattern

Autogal's RPG-Harness makes a game folder the source of truth and keeps the engine deterministic:

- The engine owns standard resource schemas, state slots, primitives, lifecycle hooks, and the one write path.
- A game is a folder of Markdown/YAML/TypeScript resources.
- The same folder runs in terminal, browser, and headless test harness.
- The main loop can be ejected or customized without forking the engine.
- Headless `step`, `peek`, `test`, `autoplay`, and fixture commands make the system agent-friendly.
- State is plain JSON and diffable.
- Resource-specific custom metadata lives in extension fields instead of bloating core schemas.

NovelFabric V4 absorption:

- Keep the story engine ignorant of open-ended literary meaning. It should know timepoints, sessions, cards, memory, deltas, triggers, reports, and validation; it should not decide what a character emotionally wants.
- Provide headless `context-pack`, `append-turn`, `validate-round`, `knowledge quick`, and `report` commands so agents can run repeatable loops.
- Keep all state JSON/Markdown round-trippable.
- Use explicit extension slots for project-specific metadata instead of expanding core Rust structs for every story genre.
- Treat simulation actions as atomic validated state transitions, not long-running hidden model loops.

### 3.3 Auto-PPT Pattern

Auto-PPT turns a deck into a folder of source files and gives the agent two clear loops:

- One product equals one folder.
- One slide equals one file.
- Order and visibility live in an explicit config file.
- Agent instructions live in `SKILL.md` and are the source of truth for the harness contract.
- A headless CLI prints the semantic text/rationale view.
- Browser routes are used for visual/layout verification.
- Scaffold files are a soft boundary: content edits are normal; scaffold edits should be surfaced because they reveal harness friction.

NovelFabric V4 absorption:

- One story project equals one workspace folder.
- Major durable facts should map to predictable files: one card, memory entry, chapter, report, session round, or context pack per file where practical.
- Ordering and visibility should live in explicit manifests rather than filenames.
- Agent-facing docs and skills are part of the runtime harness and must be updated with contract changes.
- Separate text/content verification from browser/export verification.
- Mark scaffold-level files and content-level files so agents know when to act and when to surface friction.

### 3.4 Shared Harness Rules For NovelFabric V4

These reference projects agree on a durable pattern:

1. **Workspace as boundary**: the folder is the unit an AI can understand, operate, test, and hand back.
2. **Small core, rich templates**: core code stays deterministic; templates and skills carry domain expansion.
3. **Headless first**: every important workflow has CLI read/step/validate/report commands before UI polish.
4. **One write path**: project state changes go through protected primitives with audit.
5. **Explicit manifests**: order, visibility, active session, template version, and generated artifacts are declared in files.
6. **Docs as harness**: AGENTS/SKILL/architecture docs are not commentary; they are part of the executable workflow contract.
7. **Fixtures as proof**: project fixtures and scripted workflows should prove the engine can run without a browser and without hidden services.
8. **Separate reasoning from persistence**: external agents reason; NovelFabric validates, persists, indexes, and reports.

## 4. Current Backend Inventory

The current `backend/` tree already contains most domain concepts, but they are exposed as a large Axum API and partially coupled to backend LLM calls.

| Current module | Current responsibility | V4 disposition |
|---|---|---|
| `storage.rs` | Rooted file operations and path escape protection | Keep, promote into shared CLI library |
| `config.rs` | App config plus backend LLM endpoint/role config | Split: keep XDG app config; retire LLM endpoint/role config |
| `project.rs` | Create/list/delete projects and bootstrap system agents | Split into project CLI plus template materializer |
| `import.rs` | Decode txt, split chapters, LLM semantic extraction, card/agent seeding | Split: keep decode/split/report; move semantic extraction to agent skill workflow |
| `cards.rs` | Character/rule/world card CRUD | Keep as file CLI primitives |
| `agents.rs` | soul/memory/skills asset CRUD | Keep as workspace asset CLI primitives |
| `memory.rs` | Layered memory entries | Keep as file CLI primitives |
| `timeline.rs` | Timepoints and branches | Keep as deterministic CLI primitives |
| `writing.rs` | Chapter CRUD, review notes, branch historical chapter | Keep as file CLI primitives |
| `runtime.rs` | read/glob/patch/execute restricted runtime | Keep and harden as core agent-safe CLI |
| `story_graph.rs` | Derived graph/chunks/index rebuild | Keep as derived-index CLI |
| `story_rag.rs` | quick/panorama/insight search | Keep as derived-index CLI |
| `simulation.rs` | Session creation, round advancement, fixed system role logs | Split: keep session state and append-only turn log; remove owned role scheduling |
| `swarm.rs` | Builds structured agent output evidence from session/skills/RAG | Reframe as context/evidence pack builder, not scheduler |
| `agent_output.rs` | Structured actions, consistency checks, skill invocation evidence | Keep schema, adapt to external-agent action plans |
| `report.rs` | Evidence-based reports and interviews | Keep report rendering; interviews become agent-authored or context-pack based |
| `external_swarm.rs` | Generic external swarm inference HTTP persistence used by external callers | Preserve as frozen V4 compatibility surface; internals may move behind shared services only after contract tests pass |
| `mcp.rs` | JSON-RPC MCP wrapper for external swarm | Preserve tool names and `structuredContent` shape; may become bridge over V4 services |
| `llm.rs` | OpenAI/Anthropic provider adapter | Deprecate for V4 backend |
| `main.rs` / `lib.rs` | Axum server, routes, app state | Thin optional bridge after CLI contracts exist |
| `bin/novelfabric_fanfic.rs` | Env-driven LLM smoke workflow | Retire or move to external agent skill sample |

## 5. Functions To Split Into Minimal CLI Units

V4 initializes `backend_v2` as a TypeScript workspace with one shared service layer and one preferred user-facing `novelfabric` CLI entry. Use capability-scoped subcommands rather than many unrelated binaries; subcommands should stay thin wrappers over shared TypeScript services. Skill-facing verbs should be coarse and stable so skill contracts do not become brittle.

### 5.1 Workspace and Template Management

Executable boundary: `novelfabric workspace ...`

Responsibilities:

- `workspace init --path <dir> --template <name>`
- `workspace doctor --path <dir>`
- `workspace materialize-agents --project <slug>`
- `workspace materialize-skills --project <slug>`
- `workspace print-layout`
- `workspace validate-layout --json`

Outputs:

- creates project-level `AGENTS.md`
- creates or updates `skills/novelfabric-*/SKILL.md` or the final pi-compatible skill directory selected during implementation
- creates canonical project directories
- writes a machine-readable manifest of materialized templates

### 5.2 Config and Template Store

Executable boundary: `novelfabric config ...`

Responsibilities:

- `config path`
- `config print --json|toml`
- `config set data_dir <path>`
- `config templates list`
- `config templates install --from <dir|archive>`
- `config templates reset-builtin`

Primary paths:

```text
~/.config/novelfabric/
  config.toml
  workspace-defaults.toml
  agent-clients.toml
  profiles/
    default.toml
    browser.toml
    cli.toml
  templates/
    projects/
      default-workspace/
      novel-project/
    agents/
      kp/
      random-event/
      world-maintainer/
      project-auditor/
      author/
      reviewer/
      character/
    skills/
      character-decision/
      kp-adjudicate/
      world-update/
      project-audit/
      author-draft/
      review-check/
      memory-summarize/
      timeline-branch-proposal/
  schema/
    project-layout.schema.json
    skill-frontmatter.schema.json
```

Resolution order should be explicit and visible in `config print --json` / `workspace doctor`:

1. project-local `.novelfabric/workspace.json` for workspace-specific pins
2. user XDG config and templates under `~/.config/novelfabric`
3. packaged built-in defaults shipped with the CLI
4. environment variables only when the corresponding config value is missing or when a command explicitly allows an automation override
5. direct CLI flags as the final per-invocation override

Environment variables such as `NOVELFABRIC_DATA_DIR` remain fallback overrides for automation, CI, and emergency repair only.

### 5.3 Project Management

Executable boundary: `novelfabric-project` or `novelfabric project ...`

Responsibilities:

- create/list/inspect/delete/archive projects
- validate slug and canonical layout
- bootstrap project files without invoking any model
- write `project.json`, `project.md`, timeline origin, and default assets

Candidate commands:

```bash
novelfabric project create --slug my-story --title "My Story" --template novel-project --json
novelfabric project list --json
novelfabric project inspect my-story --json
novelfabric project validate my-story --strict --json
```

### 5.4 Agent-Safe File Runtime

Executable boundary: `novelfabric fs ...`

Responsibilities:

- bounded read
- project-local glob
- exact replace
- append
- write new file with protected-asset checks
- audit all writes by caller agent id

Candidate commands:

```bash
novelfabric fs read --project my-story --path agents/aria/soul.md --json
novelfabric fs glob --project my-story --base cards --pattern '**/*.md' --json
novelfabric fs patch --project my-story --agent project-auditor --plan patch.json --json
novelfabric fs append --project my-story --agent kp --path simulation/logs/session.md --stdin --json
```

This should absorb and harden current `runtime.rs`.

### 5.5 Import and Chapterization

Executable boundary: `novelfabric import ...`

Responsibilities retained from current `import.rs`:

- raw txt byte preservation
- encoding detection / GBK fallback / UTF-8 normalized output
- deterministic chapter splitting
- import report generation
- context pack generation for external semantic extraction agents

Responsibilities removed:

- backend LLM calls
- backend semantic card generation from provider output
- silent fallback that creates guessed semantic cards

Candidate commands:

```bash
novelfabric import txt --project my-story --file novel.txt --source-name novel.txt --json
novelfabric import context-pack --project my-story --import import-novel-txt --max-chars 12000 --json
novelfabric import apply-agent-extraction --project my-story --import import-novel-txt --file extraction.json --json
```

`apply-agent-extraction` should accept a schema produced by pi/Hermes skills, validate evidence paths, then create cards/agents/skills through the same file primitives.

### 5.6 Cards, Memory, Timeline, Writing

Executable boundaries can be separate or grouped:

- `novelfabric-card`
- `novelfabric-memory`
- `novelfabric-timeline`
- `novelfabric-writing`

Responsibilities:

- provide deterministic CRUD for text assets
- keep path and id validation centralized
- produce JSON status and affected paths
- never call LLMs

Candidate commands:

```bash
novelfabric card upsert --project my-story --kind character --id aria --title Aria --body-file aria.md --json
novelfabric memory append --project my-story --scope agent --scope-id aria --timeline main --timepoint tp-0001 --stdin --json
novelfabric timeline branch create --project my-story --from tp-0003 --id branch-west-gate --json
novelfabric writing chapter update --project my-story --chapter chapter-003 --body-file draft.md --json
```

### 5.7 Knowledge Indexes

Executable boundary: `novelfabric knowledge ...`

Responsibilities retained from `story_graph.rs` and `story_rag.rs`:

- rebuild derived StoryGraph artifacts
- run quick/panorama/insight search over text-derived artifacts
- emit citations with source paths

Candidate commands:

```bash
novelfabric knowledge rebuild --project my-story --json
novelfabric knowledge quick --project my-story --query "Aria vault oath" --json
novelfabric knowledge panorama --project my-story --query "west gate conflict" --json
novelfabric knowledge insight --project my-story --query "branch risk" --json
```

### 5.8 Simulation State Engine

Executable boundary: `novelfabric sim ...`

Responsibilities retained:

- create sessions
- record user/agent turns
- maintain active session pointer
- persist append-only logs
- persist structured round/turn records
- close sessions

Responsibilities removed:

- backend-owned character/system role scheduling
- backend-generated character decisions
- backend-owned random event/world/KP/auditor reasoning

Candidate commands:

```bash
novelfabric sim session create --project my-story --session session-001 --timepoint tp-0001 --characters aria,ben --json
novelfabric sim context-pack --project my-story --session session-001 --round next --agent aria --json
novelfabric sim append-turn --project my-story --session session-001 --agent aria --role character --file aria-output.json --json
novelfabric sim validate-round --project my-story --session session-001 --round 3 --json
novelfabric sim close --project my-story --session session-001 --reason-file reason.md --json
```

The external agent loop becomes:

```text
1. pi/Hermes calls sim context-pack for a specific agent.
2. pi/Hermes reasons using NovelFabric skill instructions.
3. pi/Hermes submits a structured action/output file.
4. NovelFabric validates and applies allowed writes.
5. NovelFabric appends audit and updates derived indexes when requested.
```

### 5.9 Reports

Executable boundary: `novelfabric report ...`
Responsibilities retained from `report.rs`:

- render reports from already-written evidence
- cite source paths
- produce consistency and branch-impact scaffolds

Responsibilities moved to agents:

- interpretive interviews
- creative advice beyond deterministic evidence collation
- author/reviewer judgement

Candidate commands:

```bash
novelfabric report simulation --project my-story --session session-001 --round 4 --json
novelfabric report consistency --project my-story --session session-001 --round 4 --json
novelfabric report branch-impact --project my-story --branch branch-west-gate --json
novelfabric report context-pack --project my-story --kind writing-prewrite --chapter chapter-004 --json
```

## 6. Skill-Managed Workflow

V4 skills should become the main human/agent interface. The CLI only supplies safe atoms.

Minimum NovelFabric skill set:

| Skill | Purpose | CLI primitives it may call |
|---|---|---|
| `novelfabric-workspace-init` | Create or repair a pi-operable project workspace | `workspace`, `project`, `config` |
| `novelfabric-import-book` | Normalize txt, split chapters, request/apply semantic extraction | `import`, `card`, `agent`, `memory` |
| `novelfabric-character-turn` | Run one character decision from context pack to structured output | `sim context-pack`, `knowledge quick`, `fs patch`, `sim append-turn` |
| `novelfabric-kp-adjudicate` | Apply rules and record KP rulings | `sim context-pack`, `card`, `fs patch`, `sim append-turn` |
| `novelfabric-world-update` | Maintain world cards and introduce setting deltas | `knowledge panorama`, `card`, `memory`, `sim append-turn` |
| `novelfabric-project-audit` | Check drift, timeline risk, missing evidence | `knowledge insight`, `timeline`, `report`, `sim validate-round` |
| `novelfabric-author-draft` | Turn simulation evidence into chapter draft | `report context-pack`, `writing`, `fs patch` |
| `novelfabric-review-check` | Review chapter against cards, memory, timeline | `knowledge panorama`, `report`, `writing`, `fs patch` |
| `novelfabric-rollback-branch` | Create a timeline branch instead of rewriting history | `timeline`, `writing`, `fs patch` |

Each skill should specify:

- expected role and input arguments
- exact CLI commands allowed
- files it may read
- files it may write
- required evidence paths in final output
- validation command to run before declaring success

The repository currently has a `skills/external-swarm-inference/SKILL.md` pattern. V4 implementation should verify the exact pi project-local skill discovery convention, then either keep this `skills/<name>/SKILL.md` layout or materialize the final pi-compatible layout from `~/.config/novelfabric/templates/skills/`.

## 7. Workspace Layout Target

A V4 project should remain recognizable as the current text-first NovelFabric layout, but it should add agent-facing entry points.

```text
projects/<slug>/
  AGENTS.md
  project.md
  project.json
  .novelfabric/
    workspace.json
    template-manifest.json
    cli-manifest.json
    validation-report.json
  import/
  cards/
    characters/
    rules/
    world/
  memory/
    global/
    branches/
    chapters/
    agents/
  writing/
    chapters/
    review-notes/
    audit/
  simulation/
    active-session.txt
    sessions/
    logs/
    turns/
    context-packs/
  timeline/
    index.json
    timepoints/
    branches/
  agents/
    <agent-id>/
      soul.md
      memory.md
      profile.json
      skills/
      audit/
  knowledge/
    ontology.json
    graph/
    chunks/
    indexes/
  reports/
  history/
```

Root-level repository skills can orchestrate across projects, while project-local `AGENTS.md` tells pi/Hermes how to work inside a single story workspace.

## 8. Web App and pi Agent SDK Boundary

The Vue frontend should not call backend LLM endpoints in V4.

Target web flow:

```text
Vue UI action -> pi agent SDK task or local agent bridge -> NovelFabric skill -> NovelFabric CLI -> workspace files -> UI refresh
```

The optional HTTP bridge may still serve:

- project browsing
- static file previews
- safe CRUD wrappers over CLI primitives
- command invocation status
- web-to-agent task handoff

But the bridge should not own:

- provider keys
- model choice
- character turn ordering logic
- LLM request retries
- semantic extraction prompts as backend code

## 9. API Compatibility And Tool Authorization

### 9.1 External Swarm Compatibility Freeze

External swarm inference is already used by local services, including Hermes/OpenAlice/TraderAlice-style profiles for market, sentiment, and public-opinion inference. V4 must therefore treat it as a frozen compatibility surface, not as disposable v3 runtime code.

Frozen surfaces:

- `POST /api/external/swarm-inferences`
- `GET /api/external/swarm-inferences/{inference_id}`
- `POST /mcp` JSON-RPC transport
- MCP tools: `external_swarm_infer`, `external_swarm_require_context`, `external_swarm_get`
- idempotency via `client_request_id`
- artifact path semantics under `projects/external-<domain>/...` and `external/inferences/...`
- MCP `structuredContent` and mirrored JSON text content

Current response fields that must stay compatible:

- `inference_id`
- `project_slug`
- `session_id`
- `domain`
- `title`
- `rounds_completed`
- `item_count`
- `artifact_paths.manifest`
- `artifact_paths.report`
- `artifact_paths.input_items[]`
- `artifact_paths.session`
- `artifact_paths.swarm_rounds[]`
- `artifact_paths.context`
- `artifact_paths.role_reasoning[]`
- `summary_markdown`
- `context_requirements`
- `role_reasoning[]`

Compatibility policy:

- Additive fields are allowed when old clients can ignore them.
- Removing fields, renaming fields, changing path meaning, changing idempotency, or changing MCP tool names requires a new endpoint/tool version.
- V4 may replace internals with CLI/shared services only after old backend and new backend pass the same compatibility fixture suite.
- Existing HTTP and MCP endpoints should remain as adapters during migration so dependent profiles do not need immediate client changes.

Required tests before implementation changes:

- golden JSON fixture for a Hermes/TraderAlice-style request and response
- serializer test for `ExternalSwarmInferenceResponse`
- HTTP `POST` and `GET` route tests against the golden shape
- MCP `tools/list` test for tool names and schemas
- MCP `tools/call` test proving `structuredContent` matches the HTTP response shape
- artifact path tests for manifest/report/items/session/swarm rounds/context/role reasoning
- schema parity test proving MCP `tools/list` advertises optional request fields that HTTP accepts, including `context`

Known compatibility gap to fix additively: current Rust request struct accepts optional `context`, while the MCP `tools/list` input schema does not yet advertise it. Adding `context` to the MCP schema is compatible; removing request support is not.

### 9.2 CLI Shape And Skill Ergonomics

Use one user-facing `novelfabric` binary with capability-scoped subcommands. Avoid many unrelated executables because skills would then need to remember too much command topology.

Preferred skill-facing verbs should be coarse and stable:

- `workspace doctor`
- `context-pack`
- `recall`
- `propose-action`
- `append-turn`
- `validate`
- `report`
- `knowledge quick|panorama|insight`

Subcommands should be thin wrappers over shared Rust services. The same service layer should back CLI, HTTP bridge, MCP bridge, tests, and future pi SDK bridge. This keeps authorization and path checks in one place.

### 9.3 Capability Manifest Authorization

Skill-to-tool calls should not rely on trust in the prompt text. V4 should define an explicit workspace capability manifest, likely under:

```text
projects/<slug>/.novelfabric/capabilities.toml
projects/<slug>/.novelfabric/actors/<actor-id>.toml
```

Minimum capability vocabulary:

- `project.manage`
- `workspace.materialize`
- `knowledge.rebuild`
- `knowledge.query`
- `swarm.run`
- `external_swarm.run`
- `simulation.session_manage`
- `simulation.append_turn`
- `report.render`
- `memory.recall`
- `memory.write_own`
- `memory.propose_shared`
- `memory.read_profile:<id>`
- `files.read_allowed`
- `files.patch_allowed`
- `files.patch_protected`

Main agent default grants:

- project/template/workspace management
- knowledge rebuild and global query
- simulation/session lifecycle
- external swarm inference
- report rendering
- promotion of validated proposals into canonical files

Role subagent default grants:

- read assigned context packs
- recall own memory and explicitly shared project memory
- draft/propose action JSON
- append own turn output through validation
- propose memory updates in a proposal path

Role subagent default denies:

- project creation/deletion/template changes
- global knowledge rebuild
- external swarm inference
- direct edits to protected files
- direct writes to other profiles' private memory
- promotion of proposals into canonical memory/timeline without validation

Every mutating command must audit:

- actor id
- profile/card id when present
- command and arguments summary
- granted capability
- target paths
- result status
- timestamp

### 9.4 Memory Recall Semantics

A `recall` command is useful, but it must not become a privilege leak.

Suggested contract:

```bash
novelfabric memory recall \
  --workspace <path> \
  --actor aria \
  --profile aria \
  --query "the west gate oath" \
  --scope own-and-shared \
  --limit 12 \
  --json
```

Rules:

- Workspace may be inferred from `.novelfabric/workspace.json` when run inside a project.
- Actor/profile/card identity must still be explicit for role-sensitive memory.
- Default role-agent recall reads own memory plus allowed shared/project memory.
- Cross-profile memory requires explicit `memory.read_profile:<id>` or a main-agent-generated context pack.
- Output must include source paths, memory layer, owner/profile, and denied/redacted counts.
- Denied entries should be reported as redacted counts, not silently mixed or silently omitted.

## 10. Deprecated V3 Assets and Migration Rules

Deprecated in V4 backend:

- `backend/src/llm.rs`
- `LlmConfigService` endpoint/role model config as a product path
- `/api/config/llm-*` routes
- backend LLM healthcheck
- backend LLM semantic import extraction
- `backend/src/bin/novelfabric_fanfic.rs`
- backend-owned StorySwarm role scheduling as the primary loop

Not deprecated:

- external swarm HTTP/MCP compatibility endpoints and MCP tools; only their internals may move behind V4 shared services after compatibility tests exist

Migration rules:

1. Keep old files untouched until `backend_v2` has equivalent CLI coverage.
2. Migrate deterministic functions first: storage, config, project layout, runtime read/glob/patch, import decode/split.
3. Replace backend LLM import with `import context-pack` plus `apply-agent-extraction` schema.
4. Replace simulation `advance_round` with explicit `context-pack` and `append-turn` primitives for native story workflows, while preserving external swarm compatibility adapters.
5. Add capability manifest checks before exposing role-agent writable commands.
6. Only after CLI contracts are tested, add a thin web bridge.
7. Update `PROJECT.md`, root `AGENTS.md`, and relevant `docs/architecture/*.md` once V4 semantics become active rather than planning-only.

## 11. Implementation Phases

### Phase V4.0 - Planning and Staging

Deliverables:

- `backend_v2/AGENTS.md`
- this planning document
- no runtime code yet

Verification:

- files exist under `backend_v2`
- document explicitly lists split functions, deprecated paths, and phases

### Phase V4.1 - TypeScript Workspace Skeleton

Deliverables:

- `backend_v2/package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, and strict lint/test configuration
- shared TypeScript services for config resolution, safe path validation, and workspace layout inspection
- root `novelfabric` CLI with `config path`, `config print`, `workspace print-layout`, and `workspace doctor`
- XDG/HOME config root resolution to `~/.config/novelfabric` by default, with `XDG_CONFIG_HOME` support and explicit failure when neither path source is present
- fixture-backed workspace layout doctor and CLI JSON envelope tests

Verification:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
HOME=/Users/dbydd XDG_CONFIG_HOME= npm run cli -- config path --json
npm run cli -- workspace doctor --path fixtures/workspaces/valid-basic --json
```

### Phase V4.2 - Project and Safe File CLI

Deliverables:

- project create/list/inspect/validate
- fs read/glob/patch/write/append
- audit logs for writes
- protected `soul.md` and `memory.md` checks

Verification:

- temp project tests prove path escape rejection
- repeated commands are idempotent where promised
- JSON outputs include affected paths

### Phase V4.3 - Template Store and Skill Materialization

Deliverables:

- built-in template loading from `~/.config/novelfabric/templates`
- project-local `AGENTS.md` materialization
- built-in NovelFabric skill templates
- skill schema validation command
- scaffold/content boundary manifest inspired by Auto-PPT: content files are normal edit surfaces; scaffold files are contract surfaces that require doc updates when changed
- workspace template/satellite capability registry inspired by OpenAlice: new capabilities should register as templates or skills before entering core code

Verification:

- `workspace init` creates a pi-operable project
- `workspace doctor` reports missing or stale skill/template files
- changing a skill/schema/template fixture fails validation unless the corresponding manifest/docs are updated

### Phase V4.4 - Import Without Backend LLM

Deliverables:

- txt decode/split/import report
- semantic extraction context pack
- `apply-agent-extraction` validator and applier

Verification:

- GBK fixture import preserves raw bytes and normalizes to UTF-8
- failed/missing extraction does not create guessed semantic cards
- valid extraction JSON creates cards/agents/skills with evidence paths

### Phase V4.5 - Simulation As External-Agent State Machine

Deliverables:

- session create/inspect/close
- per-agent context pack generation
- append external agent turn
- validate round consistency
- apply structured actions through safe file runtime
- fixture-driven `sim step` / `sim test` harness inspired by RPG-Harness so a full round can be replayed from JSON inputs
- explicit active session and turn manifests, rather than hidden runtime state
- role-agent `memory recall` and proposal-write commands governed by capability manifest

Verification:

- no backend code generates character reasoning
- a test can simulate a round by feeding fixture agent outputs
- audit files cite skill file and affected paths
- fixture replay produces stable state and report artifacts across runs
- role-agent fixture proves denied cross-profile memory reads and denied protected writes are reported clearly

### Phase V4.6 - Knowledge and Report CLI

Deliverables:

- StoryGraph rebuild
- StoryRAG quick/panorama/insight
- report generation from text evidence

Verification:

- derived artifacts live under `knowledge/`
- report files cite source paths
- indexes can be deleted and rebuilt from source files

### Phase V4.7 - Compatibility Bridge, Web Bridge, And SDK Handoff

Deliverables:

- external swarm v1 compatibility fixture suite over old HTTP/MCP shape
- minimal HTTP bridge over CLI/library primitives
- web action contract for pi agent SDK
- removal or hiding of V3 LLM settings UI

Verification:

- browser path can create project, import txt, launch agent task, refresh artifacts
- no provider key is stored through NovelFabric backend UI
- Hermes/TraderAlice-style external swarm fixture returns the same JSON field names and compatible value shapes through HTTP and MCP

## 12. Risks and Open Questions

1. **pi project-local skill discovery**
   We need to confirm the exact project-local skill directory convention before materializing final skill layout. Until confirmed, use `skills/<name>/SKILL.md` as the repo-local planning pattern.

2. **Web pi SDK execution model**
   The exact boundary between Vue, pi SDK, and local CLI process spawning needs dependency research before implementation.

3. **Template versioning**
   User-customized templates in `~/.config/novelfabric` need version metadata and non-destructive upgrade behavior.

4. **Action schema compatibility**
   Current `AgentRoundAction` is useful, but V4 external agent outputs need a stricter schema with validation errors friendly enough for agents to self-repair.

5. **Old API compatibility**
   The existing frontend and tests expect HTTP endpoints. V4 should avoid breaking them until the new web bridge is ready, or should stage the work under `backend_v2` only.

6. **Security boundary**
   Since pi/Hermes agents can have more power than NovelFabric v2 agents, NovelFabric CLI tools must remain conservative: project-root path checks, exact replacement, write audit, critical asset protection, and explicit affected-path reporting are mandatory.

## 13. Immediate Next Step

After this planning stage is accepted, move development into `backend_v2/` and start Phase V4.1:

1. Continue from the TypeScript CLI foundation already committed in `backend_v2`.
2. Port deterministic storage/path/config behavior into shared TypeScript services.
3. Extend the existing `novelfabric config path`, `config print`, `workspace print-layout`, and `workspace doctor` commands toward project creation and protected file primitives.
4. Keep tests aligned with XDG config precedence, env fallback behavior, JSON envelopes, path safety, and workspace layout validation.

This directory is no longer planning-only; it contains active TypeScript V4 runtime code.
