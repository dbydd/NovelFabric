# V3 Accepted Goals Archive

> Historical accepted V3 usability goals moved out of active `STATE.md` so current V4 gap planning stays concise.

## V3 Goal 1 accepted — LLM healthcheck and visible settings feedback

- Current status: accepted after full-access browser verification on 2026-05-27.
- Implemented backend `POST /api/config/llm-healthcheck` with resolved endpoint/default-role config, provider/model/API style echo, latency, response preview, and user-facing error categories.
- Settings UI gives visible status for saving endpoint/key, default model, role override, import, card edits, agent asset edits, and skill edits; LLM healthcheck has a dedicated "测试当前 LLM" user action and visible result card.
- Historical pre-automation Playwright user-path test passed on 2026-05-27 before the fullstack `webServer` config was introduced; keep the exact command only as archived evidence, not as a current command under the 50000+ fullstack config: `PLAYWRIGHT_BROWSERS_PATH=/Users/dbydd/Library/Caches/ms-playwright PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 node node_modules/@playwright/test/cli.js test --config=playwright.fullstack.config.ts e2e-fullstack/llm-settings-feedback.spec.ts --project=chromium`.
- Current fullstack validation should use `cd frontend && npm run test:e2e:fullstack`, which starts backend/Vite/local-provider services on 50000+ ports through Playwright `webServer`.
- Supporting gates passed: backend `cargo fmt --check`, backend `cargo test` (57 passed), backend `cargo clippy --all-targets -- -D warnings`, frontend `SettingsView.spec.ts` (4 passed), `npm run type-check`, and `npm run build`.
- Next ultragoal story: G002 — LLM-required import extraction contract.

### V3 Goal 1 historical environment notes

- Earlier native-hook macOS sandbox runs could not accept G001 because local server binding and Chromium MachPort rendezvous bootstrap failed before page execution (`Permission denied 1100`). Those notes are retained as environment history only; they are superseded by the full-access browser verification above.

## V3 Goal 2 accepted — LLM-required import extraction contract

- G002 is accepted after full browser user-path verification of the failure path, rich success path, and clean-context independent review on 2026-05-27.
- Import failure path preserves raw/normalized text, chapter files, memory/timepoint records, and overview card, but does not create guessed semantic character/world/rule cards when LLM is unavailable or invalid.
- Rich LLM success path accepts confidence, structured evidence paths, warnings, and generated skill-body suggestions; those fields are rendered into card bodies and browser-verified through a real local provider.
- Backend import report and frontend Settings import report expose extraction status/message/model; the browser can see `LLM semantic extraction: llm_failed` / success status instead of only chapter count.
- Playwright failure-path and rich success-path tests pass through the automated fullstack suite with real backend, Vite, Chromium, and local provider services.
- Supporting gates passed: backend `cargo fmt`, backend `cargo test` (57 passed), backend `cargo clippy --all-targets -- -D warnings`, frontend `SettingsView.spec.ts` + `workspace.spec.ts` (9 passed), `npm run type-check`, and `npm run build`.
- Clean-context review judged the remaining skill-body browser visibility concern non-blocking for G002. Carry that follow-up into Goal 3: skill frontmatter contract, parsed invocation evidence, and Simulation UI display.

## V3 Goal 3 accepted — Skill card contract and invocation evidence

- Goal 3 is accepted after full browser user-path verification, clean-context review, and review-round hardening on 2026-05-27.
- StorySwarm round output serializes structured `skill_invocations[]` evidence with skill file, parsed frontmatter, selected runtime action/path, evidence paths, status, and repair guidance for invalid skill frontmatter.
- Legacy swarm round JSON without `skill_invocations` remains readable by defaulting the invocation list to empty.
- Simulation UI renders skill invocation evidence cards with evidence paths visible in the normal page content, not hidden behind collapsed disclosure.
- Settings Agent skill editor loads actual existing `skills/*.md` bodies before saving, so users can inspect and edit real skill contracts.
- Playwright Goal 3 skill evidence path passes through the automated fullstack suite with real backend/Vite/Chromium and a local provider service on 50000+ NovelFabric service ports.
- Supporting gates passed: backend `cargo fmt`, backend `cargo test` (63 passed), backend `cargo clippy --all-targets -- -D warnings`, frontend `SimulationView.spec.ts` + `SettingsView.spec.ts` + `workspace.spec.ts` (11 passed), `npm run type-check`, and `npm run build`.

## V3 Goal 4 accepted — Browser acceptance expansion for v3 usability

- Goal 4 is accepted after automated Playwright fullstack verification on 2026-05-28.
- Browser-only specs cover LLM settings feedback, provider/model healthcheck success and visible error categories, LLM-required import failure, invalid schema failure, rich semantic import success, skill invocation evidence, and strict `test_novel.txt` import → StoryGraph/RAG → agent assets → 10-round simulation → writing export.
- `story-systems.spec.ts` remains API-assisted setup/verification coverage and is explicitly not counted as browser-only acceptance evidence.
- Final-gate review blockers were fixed: Playwright data cleanup is constrained to `novelfabric-playwright-data-*` under the OS temp directory, browser import no longer decodes Blob uploads before sending bytes to backend, and LLM-imported skill suggestions no longer overwrite manually edited skill contracts.
- Supporting gates passed after hardening: backend `cargo fmt --check`, backend `cargo test` (69 passed), backend `cargo clippy --all-targets -- -D warnings`, frontend `npm run test:unit -- --run` (27 passed), `npm run type-check`, `npm run build`, and `npm run test:e2e:fullstack` (8 passed).
