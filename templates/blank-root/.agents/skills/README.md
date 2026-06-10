# Local Skills README

Local skill directory for `WORKSPACE_NAME`.

这个模板没有预设 `canon/`、`tools/`、`sources/notes/` 等专门目录；本地 skill 的主要作用，是帮助 operator 在 root-first 前提下收紧任务、选准唯一写入面、避免过早长目录。

## 先在什么情况下读这里

优先进入这里的时机：

- 你还在判断这次工作究竟该落 root、落单个文档，还是根本该换模板
- 你准备修改 `AGENTS.md`、`SOUL.md`、`template.json` 或 `.agents/skills/**`
- 你想新增顶层目录，但还不确定它是否真的被当前任务“赚到”

## Read order

1. `GLOBAL_PROMPT_SKILL_STACK.md`
2. `PROMPT_ENGINEERING_CORE.md`
3. `BASH_GIT_WORKFLOW.md`
4. `CONTEXT_PACKING_GUIDE.md` or `PACK_SCOPE_CONVENTIONS.md`
5. `REVIEW_LOOP.md`
6. `COMMIT_MESSAGE_FEWSHOT.md` when protected files changed

## Operator map

- `fanout-scan` → 先收窄 root 级候选写入面，确认是不是其实只需改一个文件
- `candidate-a` → 保守 root-first 路线；优先 tighten 现有规则，不长新目录
- `candidate-b` → 只在确有必要时探索更强表达，但仍要解释为什么 root 不够
- `single-write` → 在真正编辑前收束到一个明确写入面
- `final-gate` → 检查是否引入了隐藏结构假设或无依据的目录扩张

## 与模板目录语义的关系

对 `blank-root` 来说，最重要的不是“还有哪些 skill 文件”，而是：

- 这些 skill 是否帮你守住 root-first
- 它们是否阻止你把通用模板悄悄写成另一个领域模板
- 它们是否让受保护文件修改更容易被提交记录和审计说明读懂

## 推荐使用节奏

- 先不确定落点：看 `fanout-scan`
- 已知道要改根级哪个面：看 `single-write`
- 涉及 protected file：补读 `COMMIT_MESSAGE_FEWSHOT.md`
- 准备交付前：跑 `REVIEW_LOOP.md`

## Rule

This directory is not decorative. If a rule here already owns the current phase, use it. If a branch fails review twice, re-scope or rollback instead of inventing a third vague convention.
