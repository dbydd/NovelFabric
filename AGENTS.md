# AGENTS.md

> 给后续进入本仓库的 Hermes / coding agent 的项目级常驻约束。
> 目标：这些约束应被自动注入为开发上下文，而不是散落在聊天记录里。

## 1. 你现在接手的是什么

NovelFabric 是一个**文本优先**的小说创作与推演平台。

当前主线已经进入 **NovelFabric V4**：把 NovelFabric 适配成可以被 pi / Hermes 这类 agent 直接接管的文本工作区。

V4 的方向不是继续扩大旧后端 agent runtime，而是：

- V4 TypeScript 产物从旧 `backend_v2/` staging 升级为计划改名后的 `novelfabric_v4_mono/` mono app：CLI、可选 Web shell、pi agent bridge 边界同目录演进；旧 Rust 后端只作为迁移输入
- Vue 前端保留为 V4 mono app 内的可选 CLI 启动项；网页端的 agent 操作应转向 pi agent SDK / 本地 agent bridge，并仍通过 NovelFabric CLI 原语写入项目事实
- 一切项目内可变资源继续基于文本文件
- 角色调度、角色推理、KP/世界维护/项目审核等智能工作移交给外部 agent + skill
- 文件管理、导入、推演状态机、检索、报告等后端能力拆成最小 CLI 可执行单元
- 工作区模板、技能模板、默认配置放到 XDG 配置目录，默认 `~/.config/novelfabric`
- 环境变量配置降级为缺失配置项的 fallback 或显式自动化 override
- 推演、记忆、时间线、文书、审计仍必须可落盘、可回滚、可复盘

## 2. 最高优先级文档读取顺序

进入仓库后，不要自行搜索猜测上下文，按下面的显式索引读：

| 顺序 | 文件                                                                                                   | 用途                                                                | 何时必须读                                                             |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | `PROJECT.md`                                                                                           | 项目总览、技术栈、source of truth 索引                              | 所有任务                                                               |
| 2    | `PRODUCT_SPEC.md`                                                                                      | 原始产品规格、文本优先与小说创作核心需求                            | 所有架构/功能任务                                                      |
| 3    | `PRODUCT_SPEC_2.md`                                                                                    | v2 agent runtime 收束：受限文本智能体、skill-first、安全一致性      | 所有 agent/runtime/simulation 任务                                     |
| 4    | `CODEX_INFO.md`                                                                                        | 当前真实状态、历史坑点、端口/LLM/provider 约束                      | 所有继续开发任务                                                       |
| 5    | `STATE.md`                                                                                             | 当前状态摘要与质量门禁提示                                          | 所有继续开发任务                                                       |
| 6    | `docs/architecture/mirofish-fusion-plan.md`                                                            | MiroFish 融合边界、模块映射、禁止路线                               | MiroFish / RAG / 群体智能 / 报告相关任务                               |
| 7    | `docs/architecture/story-graph-rag.md`                                                                 | StoryGraph / StoryRAG 数据模型、检索工具、派生索引约束              | graph / rag / knowledge / memory 检索任务                              |
| 8    | `docs/architecture/story-swarm-runtime.md`                                                             | StorySwarm / ReportAgent 轮次、结构化输出、一致性检查               | simulation / swarm / report / interview 任务                           |
| 9    | `docs/architecture/implementation-roadmap-story-systems.md`                                            | 文件级实现路线图、milestone、测试命令                               | 实现 StoryGraph/RAG/Swarm/ReportAgent 时                               |
| 10   | `docs/architecture/v3-usability-plan.md`                                                               | v3 可用性阶段入口：LLM 拆书、LLM 健康检查、技能卡调用证据、按钮反馈 | v3 / usability / 拆书 / LLM / provider / model / skill invocation 任务 |
| 11   | `novelfabric_v4_mono/AGENTS.md`（改名前为 `backend_v2/AGENTS.md`）                                     | V4 mono app 本地约束                                                | V4 / mono app / CLI / workspace / web shell 任务                       |
| 12   | `novelfabric_v4_mono/docs/architecture/v4-cli-workspace-harness-plan.md`                               | V4 当前 CLI-first workspace harness 主规划                          | V4 架构/实现任务                                                       |
| 13   | `novelfabric_v4_mono/docs/architecture/v4-cli-command-contract.md`                                     | V4 当前 CLI 命令契约、capability、错误码                            | V4 CLI / bridge / Web shell 任务                                       |
| 14   | `novelfabric_v4_mono/novelfabric_v2backend_workspace_style_backend.md`（改名前为 `backend_v2/...`）    | V4 workspace/mono app 历史规划输入                                  | V4 架构/实现任务                                                       |
| 15   | `novelfabric_v4_mono/novelfabric_v2backend_workspace_style_backend.zh.md`（改名前为 `backend_v2/...`） | V4 历史规划输入中文版                                               | V4 架构/实现任务                                                       |

