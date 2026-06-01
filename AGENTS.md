# AGENTS.md

> 给后续进入本仓库的 Hermes / coding agent 的项目级常驻约束。
> 目标：这些约束应被自动注入为开发上下文，而不是散落在聊天记录里。

## 1. 你现在接手的是什么

NovelFabric 是一个**文本优先**的小说创作与推演平台。

当前主线不是去“拼一个外部多 Agent 演示系统”，而是继续把 **NovelFabric v2** 做成：

- Rust 后端
- Vue 前端
- 一切项目内可变资源基于文本文件
- 角色 agent 运行在**受限 runtime**中，而不是完整 shell agent
- 推演、记忆、时间线、文书、审计都要可落盘、可回滚、可复盘

## 2. 最高优先级文档读取顺序

进入仓库后，不要自行搜索猜测上下文，按下面的显式索引读：

| 顺序 | 文件 | 用途 | 何时必须读 |
|---|---|---|---|
| 1 | `PROJECT.md` | 项目总览、技术栈、source of truth 索引 | 所有任务 |
| 2 | `PRODUCT_SPEC.md` | 原始产品规格、文本优先与小说创作核心需求 | 所有架构/功能任务 |
| 3 | `PRODUCT_SPEC_2.md` | v2 agent runtime 收束：受限文本智能体、skill-first、安全一致性 | 所有 agent/runtime/simulation 任务 |
| 4 | `CODEX_INFO.md` | 当前真实状态、历史坑点、端口/LLM/provider 约束 | 所有继续开发任务 |
| 5 | `STATE.md` | 当前状态摘要与质量门禁提示 | 所有继续开发任务 |
| 6 | `docs/architecture/mirofish-fusion-plan.md` | MiroFish 融合边界、模块映射、禁止路线 | MiroFish / RAG / 群体智能 / 报告相关任务 |
| 7 | `docs/architecture/story-graph-rag.md` | StoryGraph / StoryRAG 数据模型、检索工具、派生索引约束 | graph / rag / knowledge / memory 检索任务 |
| 8 | `docs/architecture/story-swarm-runtime.md` | StorySwarm / ReportAgent 轮次、结构化输出、一致性检查 | simulation / swarm / report / interview 任务 |
| 9 | `docs/architecture/implementation-roadmap-story-systems.md` | 文件级实现路线图、milestone、测试命令 | 实现 StoryGraph/RAG/Swarm/ReportAgent 时 |
| 10 | `docs/architecture/v3-usability-plan.md` | v3 可用性阶段入口：LLM 拆书、LLM 健康检查、技能卡调用证据、按钮反馈 | v3 / usability / 拆书 / LLM / provider / model / skill invocation 任务 |

如果任务与 MiroFish 融合、群体智能、RAG、推演增强、报告 agent 有关，**第 6-9 份文档必读**。如果任务与 v3 可用性、LLM 拆书、provider/model 配置、技能卡调用证据或按钮反馈有关，**第 10 份文档必读**。不要假设可以靠搜索补齐这些约束。

## 3. 项目级硬约束

### 3.1 架构约束

- 后端必须保持 Rust 主导，不把 NovelFabric 主后端改造成 Python 拼装壳。
- 前后端分离保持不变。
- NovelFabric 主架构必须继续遵守“文本优先、文件优先、可审计”。
- 不允许把核心项目状态藏进不可追踪的黑盒数据库作为唯一真相源。
- 即使引入索引/向量/图，也只能作为**派生索引**；源事实仍需落文本或结构化可审计文件。

### 3.2 agent 约束

- v2 agent 是**受限文本智能体**，不是完整系统代理。
- 不默认给 agent shell / 进程 / 任意网络 / 任意路径权限。
- agent 能力主线保持：`read` / `glob` / `patch/write` / 结构化输出。
- 关键资产必须有保护：`soul.md`、`memory.md`、核心卡片、关键时间点记忆。

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

外部 adapter 的默认形态是通用 HTTP / 脚本 / skill 边界，不是把某个上游系统的代码耦合进 NovelFabric。外部事件、新闻、事故、研究材料等输入应先落为 NovelFabric 项目内文本/结构化文件，再进入 StoryRAG / StorySwarm / ReportAgent；接口命名保持 caller-neutral（例如 `external swarm inference`），具体业务语义通过 `domain`、items、questions 和 metadata 表达。

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
3. `cargo fmt` / `clippy` / `test` 证据（若涉及 Rust 代码）
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
