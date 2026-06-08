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

Current gap status:

The previous non-negotiable next-iteration gaps are now archived as completed foundations:

1. Web workflow orchestration + Playwright UI-only acceptance — `../architecture/archive/v4-web-workflow-orchestration-archive.md`.
2. Semantic import/materialization — `../architecture/archive/v4-semantic-import-archive.md`.
3. External swarm REST/MCP adapters — `../architecture/archive/v4-external-swarm-adapters-archive.md`.
4. Domain-specific capabilities — `../architecture/archive/v4-domain-capabilities-archive.md`.

There are currently no open gaps from the **previous** ledger. However, the latest `test_novel.txt` real-path run proved only a workflow spine plus pi-backed domain artifacts, not full canonical business completeness. Future gaps must be added here with explicit content/evidence tests before implementation.

## 8. Fresh Active Gap: Canonical Project Resource Materialization

Fresh active gap opened after the 2026-06-08 `test_novel.txt` real-path run.

Canonical gap document: `../architecture/v4-canonical-resource-materialization-gap.md`

Observed failures from the latest real-path run:

- `cards/rules`, `cards/scenes`, and `cards/world` remained empty after import/workflow completion.
- `memory/**`, `timeline/branches`, `simulation/turns`, `simulation/logs`, and `writing/chapters` remained empty or incomplete.
- the applied character card used a generic role-title shape (`aria Source Card`) instead of protagonist-backed extracted character content.

This gap must stay open until a real-path run produces canonical workspace resources with substantive content and source citations. A passing `workflow verify` alone is not sufficient evidence for product completeness.

Representative acceptance tests for closing this gap:

- a novel import must produce character/world/scene/rule cards from semantic import evidence;
- memory and timeline materialization must be exercised for at least one path each;
- simulation work must leave turn/log evidence;
- writing must reach canonical chapter apply, not only draft;
- Playwright and CLI acceptance must check workspace completeness, not only job/task status.

## 3. Test Layers

### 3.0 Archived Gap-Specific Acceptance Tests

The previously active next-iteration gap tests are archived and must remain green:

- Domain artifact materialization: `../architecture/archive/v4-domain-artifact-materialization-archive.md`.
- Opt-in SDK AgentSession execution: `../architecture/archive/v4-sdk-agent-session-opt-in-archive.md`.
- Web-safe SDK tools: `../architecture/archive/v4-web-safe-sdk-tools-foundation-archive.md`.
- Web-safe mutation tools: `../architecture/archive/v4-web-safe-mutation-tools-foundation-archive.md`.
- Structured event stream: `../architecture/archive/v4-structured-event-stream-foundation-archive.md`.
- Async/SSE bridge: `../architecture/archive/v4-async-sse-foundation-archive.md`.
- Browser runtime task UI: `../architecture/archive/v4-browser-runtime-task-ui-foundation-archive.md`.
- Web workflow orchestration + Playwright UI-only acceptance: `../architecture/archive/v4-web-workflow-orchestration-archive.md`.
- Semantic import/materialization: `../architecture/archive/v4-semantic-import-archive.md`.
- External swarm REST/MCP adapters: `../architecture/archive/v4-external-swarm-adapters-archive.md`.
- Domain-specific capabilities: `../architecture/archive/v4-domain-capabilities-archive.md`.

No completed gap should remain as an `it.todo` contract. New gaps must add a new subsection here with required tests before implementation.

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

### 3.5 Full-Acceptance Contract Tests

`test/acceptance/v4-full-usability.contract.test.ts` now acts as an archive-status regression ledger for the completed foundations above. It must not contain stale `it.todo` entries for completed work. If a future capability is not implemented yet, add a new pending contract with a precise gap name and test standard.

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

Browser gates for the archived Web workflow binding foundation:

- `npm run test:e2e` runs the stable browser gates only (`test/e2e/runtime-composer.spec.ts` by default).
- `npm run test:e2e:workflow` runs the slower full source-workflow gate (`test/e2e/source-workflow.spec.ts`) when a team needs the heavier workflow-backed browser evidence.

## 7. Definition Of Done

A V4 phase may be called complete only when:

- its command/service tests pass;
- its CLI JSON behavior is covered;
- its Web binding, if any, is Playwright-tested through visible controls;
- semantic claims include pi runtime evidence, and `test:pi-acceptance` validates output content rather than only file existence;
- deterministic shell commands label or behave as scaffold/task creation unless paired with validated semantic runtime evidence;
- every durable write is audited;
- any future pending contracts are either implemented or explicitly listed as fresh gaps with test standards.
