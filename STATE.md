# STATE

## Current phase
Phase 27 — v3 usability: LLM/provider error reporting narrow slice active

## Current cycle
research → plan → execute → validate

## Verified findings
- `test_novel.txt` is GBK/GB18030 encoded; browser upload path preserves raw file bytes and backend GBK fallback normalizes to UTF-8 without visible乱码.
- LLM backend connection config is now separated from role model config:
  - Endpoint/key/API style live under `config/llm.json` via `/api/config/llm-endpoint`.
  - Default and per-role model overrides live under `config/roles.json` via `/api/config/llm-roles/:role_id`.
  - All roles initially resolve through `default`; manually saved role configs override model and optionally API style.
- LLM-generated skill bodies are now persisted to actual agent `skills/*.md` files with frontmatter (intent/target/mode/scope/consistency), verified by backend unit test reading file content directly from disk.
- LLM import success schema now accepts confidence, structured evidence paths, warnings, and generated skill-body suggestions; those fields are rendered into card bodies and browser-verified through a real local provider.
- StoryGraph rebuild now emits derived `MENTIONED_IN` / `VALID_IN_TIMELINE` edges, enabling browser-visible GraphRAG visualization rather than an empty graph shell.
- Browser strict acceptance imported `test_novel.txt`, rebuilt StoryGraph/RAG, verified GraphRAG visualization/edges, inspected agent assets, advanced 10 rounds, and verified writing-page export.
- Simulation page no longer exposes the temporary `testresult.txt` download; continuous simulation is controlled by a numeric “推演 N 次” input.
- New projects now bootstrap built-in system agent assets for `kp`, `random-event`, `world-maintainer`, `project-auditor`, `author`, and `reviewer`, including `soul.md`, `memory.md`, and one role skill template each.
- Goal 3 implementation now serializes structured `skill_invocations[]` evidence in StorySwarm round output, including skill file, parsed frontmatter, selected runtime action/path, evidence paths, and consistency status. Legacy swarm round JSON without `skill_invocations` remains readable with an empty invocation list.
- Settings Agent skill editor now loads actual existing `skills/*.md` file bodies into the editor before saving, so users can inspect and edit real skill contracts instead of only seeing file names.
- Simulation UI now renders visible skill invocation evidence cards for each agent output, including selected target/action, evidence paths, and skill-schema repair warnings when required frontmatter fields are missing.
- Goal 3 browser user-path acceptance passed with real backend/Vite/Chromium and no API/console shortcut: the browser imported `test_novel.txt` through Settings, loaded and edited an actual `kp-adjudicate.md` skill body, advanced Simulation, and verified visible invocation evidence.
- Playwright fullstack config now starts the Rust backend and Vite frontend on 50000+ ports, starts the local LLM provider fixture automatically, runs fullstack specs serially to avoid shared LLM config contamination, and keeps provider-backed browser acceptance on the local fixture instead of port 3000.
- Settings now validates per-role LLM overrides through the browser path: a user can save a role-specific model/API style, run healthcheck for that role, reload Settings, reselect the role, and see the override persist in visible UI.
- LLM/provider error reporting hardening now covers browser-visible healthcheck error categories for auth, model_not_found, provider_5xx, and network, plus backend timeout classification coverage and browser-visible invalid import schema reporting without guessed semantic cards.
- G004 final-gate hardening removed unchecked Playwright `rm -rf` data-dir cleanup, avoids browser-side full Blob text decoding during import upload, and preserves manually edited skill contracts by writing colliding LLM-imported skills to generated `*.imported-*.md` files instead of overwriting them.
- Import seeding is now non-destructive for existing character agent `soul.md`, `memory.md`, and `skills/character-decision.md`; collision behavior is covered by full agent-seeding and imported-skill regression tests.
- Generic external swarm inference API is available at `/api/external/swarm-inferences`, persists caller-provided items as text artifacts, advances StorySwarm over HTTP without caller code coupling, and was verified from an OpenAlice workspace harness with five real OpenAlice news-framework items on 2026-06-01.

## Current implementation status
- Backend tests cover GBK fixture import, LLM-required import failure behavior, invalid LLM import schema reporting, rich LLM success schema parsing/rendering, project deletion, split LLM endpoint/role config persistence, role-specific healthcheck default-model fallback, provider status/timeout healthcheck classification, StoryGraph artifacts with edges, skill body reads, structured skill invocation evidence serialization, legacy swarm JSON compatibility, invalid skill frontmatter warning evidence, and generic external swarm inference creation/readback.
- Frontend exposes project deletion, card deletion, memory deletion, skill body read/upsert/delete, split LLM endpoint/default/role override settings, per-role LLM healthcheck feedback, import extraction status/message/model, GraphRAG visualization, skill invocation evidence in Simulation, numeric N-round simulation, and writing-page text export.
- Browser-only acceptance specs are verified through Playwright Chromium using real UI interactions only; API-assisted fullstack coverage is labelled separately and is not counted as browser-only acceptance evidence.

## Global quality gates
- `HOME=/Users/dbydd CARGO_HOME=/Users/dbydd/.cargo RUSTC=/opt/homebrew/bin/rustc RUSTDOC=/opt/homebrew/bin/rustdoc /opt/homebrew/bin/cargo test --manifest-path backend/Cargo.toml -q` passes: 69 tests.
- `HOME=/Users/dbydd CARGO_HOME=/Users/dbydd/.cargo RUSTC=/opt/homebrew/bin/rustc RUSTDOC=/opt/homebrew/bin/rustdoc /opt/homebrew/bin/cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings` passes.
- `npm run test:unit -- --run` passes: 9 files / 27 tests.
- `npm run type-check` passes.
- `npm run build` passes.
- Browser user-path acceptance is covered by the automated fullstack suite with real backend/Vite/Chromium and no API/console shortcut for the browser-only specs. The suite runs backend on `127.0.0.1:50003`, Vite on `127.0.0.1:50004`, and the local provider on `127.0.0.1:50112`.
- Fullstack service automation suite passed through Playwright `webServer`: `cd frontend && HOME=/Users/dbydd CARGO_HOME=/Users/dbydd/.cargo RUSTC=/opt/homebrew/bin/rustc RUSTDOC=/opt/homebrew/bin/rustdoc NOVELFABRIC_CARGO=/opt/homebrew/bin/cargo PLAYWRIGHT_BROWSERS_PATH=/Users/dbydd/Library/Caches/ms-playwright npm run test:e2e:fullstack` passes 8 specs using 1 worker. Seven specs are browser UI paths, including visible network healthcheck failure; `story-systems.spec.ts` is API-assisted setup/verification coverage and is labelled as such.

## Known environment notes
- The Hermes profile HOME points at `~/.hermes/profiles/hermes-coding/home`; Cargo/Playwright should be run with `HOME=/Users/dbydd` or explicit cache paths to avoid broken profile-local cargo registry and missing Playwright browser cache.
- `/opt/homebrew/opt/rustup/bin/cargo` wrapper returns permission errors in this session; use `/opt/homebrew/bin/cargo` with explicit `RUSTC=/opt/homebrew/bin/rustc` and `RUSTDOC=/opt/homebrew/bin/rustdoc`.
- Full frontend unit tests now pass in this environment; keep running `npm run test:unit -- --run` before changing frontend test configuration.

## Next actions
1. Continue LLM/provider error reporting hardening with deeper invalid-schema diagnostics and practical browser timeout coverage if the provider/client behavior can make it deterministic without slowing the suite.
2. Keep `npm run test:e2e:fullstack` green when changing fullstack specs or shared LLM config behavior.

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
