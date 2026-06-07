# NovelFabric V4 CLI 工作区 Harness 规划

> 当前 V4 架构主线。本文档是早期 fullstack / 自研 provider workflow 草案的合并替代版本。

## 1. 修正后的定位

NovelFabric V4 是 **CLI-first 的文本工作区 harness**，同时 mono app 需要内嵌一个 **pi agent SDK runtime wrapper**。

它不是 NovelFabric 自己实现的 OpenAI/Anthropic/provider backend。但 Web 端面向非技术用户，必须能在不暴露 bash 等危险能力的情况下运行 LLM-backed 任务。因此 mono app 应包装 pi agent SDK，并使用 NovelFabric 自己约定的配置路径、extension、工具策略、工作区护栏和审计。

```text
Web user / CLI user
  → NovelFabric mono app / novelfabric CLI
  → NovelFabric pi SDK runtime wrapper
  → NovelFabric skills / AGENTS / soul / capability 文本约束
  → novelfabric CLI commands and custom pi tools
  → shared TypeScript workspace services
  → workspace files + audit
```

NovelFabric 负责 workspace boundary：layout、CLI contract、context pack、validation、protected writes、audit、derived indexes、reports、artifact manifests，以及安全的 pi runtime envelope。开放式语义工作由 pi agent SDK / Hermes 在 NovelFabric skills 与 capabilities 约束下执行。

## 2. 当前配套文档

| 文档                                                  | 用途                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `v4-cli-command-contract.md`                          | 详细 CLI 命令面、JSON envelope、error codes、capability 名称、runtime commands、bridge 映射。 |
| `v4-mono-frontend-plan.md` / `.zh.md`                 | 当前 Web shell 与 bridge 集成规则。                                                           |
| `../research/frontend-reference-study.md`             | UI 与参考项目经验整理。                                                                       |
| 根目录 `AGENTS.md` 与 `novelfabric_v4_mono/AGENTS.md` | 对 agent 生效的项目约束。                                                                     |

早期提出 NovelFabric 自有 provider registry / general LLM backend 的文档已经移除或合并。不要把 `src/llm/provider.ts` 或 NovelFabric 自有 model/provider stack 重新引入为 V4 主线。

## 3. 不可违背的原则

1. **CLI before Web** — 所有重要操作都必须先有 `novelfabric` CLI 形态，再暴露成 Web 控件。
2. **Mono app wraps pi SDK** — Web 用户不应直接配置或操作 raw pi/bash；mono app 提供受控 pi SDK runtime，使用 NovelFabric config、extensions、tool allowlists 与 audit。
3. **NovelFabric config owns the wrapped runtime** — mono app 必须把 NovelFabric session 的 pi runtime state/config 重定向到 `XDG_CONFIG_HOME/novelfabric` 或 `$HOME/.config/novelfabric`，不能静默依赖用户常规 global pi 环境。
4. **No raw dangerous tools for nontechnical Web users** — Web 发起的 agent session 默认不得暴露 unrestricted `bash`、raw `write`、raw `edit`、任意网络或任意路径访问；使用调用 CLI primitives 的 NovelFabric custom tools/extensions。
5. **Files are truth** — Markdown / JSON / JSONL / TOML 工作区文件是事实源；graph、RAG index、report、job state 是可审计或可重建产物。
6. **One write path** — 持久写入走 shared workspace services，包含 safe path、capability、protected path、conflict、atomic write、audit。
7. **Skills before code branches** — 能表达为 agent instruction、skill、role profile、soul、capability rule 的行为，优先做成文本约束。
8. **Proposal before apply** — agent 输出先成为 proposal 或 task artifact；CLI validator 决定是否 apply 到 canonical files。
9. **Derived indexes only** — StoryGraph / StoryRAG 产物必须能从 workspace 源文件重建。
10. **No fixture branches** — 不允许为 `test_novel.txt` 或任何验收 fixture 写特判。
11. **Frozen external swarm compatibility** — 保持 existing REST/MCP shape 兼容；新增能力 additive 或 versioned。
12. **Browser acceptance uses controls only** — Playwright 只能点击 UI 与检查可见产物，不能用 browser console 或 direct API 绕过 UI。

## 4. NovelFabric pi Runtime Envelope

