# NovelFabric V4 CLI 工作区 Harness 规划

> 当前 V4 架构主线。本文档是早期 fullstack / 自研 LLM workflow 草案的合并替代版本。

## 1. 修正后的定位

NovelFabric V4 是 **CLI-first 的文本工作区 harness**，不是自研 LLM backend。

```text
pi / Hermes / pi agent SDK
  → NovelFabric skills / AGENTS 文本约束
  → novelfabric CLI 命令
  → shared TypeScript workspace services
  → workspace files + audit
  → optional Web shell 作为操作/审阅界面
```

NovelFabric 负责工作区边界：layout、CLI 契约、context pack、validation、protected writes、audit、derived indexes、reports、artifact manifests。开放式语义工作交给 pi agent SDK / 外部 agent，并通过 NovelFabric skills 与 capabilities 约束。

## 2. 当前配套文档

| 文档                                                  | 用途                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `v4-cli-command-contract.md`                          | 详细 CLI 命令面、JSON envelope、error codes、capability 名称、bridge 映射。 |
| `v4-mono-frontend-plan.md` / `.zh.md`                 | 当前 Web shell 与 bridge 集成规则。                                         |
| `../research/frontend-reference-study.md`             | UI 与参考项目经验整理。                                                     |
| 根目录 `AGENTS.md` 与 `novelfabric_v4_mono/AGENTS.md` | 对 agent 生效的项目约束。                                                   |

早期提出 NovelFabric 自有 LLM/provider runtime 的文档已经移除或合并。不要把 `src/llm/provider.ts` 或 NovelFabric 自有 model registry 重新引入为 V4 主线。

## 3. 不可违背的原则

1. **CLI before Web** — 所有重要操作都必须先有 `novelfabric` CLI 形态，再暴露成 Web 控件。
2. **Files are truth** — Markdown / JSON / JSONL / TOML 工作区文件是事实源；graph、RAG index、report、job state 是可审计或可重建产物。
3. **One write path** — 持久写入走 shared workspace services，包含 safe path、capability、protected path、conflict、atomic write、audit。
4. **Skills before code branches** — 能表达为 agent instruction、skill、role profile、capability rule 的行为，优先做成文本约束。
5. **pi SDK owns semantics** — LLM 推理、角色扮演、语义拆书、ReportAgent 分析、章节创作由 pi/Hermes 执行；NovelFabric 准备上下文并校验/应用输出。
6. **Proposal before apply** — agent 输出先成为 proposal 或 task artifact；CLI validator 决定是否 apply 到 canonical files。
7. **Derived indexes only** — StoryGraph / StoryRAG 产物必须能从 workspace 源文件重建。
8. **No fixture branches** — 不允许为 `test_novel.txt` 或任何验收 fixture 写特判。
9. **Frozen external swarm compatibility** — 保持 existing REST/MCP shape 兼容；新增能力 additive 或 versioned。
10. **Browser acceptance uses controls only** — Playwright 只能点击 UI 与检查可见产物，不能用 browser console 或 direct API 绕过 UI。

## 4. 参考项目经验合并

### OpenAlice

吸收：workspace 作为能力边界、template materialization、context injection、外部 agent runtime / pi adapter、skills 作为 runtime contract、inbox/artifact pushback。

避免：把 NovelFabric 变成通用 PTY/session manager；复制 AGPL 代码或交易系统概念。

### autogal / RPG-Harness

吸收：project is a folder、CLI primary runtime、`peek` / `step` / `test` headless loops、session state + JSONL trace、one deterministic write path、fixture-driven acceptance。

避免：复制游戏 DSL 或 GalGame 专用机制。

### Auto-PPT

吸收：one durable artifact per file、manifest 管理 order/visibility/status、`SKILL.md` 作为 harness contract、content loop 与 visual/browser loop 分离、headless CLI 作为语义真相源。

避免：把 PPT/React 实现模式带入小说工作区核心。

## 5. 目标 Workspace 模型

目标 layout：

```text
project.md
project.json
AGENTS.md
.novelfabric/
  capabilities.toml
  manifests/
  tasks/
  proposals/
  audit/
agents/<agent-id>/
  profile.json
  soul.md
  memory.md
  skills/*.md
imports/source/
imports/normalized/
imports/chunks/
cards/characters/
cards/scenes/
cards/world/
cards/rules/
knowledge/
memory/
simulation/
reports/
writing/chapters/
timeline/
```

这是目标契约；实现应按命令逐步增长，并先补 validator 与 fixture，再依赖 Web UI。

## 6. 目标 CLI 家族

详细命令面见 `v4-cli-command-contract.md`。高层分组：

```text
workspace / project
files
agents / skills
agent task / pi SDK
import / chapterize
cards / memory
knowledge / recall / context-pack
simulation / swarm
report / writing
workflow wrapper
external-swarm compatibility
```

关键规则：Web bridge route 是这些命令/服务的 adapter，不是第二套业务 runtime。

## 7. pi Agent SDK 集成模型

