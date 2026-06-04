# NovelFabric V4 工作区风格后端规划案

> 状态：V4 已进入实际构建。`backend_v2` 目前包含第一阶段 TypeScript CLI foundation。
>
> 范围：把 NovelFabric 改造成可以被 pi / Hermes 这类 agent 直接接管的文本工作区。后端收缩为一组小型 TypeScript CLI 原语和可选的薄 Web bridge；人物推理、人物调度、KP/世界维护/项目审核等智能工作移交给外部 agent 与 skill。

## 1. V4 总方向

V4 改变主控制模型。

旧 v2/v3 路线：

```text
NovelFabric Web/后端 -> 后端拥有 agent runtime -> 后端拥有 LLM provider adapter -> 结构化写入
```

V4 目标路线：

```text
pi / Hermes / Web pi SDK agent -> NovelFabric skills -> 小型 NovelFabric CLI 工具 -> 文本优先工作区文件
```

V4 后端在 `backend_v2/` 下使用 TypeScript 实现。本文旧有 Rust 表述属于历史迁移语境，应理解为共享 service / CLI 原语意图，不再作为在 `backend_v2` 新增 Cargo crate 的指令。

后端不再拥有以下职责：

- 人物智能
- 角色调度
- 模型路由
- provider healthcheck
- LLM 调用重试与 schema 兜底

后端保留并强化以下职责：

- 项目与模板物化
- 受保护的文件 IO
- txt 导入、编码归一化、章节切分
- 卡片、记忆、时间线、正文等文件操作
- 确定性的推演状态转移
- StoryGraph / StoryRAG 派生索引
- 基于已有文本证据的报告渲染
- 审计日志、校验、回滚 hook
- 给 Vue 与 pi agent SDK 使用的可选薄 HTTP bridge

V4 的本质是：NovelFabric 自身变成 agent workspace，而不是继续做一个和 pi/Hermes 竞争的 agent 平台。

## 2. 设计原则

1. **pi 可接管的工作区优先**

   一个 NovelFabric 项目被 agent 打开时，必须靠项目目录自身就能继续工作。目录里应有 `AGENTS.md`、skill 契约、模板 manifest、CLI 可用说明、校验命令，而不是依赖隐藏后端状态。

2. **CLI 原语优先于 HTTP API**

   每个后端能力先表达为小型 executable 或严格 subcommand，输入输出使用 JSON / JSONL / Markdown。HTTP endpoint 只是这些原语的 adapter，不是事实源。

3. **人物调度离开后端**

   角色决策、KP 裁定、世界维护、项目审核、作者草拟、审稿判断，都由外部 agent 通过 skill 完成。NovelFabric 提供 context pack、受保护写入、校验和审计。

4. **模板离开项目数据目录**

   内置模板与用户自定义模板放在 XDG 配置目录，默认 `~/.config/novelfabric`。项目工作区按需物化模板。环境变量不再是一等配置入口，只作为缺失配置项 fallback 或显式自动化 override。

5. **文本仍是事实源**

   index、cache、graph、context pack 都是派生产物。项目事实仍然落在 Markdown / JSON / JSONL 等可审计文件中。

6. **废弃后端 LLM 集成主线**

   现有 `backend/src/llm.rs`、LLM endpoint/role config、LLM healthcheck、LLM 拆书抽取，只作为迁移输入。V4 不继续把它们扩展成产品主路径。

## 3. 参考工作区模式调研

用户明确要求参考三个已经跑通的 workspace 项目：

- `github.com/TraderAlice/OpenAlice`
- `github.com/luokerenx4/autogal`
- `github.com/Ame-X/Auto-PPT`

这不是要复制它们的业务，而是吸收它们的工程 harness：如何让一个 repo / folder 被 AI agent 直接理解、操作、验证和交还。

### 3.1 OpenAlice 模式

OpenAlice 的关键是 **workspace launcher + context injector**：

