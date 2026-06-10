# Local Skills

These files are the local adapter layer for `tooling-only`.

它们主要服务于 `tools/` 与 `artifacts/` 的边界管理：什么值得进入 durable tool surface，什么只该作为一次性输出保留。

## 什么时候先来读这里

优先进入这里的时机：

- 你准备新增、扩大或重命名 `tools/**`
- 你不确定某个结果该保留在 `artifacts/`，还是晋升成可复用工具
- 你要补一段 Bash 协议、operator runbook、审计流程或脚本说明

## Read order

1. `PROMPT_ENGINEERING_CORE.md`
2. `BASH_GIT_WORKFLOW.md`
3. `CONTEXT_PACKING_GUIDE.md` or `PACK_SCOPE_CONVENTIONS.md`
4. `COMMIT_MESSAGE_FEWSHOT.md` and `REVIEW_LOOP.md` before protected edits or final handoff

## File inventory

- `PROMPT_ENGINEERING_CORE.md` — how to frame tooling work in this workspace
- `GLOBAL_PROMPT_SKILL_STACK.md` — where global prompt skills help and where local scope takes over
- `BASH_GIT_WORKFLOW.md` — the default inspect → edit → diff → verify loop for tools work
- `CONTEXT_PACKING_GUIDE.md` — how to pack reusable operator context without mixing in noise
- `PACK_SCOPE_CONVENTIONS.md` — how to interpret scope labels in this template
- `COMMIT_MESSAGE_FEWSHOT.md` — the protected change message pattern
- `REVIEW_LOOP.md` — final self-review before handoff

## 与模板目录语义的关系

这里最重要的模板绑定不是 skill 名字本身，而是它们帮助你持续区分：

- `tools/`：可复用、应维护、需说明 I/O 和 rollback 的 durable surface
- `artifacts/`：一次性结果、审计残留、暂未证明复用价值的输出

## 推荐使用节奏

- 想确认是否该新建/扩张工具：先看 `PROMPT_ENGINEERING_CORE.md`
- 准备按 inspect → edit → verify 落地：看 `BASH_GIT_WORKFLOW.md`
- 涉及 protected `tools/**`：补读 `COMMIT_MESSAGE_FEWSHOT.md`
- 交付前：用 `REVIEW_LOOP.md` 复查 owner、I/O、failure mode、rollback path 是否说清

## Rule

If a local file here already defines the placement, audit, or verification rule, follow it instead of inventing a second convention in chat.
