# STATE

## Current phase

V4 TypeScript mono app — previous next-iteration gap ledger is closed and archived. Future work must open a fresh active gap with explicit tests before implementation.

## Current V4 status

- `novelfabric_v4_mono/` is the active TypeScript mono app staging area for the CLI-first NovelFabric workspace harness.
- Broad CLI command families are available: `config`, `workspace`, `project`, `files`, `runtime`, `agents`, `agent`, `skills`, `import`, `cards`, `memory`, `knowledge`, `recall`, `context-pack`, `simulation`, `swarm`, `report`, `writing`, `workflow`, `external-swarm`, and `web`.
- Completed V4 foundations are archived in `novelfabric_v4_mono/docs/architecture/archive/`:
  - pi-backed semantic evidence loop;
  - domain artifact materialization;
  - opt-in SDK AgentSession execution;
  - Web-safe SDK tools and mutation tools;
  - structured event stream;
  - async Web bridge run registry + persistent SSE;
  - browser runtime task UI;
  - Web workflow orchestration + Playwright UI-only acceptance;
  - semantic import/materialization;
  - external swarm REST/MCP adapters;
  - domain-specific capabilities.
- The previous active gap list is empty. Do not treat archived items as pending.
- New work must add a fresh gap entry with expected artifacts, content/evidence tests, and reviewer/verifier archival criteria before implementation.

## Required V4 regression gates

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

For browser workflow changes, also run:

```bash
npm run test:e2e
```

For optional Web/layout changes, also run the Web-specific dry-run/smoke commands listed in `novelfabric_v4_mono/AGENTS.md`.

## Known environment notes

- The Hermes profile HOME points at `~/.hermes/profiles/hermes-coding/home`; Cargo/Playwright should be run with `HOME=/Users/dbydd` or explicit cache paths to avoid broken profile-local cargo registry and missing Playwright browser cache.
- `/opt/homebrew/opt/rustup/bin/cargo` wrapper returns permission errors in this session; use `/opt/homebrew/bin/cargo` with explicit `RUSTC=/opt/homebrew/bin/rustc` and `RUSTDOC=/opt/homebrew/bin/rustdoc`.
- NovelFabric pi runtime config is expected under NovelFabric-owned paths such as `~/.config/novelfabric/pi/` or `$XDG_CONFIG_HOME/novelfabric/pi/`.
- `npm run test:pi-acceptance` is a hard gate and must fail rather than skip when model config or credentials are missing.