- 原生 agent CLI 在受管理的 workspace 中运行。
- 新能力优先通过 workspace template 与 satellite repo 扩展，而不是让核心代码不断膨胀。
- 工具与上下文通过显式 registry / MCP 注入 workspace。
- 持久状态落文件，不依赖数据库作为唯一事实源。
- 敏感领域拆成独立进程，用窄协议通信。
- workspace 可以把产物推回 Inbox，用户从文件产物继续审阅和反馈。

NovelFabric 吸收方式：

- 每个小说项目就是一个能力 workspace。
- NovelFabric CLI 是上下文与状态注入层。
- 不把 `backend_v2` 做成通用 PTY/session 管理器；pi/Hermes 已经拥有这层。
- 新故事能力优先做模板、skill 或外部 adapter，不优先改核心 runtime。
- Web bridge 保持薄：UI 触发 agent task，agent 调 CLI 写文件，UI 刷新文件产物。

### 3.2 autogal / RPG-Harness 模式

autogal 的 RPG-Harness 把“游戏”表达成文件夹，并保持 engine 小而确定：

- engine 拥有标准资源 schema、状态槽、原语、生命周期 hook 和唯一写路径。
- game folder 是 Markdown / YAML / TS 资源目录。
- 同一个 game folder 可以跑 terminal、browser、headless test harness。
- 主循环可以 eject/customize，但不 fork engine。
- `step` / `peek` / `test` / `autoplay` 等 headless 命令让 AI playtester 能稳定工作。
- 状态是普通 JSON，可 diff、可快照、可回放。
- 游戏特有 metadata 放扩展字段，不膨胀核心 schema。

NovelFabric 吸收方式：

- NovelFabric 的 story engine 不解释开放文学意义，只认识 timepoint、session、card、memory、delta、trigger、report、validation。
- 人物想什么、为什么这么做，由外部 agent 通过 skill 推理。
- 后端提供 `context-pack`、`append-turn`、`validate-round`、`knowledge quick`、`report` 等 headless 命令。
- 所有状态保持 JSON / Markdown round-trip。
- 项目或题材特有字段放 extension/custom metadata，不为每种小说题材扩 Rust 核心结构。
- 推演动作必须是原子、可校验的状态转移，而不是隐藏在后端里的长模型循环。

### 3.3 Auto-PPT 模式

Auto-PPT 把 PPT 变成 agent 可编辑的源文件工作区：

- 一个 PPT 是一个文件夹。
- 一页 slide 是一个文件。
- 顺序与可见性在显式 `deck.config.ts` 中管理。
- `SKILL.md` 是 agent 的 source of truth。
- 文案/语义用 headless CLI 读态。
- 布局/视觉用单页 browser route 验证。
- scaffold 文件是软边界：内容改动直接做，scaffold 改动要先暴露给用户，因为这说明 harness 本身需要演进。

NovelFabric 吸收方式：

- 一个小说项目是一个 workspace folder。
- 重要事实尽量映射为稳定文件：一张卡、一条记忆、一章正文、一份报告、一个 session round、一个 context pack。
- 顺序、可见性、active session、模板版本、生成产物通过 manifest 管理，不藏在文件名或运行时内存里。
- `AGENTS.md` / `SKILL.md` / 架构文档是 harness 的一部分，改变 CLI、模板、schema 时必须同步更新。
- 文本内容验证和浏览器/导出验证分开走。
- 内容文件和 scaffold 文件要在 manifest 中标明，方便 agent 判断“直接做”还是“先提示”。

### 3.4 三者共性抽象

NovelFabric V4 必须吸收以下共性：

1. **workspace 是能力边界**：一个文件夹就是 agent 可理解、可操作、可测试、可交还的单位。
2. **小核心 + 丰富模板**：核心只做确定性引擎和校验；领域扩展进入模板、skill、外部 adapter。
3. **headless first**：重要流程先有 CLI read / step / validate / report，再做 UI。
4. **唯一写路径**：项目状态变化必须经过受保护原语，并留下审计。
5. **显式 manifest**：顺序、可见性、active session、模板版本、产物位置都写进文件。
6. **文档就是 harness**：AGENTS / SKILL / 架构文档不是注释，而是执行契约。
7. **fixture 是验收**：用项目 fixture 和脚本化 workflow 证明不靠浏览器、不靠隐藏服务也能跑。
8. **推理与持久化分离**：外部 agent 推理；NovelFabric 校验、写入、索引、报告。