如果任务与 MiroFish 融合、群体智能、RAG、推演增强、报告 agent 有关，**第 6-9 份文档必读**。如果任务与 v3 可用性、LLM 拆书、provider/model 配置、技能卡调用证据或按钮反馈有关，**第 10 份文档必读**。如果任务与 V4、pi/Hermes 工作区化、CLI 拆分、XDG 模板配置、`novelfabric_v4_mono`（旧称 `backend_v2`）有关，**第 11-15 份文档必读**，其中第 12-13 份是当前 active 规划，第 14-15 份只作为历史规划输入。不要假设可以靠搜索补齐这些约束。

## 3. 项目级硬约束

### 3.1 架构约束

- V4 `novelfabric_v4_mono/`（旧称 `backend_v2/`）新实现必须使用 TypeScript；不得新增 Rust crate/Cargo workspace 作为 V4 mono app 主线。
- 旧 `backend/` Rust 能力是迁移输入，未被 V4 TypeScript CLI/bridge 覆盖前不要破坏其兼容面。
- V4 新主线不再把 CLI 与 Web shell 做成两个包；可选 Web UI、CLI、pi agent bridge 边界应同目录演进。旧 `frontend/` 在迁移完成前作为历史输入保留。
- NovelFabric 主架构必须继续遵守“文本优先、文件优先、可审计”。
- 不允许把核心项目状态藏进不可追踪的黑盒数据库作为唯一真相源。
- 即使引入索引/向量/图，也只能作为**派生索引**；源事实仍需落文本或结构化可审计文件。

### 3.2 agent / workspace 约束

- V4 中，NovelFabric 项目本身必须成为 pi / Hermes 可直接接管的 agent workspace。
- 小说角色、KP、世界维护、项目审核、作者、审稿等智能调度不再由后端 LLM runtime 拥有，而由外部 agent 通过 skill 执行。
- NovelFabric 提供给 agent 的能力主线保持：`read` / `glob` / `patch/write` / context-pack / validate / report。
- 不默认给 NovelFabric 管理的角色资产隐式 shell / 任意网络 / 任意路径权限；即使外部 agent 有系统能力，也必须通过 NovelFabric CLI 原语写入项目事实。
- 关键资产必须有保护：`soul.md`、`memory.md`、核心卡片、关键时间点记忆。
- 后端 LLM provider 适配、role model config、healthcheck 在 V4 中视为旧路径，不继续扩展为主线。
- V4 mono app 仍需要面向非技术网页用户的 LLM 运行时，但该运行时应是对 pi agent SDK 的受控包装：使用 NovelFabric 自己约定的配置路径（默认 `~/.config/novelfabric/pi/`）、NovelFabric 安装/管理的 sandbox/permission/CLI-only-write extensions，并默认阻止 raw `bash`、raw `write/edit`、任意网络和任意路径访问。
- 集群推演 / external swarm inference 是已有外部依赖面，不等同于旧 LLM adapter；V4 必须保持其 HTTP/MCP API 兼容。

#### 当前 V4 handoff gap（下一轮迭代入口）

已完成的 pi-backed semantic evidence loop 与 domain artifact materialization 已归档到：

- `novelfabric_v4_mono/docs/architecture/archive/v4-pi-evidence-loop-archive.md`
- `novelfabric_v4_mono/docs/architecture/archive/v4-domain-artifact-materialization-archive.md`

active handoff 不再堆叠已完成细节，下一轮只聚焦未完成 gap。

下一轮优先 gap：

