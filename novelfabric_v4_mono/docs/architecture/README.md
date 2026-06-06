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
