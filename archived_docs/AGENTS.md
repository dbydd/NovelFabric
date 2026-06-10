# AGENTS.md

> 给后续进入本仓库的 Hermes / coding agent 的项目级常驻约束。
> 当前仓库处于 V5 完全重写准备阶段；这份文件的目标是避免后续 agent 把 `dev` 分支误读成可继续修补的旧实现仓库。

## 1. 你现在接手的是什么

NovelFabric 是一个**文本优先**的小说创作与推演平台。

当前 `dev` 分支已经主动清空上一版实现，只保留项目文档、架构记录、QA 文档和历史归档资料，为 **V5 彻底重写** 做准备。

这意味着：

- 当前仓库不是可运行产品
- 当前仓库不是 V4 增量开发分支
- 当前仓库的主要价值是约束、历史与 source of truth 文档

## 2. 最高优先级文档读取顺序

进入仓库后，不要自行搜索猜测上下文，按下面顺序读：

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `AGENTS.md`
7. `docs/architecture/mirofish-fusion-plan.md`
8. `docs/architecture/story-graph-rag.md`
9. `docs/architecture/story-swarm-runtime.md`
10. `docs/architecture/implementation-roadmap-story-systems.md`

按任务再继续读：

- 涉及 v3/v4 历史方案、CLI/workspace harness、命令契约、gap ledger、Web shell、bridge、external swarm 兼容时，继续阅读 `docs/architecture/` 中相关 `v4-*`、`external-swarm-*`、archive 文档。
- 涉及验收和回归门槛时，继续阅读 `docs/qa/`。
- 涉及视觉风格时，阅读 `design-system/novelfabric/MASTER.md`。

## 3. 当前分支的硬约束

### 3.1 仓库状态约束

- `dev` 分支当前应保持**文档优先**；不要假设这里还存在活跃代码、测试、构建链或依赖清单。
- 在没有先更新规划文档前，不要直接恢复大批旧文件或沿用旧目录结构。
- 任何重新引入实现代码的工作，都应先把 V5 的 active architecture、目录布局、验证方式写清楚。

### 3.2 产品高层约束

- NovelFabric 仍然必须遵守“文本优先、文件优先、可审计”。
- 不允许把核心项目状态藏进不可追踪的黑盒数据库作为唯一真相源。
- 即使引入索引、图谱、向量、RAG，也只能作为派生产物；源事实仍需落文本或结构化可审计文件。
- 角色 agent 仍应被视为**受限文本智能体**，而不是默认拥有任意 shell / 网络 / 路径权限的系统 agent。

### 3.3 融合边界约束

允许吸收：

- GraphRAG / Temporal GraphRAG 思路
- 群体智能推演编排思路
- ReportAgent / interview / insight_forge 这类高层工具形态
- workspace-first / harness-first / text-artifact-first 的工程模式

不允许直接照搬为主线：

- 用 Python Flask + Zep Cloud + OASIS 取代 NovelFabric 主后端
- 把 Twitter/Reddit 社媒模拟直接当作小说跑团内核
- 在未厘清 AGPL 边界前复制 MiroFish 实现代码进主仓库
- 因参考其它 workspace 项目而把 NovelFabric 核心改成通用 PTY 管理器

### 3.4 历史文档使用约束

- V4 文档是**历史输入**，不是必须继承的实现承诺。
- `docs/architecture/archive/` 下的归档文档用于追溯已完成过什么，不等于 V5 必须原样复刻。
- 若 V5 决定废弃某条 V4 路线，必须在新文档中明确写出废弃理由和替代方案。

## 4. 后续开发默认顺序

涉及 V5 重写时，默认顺序是：

1. 先补文档与边界
2. 再定目录结构与实现语言
3. 再实现最小可信执行面
4. 再补测试与验收
5. 最后再接用户界面或外部 adapter

不要上来就：

- 把 V4 文件原样搬回
- 直接恢复一套 CLI/Web/bridge 而不先重写契约
- 把“能跑”当作“可用”

## 5. 验收要求

宣称某个 V5 阶段完成前，至少给出：

1. 改了哪些文档 / 文件
2. 哪些高层约束被继承、废弃或重写
3. 数据结构、API、目录契约是否已明确落盘
4. 如果已经重新引入代码，需要给出与该阶段相匹配的最新验证证据
5. 如果还处于设计阶段，要明确写出尚未实现的边界

## 6. 文档维护规则

凡是后续改变了以下任一内容，必须同步更新 `AGENTS.md` 与相关 `docs/architecture/*.md`：

- 主实现语言与运行时边界
- StoryGraph / StoryRAG / StorySwarm / ReportAgent 的职责划分
- external swarm / MCP / HTTP adapter 的定位
- workspace 能力边界与 agent 权限模型
- V5 的目录布局、验证门槛与验收方式
