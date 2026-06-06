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

Current non-negotiable gaps:

- `agent run --runtime pi` records a deterministic run envelope; it does not yet launch a real pi AgentSession.
- Web workflow controls are not yet bound to the full workflow/agent runtime path.
- Semantic拆书, role reasoning, ReportAgent analysis, and chapter drafting are not yet pi-backed.
- External swarm REST and MCP adapters still need to call the shared external-swarm service and pass golden fixture tests.
- Several domain commands still need tighter domain-specific capabilities beyond broad project/file write capabilities.

## 3. Test Layers

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
- pi-backed stages are task creation or pending/runtime stages, not fake semantic success;
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

`test:pi-acceptance` must not skip. It fails immediately when NovelFabric-owned pi settings are missing `defaultProvider` / `defaultModel`, or when the configured pi process cannot reach a real LLM. When configured, it launches `node_modules/.bin/pi --print --no-tools`, feeds it a workflow context pack, requires structured JSON output with source-specific terms, writes that output through NovelFabric CLI, then re-reads the saved file and validates its content. This gate exists specifically to prevent tests that only prove file creation while allowing blank or irrelevant content.

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