Mono app 可以且应该运行 LLM-backed tasks，但必须在以下 envelope 内：

```text
NovelFabric runtime config root
  → bundled/approved pi settings
  → NovelFabric pi extensions
  → sandbox / permission gate / CLI-only write tools
  → pi AgentSession
  → task package + skills
  → validated proposals
  → CLI apply
```

### 配置路径

使用 NovelFabric-owned config roots：

```text
$XDG_CONFIG_HOME/novelfabric/pi/
$XDG_CONFIG_HOME/novelfabric/pi/settings.json
$XDG_CONFIG_HOME/novelfabric/pi/extensions/
$XDG_CONFIG_HOME/novelfabric/pi/skills/
$XDG_CONFIG_HOME/novelfabric/pi/prompts/
```

如果没有 `XDG_CONFIG_HOME`，则使用：

```text
$HOME/.config/novelfabric/pi/
```

workspace-local overlay 可放在：

```text
<workspace>/.novelfabric/pi/
<workspace>/.pi/skills/
<workspace>/.pi/prompts/
```

wrapped runtime 只有在用户显式 opt-in 或执行 documented import/migration 时，才可以读取用户 global pi auth/model 配置。NovelFabric-specific extensions 与 permission policy 应来自 NovelFabric config，而不是用户常规 pi agent setup。

### 模型角色

NovelFabric runtime settings 需要有意区分 workflow 模型与验收模型：

- `modelDefaults` / `novelFabricWorkflowModel` 应指向 `generic-writer`。这个模型驱动真实 NovelFabric LLM 工作流阶段，例如语义导入、写作、角色推理与报告任务。
- `testModelDefaults` / `novelFabricTestModel` 应指向 `flash-vibe`。这个模型仅用于测试/验收 agent，用来证明 workflow 数据确实被 LLM agent 处理过。

不要把 `flash-vibe` 用作默认产品 workflow 模型。硬 pi 测试在这些模型设置或凭据缺失时不得 skip；缺少 runtime 配置就是失败状态。

### 必要 runtime extensions

wrapped runtime 应支持 NovelFabric-provided pi extensions，例如：

- sandbox / path guard；
- permission gate；
- `novelfabric_read_file`；
- `novelfabric_write_file`；
- `novelfabric_context_pack`；
- `novelfabric_validate`；
- `novelfabric_apply_proposal`；
- `novelfabric_report`。

这些 extension 内部调用 `novelfabric` CLI/shared services，不做 ad hoc filesystem writes。

### Tool policy

Web 发起的 session：

- 默认 deny raw `bash`、raw `write`、raw `edit`；
- 只允许 workspace scope 内的 read/search tools；
- mutation 通过 NovelFabric custom tools 或 CLI commands；
- 每个 task 绑定 actor/capability；
- 记录 session id、task id、allowed tools、extensions、artifacts、audit paths。

CLI power user 可以自行使用外部 pi/Hermes agent；但任何 durable NovelFabric project mutation 若要被视为有效 workspace state，仍必须经过 NovelFabric CLI primitives。

## 5. 参考项目经验合并

### OpenAlice

吸收：workspace 作为能力边界、template materialization、context injection、外部 agent runtime / pi adapter、skills 作为 runtime contract、inbox/artifact pushback。

避免：把 NovelFabric 变成通用 PTY/session manager；复制 AGPL 代码或交易系统概念。

### autogal / RPG-Harness

吸收：project is a folder、CLI primary runtime、`peek` / `step` / `test` headless loops、session state + JSONL trace、one deterministic write path、fixture-driven acceptance。

避免复制游戏 DSL 或 GalGame 专用机制。

### Auto-PPT

吸收：one durable artifact per file、manifest 管理 order/visibility/status、`SKILL.md` 作为 harness contract、content loop 与 visual/browser loop 分离、headless CLI 作为语义真相源。

避免把 PPT/React 实现模式带入小说工作区核心。

## 6. 目标 Workspace 模型

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
  pi/
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

## 7. 目标 CLI 家族

详细命令面见 `v4-cli-command-contract.md`。高层分组：

