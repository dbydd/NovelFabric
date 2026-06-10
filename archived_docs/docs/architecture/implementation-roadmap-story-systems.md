# Story Systems Implementation Roadmap

> 目的：把 `StoryGraph → StoryRAG → StorySwarm → ReportAgent` 融合方案拆成后续 agent 可直接执行的文件级开发路线。
> 状态：实现计划约束文档，不代表功能已完成。

---

## 0. 必读前置

实现本路线图前，必须先读：

1. `AGENTS.md`
2. `docs/architecture/mirofish-fusion-plan.md`
3. `docs/architecture/story-graph-rag.md`
4. `docs/architecture/story-swarm-runtime.md`
5. `PRODUCT_SPEC_2.md`

不要跳过这些文档直接开写代码。

---

## 1. 总体开发顺序

固定顺序：

```text
M1 StoryGraph implementation baseline
  → M2 StoryRAG implementation baseline
  → M3 Swarm context integration
  → M4 structured agent round outputs
  → M5 ReportAgent implementation baseline
  → M6 interview / deeper analysis
  → M7 optional external adapter
```

不要反过来先做 UI 或外部 MiroFish/OASIS adapter。

---

## 2. M1 — StoryGraph implementation baseline

### 2.1 目标

从现有 NovelFabric 项目文本资源生成本地图谱派生产物：

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

### 2.2 后端文件

新增：

- `backend/src/story_graph.rs`

修改：

- `backend/src/lib.rs`
- `backend/src/project.rs`
- 可能需要修改路由聚合处：`backend/src/lib.rs`

### 2.3 Rust 数据结构

建议最小结构：

```rust
pub struct StoryGraphNode {
    pub id: String,
    pub name: String,
    pub labels: Vec<String>,
    pub summary: String,
    pub source_paths: Vec<String>,
}

pub struct StoryGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: String,
    pub fact: String,
    pub valid_at: Option<String>,
    pub invalid_at: Option<String>,
    pub source_path: String,
}

pub struct StoryGraphEpisode {
    pub id: String,
    pub timeline: String,
    pub timepoint: String,
    pub source_path: String,
    pub summary: String,
}

pub struct StoryGraphRebuildOutput {
    pub node_count: usize,
    pub edge_count: usize,
    pub episode_count: usize,
    pub chunk_count: usize,
}
```

### 2.4 最小抽取规则

第一版不依赖 LLM，先用规则抽取：

- `cards/characters/*.md` → `Character` node
- `cards/rules/*.md` → `Rule` node
- `cards/world/*.md` → `WorldState` node
- `writing/chapters/*.md` → `Chapter` node + chunk
- `memory/**/entries/**/*.md` → `Event` / `Memory` episode
- `simulation/logs/*.md` → `Event` episode
- `timeline/timepoints/*.json` → `Timepoint` episode

### 2.5 API

新增最小 API：

```text
POST /api/projects/:slug/knowledge/rebuild
GET  /api/projects/:slug/knowledge/graph/nodes
GET  /api/projects/:slug/knowledge/graph/edges
GET  /api/projects/:slug/knowledge/graph/episodes
```

### 2.6 测试

新增单测位置：

- `backend/src/story_graph.rs` 内部 `#[cfg(test)]`

最低测试：

1. 创建临时项目结构。
2. 写入一张角色卡、一张规则卡、一章正文、一条 memory。
3. 执行 rebuild。
4. 断言：
   - `knowledge/graph/nodes.jsonl` 存在
   - `knowledge/graph/episodes.jsonl` 存在
   - node 里有 `Character`
   - episode 能回溯到 `source_path`

### 2.7 验收命令

```bash
cargo fmt --manifest-path backend/Cargo.toml --all --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml -q
```

---

## 3. M2 — StoryRAG implementation baseline

### 3.1 目标

在 StoryGraph 派生产物之上提供最小检索能力：

- `quick_search`
- `panorama_search`
- `insight_forge`

第一版可用 keyword / 简单打分，不要先上重型向量库。

### 3.2 后端文件

新增：

- `backend/src/story_rag.rs`

修改：

- `backend/src/lib.rs`
- `backend/src/story_graph.rs`（如需复用读取函数）

### 3.3 数据结构

