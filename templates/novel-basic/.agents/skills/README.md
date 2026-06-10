# Skills README — WORKSPACE_NAME

This directory is the local control stack for narrative truth handling.

它服务的不是泛化内容生产，而是 `canon/`、`inbox/`、`artifacts/` 之间的真相分层：什么时候只是 intake，什么时候可以 promotion，什么时候只能生成派生产物而不能改 canon。

## 什么时候先来读这里

优先进入这里的时机：

- 你要处理人物、地点、规则、时间线等 narrative truth
- 你不确定某份材料该落 `inbox/`、进 `canon/`，还是只该出现在 `artifacts/`
- 你准备做 continuity repair、truth promotion 或 stale-artifact 判断

## Read order

1. `GLOBAL_PROMPT_SKILL_STACK.md`
2. `PROMPT_ENGINEERING_CORE.md`
3. `BASH_GIT_WORKFLOW.md`
4. `CONTEXT_PACKING_GUIDE.md` or `PACK_SCOPE_CONVENTIONS.md`
5. `REVIEW_LOOP.md`
6. `COMMIT_MESSAGE_FEWSHOT.md` before protected canon changes

## Operator map

- `fanout-scan` → 先看相关 `canon/`、`inbox/` 和已有 `artifacts/`
- `candidate-a` → canon-safe conservative path
- `candidate-b` → sharper editorial or promotion path
- `single-write` → choose one truth-classification move
- `final-gate` → continuity, promotion, and stale-artifact review

## 与模板目录语义的关系

这些 skill 的价值，在于把目录语义变成可执行的工作顺序：

- `canon/` 是 accepted truth，不是草稿区
- `inbox/` 是待整理输入，不是静悄悄 polish 后直接升格的事实
- `artifacts/` 是派生产物，不应越权成为真相源

## 推荐使用节奏

- 先分辨材料身份：看 `fanout-scan`
- 想保守地修 continuity：先走 `candidate-a`
- 确实要做 promotion：再看 `candidate-b`
- 进入 protected canon 改动前：补读 `COMMIT_MESSAGE_FEWSHOT.md`
- 交付前：用 `REVIEW_LOOP.md` 复查是否留下 stale artifact

## Rule

If a local file here already defines how truth promotion, continuity repair, or artifact freeze should work, follow it. Unsupported improvisation does not ship.