```text
workspace / project
files
runtime / pi SDK
agents / skills
agent task
import / chapterize
cards / memory
knowledge / recall / context-pack
simulation / swarm
report / writing
workflow wrapper
external-swarm compatibility
```

关键规则：Web bridge route 是这些命令/服务的 adapter，不是第二套业务 runtime。

## 8. 继续扩面前的测试闸门

当前命令面已经足够宽，下一阶段必须测试先行。不要在现有命令族缺少诚实验收覆盖时继续扩命令。

必需闸门：

- 每个 shared workspace primitive 有 service tests；
- 每个 command family 有 CLI tests，覆盖 JSON envelope 与失败行为；
- workflow state tests 必须区分 deterministic harness completion 与 pi-backed semantic completion；
- runtime policy tests 必须证明 NovelFabric-owned pi config root 与 Web-safe tool denial；
- 尚未实现的真实 pi/Web 业务闭环必须保留 pending contract tests；
- Web surface 必须用 Playwright 通过可见控件测试，不使用 console 或 direct API 绕过。

当前 QA 契约是 `../qa/v4-full-usability-acceptance.md`。确定性 CLI 测试通过只能称为 harness-complete；只有同时具备 pi runtime evidence 与 browser/control evidence，才能称为 business-complete。

## 9. pi Agent SDK Task Model

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
  → NovelFabric pi SDK runtime wrapper
  → pi AgentSession with NovelFabric config/extensions/skills
  → agent reads allowed workspace context
  → agent outputs structured proposal/result
  → novelfabric validate
  → novelfabric domain apply / files write
  → audit + artifact manifest refresh
