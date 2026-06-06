# V4 QA Notes

This directory contains QA contracts, evidence notes, and report templates for the V4 mono app.

## Active QA Contract

Read first:

- `v4-full-usability-acceptance.md` defines the full usability standard, test layers, pending contracts, fixture requirements, and evidence requirements.

## Evidence Notes

- `browser-ui-persistence-smoke-2026-06-05.md` records the browser UI/file-persistence smoke that used Playwright and `test_novel.txt`.

That smoke is retained only as evidence for UI controls, bridge writes, file visibility, and audit plumbing. It is not real business workflow acceptance.

## Templates

- `templates/acceptance-report.md` is the required report shape for future full acceptance runs.

Future business-flow acceptance must prove NovelFabric-wrapped pi-agent-SDK semantic execution through CLI-backed Web controls, task/event traces, workspace artifacts, validation output, audit JSONL, and Playwright-visible user actions.

For content-level LLM validation, run:

```bash
npm run test:pi-acceptance
```

This is a hard gate: missing NovelFabric pi model config or LLM credentials must fail, not skip. Runtime model roles are split deliberately: `generic-writer` drives future NovelFabric LLM workflow stages, while `flash-vibe` is reserved for acceptance/testing agents.
