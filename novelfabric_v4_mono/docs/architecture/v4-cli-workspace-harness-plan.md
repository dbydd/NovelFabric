# NovelFabric V4 CLI Workspace Harness Plan

> Status: replanning after reference rescan. This replaces the previous fullstack custom-LLM direction with a CLI-first, pi-agent-SDK-backed workspace harness.

## 1. Corrected System Understanding

NovelFabric V4 is **not** a custom LLM backend.

It is a **text-first workspace harness** that provides:

- durable workspace files as source of truth;
- capability-scoped CLI commands;
- protected file policy;
- audit logs;
- agents and skills as text constraints;
- optional Web shell as a CLI-visible interface;
- pi agent SDK / Hermes as the smart execution layer.

Correct chain:

```text
pi / Hermes / pi agent SDK
  → NovelFabric skills / AGENTS text constraints
  → novelfabric CLI commands
  → shared workspace services
  → workspace files + audit
  → optional Web shell on top
```

This means the prior idea of implementing a custom `src/llm/` provider layer as the V4 mainline should be removed or demoted to a non-goal.

---

## 2. What The Documentation Says Now

### 2.1 Root docs

The top-level docs consistently point to:

- text-first, file-first NovelFabric facts;
- V4 mono app as TypeScript CLI-first workspace harness;
- roles/agents moved out of backend runtime and into external agent + skill text constraints;
- external swarm HTTP/MCP compatibility frozen;
- browser verification must be Playwright-driven.

### 2.2 V4 mono app AGENTS

The V4 mono app directory says:

- no new Rust mainline;
- keep CLI tools safe for external agents;
- use capability manifests for authorization;
- keep writes centralized through shared TypeScript services;
- the future pi bridge must not bypass NovelFabric CLI/capability checks.

### 2.3 Skill / agent emphasis

The project already treats behavior as text:

- `AGENTS.md`
- `SKILL.md`
- workspace `agents/<id>/soul.md`
- `agents/<id>/memory.md`
- `agents/<id>/skills/*.md`
- `.novelfabric/capabilities.toml`

So future intelligence should be expressed first as skills / prompts / capability text, not as hidden control-flow in the app.

---

## 3. Reframed Goal

Instead of:

```text
build a custom LLM-backed workflow runtime inside NovelFabric
```

the actual goal becomes:

```text
expose every meaningful NovelFabric operation as a CLI command,
let pi agent SDK / Hermes execute the semantic work,
keep NovelFabric responsible for safe writes, validation, audit, and workspace facts,
and let the Web shell only orchestrate and visualize CLI-backed flows.
```

---

## 4. Design Principles For The Replan

### 4.1 CLI first

Anything users or agents can do should exist as a CLI command before it exists in the Web UI.

### 4.2 Shared primitives first

Reuse existing primitives where they already exist:

- `read`
- `write`
- `bash`
- `glob/search`
- `validate`
- `report`
- `context-pack`

### 4.3 Skills before code branches

If a behavior can be specified as a skill or agent constraint, do that first.

### 4.4 Files are truth

All durable state must live in workspace files or auditable generated artifacts.

### 4.5 No hidden backend brain

Do not build a private LLM runtime that supersedes pi agent SDK / external agent execution.

### 4.6 No sample-specific logic

No special-casing for `test_novel.txt` or any other fixture.

### 4.7 Browser is a harness, not the source of truth

Browser controls should trigger CLI-backed operations, not invent their own workflow semantics.

---

## 5. CLI Command Decomposition

The next implementation wave should prioritize a broad CLI surface. A useful command map is:

### 5.1 Workspace / Project

```bash
novelfabric project init
novelfabric project inspect
novelfabric project validate
novelfabric project list
novelfabric workspace doctor
novelfabric workspace layout
```

Purpose:

- materialize workspace structure;
- validate required files/directories;
- show what the harness can operate on.

### 5.2 Files

Already on the right track and should remain central:

```bash
novelfabric files tree
novelfabric files read
novelfabric files write
novelfabric files patch
novelfabric files protect-check
```