```rust
pub struct StoryRagHit {
    pub fact: String,
    pub source_path: String,
    pub timeline: Option<String>,
    pub timepoint: Option<String>,
    pub score: f32,
}

pub struct QuickSearchOutput {
    pub query: String,
    pub hits: Vec<StoryRagHit>,
}

pub struct PanoramaSearchOutput {
    pub query: String,
    pub active_facts: Vec<StoryRagHit>,
    pub historical_facts: Vec<StoryRagHit>,
    pub nodes: Vec<StoryGraphNode>,
    pub edges: Vec<StoryGraphEdge>,
}

pub struct InsightForgeOutput {
    pub query: String,
    pub sub_queries: Vec<String>,
    pub facts: Vec<StoryRagHit>,
    pub relationship_chains: Vec<String>,
    pub risk_notes: Vec<String>,
}
```

### 3.4 API

```text
GET  /api/projects/:slug/rag/quick?query=...
POST /api/projects/:slug/rag/panorama
POST /api/projects/:slug/rag/insight
```

### 3.5 insight_forge 第一版

第一版可以先不用 LLM 拆子问题，采用规则：

- 原 query
- query + `角色`
- query + `规则`
- query + `世界观`
- query + `时间线`
- query + `记忆`

后续再接 `llm.rs` 做子问题生成。

### 3.6 测试

新增单测：

- 命中角色名能返回对应人物卡。
- 命中章节关键词能返回章节 source_path。
- `panorama_search` 区分 active/historical 的字段结构。
- `insight_forge` 输出 sub_queries 和 facts。

### 3.7 验收命令

同 M1。

---

## 4. M3 — Swarm Context Integration

### 4.1 目标

让当前 `simulation.rs` 的轮次推进能够读取 StoryRAG 上下文。

不是立刻重写整个 simulation，而是先增加上下文构建层。

### 4.2 后端文件

新增：

- `backend/src/swarm.rs`

修改：

- `backend/src/simulation.rs`
- `backend/src/lib.rs`
- `backend/src/story_rag.rs`

### 4.3 核心结构

```rust
pub struct SwarmTurnContext {
    pub project_slug: String,
    pub session_id: String,
    pub round: u32,
    pub timeline: String,
    pub timepoint_id: String,
    pub recent_logs: Vec<SessionLogEntry>,
    pub rag_hits: Vec<StoryRagHit>,
}
```

### 4.4 接入点

在 `SimulationService::advance_round` 附近接入：

1. 读取 session。
2. 根据 session title / timepoint / characters / directives 构建 query。
3. 调用 StoryRAG quick 或 panorama。
4. 把结果写入本轮内部上下文。
5. 本阶段可以先不改变对外 API 输出，只补内部能力和测试。

### 4.5 测试

- 构建一个带角色卡和 memory 的项目。
- rebuild StoryGraph。
- 创建 simulation session。
- advance round 时能构造非空 `SwarmTurnContext.rag_hits`。

---

## 5. M4 — Structured Agent Round Outputs

### 5.1 目标

把角色/系统角色的输出从纯 summary 升级为结构化对象。

### 5.2 后端文件

修改：

- `backend/src/simulation.rs`
- `backend/src/swarm.rs`
- `backend/src/runtime.rs`（如需复用 patch/write 保护）

可能新增：

- `backend/src/agent_output.rs`

### 5.3 结构建议

```rust
pub struct AgentRoundOutput {
    pub agent_id: String,
    pub role: SimulationRole,
    pub intent: String,
    pub reasoning_summary: String,
    pub evidence: Vec<String>,
    pub actions: Vec<AgentRoundAction>,
    pub consistency_checks: ConsistencyChecks,
}

pub struct ConsistencyChecks {
    pub ooc: ConsistencyStatus,
    pub world: ConsistencyStatus,
    pub timeline: ConsistencyStatus,
}

pub enum ConsistencyStatus {
    Pass,
    Warn,
    Block,
}
```

### 5.4 最小策略

第一版可先由后端把已有 summary 包装成结构化输出。

之后再让 LLM 直接输出结构化 JSON。

### 5.5 落盘

建议新增：

```text
simulation/sessions/<session_id>/rounds/<round>.json
simulation/logs/<session_id>.md
```

