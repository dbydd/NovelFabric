# NovelFabric V4 Full Usability Acceptance

> Active QA contract. This document defines what counts as fully usable NovelFabric V4 behavior. It intentionally separates deterministic CLI harness success from true pi-backed business success.

## 1. Goal

NovelFabric V4 is complete for nontechnical users only when a user can open the mono app Web shell and complete this loop without touching raw `bash`, raw `write`, raw `edit`, arbitrary paths, or provider configuration:

```text
upload/import source text
  -> pi-backed semantic book split
  -> citation-backed card proposals
  -> StoryRAG/context-pack rebuild
  -> role reasoning and StorySwarm turns
  -> ReportAgent analysis
  -> chapter draft generation
  -> review/apply/export
  -> audit and rollback evidence
```

A deterministic CLI command or browser template is useful harness progress, but it is not business success unless it carries pi/runtime evidence and accepted workspace artifacts.

## 2. Current Status Snapshot

As of the current V4 mono app state, the following command families exist and are test-covered at the CLI/service layer:

```text
config, workspace, project, files, runtime, agents, agent, skills, import,
cards, memory, knowledge, recall, context-pack, simulation, swarm,
report, writing, workflow, external-swarm, web
```

Current strengths:

- CLI command surface is broad and machine-readable.
- Workspace writes route through shared file services with safe paths, symlink rejection, capability checks, protected path policy, atomic writes, and audit.
- Runtime config materializes a NovelFabric-owned pi config envelope under `~/.config/novelfabric/pi` or `$XDG_CONFIG_HOME/novelfabric/pi`.
- Workflow/job/task artifacts are explicit files under `.novelfabric/`.
- External swarm CLI wrapper preserves the compatibility shape at the artifact level.

Current non-negotiable gaps, in next-iteration order:

1. **Web-safe pi SDK runtime** — `agent run --runtime pi` now launches the NovelFabric-owned pi CLI with `generic-writer` and records completed result/domain evidence, but Web runtime sessions still need a Web-safe pi SDK `AgentSession` wrapper, event stream, runtime trace, and enforced tool policy.
2. **Web full workflow binding** — Web workflow controls are not yet bound to upload/import → semantic拆书 → cards/memory/timeline → StoryRAG/context → StorySwarm → ReportAgent → chapter generation → editor review/save through the full workflow/agent runtime path.
3. **Semantic import/materialization** — deterministic import exists, but source text still needs pi-backed chapter/card/world/rule/timeline/memory/context-pack generation with content-quality validation.
4. **External swarm REST/MCP adapters** — adapters still need to call the shared external-swarm service and pass golden fixture tests for the frozen compatibility contract.
5. **Domain-specific capabilities** — cards/memory/swarm/report/writing commands still need tighter domain capabilities beyond broad project/file write capabilities.

## 3. Test Layers

### 3.0 Gap-Specific Acceptance Tests For Next Iteration

The next iteration is not accepted until these tests exist and pass for each implemented gap:

Completed domain artifact materialization tests are archived in `../architecture/archive/v4-domain-artifact-materialization-archive.md`. The active gap-specific gates begin at SDK runtime.

#### Gap 1 — SDK AgentSession / Web-Safe Runtime

Required tests:

- runtime service test instantiates the pi SDK bridge with a temp NovelFabric config root;
- event-stream test asserts stable event types for session started, model output, tool request/denial, validation, completion, and failure;
- policy tests prove Web sessions deny raw `bash`, raw `write`, raw `edit`, arbitrary network, and arbitrary paths;
- compatibility test proves CLI process bridge and SDK bridge produce equivalent task evidence envelopes where applicable.

#### Gap 2 — Web Full Workflow Binding

Required tests:

- Playwright test uses UI controls only, with 50000+ ports and no console/API shortcuts;
- user flow covers upload/import, semantic assets, context/RAG, StorySwarm, ReportAgent, chapter generation, editor review, and save;
- assertions inspect visible runtime evidence, final domain artifacts, editor content, and audit records.

#### Gap 3 — Semantic Import / Materialization

Required tests:

- at least two source fixtures with different names/entities/scenes;
- generated chapters/cards/world/rules/timeline/memory/context packs cite source excerpts and contain fixture-specific but non-hardcoded content;
- invalid or low-quality pi output fails validation and leaves source files intact;
- apply is reversible or conflict-safe through base hashes and audit.

#### Gap 4 — External Swarm REST/MCP Adapters

Required tests:

- REST golden tests for `POST /api/external/swarm-inferences` and `GET /api/external/swarm-inferences/{inference_id}`;
- MCP golden tests for `tools/list` and `tools/call` on `external_swarm_infer`, `external_swarm_require_context`, and `external_swarm_get`;
- idempotency, artifact path semantics, `structuredContent`, and additive-field compatibility are asserted.

#### Gap 5 — Domain-Specific Capabilities

Required tests:

- main agent can perform authorized card/memory/swarm/report/writing operations;
- role agent cannot run external swarm, write other profiles' private memory, patch protected files, or materialize global artifacts without explicit capability;
- audit records include actor, capability, reason, target path, and resulting hash.