Purpose:

- file tree, read, write, patch, and protection all stay in one audited path.

### 5.3 Agents / Skills

```bash
novelfabric agents list
novelfabric agents inspect
novelfabric agents materialize
novelfabric agents validate
novelfabric skills list
novelfabric skills read
novelfabric skills validate
```

Purpose:

- agents are text assets, not hidden runtime objects;
- skills are the durable behavior contract;
- the CLI becomes the canonical way to inspect what an agent is allowed to do.

### 5.4 Import / Chapterize

```bash
novelfabric import inbox
novelfabric import normalize
novelfabric import chapterize
novelfabric import context-pack
novelfabric import validate
```

Purpose:

- bring raw novel text into the harness;
- normalize and chunk it;
- prepare context packs for external agents.

### 5.5 Cards / Memory

```bash
novelfabric cards list
novelfabric cards read
novelfabric cards propose
novelfabric cards apply
novelfabric cards validate

novelfabric memory recall
novelfabric memory append
novelfabric memory propose-shared
```

Purpose:

- proposals are explicit;
- apply is explicit;
- memory is role-scoped and guarded.

### 5.6 Knowledge / Context Pack

```bash
novelfabric knowledge rebuild
novelfabric knowledge search
novelfabric knowledge context-pack
```

Purpose:

- StoryGraph / StoryRAG remain derived indexes;
- they feed agent context, but do not replace files.

### 5.7 Simulation / StorySwarm

```bash
novelfabric simulation create
novelfabric simulation state
novelfabric simulation context-pack
novelfabric simulation propose-action
novelfabric simulation append-turn
novelfabric simulation validate
novelfabric simulation report
```

Purpose:

- deterministic state machine + external semantic agent action;
- round order preserved;
- evidence and artifacts written to files.

### 5.8 Writing / Chapter

```bash
novelfabric writing context-pack
novelfabric writing apply-draft
novelfabric writing review
novelfabric writing export
```

Purpose:

- writing is a disciplined CLI flow, not a hidden UI-only feature.

### 5.9 Timeline / Branch

```bash
novelfabric timeline inspect
novelfabric timeline validate
novelfabric timeline branch-proposal
novelfabric timeline branch-apply
```

Purpose:

- history cannot be silently rewritten;
- branch proposals make modifications explicit.

### 5.10 External Swarm Compatibility

```bash
novelfabric external-swarm infer
novelfabric external-swarm get
novelfabric external-swarm require-context
```

Purpose:

- preserve frozen compatibility while offering CLI smoke and orchestration entrypoints.

---

## 6. pi Agent SDK Positioning

The LLM side should be handled by pi agent SDK, not by a NovelFabric-owned provider layer.

Implications:

- do **not** build a new `src/llm/provider.ts` mainline;
- do **not** create a custom provider registry as the V4 core;
- do **not** make NovelFabric the owner of the semantic model loop;
- do make NovelFabric the owner of the workspace boundary, files, audit, and capability enforcement.

The SDK should be treated as the semantic execution layer that consumes:

- context packs;
- skill text;
- project docs;
- agent memory;
- capability manifests;
- CLI-generated proposals.

NovelFabric then validates and persists outputs.

---

## 7. Text-First Skill / Agent Model

Whenever behavior can be expressed as a constraint, it should be captured as text.

Examples:

- `AGENTS.md` rules
- `SKILL.md` actions
- `soul.md`
- `memory.md`
- `capabilities.toml`
- `context-pack` files
- proposal files
- review notes

Recommended skill families:

- `import-normalize`
- `import-chapterize`
- `card-propose`
- `memory-recall`
- `memory-append`
- `storyrag-search`
- `context-pack-build`
- `role-propose-action`
- `kp-adjudicate`
- `world-update`
- `project-audit`
- `report-render`
- `chapter-draft`
- `chapter-review`
- `timeline-branch-proposal`

These should live as text files and should be loadable by external agents through the CLI harness.

---

## 8. Frontend Repositioning

The mono app UI should not own the business logic.

