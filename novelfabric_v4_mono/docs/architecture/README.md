# V4 Architecture Documents

This directory keeps the active NovelFabric V4 mono app architecture documents.

## Active V4 Direction

Read these first for current V4 work:

1. `v4-cli-workspace-harness-plan.md` — canonical CLI-first workspace harness plan.
2. `v4-cli-command-contract.md` — target `novelfabric` CLI command surface, JSON envelopes, error codes, and capabilities.
3. `v4-mono-frontend-plan.md` / `v4-mono-frontend-plan.zh.md` — Web shell design and bridge integration rules.

## Historical Cleanup

The earlier custom-LLM/fullstack drafts were removed from this directory. Their useful corrections were merged into the CLI harness plan and command contract.

Do not reintroduce a NovelFabric-owned provider runtime as the V4 mainline. Semantic execution belongs to pi agent SDK / external agents under NovelFabric skills and CLI guardrails.
