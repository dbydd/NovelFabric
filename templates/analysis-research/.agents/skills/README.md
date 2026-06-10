# Local Skills

These files are the local adapter layer for `analysis-research`.

它们主要服务于 `sources/`、`notes/`、`artifacts/` 的 provenance 链：先保存证据，再形成判断，最后导出派生产物，而不是反过来。

## 什么时候先来读这里

优先进入这里的时机：

- 你准备收集新资料、写比较笔记或生成总结报告
- 你不确定某段内容该留在 `sources/`、写进 `notes/`，还是作为 `artifacts/` 输出
- 你要检查某个 claim 是否已经有足够支撑路径

## Read order

1. `PROMPT_ENGINEERING_CORE.md`
2. `BASH_GIT_WORKFLOW.md`
3. `CONTEXT_PACKING_GUIDE.md` or `PACK_SCOPE_CONVENTIONS.md`
4. `COMMIT_MESSAGE_FEWSHOT.md` and `REVIEW_LOOP.md` before protected edits or final handoff

## File inventory

- `PROMPT_ENGINEERING_CORE.md` — how to frame evidence-driven analysis here
- `GLOBAL_PROMPT_SKILL_STACK.md` — where global prompt skills help and where local provenance rules take over
- `BASH_GIT_WORKFLOW.md` — the default inspect → edit → diff → verify loop for research text work
- `CONTEXT_PACKING_GUIDE.md` — how to pack evidence chains and open questions
- `PACK_SCOPE_CONVENTIONS.md` — how to interpret scope labels in this template
- `COMMIT_MESSAGE_FEWSHOT.md` — the protected change message pattern
- `REVIEW_LOOP.md` — final self-review before handoff

## 与模板目录语义的关系

这里的本地 skills 要持续帮你守住三层角色：

- `sources/`：原始证据与出处
- `notes/`：工作判断、比较、解释与研究结论
- `artifacts/`：对外可读的派生产物

也就是说，artifact 可以更 polished，但不应比 `notes/` 更早建立重大判断；而 `notes/` 的任何结论都应能回指 `sources/`。

## 推荐使用节奏

- 先判断材料该落哪一层：看 `PROMPT_ENGINEERING_CORE.md`
- 准备按 inspect → edit → verify 处理研究文本：看 `BASH_GIT_WORKFLOW.md`
- 涉及 protected `notes/**`：补读 `COMMIT_MESSAGE_FEWSHOT.md`
- 交付前：用 `REVIEW_LOOP.md` 复查 claim、support path 和 unresolved gaps

## Rule

If a local file here already defines the provenance, placement, or review rule, follow it instead of inventing a second convention in chat.