## 4. 当前后端模块盘点

当前 `backend/` 已经有较完整的领域层，但暴露方式是大型 Axum API，且部分逻辑与后端 LLM 调用耦合。

| 当前模块 | 当前职责 | V4 处理方式 |
|---|---|---|
| `storage.rs` | 根目录内文件操作、路径逃逸保护 | 保留，升级为共享 CLI library |
| `config.rs` | 应用配置 + 后端 LLM endpoint/role config | 拆分：保留 XDG 应用配置，废弃 LLM config 主路径 |
| `project.rs` | 项目创建/列表/删除，bootstrap system agents | 拆成 project CLI + template materializer |
| `import.rs` | txt 解码、章节切分、LLM 语义抽取、卡片/agent seed | 保留解码/切分/report；语义抽取移交 agent skill |
| `cards.rs` | 人物/规则/世界卡 CRUD | 保留为文件 CLI 原语 |
| `agents.rs` | soul/memory/skills 资产 CRUD | 保留为 workspace asset CLI 原语 |
| `memory.rs` | 分层记忆条目 | 保留为文件 CLI 原语 |
| `timeline.rs` | 时间点与分支 | 保留为确定性 CLI 原语 |
| `writing.rs` | 章节、审稿笔记、历史章节分支 | 保留为文件 CLI 原语 |
| `runtime.rs` | 受限 read/glob/patch/execute runtime | 保留并强化为 agent-safe CLI 核心 |
| `story_graph.rs` | 派生 graph/chunk/index rebuild | 保留为派生索引 CLI |
| `story_rag.rs` | quick/panorama/insight search | 保留为派生检索 CLI |
| `simulation.rs` | session 创建、推进、固定系统角色日志 | 拆分：保留 session 状态与 append-only turn log；移除后端调度 |
| `swarm.rs` | 基于 session/skills/RAG 生成结构化输出证据 | 改为 context/evidence pack builder，不做 scheduler |
| `agent_output.rs` | 结构化 action、consistency、skill invocation evidence | 保留 schema，适配外部 agent action plan |
| `report.rs` | 基于证据的报告与采访 | 保留报告渲染；采访解释交给 agent 或 context-pack |
| `external_swarm.rs` | 已被外部调用方使用的 generic external swarm inference HTTP persistence | 保留为 V4 冻结兼容面；内部可迁移到共享服务，但必须先通过契约测试 |
| `mcp.rs` | external swarm 的 JSON-RPC MCP wrapper | 保留工具名和 `structuredContent` 形状；未来可作为 V4 service bridge |
| `llm.rs` | OpenAI/Anthropic provider adapter | V4 后端废弃 |
| `main.rs` / `lib.rs` | Axum server、route、app state | CLI 契约稳定后再做薄 Web bridge |
| `bin/novelfabric_fanfic.rs` | env-driven LLM smoke workflow | 移除或转为外部 agent skill sample |

## 5. 要拆分的最小 CLI 单元

V4 优先做成一个 `novelfabric` 主 binary + capability-scoped subcommands。不要拆成大量互不相关的小 executable，否则 skill 会记住过多命令拓扑，复杂度会转嫁给 agent。子命令应只是薄入口，背后复用同一组 Rust service。

### 5.1 Workspace / Template

候选命令：

```bash
novelfabric workspace init --path <dir> --template novel-project --json
novelfabric workspace doctor --path <dir> --json
novelfabric workspace materialize-agents --project <slug> --json
novelfabric workspace materialize-skills --project <slug> --json
novelfabric workspace print-layout
novelfabric workspace validate-layout --json
```

职责：

- 创建 project-level `AGENTS.md`
- 物化 pi-compatible skills
- 创建 canonical project directories
- 写入 template manifest
- 标注 content/scaffold 边界