Its role is:

- launch CLI-backed workflows;
- show job state;
- show evidence/artifacts;
- show file previews and review surfaces;
- allow controlled edits through bridge-backed write primitives;
- preserve browser-only acceptance.

The UI should call workflow commands, not invent a separate semantic runtime.

### 8.1 UI controls should map to CLI operations

Example flow:

```text
Upload source
  → CLI import normalize
  → CLI import chapterize
  → CLI import context-pack
  → pi-agent-driven card proposals
  → CLI cards apply
  → CLI simulation propose-action
  → CLI simulation append-turn
  → CLI simulation report
  → CLI writing apply-draft
```

### 8.2 The browser is not the backend

If a browser control exists, there should be a matching CLI primitive behind it.

---

## 9. External Reference Project Lessons

Reference projects were reviewed as workspace patterns, not code sources.

### 9.1 OpenAlice

Absorb:

- workspace-as-boundary;
- satellite workspace/template thinking;
- capability isolated tooling;
- file-native artifact flow.

Do not absorb:

- turning NovelFabric into a generic PTY manager;
- copy-pasting runtime implementation.

### 9.2 autogal

Absorb:

- agent harness around file artifacts;
- CLI-first loops;
- role/profile separation;
- text-native operation logs.

Do not absorb:

- game-specific or multi-agent infrastructure that bypasses NovelFabric primitives.

### 9.3 Auto-PPT

Absorb:

- workspace template assembly;
- artifact generation pipeline;
- clear input/output directories;
- command-based generation flow.

Do not absorb:

- turning NovelFabric into a presentation tool;
- UI-only generation without CLI traces.

---

## 10. Revised Phase Plan

### Phase 1 — CLI Contract Freeze

- enumerate every required CLI command;
- align docs and AGENTS;
- define JSON envelopes and error codes;
- preserve current file commands and workspace doctor behavior.

### Phase 2 — Agent / Skill Materialization

- materialize default agent assets;
- add skill templates;
- express role constraints as text;
- bind capability manifest to agent roles.

### Phase 3 — Import / Chapterize CLI

- text ingestion;
- encoding normalization;
- chunking;
- chapter candidate generation;
- context-pack output;
- no in-house provider layer.

### Phase 4 — Card / Memory Proposal Flows

- propose/apply/review split;
- role memory operations;
- shared memory proposal workflows.

### Phase 5 — StoryGraph / StoryRAG CLI

- derived indexes;
- search/context-pack commands;
- evidence-rich outputs.

### Phase 6 — Simulation / StorySwarm CLI

- state machine;
- action proposal;
- append-turn;
- report;
- branch/timeline validation.

### Phase 7 — Writing / Chapter CLI

- draft/review/apply/export;
- chapter evidence tracking;
- path-based audit.

### Phase 8 — pi Agent SDK Bridge

- use pi agent SDK to run semantics;
- retain NovelFabric CLI as the write gate;
- keep browser and agents behind CLI-backed bridge.

### Phase 9 — Web Shell Rewire

- bind UI controls to CLI commands;
- keep browser acceptance Playwright-only;
- remove template-only success paths.

### Phase 10 — End-to-End Acceptance

- one or more fixture-based browser runs;
- real semantic completion via pi agent SDK;
- no unresolved blockers.

---

## 11. Success Criteria For The Next Build Phase

We should only call a future browser/business-flow test successful if:

- LLM/agent semantics were actually executed through pi agent SDK or its local bridge;
- import/chapterization produced meaningful structured outputs;
- cards, context packs, role actions, swarm rounds, reports, and chapters are all artifacted;
- every durable write went through NovelFabric CLI primitives;
- browser controls only orchestrated CLI-backed work;
- no special case was written for a fixture source.

---

## 12. Bottom Line

The corrected plan is:

```text
NovelFabric = CLI-first workspace harness
pi agent SDK = semantic execution layer
skills/AGENTS = behavior constraints
workspace files = truth
Web UI = human control surface
```

That is the architecture the next implementation round should follow.
