# STATE

## Current phase
Phase 25 — Frontend cleanup for batch simulation, writing export, and built-in system agent templates

## Current cycle
research → plan → execute → validate

## Verified findings
- `test_novel.txt` is GBK/GB18030 encoded; browser upload path preserves raw file bytes and backend GBK fallback normalizes to UTF-8 without visible乱码.
- LLM backend connection config is now separated from role model config:
  - Endpoint/key/API style live under `config/llm.json` via `/api/config/llm-endpoint`.
  - Default and per-role model overrides live under `config/roles.json` via `/api/config/llm-roles/:role_id`.
  - All roles initially resolve through `default`; manually saved role configs override model and optionally API style.
- Import creates semantic character/world/rule assets plus per-character `soul.md`, `memory.md`, and `skills/character-decision.md` artifacts.
- StoryGraph rebuild now emits derived `MENTIONED_IN` / `VALID_IN_TIMELINE` edges, enabling browser-visible GraphRAG visualization rather than an empty graph shell.
- Browser strict acceptance imported `test_novel.txt`, rebuilt StoryGraph/RAG, verified GraphRAG visualization/edges, inspected agent assets, advanced 10 rounds, and verified writing-page export.
- Simulation page no longer exposes the temporary `testresult.txt` download; continuous simulation is controlled by a numeric “推演 N 次” input.
- New projects now bootstrap built-in system agent assets for `kp`, `random-event`, `world-maintainer`, `project-auditor`, `author`, and `reviewer`, including `soul.md`, `memory.md`, and one role skill template each.

## Current implementation status
- Backend tests cover GBK fixture import, semantic assets, project deletion, split LLM endpoint/role config persistence, and StoryGraph artifacts with edges.
- Frontend exposes project deletion, card deletion, memory deletion, skill deletion/upsert, split LLM endpoint/default/role override settings, GraphRAG visualization, numeric N-round simulation, and writing-page text export.
- Full browser UI acceptance is verified through Playwright Chromium using real UI interactions only; direct API calls/network injection were not used as the acceptance path.

## Global quality gates
- `HOME=/Users/dbydd CARGO_HOME=/Users/dbydd/.cargo RUSTC=/opt/homebrew/bin/rustc RUSTDOC=/opt/homebrew/bin/rustdoc /opt/homebrew/bin/cargo test --manifest-path backend/Cargo.toml -q` passes.
- `HOME=/Users/dbydd CARGO_HOME=/Users/dbydd/.cargo RUSTC=/opt/homebrew/bin/rustc RUSTDOC=/opt/homebrew/bin/rustdoc /opt/homebrew/bin/cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings` passes.
- `npm run test:unit -- --run src/views/SimulationView.spec.ts src/views/WritingView.spec.ts src/lib/workspace.spec.ts` passes.
- `npm run type-check` passes.
- `npm run build` passes.
- `HOME=/Users/dbydd PLAYWRIGHT_BROWSERS_PATH=/Users/dbydd/Library/Caches/ms-playwright PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 npx playwright test --config=playwright.fullstack.config.ts e2e-fullstack/strict-import-simulation.spec.ts` passes.

## Known environment notes
- The Hermes profile HOME points at `~/.hermes/profiles/hermes-coding/home`; Cargo/Playwright should be run with `HOME=/Users/dbydd` or explicit cache paths to avoid broken profile-local cargo registry and missing Playwright browser cache.
- `/opt/homebrew/opt/rustup/bin/cargo` wrapper returns permission errors in this session; use `/opt/homebrew/bin/cargo` with explicit `RUSTC=/opt/homebrew/bin/rustc` and `RUSTDOC=/opt/homebrew/bin/rustdoc`.
- `npm run test:unit -- --run` still fails on unrelated Electron specs under browser Vitest because of `No such built-in module: node:`; changed frontend workspace/settings tests pass when targeted.

## Next actions
1. Decide whether to keep `frontend/playwright.fullstack.config.ts` as the canonical full-stack acceptance config.
2. Separately fix Electron Vitest environment so full `npm run test:unit -- --run` is green.
3. Improve semantic extraction beyond deterministic fixture-oriented heuristics by wiring saved split LLM config into more import/runtime paths.