### 5.2 Config / Template Store

候选命令：

```bash
novelfabric config path
novelfabric config print --json
novelfabric config set data_dir <path>
novelfabric config templates list --json
novelfabric config templates install --from <dir|archive> --json
novelfabric config templates reset-builtin --json
```

默认布局：

```text
~/.config/novelfabric/
  config.toml
  workspace-defaults.toml
  agent-clients.toml
  profiles/
    default.toml
    browser.toml
    cli.toml
  templates/
    projects/
    agents/
    skills/
  schema/
    project-layout.schema.json
    skill-frontmatter.schema.json
```

解析顺序必须可见，并由 `config print --json` / `workspace doctor` 输出：

1. 项目本地 `.novelfabric/workspace.json`
2. 用户 XDG 配置与模板 `~/.config/novelfabric`
3. CLI 内置默认模板
4. 环境变量 fallback
5. 单次命令 CLI flags override

### 5.3 Project

候选命令：

```bash
novelfabric project create --slug my-story --title "My Story" --template novel-project --json
novelfabric project list --json
novelfabric project inspect my-story --json
novelfabric project validate my-story --strict --json
```

职责：

- 创建 / 列表 / 检查 / 删除 / 归档 project
- 校验 slug 与 canonical layout
- 不调用任何模型
- 写入 `project.json`、`project.md`、timeline origin、默认 assets

### 5.4 Agent-Safe File Runtime

候选命令：

```bash
novelfabric fs read --project my-story --path agents/aria/soul.md --json
novelfabric fs glob --project my-story --base cards --pattern '**/*.md' --json
novelfabric fs patch --project my-story --agent project-auditor --plan patch.json --json
novelfabric fs append --project my-story --agent kp --path simulation/logs/session.md --stdin --json
```

职责：

- bounded read
- project-local glob
- exact replace
- append
- protected write
- 所有写入按 agent id 记审计

这部分应吸收并强化当前 `runtime.rs`。

### 5.5 Import

候选命令：

```bash
novelfabric import txt --project my-story --file novel.txt --source-name novel.txt --json
novelfabric import context-pack --project my-story --import import-novel-txt --max-chars 12000 --json
novelfabric import apply-agent-extraction --project my-story --import import-novel-txt --file extraction.json --json
```

保留职责：

- raw bytes 保存
- 编码识别 / GBK fallback / UTF-8 normalized output
- 章节切分
- import report
- 给外部 agent 的 semantic extraction context pack

移除职责：

- 后端 LLM 调用
- 后端 provider output schema 解析作为主路径
- 规则 fallback 猜测人物/世界观/规则卡

### 5.6 Cards / Memory / Timeline / Writing

候选命令：

```bash
novelfabric card upsert --project my-story --kind character --id aria --title Aria --body-file aria.md --json
novelfabric memory append --project my-story --scope agent --scope-id aria --timeline main --timepoint tp-0001 --stdin --json
novelfabric timeline branch create --project my-story --from tp-0003 --id branch-west-gate --json
novelfabric writing chapter update --project my-story --chapter chapter-003 --body-file draft.md --json
```

要求：

- deterministic CRUD
- 统一路径/id 校验
- JSON 输出 affected paths
- 不调用 LLM

### 5.7 Knowledge

候选命令：

```bash
novelfabric knowledge rebuild --project my-story --json
novelfabric knowledge quick --project my-story --query "Aria vault oath" --json
novelfabric knowledge panorama --project my-story --query "west gate conflict" --json
novelfabric knowledge insight --project my-story --query "branch risk" --json
```

要求：

- 从文本事实重建 StoryGraph
- quick / panorama / insight 检索必须带 source paths
- `knowledge/` 下所有产物可删后重建

### 5.8 Simulation State Engine

候选命令：