```

## 10. Skill / Agent 文本资产

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

每个 skill 必须定义：触发条件与输入、允许 CLI/custom tools、可读范围、proposal/apply 路径、输出 schema、citation/evidence、成功前 validation、禁止 shortcut。

## 11. Active Gap Plan And Test-First Gate

已完成的 pi-backed semantic evidence loop 已归档到 `archive/v4-pi-evidence-loop-archive.md`，已完成的 domain artifact materialization 已归档到 `archive/v4-domain-artifact-materialization-archive.md`，已完成的 opt-in SDK AgentSession execution 已归档到 `archive/v4-sdk-agent-session-opt-in-archive.md`，已完成的 Web-safe read-only SDK tools foundation 已归档到 `archive/v4-web-safe-sdk-tools-foundation-archive.md`，已完成的 Web-safe mutation tools foundation 已归档到 `archive/v4-web-safe-mutation-tools-foundation-archive.md`。active plan 不再重复堆叠已完成 hardening / materialization / opt-in SDK execution / read-only SDK tools foundation / mutation tools foundation 项，只保留阻塞完整业务闭环的未完成 gap。

### 11.1 未完成 Gap 与测试标准

| 优先级 | Gap                                                 | 必须产出                                                                                                                                                                             | 最低测试标准                                                                                                                                                                       |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Web runtime event stream 与 lifecycle orchestration | 将 bridge runtime routes 从 sanitized task snapshots 升级为 browser-visible start/status/stream/cancel/retry lifecycle，并提供 bounded/redacted event trace。                        | Bridge tests 证明 streaming event shape、denial events、cancellation/retry cleanup、无 internal path/session 泄漏，以及 completed/failed/cancelled runs 的稳定 evidence envelope。 |
| 2      | Web full workflow binding                           | 浏览器能通过 CLI-backed services 跑通上传/导入原文 → semantic 拆书 → cards/memory/timeline → StoryRAG/context → StorySwarm → ReportAgent → chapter generation → editor review/save。 | Playwright test 只用 UI controls、50000+ ports、无 console/API shortcut，并断言最终 domain artifacts 与 visible runtime evidence。                                                 |
| 3      | Semantic import/materialization                     | 原文通过 pi-backed outputs 生成 chapters、character/world/rule cards、timeline、memory、context packs，并支持 reversible apply。                                                     | Acceptance tests 至少使用两个 source fixtures；生成资产必须引用 source excerpts、通过 content-quality checks、禁止 fixture-specific hardcoding。                                   |
| 4      | External swarm REST/MCP adapters                    | Frozen external swarm REST/MCP endpoints/tools 调 shared TypeScript services，并保持既有 request/response/idempotency/artifact semantics。                                           | Golden fixture tests 覆盖 REST POST/GET 与 MCP tools/list/tools/call，包含 Hermes/OpenAlice/TraderAlice 风格 payloads。                                                            |
| 5      | Domain-specific capabilities                        | cards/memory/swarm/report/writing 使用更窄 capability names，而不是 broad project/file write authority。                                                                             | Capability tests 证明 main agent 可执行授权 domain 操作，role agents 被拒绝跨域/保护操作，audit records 包含 actor/capability/reason/path/hash。                                   |

### 11.2 全局测试策略

- deterministic harness tests 必须在 CI 中通过；
- `npm run test:pi-acceptance` 是硬内容门槛，NovelFabric pi config 或 LLM 凭据不可用时必须失败，不能 skip；
- 真实 pi/Web acceptance tests 在未实现前应作为 pending contract tests 存在；
- 没有 completed pi runtime evidence 与内容校验的 deterministic shell 不能被描述为 semantic business success；
- `workflow verify` 必须持续要求 pi-task stages 同时具备 validated pi task evidence 与对应 domain artifact evidence；该已完成要求已归档，但不能回退。

## 12. 实施阶段

1. **CLI Contract And Test Freeze** — 保持命令契约最新；稳定现有 config/workspace/files/web 命令；新增或修改命令必须同步 service tests、CLI tests 与 QA contract 状态；确定性壳只能称为 harness 进展，不能称为 semantic business success。
2. **Runtime Config / Extension Envelope** — 添加 `runtime doctor/config/materialize`，物化 NovelFabric-owned pi settings/extensions/skills/prompts，定义 Web-safe tool policy。
3. **Agent / Skill Materialization** — 物化默认 agents/skills，添加 agents/skills inspect/validate，扩展 capability 模板。
4. **Import / Chapterize CLI** — inbox、normalize、chunk、chapterize、context-pack、validate；semantic extraction 由 pi skill 输出并由 CLI apply。
5. **Proposal / Apply Model** — cards、memory、simulation、reports、chapters 统一 proposal → validate → apply。
6. **StoryGraph / StoryRAG CLI** — 从源文件重建 `knowledge/`，提供 search/context-pack。
7. **Simulation / StorySwarm CLI** — session、context packs、turn append、validation、swarm plan/task/output/finalize。
8. **Report / Writing CLI** — report task/validate/apply/list/show；writing context-pack、draft task、apply-draft、review、export。
9. **Web-Safe pi SDK Runtime Bridge** — 基于已归档的 `agent run --runtime pi-sdk` opt-in AgentSession path、read-only SDK tools foundation 与 mutation tools foundation，继续补齐 Web bridge session lifecycle controls、real-time/bounded event streaming、cancellation/retry 与 browser-visible runtime trace；保持现有 agent task create/inspect/run/output validate/status/abort 命令契约，并继续记录 session/task evidence。
10. **Web Shell Rewire** — 用 CLI-backed workflow/task 调用替换 template-only business paths，展示 runtime policy 与证据。
11. **End-to-End Acceptance** — 两个 source fixture，十轮 browser run，必须有 pi-backed semantic evidence，无 console/direct API/fixture 特判。

## 13. 成功标准

未来业务流程测试只有满足以下条件才算成功：

- semantic work 由 NovelFabric pi SDK runtime wrapper 在 NovelFabric skills 约束下执行；
- 非技术 Web session 未暴露 raw dangerous tools；
- cards、context packs、role actions、swarm outputs、reports、chapter drafts 都是真实 artifacts，而不是 UI templates；
- 每个 applied write 都经过 `novelfabric` CLI/shared services；
- 关键输出均引用 workspace evidence；
- capability / protected path rules 被执行；
- Web controls 只 orchestrate CLI-backed operations。

## 14. 明确非目标

- 不把 NovelFabric-owned OpenAI/Anthropic provider layer 作为 V4 主线。
- 不依赖用户普通 global pi extension set 来保证 mono app 安全。
- 不把隐藏数据库作为唯一事实源。
- 不给 role agent 默认 shell/network/arbitrary path 权限。
- 不做 Web-only business generation path。
- 不复制参考项目实现代码。
- 不破坏 frozen external swarm REST/MCP shape。
