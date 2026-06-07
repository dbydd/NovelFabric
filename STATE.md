# STATE

## Current phase

V4 TypeScript mono app — next iteration planning for Web workflow orchestration + Playwright UI-only acceptance after archiving the browser runtime task UI foundation.

## Current cycle

Archive completed pi-evidence, domain artifact, opt-in SDK AgentSession, Web-safe SDK tools, Web-safe mutation tools, structured event stream, async/SSE, and browser runtime task UI foundation work → keep active docs focused on unfinished gaps → next implementation starts with Web workflow orchestration + Playwright UI-only acceptance.

## Current V4 status

- `novelfabric_v4_mono/` is the active TypeScript mono app staging area for the CLI-first NovelFabric workspace harness.
- Broad CLI command families are available: `config`, `workspace`, `project`, `files`, `runtime`, `agents`, `agent`, `skills`, `import`, `cards`, `memory`, `knowledge`, `recall`, `context-pack`, `simulation`, `swarm`, `report`, `writing`, `workflow`, `external-swarm`, and `web`.
- Completed pi-backed semantic evidence hardening is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-pi-evidence-loop-archive.md`.
- Completed domain artifact materialization is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-domain-artifact-materialization-archive.md`.
- Completed opt-in SDK AgentSession execution is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-sdk-agent-session-opt-in-archive.md`.
- Completed Web-safe read-only SDK tools foundation is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-web-safe-sdk-tools-foundation-archive.md`.
- Completed Web-safe mutation tools foundation is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-web-safe-mutation-tools-foundation-archive.md`.
- Completed structured event stream foundation is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-structured-event-stream-foundation-archive.md`.
- Completed async Web bridge run registry + persistent SSE foundation is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-async-sse-foundation-archive.md`.
- Completed browser runtime task UI foundation is archived at `novelfabric_v4_mono/docs/architecture/archive/v4-browser-runtime-task-ui-foundation-archive.md`.
- Workflow pi-task stages now require pi evidence and domain artifact evidence for StorySwarm, ReportAgent, and writing outputs.
- Active planning now starts at **Web workflow orchestration + Playwright UI-only acceptance** over the archived browser runtime task UI and async/SSE foundations. The full product/business loop is still incomplete until Web-controlled workflow acceptance, semantic import, external swarm REST/MCP, and domain-specific capabilities are finished.
- Detailed active gap ledger and test standards live in:
  - `novelfabric_v4_mono/docs/architecture/v4-cli-workspace-harness-plan.md`
  - `novelfabric_v4_mono/docs/architecture/v4-cli-command-contract.md`
  - `novelfabric_v4_mono/docs/qa/v4-full-usability-acceptance.md`
- Historical V3 accepted-goal evidence has been archived to `docs/archive/v3-accepted-goals-archive.md`.

## Active next-iteration gaps

1. **Web workflow orchestration + Playwright UI-only acceptance** — browser controls use the archived browser runtime task UI and async/SSE foundations to execute upload/import → workflow jobs → runtime sessions → final domain artifact visibility without console/API shortcuts.
2. **Semantic import/materialization** — pi-backed generation of chapters, cards, world/rule assets, timeline, memory, and context packs with content-quality validation and reversible/conflict-safe apply.
3. **External swarm REST/MCP adapters** — preserve the frozen external swarm inference REST/MCP contract with golden fixture tests.
4. **Domain-specific capabilities** — tighten cards/memory/swarm/report/writing operations around narrow capabilities instead of broad project/file write authority.

## Required V4 verification gates

For V4 TypeScript changes under `novelfabric_v4_mono`, keep these gates green:

```bash
npm run typecheck
npm run lint
npm test
npm run test:runtime
npm run test:contracts
npm run test:acceptance
npm run build
npm run web:build
npm run format:check
npm run test:pi-acceptance
```

For optional Web/layout changes, also run the Web-specific dry-run/smoke commands listed in `novelfabric_v4_mono/AGENTS.md`.

For legacy Rust/backend or old frontend changes, use the archived V3/fullstack notes and preserve external swarm compatibility. Do not count legacy browser/fullstack success as proof that the V4 mono app business loop is complete.

## Known environment notes

- The Hermes profile HOME points at `~/.hermes/profiles/hermes-coding/home`; Cargo/Playwright should be run with `HOME=/Users/dbydd` or explicit cache paths to avoid broken profile-local cargo registry and missing Playwright browser cache.
- `/opt/homebrew/opt/rustup/bin/cargo` wrapper returns permission errors in this session; use `/opt/homebrew/bin/cargo` with explicit `RUSTC=/opt/homebrew/bin/rustc` and `RUSTDOC=/opt/homebrew/bin/rustdoc`.
- NovelFabric pi runtime config is expected under NovelFabric-owned paths such as `~/.config/novelfabric/pi/` or `$XDG_CONFIG_HOME/novelfabric/pi/`.
- `npm run test:pi-acceptance` is a hard gate and must fail rather than skip when model config or credentials are missing.