```bash
novelfabric sim session create --project my-story --session session-001 --timepoint tp-0001 --characters aria,ben --json
novelfabric sim context-pack --project my-story --session session-001 --round next --agent aria --json
novelfabric sim append-turn --project my-story --session session-001 --agent aria --role character --file aria-output.json --json
novelfabric sim validate-round --project my-story --session session-001 --round 3 --json
novelfabric sim step --project my-story --session session-001 --input fixture-round.json --json
novelfabric sim test --project my-story --fixtures simulation/tests --json
novelfabric sim close --project my-story --session session-001 --reason-file reason.md --json
```

保留职责：

- session create / inspect / close
- active session pointer
- append-only logs
- structured turn records
- context-pack generation
- round validation
- fixture replay

移除职责：

- 后端生成人物决策
- 后端生成 random event / world / KP / auditor reasoning
- 后端按 provider/model 调 LLM

外部 agent loop：

```text
1. pi/Hermes 调 sim context-pack 获取某 agent 上下文。
2. pi/Hermes 读取 NovelFabric skill 并推理。
3. pi/Hermes 输出结构化 action/output 文件。
4. NovelFabric 校验并应用允许的写入。
5. NovelFabric 写审计，按需重建 index/report。
```

### 5.9 Report

候选命令：

```bash
novelfabric report simulation --project my-story --session session-001 --round 4 --json
novelfabric report consistency --project my-story --session session-001 --round 4 --json
novelfabric report branch-impact --project my-story --branch branch-west-gate --json
novelfabric report context-pack --project my-story --kind writing-prewrite --chapter chapter-004 --json
```

职责：

- 从已有证据生成报告
- 引用 source paths
- 生成一致性/分支影响/续写准备报告骨架
- 不做开放式访谈推理

## 6. Skill 管理模型

V4 的主要人机/agent 接口应该是 skill，CLI 只提供安全原子能力。

最低 skill 集：

| Skill | 目的 | 可调用 CLI |
|---|---|---|
| `novelfabric-workspace-init` | 创建/修复 pi-operable workspace | `workspace`, `project`, `config` |
| `novelfabric-import-book` | txt 导入、章节切分、语义抽取申请/应用 | `import`, `card`, `agent`, `memory` |
| `novelfabric-character-turn` | 单个角色回合 | `sim context-pack`, `knowledge quick`, `fs patch`, `sim append-turn` |
| `novelfabric-kp-adjudicate` | KP 裁定 | `sim context-pack`, `card`, `fs patch`, `sim append-turn` |
| `novelfabric-world-update` | 世界观维护 | `knowledge panorama`, `card`, `memory`, `sim append-turn` |
| `novelfabric-project-audit` | 漂移/时间线/证据检查 | `knowledge insight`, `timeline`, `report`, `sim validate-round` |
| `novelfabric-author-draft` | 推演证据转章节草稿 | `report context-pack`, `writing`, `fs patch` |
| `novelfabric-review-check` | 章节审稿 | `knowledge panorama`, `report`, `writing`, `fs patch` |
| `novelfabric-rollback-branch` | 历史改动转时间线分支 | `timeline`, `writing`, `fs patch` |

每个 skill 必须写清：

- 触发条件
- 输入参数
- 允许调用的 CLI
- 可读文件范围
- 可写文件范围
- 输出必须包含的 evidence paths
- 宣称完成前必须运行的 validation command

## 7. V4 工作区目标布局

```text
projects/<slug>/
  AGENTS.md
  project.md
  project.json
  .novelfabric/
    workspace.json
    template-manifest.json
    cli-manifest.json
    validation-report.json
    scaffold-manifest.json
  import/
  cards/
    characters/
    rules/
    world/
  memory/
    global/
    branches/
    chapters/
    agents/
  writing/
    chapters/
    review-notes/
    audit/
  simulation/
    active-session.txt
    sessions/
    logs/
    turns/
    context-packs/
    tests/
  timeline/
    index.json
    timepoints/
    branches/
  agents/
    <agent-id>/
      soul.md
      memory.md
      profile.json
      skills/
      audit/
  knowledge/
    ontology.json
    graph/
    chunks/
    indexes/
  reports/
  history/
```

## 8. Web 与 pi Agent SDK 边界

