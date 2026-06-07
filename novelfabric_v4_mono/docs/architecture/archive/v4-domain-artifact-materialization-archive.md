# V4 Completed Gap Archive — Domain Artifact Materialization

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active gaps live in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `3622179 feat: add domain materializers for agent task output` — service-level materializers from validated task/result.json output, plus focused materializer tests.
- `bb6a879 feat: require workflow domain artifacts from pi tasks` — workflow integration where verify requires both pi evidence and domain artifact evidence, with exact source-anchor validation and current job/stage/task-result provenance binding.

## Archived Completion State

The V4 mono app has completed the **domain artifact materialization** gap for workflow pi-task stages:

- Service-level materializers transform validated pi `task/result.json` output into durable NovelFabric domain artifacts.
- StorySwarm pi-task output materializes to StorySwarm proposal/output JSON under the simulation session.
- ReportAgent pi-task output materializes to report artifact JSON and applyable Markdown report content.
- Writing pi-task output materializes to draft/chapter artifacts with citation and source-anchor evidence.
- Workflow pi-task stages now record both pi evidence and domain artifact evidence for `swarm.task.create`, `report.task.create`, and `writing.draft`.
- `workflow verify` requires validated pi task evidence, domain artifact evidence, content hash checks, domain validation, and provenance binding to the current job/stage/task result.
- Domain materializers validate output kind/version, required markdown/action fields, citations, source anchors, placeholder rejection, and grounded source anchors.
- Source anchor schema validation uses exact item equality for required anchors rather than substring-only checks.

## Archived Verification Evidence

The accepted state passed the project verification gates, including:

```text
npm run typecheck
npm run lint
npm test
npm run test:runtime
npm run test:contracts
npm run test:acceptance
npm run build
npm run web:build
npm run format:check
npm run test:pi-acceptance
```

Representative test coverage includes:

- service-level materializer tests for swarm, report, and writing artifacts;
- negative tests for pending task results, invalid kind/version, missing markdown/action content, placeholder output, ungrounded anchors, and stale citation hashes;
- workflow tests proving missing domain artifacts fail verification even when pi evidence exists;
- workflow tests for hash mismatch, wrong job/stage/task provenance, stale paths, and exact source-anchor validation;
- real `generic-writer` workflow tests for StorySwarm, ReportAgent, and writing draft pi-task stages.

## Important Boundary

This archive proves that workflow pi-task output can become validated domain artifacts. It still does not complete the full product/business loop. Opt-in SDK AgentSession execution has since been completed and archived in `v4-sdk-agent-session-opt-in-archive.md`. Active gaps remain: Web-safe runtime extensions and Web bridge session orchestration, browser full workflow binding, semantic import/materialization, external swarm REST/MCP adapters, and domain-specific capabilities.
