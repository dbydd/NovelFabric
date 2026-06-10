# NovelFabric

## Overview

NovelFabric 是一个文本优先的小说创作与推演平台。

当前 `dev` 分支不是活跃实现线，而是 **V5 重写准备仓库**：代码、测试、依赖和运行资产已经清空，只保留项目规格、架构边界、历史 handoff 与验收文档，供下一轮实现作为 source of truth。

## Product source of truth

- Primary specification: `PRODUCT_SPEC.md`
- v2 runtime constraint: `PRODUCT_SPEC_2.md`
- Current rewrite-prep state: `CODEX_INFO.md`
- Current branch status / gate notes: `STATE.md`
- Project-level agent instructions: `AGENTS.md`
- Architecture and archive documents: `docs/architecture/`
- QA and acceptance documents: `docs/qa/`
- Research notes: `docs/research/`
- Design system document: `design-system/novelfabric/MASTER.md`

## Active branch status

- `main` preserves the latest V4 checkpoint before the planned rewrite.
- `dev` is intentionally documentation-only.
- No implementation language is currently active on `dev`; language/runtime decisions for V5 must be justified against the retained docs.

## Working rules for V5 prep

- Treat the retained documents as constraints, not as proof that old implementations should survive.
- Keep the product text-first, file-first, and auditable.
- Do not claim completion from a minimally runnable slice; usability remains the bar.
- If V5 changes architecture, update `AGENTS.md` and the relevant `docs/architecture/*.md` files in the same change.

## Definition of done for the current branch

Work on `dev` is complete when:

1. The repository contains only documentation and other intentionally retained textual planning artifacts.
2. Root-level handoff documents accurately describe the rewrite-prep state.
3. There is no stale claim that the branch still contains runnable V4 code.