Vue 前端在 V4 不再调用后端 LLM endpoint。

目标 Web flow：

```text
Vue UI action -> pi agent SDK task 或 local agent bridge -> NovelFabric skill -> NovelFabric CLI -> workspace files -> UI refresh
```

可选 HTTP bridge 可以提供：

- 项目浏览
- 文件预览
- CLI 原语的安全 CRUD wrapper
- command invocation status
- web-to-agent task handoff

HTTP bridge 不拥有：

- provider keys
- model choice
- character turn ordering logic
- LLM request retry
- semantic extraction prompt as backend code

## 9. API 兼容与工具鉴权

### 9.1 External Swarm 兼容冻结

当前机器上已经有服务依赖 NovelFabric 的集群推演能力，例如 Hermes/OpenAlice/TraderAlice profile 用它做舆情、市场影响或公共事件推演。因此 V4 必须把 external swarm inference 视为冻结兼容面，而不是可以随内部重构删除的 v3 代码。

冻结兼容面包括：

- `POST /api/external/swarm-inferences`
- `GET /api/external/swarm-inferences/{inference_id}`
- `POST /mcp` JSON-RPC transport
- MCP tools：`external_swarm_infer`、`external_swarm_require_context`、`external_swarm_get`
- `client_request_id` 幂等行为
- `projects/external-<domain>/...` 与 `external/inferences/...` 的 artifact path 语义
- MCP `structuredContent` 与 mirrored JSON text content

当前响应字段必须保持兼容：

- `inference_id`
- `project_slug`
- `session_id`
- `domain`
- `title`
- `rounds_completed`
- `item_count`
- `artifact_paths.manifest`
- `artifact_paths.report`
- `artifact_paths.input_items[]`
- `artifact_paths.session`
- `artifact_paths.swarm_rounds[]`
- `artifact_paths.context`
- `artifact_paths.role_reasoning[]`
- `summary_markdown`
- `context_requirements`
- `role_reasoning[]`

兼容策略：

- 允许 additive fields，前提是旧客户端可忽略。
- 删除字段、改名、改变 path 含义、改变幂等规则、改变 MCP tool name，都必须开新 endpoint/tool version。
- V4 可以把内部实现迁到 CLI/shared service，但旧后端和新后端必须先通过同一套 fixture contract tests。
- 迁移期保留旧 HTTP/MCP endpoint 作为 adapter，避免依赖它的 profile 立刻改客户端。

必需测试：

- Hermes/TraderAlice 风格请求与响应 golden JSON fixture
- `ExternalSwarmInferenceResponse` serializer 测试
- HTTP `POST` / `GET` route 测试
- MCP `tools/list` 工具名与 schema 测试
- MCP `tools/call` 测试，证明 `structuredContent` 与 HTTP 响应结构兼容
- artifact path 测试，覆盖 manifest/report/items/session/swarm rounds/context/role reasoning
- schema parity 测试，证明 MCP `tools/list` 会暴露 HTTP 已接受的可选字段，包括 `context`

已知需要 additive 修复的兼容洞：当前 Rust request struct 接受可选 `context`，但 MCP `tools/list` 的 input schema 尚未暴露它。给 MCP schema 增加 `context` 是兼容修复；移除 request 对 `context` 的支持不是兼容修复。

### 9.2 CLI 形态与 skill 复杂度折中

优先一个 `novelfabric` 主 binary，而不是大量离散 executable。skill 面向的是稳定粗粒度动作，不应承担复杂命令拓扑。

建议稳定 skill-facing verbs：

- `workspace doctor`
- `context-pack`
- `recall`
- `propose-action`
- `append-turn`
- `validate`
- `report`
- `knowledge quick|panorama|insight`

子命令只是薄 wrapper；CLI、HTTP bridge、MCP bridge、测试、未来 pi SDK bridge 都应复用同一组 Rust service。权限、路径保护、审计也必须在 service 层实现。

### 9.3 Capability Manifest 鉴权

skill -> tool 调用不能只相信 prompt 自觉。V4 应定义显式 workspace capability manifest，例如：

