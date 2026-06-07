# V4 Completed Gap Archive — Semantic Import / Materialization

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active planning lives in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `4275f89 feat: add semantic import materializer` — pi-backed semantic import task creation, materialization, validation, CLI integration, and workflow stage support.
- `d99d6a4 fix: canonical context pack for workflow cards.propose` — canonical import context pack output required by downstream card proposal workflow stages.

## Archived Completion State

The V4 mono app has completed the semantic import/materialization foundation:

- `import semantic` creates a NovelFabric agent task for semantic source extraction.
- Semantic import tasks require exact source anchors derived from the source and context pack.
- Validated pi task output materializes to `imports/semantic/*.json` with kind `novelfabric.import.semantic`.
- Materialized artifacts include chapters, characters, events, card seeds, citations, source hashes, context pack hashes, task provenance, and source anchors.
- Validation rejects stale source/context hashes, missing citations, low-substance summaries, and anchors that do not occur in the source text.
- Workflow includes an `import.semantic` pi-task stage and validates the resulting semantic import artifact before downstream card proposal stages.

## Archived Verification Evidence

Accepted gates include:

```text
npm run typecheck
npm run lint
npm test
npm run test:acceptance
npm run format:check
```

Representative coverage:

- `test/import/semantic.test.ts` covers task creation, source-grounded materialization, and invalid-anchor rejection.
- `test/cli/import.test.ts` covers the `import semantic` command through the CLI registrar.
- `test/workflow/index.test.ts` covers the workflow `import.semantic` stage and validates the resulting artifact.
- Browser workflow tests exercise semantic import as part of the visible source workflow path.

## Important Boundary

This archive proves semantic import materialization into validated NovelFabric artifacts. Future improvements may add richer extraction schemas or quality scoring, but those are enhancements to the archived foundation, not the active blocking gap.
