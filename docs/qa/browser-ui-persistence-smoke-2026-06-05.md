# Browser UI Persistence Smoke — 2026-06-05

> Status: retained QA evidence for UI controls, file persistence, and bridge plumbing. This is **not** real business-flow acceptance.

## Scope

This smoke run used Playwright UI controls with repository-root `test_novel.txt` to verify that the mono app Web shell can:

- open the CLI-backed Web bridge on a temporary workspace copy;
- upload a source text file through a browser file input;
- decode UTF-8 / GB18030-style text cleanly enough for display;
- write the uploaded file through the shared file service;
- show generated workspace artifacts in the file tree/editor;
- repeat UI interactions for 10 rounds without blocking the browser or bridge.

## What It Proved

The run proved:

```text
browser controls → bridge → shared file service → workspace files + audit
```

It also verified that the UI was human-operable enough for repeated source-inbox and file-opening interactions.

## What It Did Not Prove

The run did **not** prove real NovelFabric business logic:

- no pi agent SDK session performed semantic work;
- no real LLM-backed 拆书 occurred;
- no role agent reasoned over context;
- no StoryRAG evidence retrieval drove推演;
- no StorySwarm / ReportAgent analysis was executed;
- generated cards/reports/chapters were template-style browser artifacts.

Future acceptance must use the CLI workspace harness and pi agent SDK path described in:

```text
docs/architecture/v4-cli-workspace-harness-plan.md
docs/architecture/v4-cli-command-contract.md
```

## Issues Found During The Smoke

1. **GB18030/GBK text looked garbled after browser upload**
   - Fix: browser upload decodes source files by comparing UTF-8 and GB18030 replacement scores and selecting the cleaner decode.
   - Generality: applies to uploaded text files with these encodings; it is not tied to `test_novel.txt`.

2. **Source-inbox controls needed a browser-visible loop entry**
   - Fix: added a Web-visible control path for repeated UI/persistence smoke interactions.
   - Correction: this control path must not be treated as real semantic workflow acceptance.

3. **Playwright navigation hit ambiguous controls**
   - Fix: test automation now targets concrete accessible controls such as `directory imports` and `Source Inbox`.

## Final Smoke Evidence

Command used at the time:

```bash
node scripts/browser-workflow-check.mjs
```

Representative result:

```json
{
  "ok": true,
  "rounds": 10,
  "screenshots": ["browser-workflow-before.png", "browser-workflow-after.png"]
}
```

Supporting gates passed during that run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
npm run format:check
```

Test suite evidence:

```text
7 test files passed
47 tests passed
```

## Current Use

Keep this document only as UI/file-persistence smoke history. Do not cite it as proof that NovelFabric can complete the real import → cards → role play → StorySwarm → ReportAgent → chapter business loop.
