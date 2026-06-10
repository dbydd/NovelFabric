# MiroFish 融合方案（NovelFabric 原生化）

> 状态：设计约束文档
> 目的：把对 MiroFish 的研究结论收敛成 NovelFabric 后续 agent 开发的固定上下文。

---

## 1. 结论

NovelFabric 与 MiroFish 有明显可融合性，但**不应直接把 MiroFish 当作 NovelFabric 主后端内核引入**。

正确方向是：

- 吸收其 `GraphRAG`、`群体智能推演`、`ReportAgent` 设计思想
- 按 NovelFabric 的文本优先、Rust 后端、受限 runtime 约束重新实现

统一命名为：

- `StoryGraph`
- `StoryRAG`
- `StorySwarm`
- `ReportAgent`

---

## 2. 为什么不直接接入 MiroFish

### 2.1 技术栈不匹配

MiroFish 当前实现依赖：

- Flask
- Zep Cloud
- camel-oasis / OASIS
- Python 后端调度

NovelFabric 当前主线是：

- Rust axum 后端
- 文本文件为核心数据源
- 受限文本 runtime
- 当前 simulation / memory / timeline / writing 已有本地领域层

直接接入会把系统撕成“双后端拼装架构”。

### 2.2 业务语义不同

MiroFish 主范式：

- 舆情 / 公共事件 / 社媒传播模拟

NovelFabric 主范式：

- 小说角色推演
- KP 裁定
- 世界观维护
- 项目审核
- 时间轴分叉
- 文书落地

两者都属于多智能体，但动作语义不同。

### 2.3 许可证风险

MiroFish 为 AGPL-3.0。

默认策略：

- 不直接复制实现代码进 NovelFabric 主链路
- 只吸收架构思想
- 如未来需要做兼容层，优先做成可选外部 adapter

---

## 3. 融合总目标

把 NovelFabric 升级为一个具备以下能力的小说创作平台：

```text
文本项目资源
  ↓
StoryGraph（本地时序图谱）
  ↓
StoryRAG（检索与洞察）
  ↓
StorySwarm（群体推演）
  ↓
ReportAgent（报告/采访/分析）
```

这条主线必须保持：

- 所有核心事实可追溯到文本文件
- 检索层是派生层，不是唯一真相源
- agent 行动必须可审计
- 时间线修改必须遵守 branch / rollback 机制

---

## 4. 模块映射

| MiroFish | NovelFabric 对应原生模块 |
|---|---|
| ontology_generator | StoryGraph schema / ontology |
| graph_builder | StoryGraph rebuild / incremental update |
| zep_tools.quick_search | StoryRAG.quick_search |
| zep_tools.panorama_search | StoryRAG.panorama_search |
| zep_tools.insight_forge | StoryRAG.insight_forge |
| oasis_profile_generator | character/system agent profile generator |
| OASIS simulation | StorySwarm runtime over simulation.rs |
| interview_agents | ReportAgent / simulation interview API |
| report_agent | NovelFabric ReportAgent |

---

## 5. NovelFabric 中的原生化替代

### 5.1 StoryGraph 替代 Zep Standalone Graph

不把 Zep 作为默认唯一后端。

默认使用：

- 本地 `knowledge/graph/nodes.jsonl`
- 本地 `knowledge/graph/edges.jsonl`
- 本地 `knowledge/graph/episodes.jsonl`
- 本地 chunks / indexes

可选支持未来 adapter：

- Zep
- 向量库
- 图数据库

但源事实必须来自项目文本。

### 5.2 StorySwarm 替代 OASIS 社媒模拟

不照搬 Twitter/Reddit 平台语义。

NovelFabric 的群体推演主循环固定围绕：

1. 角色决策
2. 随机事件
3. 世界观维护
4. KP 裁定
5. 项目审核
6. 记忆/时间线/图谱更新

### 5.3 ReportAgent 替代 MiroFish 报告系统

保留多工具、ReACT 风格、深度检索、采访功能。

但输出应更贴合小说/创作：

- 推演报告
- 角色关系变化报告
- 分支影响分析
- 续写建议
- OOC / 世界观 / 时间线一致性审计

---

## 6. 明确禁止的错误方向

以下做法视为偏题：

1. 直接把 MiroFish Python 后端并入主后端
2. 强制 NovelFabric 依赖 Zep Cloud 才能运行核心功能
3. 把 OASIS 社媒平台建模当作小说推演默认内核
4. 在 AGPL 边界未处理前直接复制其实现代码
5. 跳过 StoryGraph/StoryRAG，直接做花哨 UI 演示

---

## 7. 正确实施顺序

### Phase A
先补文档、数据模型、接口边界。

### Phase B
实现 StoryGraph 最小闭环。

### Phase C
实现 StoryRAG 三件套：

- quick_search
- panorama_search
- insight_forge

### Phase D
把 simulation 上下文升级为可消费 StoryRAG 的群体推演。

### Phase E
实现 ReportAgent 与采访能力。

### Phase F
如确有必要，再做外部 adapter。

---

## 8. 与后续 agent 开发的关系

后续 Hermes / 子 agent 在实现涉及：

- graph
- rag
- simulation upgrade
- report
- interview
- multi-agent

这些关键词的任务时，必须默认把本文件当作**项目级架构收束约束**，禁止回到“直接接入 MiroFish 原工程”的错误路线。
