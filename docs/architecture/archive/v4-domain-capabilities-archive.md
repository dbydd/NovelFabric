# V4 Completed Gap Archive — Domain-Specific Capabilities

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active planning lives in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `5be9630 feat: add domain-specific capability tightening for cards` — cards proposal/apply operations require cards-specific capabilities.
- `aa6fa4f feat: tighten domain-specific capabilities for writing/report/swarm/memory` — writing, report, swarm, and memory operations require narrow domain capabilities.

## Archived Completion State

The V4 mono app has completed the domain-specific capability tightening gap:

- Card proposal/apply flows use `cards.propose` and `cards.apply` rather than broad project/file authority.
- Memory flows use actor-scoped memory capabilities such as `memory.recall`, `memory.write_own`, `memory.propose_shared`, and `memory.apply_shared`.
- Simulation and swarm flows use narrow simulation/swarm capabilities such as `simulation.create`, `simulation.append_turn`, and `swarm.run`.
- Report flows use report-specific capabilities such as `report.render` and `report.apply`.
- Writing flows use writing-specific capabilities such as `writing.draft`, `writing.apply`, and `writing.export`.
- Capability denials fail explicitly with `capability_denied`; protected writes still require protected-file policy and protected capability checks.
- Tests prove main-agent success, role-agent denial, and capability audit metadata for representative domains.

## Archived Verification Evidence

Accepted gates include:

```text
npm run typecheck
npm run lint
npm test
npm run format:check
```

Representative coverage:

- `test/cards/proposals.test.ts` covers `cards.propose`/`cards.apply` success and denial.
- `test/memory/service.test.ts` covers actor-scoped memory permission behavior.
- `test/cli/cards-memory.test.ts`, `test/cli/report-writing.test.ts`, and `test/cli/simulation-swarm.test.ts` cover CLI-facing domain capability behavior.
- Domain materializer tests seed explicit domain capabilities and verify capability-protected writes continue to audit correctly.

## Important Boundary

New domain commands must continue this pattern: introduce a narrow capability name, enforce it in the shared service layer, and add success/denial/audit tests before exposing the command to Web or agent tools.
