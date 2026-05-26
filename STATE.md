# STATE

## Current phase
Phase 23 — Strict import, asset deletion, LLM config, and 10-round acceptance

## Current cycle
research → plan → execute → validate

## Verified findings
- `test_novel.txt` is GBK/GB18030 encoded; lossy UTF-8 decoding produced visible乱码.
- Backend import now decodes non-UTF8 Chinese txt through GBK fallback and preserves normalized UTF-8 text without replacement characters.
- Import creates semantic character/world/rule assets plus per-character `soul.md`, `memory.md`, and `skills/character-decision.md` artifacts.
- Project/card/memory/agent-skill deletion endpoints and frontend management buttons exist.
- Frontend LLM configuration persists to backend local `config/llm.json` using pi-agent/OpenAI-chat style fields compatible with `models.json`.
- A local acceptance project imported `test_novel.txt`, rebuilt StoryGraph, created simulation assets, advanced 10 rounds, and wrote `testresult.txt`.

## Current implementation status
- Backend tests cover GBK fixture import and semantic assets, project deletion, and LLM config persistence.
- Frontend exposes project deletion, card deletion, memory deletion, skill deletion/upsert, LLM settings, 10-round simulation, and `testresult.txt` download action.
- Browser launch was verified through the available macOS browser automation surface, but deeper DOM/click control was blocked by host Accessibility/JavaScript automation permissions in this session.

## Global quality gates
- `cargo test --manifest-path backend/Cargo.toml -q` passes.
- `cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings` passes.
- `npm run test:unit -- --run` passes.
- `npm run type-check` passes.
- `npm run build` passes.

## Next actions
1. Re-run full browser UI acceptance once Codex Browser Node REPL or host Accessibility/Apple Events permissions are exposed.
2. Improve semantic extraction beyond deterministic fixture-oriented heuristics by wiring saved LLM config into import extraction.
3. Re-run acceptance from a clean project after UI browser control is unblocked.
