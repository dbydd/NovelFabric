# V4 Architecture Documents

This directory keeps the active NovelFabric V4 mono app architecture documents.

## Active V4 Direction

Read these first for current V4 work:

1. `v4-cli-workspace-harness-plan.md` — canonical CLI-first workspace harness plan and current progress/gap snapshot.
2. `v4-cli-command-contract.md` — target `novelfabric` CLI command surface, JSON envelopes, error codes, capabilities, and implementation status.
3. `../qa/v4-full-usability-acceptance.md` — full usability test contract and evidence standard.
4. `v4-mono-frontend-plan.md` / `v4-mono-frontend-plan.zh.md` — Web shell design and bridge integration rules.

## Historical Cleanup

The earlier custom-LLM/fullstack drafts were removed from this directory. Their useful corrections were merged into the CLI harness plan and command contract.

Do not reintroduce a NovelFabric-owned provider runtime as the V4 mainline. Semantic execution belongs to the NovelFabric-wrapped pi agent SDK runtime or external agents under NovelFabric skills, CLI guardrails, runtime extensions, and Web-safe tool policies. Current runtime model roles are fixed in the active plans: `generic-writer` drives real NovelFabric workflow execution, while `flash-vibe` is reserved for hard acceptance/testing agents.

## Current Gap Snapshot For Next Iteration

Completed pi-evidence hardening is archived in `archive/v4-pi-evidence-loop-archive.md`; completed domain artifact materialization is archived in `archive/v4-domain-artifact-materialization-archive.md`; completed opt-in SDK AgentSession execution is archived in `archive/v4-sdk-agent-session-opt-in-archive.md`; completed Web-safe read-only SDK tools foundation is archived in `archive/v4-web-safe-sdk-tools-foundation-archive.md`; completed Web-safe mutation tools foundation is archived in `archive/v4-web-safe-mutation-tools-foundation-archive.md`; completed structured event stream foundation is archived in `archive/v4-structured-event-stream-foundation-archive.md`; completed async Web bridge run registry + persistent SSE foundation is archived in `archive/v4-async-sse-foundation-archive.md`; completed browser runtime task UI foundation is archived in `archive/v4-browser-runtime-task-ui-foundation-archive.md`; completed Web workflow orchestration + Playwright UI-only acceptance is archived in `archive/v4-web-workflow-orchestration-archive.md`; completed semantic import/materialization is archived in `archive/v4-semantic-import-archive.md`; completed external swarm REST/MCP adapters are archived in `archive/v4-external-swarm-adapters-archive.md`; completed domain-specific capabilities are archived in `archive/v4-domain-capabilities-archive.md`.

The previous next-iteration gap ledger is now empty: Web workflow orchestration, semantic import/materialization, external swarm REST/MCP adapters, and domain-specific capabilities have all been implemented, tested, and archived. Active planning should not re-list these as pending work. Future work must open a new gap entry with its own test standard rather than reusing stale completed gaps. Keep the full-usability gates green and extend them only when adding new behavior.