```text
projects/<slug>/.novelfabric/capabilities.toml
projects/<slug>/.novelfabric/actors/<actor-id>.toml
```

最低 capability 词表：

- `project.manage`
- `workspace.materialize`
- `knowledge.rebuild`
- `knowledge.query`
- `swarm.run`
- `external_swarm.run`
- `simulation.session_manage`
- `simulation.append_turn`
- `report.render`
- `memory.recall`
- `memory.write_own`
- `memory.propose_shared`
- `memory.read_profile:<id>`
- `files.read_allowed`
- `files.patch_allowed`
- `files.patch_protected`

主 agent 默认拥有：

- 项目/模板/workspace 管理
- 知识库 rebuild 与全局查询
- simulation/session 生命周期管理
- external swarm inference
- report rendering
- validated proposal 晋升为 canonical files

角色 subagent 默认拥有：

- 读取分配给自己的 context pack
- recall 自己的记忆和显式共享记忆
- 草拟 action JSON
- 通过 validation append 自己的 turn output
- 在 proposal path 中提出记忆更新

角色 subagent 默认拒绝：

- 项目创建/删除/template 修改
- global knowledge rebuild
- external swarm inference
- protected files 直接编辑
- 其它 profile 私有记忆直接读写
- 未经 validation 把 proposal 晋升为 canonical memory/timeline

所有 mutating command 必须审计：

- actor id
- profile/card id
- command 与参数摘要
- granted capability
- target paths
- result status
- timestamp

### 9.4 记忆 Recall 语义

`recall` 很有用，但不能变成权限泄漏。

建议命令：

```bash
novelfabric memory recall \
  --workspace <path> \
  --actor aria \
  --profile aria \
  --query "the west gate oath" \
  --scope own-and-shared \
  --limit 12 \
  --json
```

规则：

- 在项目目录内运行时可以从 `.novelfabric/workspace.json` 推断 workspace。
- 但涉及角色记忆权限时，actor/profile/card 必须显式给出。
- 默认角色 recall 只读自己的记忆和被授权共享的项目记忆。
- 跨 profile 记忆读取需要 `memory.read_profile:<id>` 或由主 agent 生成 context pack。
- 输出必须包含 source paths、memory layer、owner/profile、denied/redacted counts。
- 被拒绝的条目应体现为 redacted counts，而不是静默混入或静默省略。

## 10. V3 资产废弃与迁移规则

V4 后端废弃：

- `backend/src/llm.rs`
- `LlmConfigService` endpoint/role model config 产品路径
- `/api/config/llm-*` routes
- backend LLM healthcheck
- backend LLM semantic import extraction
- `backend/src/bin/novelfabric_fanfic.rs`
- backend-owned StorySwarm role scheduling 主循环

不废弃：

- external swarm HTTP/MCP compatibility endpoints 与 MCP tools；只有内部实现可在兼容测试存在后迁到 V4 shared services

迁移规则：

1. `backend_v2` 等价 CLI 覆盖完成前，不改旧文件。
2. 先迁移确定性函数：storage、config、project layout、runtime read/glob/patch、import decode/split。
3. 用 `import context-pack` + `apply-agent-extraction` schema 替代后端 LLM 拆书。
4. 原生小说工作流用 `sim context-pack` + `sim append-turn` 替代 simulation `advance_round` 后端调度，同时保留 external swarm 兼容 adapter。
5. 暴露角色 agent 可写命令前，先加入 capability manifest 检查。
6. CLI 契约测试稳定后，再做薄 Web bridge。
7. V4 语义从 planning 变成 active 后，同步更新 `PROJECT.md`、root `AGENTS.md`、`docs/architecture/*.md`。

## 11. 实施阶段

### V4.0 规划与 staging

已完成/本阶段目标：

- `backend_v2/AGENTS.md`
- `backend_v2/novelfabric_v2backend_workspace_style_backend.md`
- `backend_v2/novelfabric_v2backend_workspace_style_backend.zh.md`
- 尚未实现运行时代码