如果不想新增 rounds 目录，也必须确保结构化输出可在现有 session JSON 中保存。

### 5.6 测试

- 每个角色输出都有 `agent_id` / `role` / `intent`。
- `ProjectAuditor` 可以产生 `Warn` / `Block` 状态。
- `Block` 不应直接写关键资产。

---

## 6. M5 — ReportAgent implementation baseline

### 6.1 目标

生成带证据引用的推演报告，而不是普通摘要。

### 6.2 后端文件

新增：

- `backend/src/report.rs`

修改：

- `backend/src/lib.rs`
- `backend/src/story_rag.rs`
- `backend/src/simulation.rs`

### 6.3 报告目录

```text
projects/<slug>/reports/
  simulation/
    <session_id>-round-<round>.md
  consistency/
    <timestamp>.md
  writing/
    <chapter-id>-prewrite.md
```

### 6.4 API

```text
POST /api/projects/:slug/reports/simulation
GET  /api/projects/:slug/reports
GET  /api/projects/:slug/reports/:kind/:id
```

### 6.5 报告最低结构

```md
# 推演报告

## 输入范围

## 本轮关键事实

## 因果链

## 角色态度变化

## 世界观/规则影响

## 时间线与分支风险

## 续写建议

## 引用
```

引用必须尽量包含源文件路径。

### 6.6 测试

- 给一个已存在 session 生成报告。
- 报告文件落盘。
- 报告包含 `## 引用`。
- 报告至少引用一个 `source_path`。

---

## 7. M6 — Interview / Deeper Analysis

### 7.1 目标

允许用户采访角色或系统角色，并把采访作为可审计文本产物落盘。

### 7.2 后端文件

修改/新增：

- `backend/src/report.rs`
- `backend/src/swarm.rs`
- `backend/src/agents.rs`

### 7.3 API

```text
POST /api/projects/:slug/simulation/sessions/:session_id/interview
```

请求：

```json
{
  "agent_ids": ["aria", "kp"],
  "questions": ["你为什么这样行动？"]
}
```

落盘：

```text
simulation/sessions/<session_id>/interviews/<timestamp>.md
```

### 7.4 约束

回答必须基于：

- agent soul
- agent memory
- session logs
- StoryRAG facts

禁止无依据泛聊。

---

## 8. M7 — Optional External Adapter

### 8.1 目标

仅在主线稳定后，考虑外部 MiroFish/OASIS adapter。

### 8.2 文件

新增：

- `backend/src/integrations/mod.rs`
- `backend/src/integrations/mirofish.rs`

### 8.3 约束

- feature-gated
- 默认关闭
- 不成为核心运行依赖
- 不复制 MiroFish 实现代码
- 只做导出/导入/外部进程调用

---

## 9. 前端接入顺序

前端应等后端语义稳定后再做。

建议文件：

- `frontend/src/views/MemoryView.vue`
- `frontend/src/views/SimulationView.vue`
- 新增 `frontend/src/views/ReportsView.vue`（可选）
- `frontend/src/lib/workspace.ts`
- `frontend/src/router/index.ts`

前端功能顺序：

1. knowledge rebuild 按钮与状态
2. RAG 查询面板
3. simulation 中显示 rag context / evidence
4. report 列表与查看
5. interview 面板

---

## 10. 全局验证命令

每个涉及 Rust 的 milestone 至少跑：

```bash
cargo fmt --manifest-path backend/Cargo.toml --all --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml -q
```

涉及前端时再跑：

```bash
npm --prefix frontend run type-check
npm --prefix frontend run test:unit -- --run
npm --prefix frontend run build
```

---

## 11. 禁止事项

- 不要先接 Zep Cloud 当主依赖。
- 不要先接 OASIS 当主推演内核。
- 不要复制 MiroFish AGPL 源码。
- 不要跳过 StoryGraph/StoryRAG 直接写 ReportAgent 幻觉总结。
- 不要做只有 UI、没有后端语义的演示页。
- 不要让 agent 获得默认 shell 权限。

---

## 12. 完成定义

任何 milestone 宣称完成时，必须给：

1. 改动文件列表
2. 数据/接口产物
3. 测试命令与输出
4. 未覆盖风险

若只是文档阶段，必须明确说明：**尚未实现运行时代码**。
