# V4 Completed Gap Archive — Web Workflow Orchestration + Playwright UI-Only Acceptance

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active planning lives in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `26c7ebb feat: add workflow bridge routes` — bridge routes for workflow plan/start/peek/status/artifacts/verify/cancel.
- `5cac31f feat: add async workflow step runner` — asynchronous workflow step execution and status evidence.
- `0a96737 feat: add workflow ui binding` — Source Inbox workflow controls and browser-visible workflow status/artifacts.
- `9147677 feat: add playwright runtime composer e2e test` — browser runtime composer Playwright foundation.
- `d99d6a4 fix: canonical context pack for workflow cards.propose` — canonical context pack compatibility for workflow progression and browser acceptance.

## Archived Completion State

The V4 mono app has completed the Web workflow orchestration and UI-only browser acceptance gap at the foundation level required by the previous active ledger:

- Browser controls create workflow jobs from Source Inbox instead of requiring direct API calls.
- Workflow status, step execution, verification, and artifact visibility are exposed through the Web shell.
- Async workflow step execution prevents the browser from blocking on long LLM/pi stages.
- Workflow artifacts include StorySwarm output, ReportAgent artifacts, and writing drafts that can be opened in the editor.
- Playwright UI-only coverage exercises upload/import, workflow creation, step progression, verification, artifact listing, and final writing artifact inspection.
- Browser assertions reject internal path/session leakage and placeholder/template content.

## Archived Verification Evidence

Accepted gates include:

```text
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run format:check
```

Representative coverage:

- `test/e2e/source-workflow.spec.ts` proves the workflow can be driven through visible browser controls only.
- `test/e2e/runtime-composer.spec.ts` covers runtime composer UI behavior.
- `test/web/bridge-plugin.test.ts` covers bridge route behavior for workflow/runtime operations.
- `test/workflow/index.test.ts` covers workflow verification and artifact evidence integrity.

## Important Boundary

This archive proves the browser-controlled workflow foundation and UI-only acceptance path for the current V4 mono app. It does not remove the need to keep future browser features Playwright-tested and UI-only; any new workflow stage or artifact surface must extend the same controls-only evidence standard.
