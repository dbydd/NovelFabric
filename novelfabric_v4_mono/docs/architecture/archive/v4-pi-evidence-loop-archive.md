# V4 Completed Gap Archive — Pi Evidence Loop

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active gaps live in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Archived Completion State

The V4 mono app has completed the **pi-backed semantic evidence loop**:

- `agent run --runtime pi` launches the NovelFabric-owned pi CLI with `generic-writer` for workflow execution.
- The hard acceptance gate uses `flash-vibe` through `npm run test:pi-acceptance` and fails rather than skips when runtime config or credentials are missing.
- Workflow pi-task stages (`swarm.task.create`, `report.task.create`, `writing.draft`) create agent task packages, run the pi task, validate `output.schema.json`, and record `task/result.json` runtime evidence.
- Pi-task output validation requires source-grounded anchors and non-empty/schema-valid output.
- Workflow verification binds pi evidence to the current job/stage task id and result path.
- Workflow verification rejects missing, duplicate, ahead, unknown, mismatched, hashless, or tampered stage/evidence state.
- Source path extraction for simulation context hard-fails when a parsed source path cannot be read; it no longer silently falls back to path text.
- Real `generic-writer` tests cover all three pi-task stages: StorySwarm task, ReportAgent task, and writing draft task.

## Archived Verification Evidence

The accepted state passed:

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

Representative committed hardening topics:

- pi agent task execution with workflow evidence;
- required runtime evidence, non-empty output, and schema validation;
- source-anchor derivation from context packs;
- result hash preservation and tamper detection;
- workflow stage progression validation;
- source-read hard failure regression;
- documentation sync for the remaining domain artifact gap.

## Important Boundary

This archive proves semantic evidence, not full business completion. Domain artifact materialization has since been completed and archived in `v4-domain-artifact-materialization-archive.md`. The next active gap is the SDK `AgentSession` / Web-safe runtime bridge, followed by Web full workflow binding, semantic import/materialization, external swarm REST/MCP adapters, and domain-specific capabilities.
