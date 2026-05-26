# StoryGraph / StoryRAG 设计约束

> 用于约束 NovelFabric 后续的图谱与检索开发。

---

## 1. 核心原则

StoryGraph 与 StoryRAG 是 **NovelFabric 项目文本资源的派生知识层**。

这意味着：

- 源事实来自项目文本
- 图谱/索引可以重建
- 图谱/索引不是唯一真相源
- 任何事实都应尽量回溯到文件路径与时间点

---

## 2. 数据来源

StoryGraph 重建时默认扫描：

- `project.md`
- `cards/characters/*.md`
- `cards/rules/*.md`
- `cards/world/*.md`
- `memory/**`
- `writing/chapters/*.md`
- `simulation/logs/**`
- `timeline/**`

禁止默认读取项目目录外路径。

---

## 3. 建议落盘目录

```text
projects/<slug>/knowledge/
  ontology.json
  graph/
    nodes.jsonl
    edges.jsonl
    episodes.jsonl
  chunks/
    chunks.jsonl
  indexes/
    manifest.json
```

这些文件是**派生资产**，允许重建。

---

## 4. 最低数据模型

### 4.1 Node

建议字段：

```json
{
  "id": "character:aria",
  "name": "Aria",
  "labels": ["Character"],
  "summary": "...",
  "source_paths": ["cards/characters/aria.md"]
}
```

### 4.2 Edge

建议字段：

```json
{
  "id": "edge:0001",
  "source": "character:aria",
  "target": "faction:red-court",
  "relation": "ALLIED_WITH",
  "fact": "Aria currently cooperates with the Red Court.",
  "valid_at": "timeline/main/0003",
  "invalid_at": null,
  "source_path": "memory/agents/aria/..."
}
```

### 4.3 Episode

建议字段：

```json
{
  "id": "episode:main:0003:kp-ruling",
  "timeline": "main",
  "timepoint": "0003",
  "source_path": "simulation/logs/session-001.md",
  "summary": "KP ruled that ..."
}
```

---

## 5. 默认实体类型

第一版建议至少支持：

- `Character`
- `Faction`
- `Location`
- `Item`
- `Event`
- `Secret`
- `Rule`
- `WorldState`
- `Chapter`
- `TimelineBranch`

后续可扩展，但不要一开始泛化到失控。

---

## 6. 默认关系类型

第一版建议至少支持：

- `KNOWS`
- `HIDES_FROM`
- `ALLIED_WITH`
- `OPPOSES`
- `LOVES`
- `HATES`
- `OWES`
- `LOCATED_AT`
- `CAUSED`
- `PREVENTS`
- `REQUIRES`
- `CONSTRAINS`
- `MENTIONED_IN`
- `VALID_IN_TIMELINE`
- `BRANCHES_FROM`

---

## 7. StoryRAG 最低工具面

### 7.1 quick_search

用途：

- 单轮 agent 决策前的轻量查找
- 快速召回角色、章节、记忆、事件

输出必须尽量包含：

- `fact`
- `source_path`
- `timeline`
- `timepoint`

### 7.2 panorama_search

用途：

- 看全貌
- 看历史与当前差异
- 找长期冲突、设定变迁、角色关系演化

输出必须区分：

- 当前有效事实
- 历史 / 失效事实
- 相关节点
- 相关边

### 7.3 insight_forge

用途：

- 复杂剧情问题拆解
- 多跳检索
- 输出关系链与受影响对象

标准流程：

1. 子问题分解
2. 每个子问题检索
3. 汇总关键事实
4. 汇总核心实体
5. 构造关系链
6. 输出风险/影响分析

---

## 8. 重要约束

### 8.1 检索不是瞎总结

每个高层检索结果都应优先引用：

- 真实事实文本
- 文件路径
- 时间线 / 时间点

### 8.2 不允许把 embedding 结果当真相

embedding / rerank / vector store 只能帮助召回，不能替代文本事实。

### 8.3 必须适配时间线分叉

所有重要事实尽量带：

- timeline
- timepoint
- valid / invalid 语义

否则后续 branch/rollback 会失真。

---

## 9. 与 simulation / report 的接口关系

StoryRAG 应至少服务两个上层：

### 9.1 StorySwarm

给每个角色 / 系统角色提供：

- 相关人物
- 最近事件
- 当前冲突
- 规则约束
- 世界状态

### 9.2 ReportAgent

给报告生成提供：

- 事实引用
- 因果链
- 角色关系变化
- 历史对照

---

## 10. 开发优先级

先做：

1. 规则抽取 + JSONL 落盘
2. keyword/BM25 级检索
3. insight_forge 的结构化输出

后做：

- embedding adapter
- 图数据库 adapter
- 外部 GraphRAG 服务适配