### 3.1 Workspace Service Tests

Required evidence:

- path traversal rejection;
- symlink escape rejection;
- protected write denial;
- base-hash conflict detection;
- append/patch/write audit JSONL;
- derived artifact hash validation.

Representative tests:

```text
test/workspace/files.test.ts
test/workspace/project.test.ts
test/fs/safe-path.test.ts
```

### 3.2 CLI Command Tests

Every command family must have at least one focused CLI test that proves:

- JSON envelope shape;
- non-zero exit behavior for validation failures where relevant;
- actor/capability behavior for writes;
- artifact path and hash evidence.

Representative tests:

```text
test/cli/*.test.ts
```

### 3.3 Runtime Policy Tests

The wrapped pi runtime must prove:

- config root resolves to NovelFabric-owned paths;
- materialized extensions are NovelFabric-approved metadata;
- Web-safe policy denies raw `bash`, raw `write`, raw `edit`, network, and arbitrary path access;
- allowed tools are NovelFabric adapters such as `novelfabric_write_file` and `novelfabric_validate`.

Representative tests:

```text
test/runtime/config.test.ts
test/commands/runtime.test.ts
test/cli/agent-task.test.ts
```

### 3.4 Workflow State Tests

Workflow tests must prove that job state is honest:

- deterministic stages may complete when artifacts are produced;
- pi-task stages synchronously run the NovelFabric-owned pi CLI with `generic-writer`;
- task creation alone is not completion: pi execution must finish with completed runtime evidence, schema-valid output, and required source anchors;
- `workflow verify` requires hashed result evidence bound to the current job/stage before pi-task stages count as complete;
- workflow verification must continue requiring corresponding StorySwarm output, ReportAgent artifact, or writing draft/chapter artifact in addition to `task/result.json`; these domain artifacts must be hash-verified and pass domain validation;
- failed/cancelled/retry states preserve trace and artifacts;
- `workflow verify` detects unreadable or mutated artifacts.

Representative tests:

```text
test/workflow/index.test.ts
test/cli/workflow.test.ts
```

### 3.5 Pending Full-Acceptance Contract Tests

The following tests are intentionally pending until the underlying feature exists:

```text
test/acceptance/v4-full-usability.contract.test.ts
```

They cover:

- real pi AgentSession execution;
- nontechnical Web workflow with no dangerous tool exposure;
- pi-backed semantic拆书;
- pi-backed role reasoning and StorySwarm;
- pi-backed ReportAgent and chapter draft;
- Playwright-only browser acceptance;
- frozen external swarm REST/MCP adapters.

Pending contract tests do not count as pass. They are a visible gap ledger.

## 4. Fixture Requirements

Minimum fixtures:

- `fixtures/workspaces/valid-basic` for safe workspace shape;
- repository-root `test_novel.txt` for historical browser/file smoke;
- a second non-sample source text for generality;
- a capability-restricted workspace fixture;
- a protected/conflict workspace fixture;
- external swarm golden request/response fixtures.

No implementation may special-case fixture names.

## 5. Evidence Requirements

A full acceptance report must include:

- commit SHA;
- workspace fixture path;
- NovelFabric pi config root;
- workflow job id;
- pi session id and event trace;
- allowed tool policy;
- task package path;
- context-pack hashes;
- proposal/artifact paths;
- validation command outputs;
- audit JSONL paths;
- final chapter/report files;
- Playwright screenshots or trace for browser runs.

## 6. Test Commands

Quick local gate:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
npm run format:check
```

Focused gates:

```bash
npm run test:runtime
npm run test:contracts
npm run test:acceptance
```

Hard pi-backed content gate:

```bash
npm run test:pi-acceptance
```

`test:pi-acceptance` must not skip. It fails immediately when NovelFabric-owned pi settings are missing `testModelDefaults` or a usable fallback `defaultProvider` / `novelFabricTestModel`, or when the configured pi process cannot reach a real LLM. When configured, it launches `node_modules/.bin/pi --print --no-tools`, feeds it a workflow context pack, requires structured JSON output with source-specific terms, writes that output through NovelFabric CLI, then re-reads the saved file and validates its content. This gate exists specifically to prevent tests that only prove file creation while allowing blank or irrelevant content.

Model roles:

- `modelDefaults` / `novelFabricWorkflowModel` should point to `generic-writer`; this model drives future NovelFabric LLM-backed writing and workflow stages.
- `testModelDefaults` / `novelFabricTestModel` should point to `flash-vibe`; this model is reserved for acceptance/testing agents only.

Browser gates, once Web workflow binding exists:

```bash
npm run test:e2e
```

## 7. Definition Of Done

A V4 phase may be called complete only when:

- its command/service tests pass;
- its CLI JSON behavior is covered;
- its Web binding, if any, is Playwright-tested through visible controls;
- semantic claims include pi runtime evidence, and `test:pi-acceptance` validates output content rather than only file existence;
- deterministic shell commands label or behave as scaffold, task creation, or pending work rather than semantic completion;
- every durable write is audited;
- known pending contracts are either implemented or explicitly listed as gaps.