1. 接入 pi SDK `AgentSession` / event stream / Web-safe tool policy，替代或封装当前 CLI process bridge。
2. 打通 Web 全流程：上传/导入原文 → semantic 拆书 → cards/memory/timeline → StoryRAG/context → StorySwarm → ReportAgent → chapter generation → editor review/save。
3. 实现 semantic import/materialization：原文通过 pi 生成章节、角色/世界/规则卡、timeline、memory、context pack，并做内容质量校验。
4. 落 frozen external swarm REST/MCP adapters 与 golden tests。
5. 收紧 cards/memory/swarm/report/writing 的 domain-specific capabilities，避免用 broad file/project 权限代替业务授权。

详细测试标准见 `novelfabric_v4_mono/docs/architecture/v4-cli-workspace-harness-plan.md` 与 `novelfabric_v4_mono/docs/qa/v4-full-usability-acceptance.md`。

### 3.3 融合 MiroFish 的边界

允许吸收：

- GraphRAG / Temporal GraphRAG 思路
- 群体智能推演编排思路
- ReportAgent / interview / insight_forge 这类高层工具形态

不允许直接照搬为主线：

- 用 Python Flask + Zep Cloud + OASIS 取代 NovelFabric 主后端
- 把 Twitter/Reddit 社媒模拟直接当作小说跑团内核
- 在未厘清 AGPL 边界前复制 MiroFish 实现代码进主仓库

### 3.4 MiroFish 许可证边界

- `MiroFish` 为 AGPL-3.0。
- 默认策略：**只借鉴架构，不直接复制实现代码。**
- 如需做兼容层，应优先作为可选 adapter / 外部进程集成，而不是内嵌主链路。

### 3.5 V4 workspace 参考项目吸收边界

用户明确认可并要求参考这些已跑通的 workspace 模式：

- `github.com/TraderAlice/OpenAlice`
- `github.com/luokerenx4/autogal`
- `github.com/Ame-X/Auto-PPT`

可吸收的共性：

- workspace 是能力边界，新能力优先做模板、skill、外部/卫星工作区，而不是继续膨胀核心后端。
- 工作区由文件、模板、agent 指令、CLI harness 和验证命令组成，agent 可以直接读懂并操作。
- 核心引擎保持小而确定，只做状态转移、校验、索引、报告等可复盘原语。
- 内容/资源采用“一项事实一个文件或少数固定文件”的布局，顺序/可见性/状态由显式配置文件管理。
- AI/agent 工作流要有 headless CLI 读态、单步执行、测试 fixture、可视/产物验证等闭环。
- 文档/skill 是 harness 的一部分，改变工作区契约时必须同改对应 AGENTS/SKILL/规划文档。

不可吸收为主线的内容：

- 不把 NovelFabric 改成交易系统、GalGame 引擎或 PPT 工具。
- 不直接复制参考项目实现代码。
- 不因为参考 OpenAlice workspace launcher 就把 NovelFabric 核心变成通用 PTY 管理器；NovelFabric 的核心仍是小说文本工作区和安全 CLI 原语。

### 3.6 V4 API 兼容与 tool 鉴权约束

- `POST /api/external/swarm-inferences`、`GET /api/external/swarm-inferences/{inference_id}`、`POST /mcp` 下的 `external_swarm_infer` / `external_swarm_require_context` / `external_swarm_get` 是 V4 冻结兼容面。
- 不允许在 V4 重构中破坏 external swarm 的请求字段、响应字段、artifact path 语义、idempotency 行为、MCP `structuredContent` 形状；需要新增能力时采用 additive fields 或新 endpoint/tool name。
- 兼容性必须有 golden fixture / serializer / HTTP / MCP 单元测试覆盖，至少包含 Hermes / TraderAlice 舆情或市场影响推演风格的请求。
- V4 CLI 形态优先采用一个 `novelfabric` 主入口与少数稳定子命令；子命令只是入口，权限、路径保护、审计必须在共享 TypeScript 服务层执行。
- V4 可选 Web shell 必须通过显式 CLI/script 启动，默认使用 50000+ 端口；layout-only demo 不得调用后端 API。
- skill -> tool 调用必须经过显式 capability manifest，而不是靠 skill 自觉或靠命令名猜权限。
- 主 agent 默认拥有项目管理、知识库管理、集群推演/session 管理、报告生成、模板物化等管理能力。
- 角色 subagent 默认只拥有受限上下文读取、自己的记忆 recall、行动草案、记忆更新 proposal 等能力；不得直接管理项目、重建全局知识库、运行 external swarm、写其它角色私有记忆或改关键资产。
- 工作区内的“回忆/recall”必须按 workspace + actor/profile/card 解析权限，默认只读本角色记忆和被授权的共享记忆；跨 profile 读取必须显式授权并在输出中保留来源路径和 redaction 信息。

