> Superseded note (2026-06-05): the gap inventory remains useful, but any "LLM provider" or custom backend-runtime wording should be read as "pi agent SDK / skill-driven agent execution". The active implementation direction is `v4-cli-workspace-harness-plan.md`.

# V4 Real Business Workflow Gap Plan

> Status: next-phase plan after browser workflow acceptance correction. The 10-round Playwright loop verified UI controls, bridge writes, and artifact visibility, but it did **not** prove real NovelFabric business logic because no LLM / agent / external swarm backend performed semantic work.

## 1. What The Browser Test Actually Proved

The current mono app can do the following through browser controls:

- upload a source text file from `imports/source`;
- decode UTF-8 or GB18030/GBK-like text well enough for display;
- write uploaded text through the CLI-backed bridge and shared file service;
- create visible workspace artifacts for cards, turns, reports, and chapters;
- save those artifacts through capability-checked file writes with audit logs;
- run this UI/file-write path repeatedly for 10 rounds with both existing-role and custom-role selections.

This is valuable UI and persistence plumbing, but the generated artifacts are deterministic text assembled from templates and excerpts. They are not semantic拆书, role reasoning, StoryRAG retrieval, StorySwarm inference, or prose generation.

## 2. Missing Capabilities For A Real Business Loop

A real loop must complete:

```text
上传/导入原文 → LLM 拆书 → 结构化卡片 → 角色带入跑团 → 集群推演 → 报告/审计 → 章节生成 → 文件落盘
```

Current gaps:

### 2.1 LLM Provider / Agent Invocation

Missing:

- provider configuration for web/CLI workflow execution;
- model health check inside V4 mono app;
- prompt/template execution service;
- structured JSON output validation and repair loop;
- retry / timeout / cancellation handling;
- user-visible evidence that a backend model actually ran.

Current state:

- `src/agent-runtime/pi-adapter.ts` only declares a future pi bridge boundary.
- `web bridge` is file-bridge only; `piAgentBridge` remains `planned-disabled`.
- No CLI command performs LLM-backed import, card extraction, role reasoning, or chapter drafting.

### 2.2 Import / 拆书 Pipeline

Missing:

- canonical import job model;
- chapter segmentation over long source text;
- source chunk manifests with byte/line offsets;
- LLM-assisted synopsis / chapter extraction;
- failure artifacts that preserve raw text, normalized text, partial chapters, and validation errors;
- browser controls to inspect/retry import stages.

Current state:

- upload writes the raw source file;
- current workflow only takes a short excerpt and templates derived artifacts.

### 2.3 Card Extraction / Writing Cards

Missing:

- structured schemas for character/world/rule/scene cards;
- LLM extraction prompts and validation;
- citation paths back to source chunks;
- merge/conflict handling when extracted cards already exist;
- UI review/apply flow for accepted/rejected card proposals.

Current state:

- `cards/characters/imported-protagonist-XX.md` and `cards/scenes/imported-scene-XX.md` are generated from fixed templates.

### 2.4 StoryGraph / StoryRAG

Missing:

- graph/index rebuild command;
- entity/relation extraction from source, cards, memory, timeline, simulation logs, and chapters;
- quick_search / panorama_search / insight_forge service APIs;
- citations with file path, source range, timeline/timepoint, and relation provenance;
- UI integration showing retrieved evidence before推演/写作.

Current state:

- graph UI is visual/static interaction plus local node editing;
- no derived StoryGraph/StoryRAG index is built or queried.

### 2.5 Role Reasoning / 跑团

Missing:

- actor/profile/card identity resolution;
- capability-scoped context pack creation;
- role prompt templates;
- role memory recall with redaction/source metadata;
- action proposal schema;
- KP/world-maintainer/project-auditor validation passes;
- append-turn command that writes session log, memory proposal, timepoint/branch events, and graph deltas.

Current state:

- UI role select chooses `Aria`, `KP`, or custom role string;
- no role agent actually reasons over context.

### 2.6 StorySwarm / External Swarm

Missing:

- real StorySwarm orchestration service for `characters -> random-event -> world-maintainer -> kp -> project-auditor`;
- compatibility-preserving invocation path for frozen external swarm REST/MCP surface;
- golden fixtures proving HTTP/MCP serializer compatibility;
- browser workflow control that can start/poll/cancel a swarm run without direct API bypass;
- artifact manifests for each round.

