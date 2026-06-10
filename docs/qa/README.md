# V4 QA Notes

This directory contains QA contracts, evidence notes, and report templates for the V4 mono app.

## Active QA Contract

Read first:

- `v4-full-usability-acceptance.md` defines the full usability standard, test layers, archived contract regression ledger, fixture requirements, and evidence requirements.

## Evidence Notes

- `browser-ui-persistence-smoke-2026-06-05.md` records the browser UI/file-persistence smoke that used Playwright and `test_novel.txt`.
- `../architecture/archive/v4-real-path-partial-coverage-2026-06-08.md` records the latest `test_novel.txt` real-path run, which proved the CLI workflow spine plus pi-backed domain artifacts but did **not** prove full canonical business completeness.

The browser UI smoke is retained only as evidence for UI controls, bridge writes, file visibility, and audit plumbing. The 2026-06-08 real-path archive is retained only as evidence that the workflow spine succeeded while canonical card/memory/timeline/simulation/chapter coverage remained incomplete. Neither archive is real business workflow acceptance.

## Templates

- `templates/acceptance-report.md` is the required report shape for future full acceptance runs.

Business-flow regression acceptance must keep proving NovelFabric-wrapped pi-agent-SDK semantic execution through CLI-backed Web controls, task/event traces, workspace artifacts, validation output, audit JSONL, and Playwright-visible user actions.

For content-level LLM validation, run:

```bash
npm run test:pi-acceptance
```

This is a hard gate: missing NovelFabric pi model config or LLM credentials must fail, not skip. Runtime model roles are split deliberately: `generic-writer` drives NovelFabric LLM workflow stages, while `flash-vibe` is reserved for acceptance/testing agents.
