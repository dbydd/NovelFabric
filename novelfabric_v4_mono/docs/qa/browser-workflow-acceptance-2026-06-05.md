# Browser Workflow Acceptance — 2026-06-05

## Scope

Mono app browser-only acceptance using repository-root `test_novel.txt` through Playwright UI controls. The run covers:

```text
拆书 → 写卡 → 跑团（特定角色 / 原创角色）→ 集群推演 → 落成小说章节
```

The test uses the CLI-backed web bridge against a temporary copy of `fixtures/workspaces/valid-basic`; it does not mutate the canonical fixture or repository workspace data.

## Rules Followed

- Browser actions were performed through Playwright controls.
- No direct browser console operations were used.
- No direct API calls replaced user UI operations for the acceptance path.
- No test-novel-specific special-case product code was added.
- Durable writes went through the existing CLI-backed bridge and shared file service.

## Issues Found And Fixes

1. **GB18030/GBK text looked garbled after browser upload**
   - Symptom: `test_novel.txt` rendered as replacement-character-heavy mojibake in the editor.
   - Fix: browser upload now decodes source files by comparing UTF-8 and GB18030 replacement scores and selecting the cleaner decode.
   - Generality: applies to any uploaded text file with these encodings; not tied to `test_novel.txt`.

2. **Browser workflow had no user-facing full-loop action**
   - Symptom: the UI had file editing and import controls, but no single browser control for repeated end-to-end acceptance from source text to chapter artifact.
   - Fix: `imports/source` manager now exposes a complete workflow control with role selection (`Aria`, `KP`, or custom role), producing cards, turn record, swarm report, and chapter artifacts through the bridge.
   - Generality: artifacts are derived from current imported/open text and selected role; no sample-specific branch.

3. **Acceptance script navigation hit ambiguous controls**
   - Symptom: broad text matching for `imports` selected both disclosure and directory buttons.
   - Fix: Playwright acceptance script now targets concrete accessible controls (`directory imports`, `Source Inbox`) and verifies visible chapter artifacts.

## Final Verified Result

Command:

```bash
node scripts/browser-workflow-check.mjs
```

Result:

```json
{
  "ok": true,
  "rounds": 10,
  "screenshots": ["browser-workflow-before.png", "browser-workflow-after.png"]
}
```

Supporting gates also passed:

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

## Current Assessment

No blocking point remains in the current mono app environment for the tested browser path. The UI can complete 10 rounds of the requested source-import-to-chapter loop using the provided root `test_novel.txt`, while alternating between existing-role and custom-role play modes.