## 4. 当前已确定的融合方向

NovelFabric 对 MiroFish 的吸收，不叫“把 MiroFish 接进来”，而叫：

- `StoryGraph`：本地图谱与时序知识层
- `StoryRAG`：面向小说项目的检索层
- `StorySwarm`：多角色/系统角色群体推演层
- `ReportAgent`：推演报告、分支分析、角色采访、一致性审计

统一主线：

```text
StoryGraph → StoryRAG → StorySwarm → ReportAgent → optional external adapters
```

外部 adapter 的默认形态是通用 MCP / HTTP / 脚本 / skill 边界，不是把某个上游系统的代码耦合进 NovelFabric。面向 agent 的调用优先走 remote MCP 工具（例如 `external_swarm_infer`），避免让 agent 直接调裸 `/api/*`；外部事件、新闻、事故、研究材料等输入应先落为 NovelFabric 项目内文本/结构化文件，再进入 StoryRAG / StorySwarm / ReportAgent；接口命名保持 caller-neutral（例如 `external swarm inference`），具体业务语义通过 `domain`、items、questions 和 metadata 表达。

## 5. 后续开发必须遵守的模块边界

### 5.1 StoryGraph

源数据应来自：

- `project.md`
- `cards/characters/*.md`
- `cards/rules/*.md`
- `cards/world/*.md`
- `memory/**`
- `writing/chapters/*.md`
- `simulation/logs/**`
- `timeline/**`

图谱/索引属于派生产物，建议位于：

```text
projects/<slug>/knowledge/
```

### 5.2 StoryRAG

最低要提供 3 类能力：

- `quick_search`
- `panorama_search`
- `insight_forge`

所有检索输出都应尽量带：

- 文件路径
- 时间点 / 时间线
- 引用事实
- 相关实体 / 关系

### 5.3 StorySwarm

推演顺序默认是：

```text
characters -> random-event -> world-maintainer -> kp -> project-auditor
```

每轮推演后的最小落盘要求：

- session log
- agent memory
- timepoint / branch 相关事件
- 必要的 graph / episode 增量更新

### 5.4 ReportAgent

ReportAgent 不是普通摘要器。
它应该能结合 StoryRAG / session / agent interview 输出：

- 推演报告
- 一致性审计报告
- 分支影响分析
- 续写建议
- 伏笔/冲突追踪

## 6. 开发节奏约束

涉及上述融合主线时，默认顺序：

1. 先补文档与数据模型
2. 再实现最小后端闭环
3. 再接入现有 simulation / runtime
4. 再做前端呈现
5. 最后考虑外部 adapter

不要上来就：

- 接 Python 服务
- 接 Zep Cloud 强依赖
- 引 OASIS 成为主链路
- 做 UI 演示而后端语义没收敛

## 7. 验收要求

宣称完成前，至少给出：

1. 改了哪些文档 / 文件
2. 数据结构或 API 是否已落盘
3. V4 TypeScript 代码需提供 `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 证据；涉及可选 Web shell 时还需提供 `npm run web:build` 与 `npm run cli -- web demo --port 50021 --dry-run --json` 证据；旧 Rust 代码变更才需要 cargo/clippy 证据
4. 若只是设计文档阶段，要明确写清尚未实现的边界

## 8. 文档维护规则

凡是后续改变了以下任一内容，必须同步更新 `docs/architecture/*.md` 与本文件：

- MiroFish 融合边界
- StoryGraph 数据模型
- StoryRAG 检索接口
- StorySwarm 轮次编排
- ReportAgent 职责
- 外部 adapter 的定位
- 通用 external swarm inference API / script / skill 合约