未来 pi bridge 应创建 task package 与 session，而不是直接调用模型 provider。

推荐 task package：

```text
.novelfabric/tasks/<task-id>/
  task.md
  input.json
  context-pack.json
  allowed-commands.md
  output.schema.json
  result.json
  events.jsonl
```

执行流：

```text
novelfabric context-pack / task create
  → pi agent SDK session with NovelFabric skills
  → agent reads allowed workspace context
  → agent outputs structured proposal/result
  → novelfabric validate
  → novelfabric domain apply / files write
  → audit + artifact manifest refresh
```

不要让 pi 内置 `write` / `edit` 或 unrestricted `bash` 成为 canonical NovelFabric facts 的常规写入路径。若新增 pi custom tool，应在内部调用 `novelfabric` CLI。

## 8. Skill / Agent 文本资产

推荐 skill families：

```text
novelfabric-import-book
novelfabric-card-extraction
novelfabric-character-turn
novelfabric-kp-adjudicate
novelfabric-world-update
novelfabric-project-audit
novelfabric-storyswarm-round
novelfabric-report-agent
novelfabric-author-draft
novelfabric-review-check
novelfabric-timeline-branch-proposal
```

每个 skill 必须定义：

- 触发条件与必需输入；
- 允许调用的 CLI；
- 可读文件范围；
- 可写 proposal/apply 路径；
- 输出 schema；
- citation/evidence 要求；
- 宣称成功前必须运行的 validation 命令；
- 禁止 shortcut，包括 direct filesystem write 与 fixture-specific logic。

## 9. 实施阶段

### Phase 1 — CLI Contract Freeze

- 保持 `v4-cli-command-contract.md` 最新。
- 稳定现有 `config`、`workspace`、`files`、`web` 命令。
- 只有当 JSON envelope、capability、artifact paths 已文档化时，才添加命令 stub。

### Phase 2 — Agent / Skill Materialization

- 从 XDG templates 物化默认 agents 与 skills。
- 添加 `agents list/inspect/materialize/validate` 与 `skills list/read/validate`。
- 扩展 main/system/role agents 的 capability manifest 模板。

### Phase 3 — Import / Chapterize CLI

- 添加 inbox、normalize、chunk、chapterize、context-pack、validate。
- deterministic stages 不调用 LLM provider。
- semantic extraction 是 pi skill 输出，由 CLI validate/apply。

### Phase 4 — Proposal / Apply Model

- Cards、memory、simulation、reports、chapters 统一使用 proposal → validate → apply。
- 所有 apply command 走 shared write services 与 audit。

### Phase 5 — StoryGraph / StoryRAG CLI

- 从源文件重建 `knowledge/` 派生产物。
- search/context-pack 输出 file paths、excerpt、entity/relation metadata、timeline 信息（如有）。

### Phase 6 — Simulation / StorySwarm CLI

- 添加 session state、context packs、turn append、validation、swarm plan/task/output/finalize。
- 默认轮次为 `characters → random-event → world-maintainer → kp → project-auditor`。
- agent reasoning 来自 pi skills；CLI 只应用已验证输出。

### Phase 7 — Report / Writing CLI

- 添加 report task/validate/apply/list/show。
- 添加 writing context-pack、draft task、apply-draft、review、export。
- 章节必须引用 accepted artifacts 并通过 validation 才能 apply。

### Phase 8 — pi Agent SDK Bridge

- 实现 `agent task create/inspect/run/output validate/status/abort`。
- 使用 pi SDK sessions 与 skills。
- 记录 session/task evidence，不接管 provider configuration。

### Phase 9 — Web Shell Rewire

- 用 CLI-backed workflow/task 调用替换 template-only business paths。
- 展示 job stage、evidence、artifacts、validation errors、audit paths、retry controls。

### Phase 10 — End-to-End Acceptance

- `test_novel.txt` 完整 browser-controlled run。
- 另一个 source fixture 完整 browser-controlled run。
- 十轮 browser run，必须有 pi-backed semantic evidence。
- 禁止 browser console、direct API bypass、fixture-specific code。

## 10. 成功标准

未来业务流程测试只有满足以下条件才算成功：

- semantic work 由 pi agent SDK / external agent 在 NovelFabric skills 约束下执行；
- cards、context packs、role actions、swarm outputs、reports、chapter drafts 都是真实 artifacts，而不是 UI templates；
- 每个 applied write 都经过 `novelfabric` CLI/shared services；
- 关键输出均引用 workspace evidence；
- capability / protected path rules 被执行；
- Web controls 只 orchestrate CLI-backed operations。

## 11. 明确非目标

- 不把 NovelFabric-owned OpenAI/Anthropic provider layer 作为 V4 主线。
- 不把隐藏数据库作为唯一事实源。
- 不给 role agent 默认 shell/network/arbitrary path 权限。
- 不做 Web-only business generation path。
- 不复制参考项目实现代码。
- 不破坏 frozen external swarm REST/MCP shape。
