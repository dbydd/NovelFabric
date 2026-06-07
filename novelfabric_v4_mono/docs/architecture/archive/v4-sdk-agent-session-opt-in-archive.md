# V4 Completed Gap Archive — Opt-In SDK AgentSession Execution

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active gaps live in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `deb4d59` — SDK skeleton and runtime doctor gating: NovelFabric detects required `@earendil-works/pi-coding-agent` SDK exports, materializes/validates the NovelFabric-owned runtime envelope, and fails runtime doctor when required SDK exports are unavailable.
- `ae8490c` — opt-in `pi-sdk` runtime path: `agent run --runtime pi-sdk` can execute through an injectable SDK seam, record SDK events, preserve the existing task/result evidence envelope, and keep the stable CLI process bridge as the default runtime.
- `94e5551` — real pi-sdk acceptance gate: `npm run test:pi-sdk-acceptance` runs a real SDK AgentSession path through the NovelFabric-owned runtime config and hard-fails on missing model/config/SDK execution evidence.

## Archived Completion State

The V4 mono app has completed an **opt-in SDK AgentSession execution surface**:

- `agent run --runtime pi-sdk` exists as an explicit runtime option separate from the stable `--runtime pi` CLI process bridge.
- SDK availability is checked through the real pi SDK export surface.
- Runtime doctor fails rather than false-greening when required SDK exports are unavailable.
- The SDK path records task evidence in the same audited task/result shape expected by workflow verification and acceptance tooling.
- SDK acceptance is exposed through `npm run test:pi-sdk-acceptance`.
- Tests cover the injectable SDK seam, CLI runtime selection, assistant-output handling, stale-message rejection, and real acceptance execution.

## Known Limitations

This archive does **not** complete the full Web-safe runtime gap:

- the SDK path currently runs with raw model execution controls such as `noTools: "all"` and `noExtensions: true`;
- NovelFabric Web-safe pi extensions are not yet executing as SDK tools;
- browser session lifecycle, progress streaming, cancellation, retry, and visible runtime trace are not wired through the Web bridge;
- Web users still do not have the full `AgentSession` orchestration surface needed for nontechnical operation.

## Archived Verification Evidence

The accepted opt-in SDK state passed the project verification gates, including:

```text
npm run typecheck
npm run lint
npm run test:runtime
npm run test:contracts
npm run format:check
npm run test:pi-sdk-acceptance
```

## Important Boundary

This archive proves that an opt-in SDK AgentSession execution path exists and is testable. The next active gap is narrower: **Web-safe runtime extensions and Web bridge session orchestration**. That gap must prove NovelFabric-controlled SDK tools/extensions, denied raw dangerous tools, browser-visible event traces, and bridge lifecycle controls.