### V4.1 TypeScript workspace skeleton

目标：

- `backend_v2/package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.build.json` 与严格 lint/test 配置
- shared config / safe path / workspace layout TypeScript services
- root `novelfabric` CLI
- `config path`
- `config print`
- `workspace print-layout`
- `workspace doctor`
- 默认解析 `~/.config/novelfabric`，支持 `XDG_CONFIG_HOME`，缺少 HOME/XDG 时显式失败
- fixture-backed workspace doctor 与 CLI JSON envelope 测试

验证：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
HOME=/Users/dbydd XDG_CONFIG_HOME= npm run cli -- config path --json
npm run cli -- workspace doctor --path fixtures/workspaces/valid-basic --json
```

### V4.2 Project + safe file CLI

目标：

- project create/list/inspect/validate
- fs read/glob/patch/write/append
- 写入审计
- `soul.md` / `memory.md` 保护

### V4.3 Template store + skill materialization

目标：

- 从 `~/.config/novelfabric/templates` 加载模板
- 物化 project-local `AGENTS.md`
- 内置 NovelFabric skill templates
- skill schema validation
- Auto-PPT 式 content/scaffold 边界 manifest
- OpenAlice 式 template/satellite capability registry

### V4.4 无后端 LLM 的 import

目标：

- txt decode/split/import report
- semantic extraction context pack
- `apply-agent-extraction` validator/applier
- 不再生成猜测式语义卡

### V4.5 外部 agent 驱动的 simulation state machine

目标：

- session create/inspect/close
- per-agent context pack
- append external agent turn
- validate round
- safe file runtime 应用结构化 action
- RPG-Harness 式 `sim step` / `sim test` fixture replay
- active session / turn manifest 文件化
- 由 capability manifest 约束的角色 `memory recall` 与 proposal-write 命令

### V4.6 Knowledge + report CLI

目标：

- StoryGraph rebuild
- StoryRAG quick/panorama/insight
- evidence-based reports
- `knowledge/` 可删可重建

### V4.7 Compatibility bridge + Web bridge + SDK handoff

目标：

- external swarm v1 compatibility fixture suite，覆盖旧 HTTP/MCP 形状
- CLI/library 原语上的薄 HTTP bridge
- Vue 通过 pi agent SDK / local bridge 触发 agent task
- 移除或隐藏 V3 LLM settings UI

## 12. 风险与开放问题

1. **pi project-local skill discovery**

   需要确认 pi 项目本地 skill 的最终发现约定。确认前以 `skills/<name>/SKILL.md` 作为规划模式。

2. **Web pi SDK 执行模型**

   Vue、pi SDK、本地 CLI spawn 的边界需要先做 dependency research。

3. **模板版本升级**

   `~/.config/novelfabric` 中的用户自定义模板需要 version metadata 与非破坏性升级策略。

4. **外部 agent action schema**

   当前 `AgentRoundAction` 有参考价值，但 V4 需要更严格的 schema 和便于 agent 自修复的错误信息。

5. **旧 API 兼容**

   现有前端和测试依赖 HTTP endpoint。V4 应在 `backend_v2` staging 完成后再切换，或保留兼容 bridge。

6. **安全边界**

   pi/Hermes 可能比旧 v2 agent 更有系统能力，因此 NovelFabric CLI 必须更保守：project-root path check、exact replacement、write audit、critical asset protection、affected-path reporting 都是硬要求。

## 13. 立即下一步

规划阶段接受后，正式进入 `backend_v2/` 开发：

1. 从已经提交的 TypeScript CLI foundation 继续推进。
2. 将确定性的 storage / path / config 行为迁入共享 TypeScript services。
3. 在现有 `novelfabric config path`、`config print`、`workspace print-layout`、`workspace doctor` 基础上扩展 project create 与 protected file primitives。
4. 持续补充 XDG config precedence、env fallback、JSON envelope、路径安全、workspace layout validation 测试。

`backend_v2` 已不再是纯规划目录；它包含 V4 TypeScript runtime code。