Current state:

- external swarm compatibility is displayed, but not invoked;
- current report text is deterministic.

### 2.7 ReportAgent / Chapter Generation

Missing:

- ReportAgent that consumes StoryRAG + session + agent interviews;
- consistency audit report generation;
- branch impact analysis;
- chapter drafting prompt with source/card/session citations;
- chapter review/edit/apply workflow;
- output validation for chapter metadata and evidence.

Current state:

- `writing/chapters/browser-chapter-XX.md` is a template containing role name and excerpt.

### 2.8 Browser Execution Model

Missing:

- web bridge endpoints for workflow jobs beyond files tree/read/write;
- job state model: queued/running/waiting-for-user/failed/completed;
- streaming logs/status without browser console;
- retry/continue controls after a failed stage;
- visual proof of backend model calls and structured output evidence;
- acceptance tests that operate only through controls while asserting real backend artifacts.

Current state:

- browser controls can write files and open artifacts;
- no true workflow job backend exists.

## 3. Next-Phase Development Plan

### Phase A — Workflow Contract And Schemas

Deliverables:

- `src/workflow/` schemas for import jobs, extracted cards, context packs, role actions, swarm rounds, reports, and chapters.
- CLI commands:
  - `novelfabric workflow start --workspace ... --source imports/source/x.txt --json`
  - `novelfabric workflow status --workspace ... --job <id> --json`
  - `novelfabric workflow continue --workspace ... --job <id> --json`
- All workflow mutations still use shared services, safe paths, protected policy, and audit.

Verification:

- schema unit tests;
- CLI job fixture tests;
- no LLM yet, but no template-only success claim.

### Phase B — LLM Provider / Agent Execution Adapter

Deliverables:

- V4 workflow model config loaded from XDG config with env fallback only;
- health check command;
- typed LLM call abstraction with structured-output validation;
- prompt templates for import, card extraction, role reasoning, swarm report, and chapter drafting;
- evidence logs recording provider/model/prompt hash/output schema.

Verification:

- provider health command;
- mocked provider unit tests;
- one real-provider smoke only when credentials/config are present.

### Phase C — Import + Card Extraction

Deliverables:

- long-text chunking and chapter segmentation;
- LLM-assisted summaries and card proposals;
- card proposal review/apply files;
- UI controls in `imports/source` to run/retry stages and inspect citations.

Verification:

- `test_novel.txt` import produces source chunks, chapter candidates, card proposals, and citations;
- tests also run against at least one synthetic non-`test_novel.txt` fixture.

### Phase D — StoryRAG + Context Pack

Deliverables:

- derived index files under `knowledge/`;
- `quick_search`, `panorama_search`, `insight_forge` commands/services;
- context pack builder with role-scoped permissions;
- UI evidence pane for retrieved facts.

Verification:

- retrieval outputs include file paths, source excerpts/ranges, entities, relation labels, and timeline/timepoint when available.

### Phase E — Role Reasoning + StorySwarm

Deliverables:

- role action proposal schema;
- role memory recall and redaction;
- default round order: `characters -> random-event -> world-maintainer -> kp -> project-auditor`;
- append-turn/session/memory/timepoint artifacts;
- external swarm compatibility tests remain green.

Verification:

- one complete run with existing role;
- one complete run with custom role;
- generated artifacts contain actual LLM outputs and citations.

### Phase F — ReportAgent + Chapter Generation

Deliverables:

- ReportAgent consistency audit and branch impact reports;
- chapter drafting from accepted swarm/report outputs;
- chapter metadata/evidence validation;
- browser review/apply controls.

Verification:

- chapter output is not a fixed template and cites cards/session/report artifacts.

### Phase G — Browser Acceptance Re-run

Deliverables:

- Playwright test that uses only browser controls;
- no console/API shortcuts;
- ten-loop run may pause/retry on failures but must record blockers;
- assertions prove model-backed artifacts exist, including provider/model evidence logs.

Acceptance criteria:

- at least one full loop with `test_novel.txt` completes;
- at least one full loop with a different fixture completes;
- ten-loop browser run completes without unresolved blockers;
- all writes are audited;
- no sample-specific branching or bypass code exists.

## 4. Documentation Correction

The prior browser acceptance should be treated as a UI/file-persistence acceptance, not as full business acceptance. Full acceptance is deferred until Phases A–G are implemented and verified.
