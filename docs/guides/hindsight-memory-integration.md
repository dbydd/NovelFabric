# Hindsight Memory Integration Guide

> 供 NovelFabric 接入 Hindsight 作为外部长期记忆层的参考。
> 本文基于本机已部署的 Hindsight 实例与官方文档编写，不是实现规范——具体接入前请以 [hindsight.vectorize.io](https://hindsight.vectorize.io) 为准。

## 1. Hindsight 是什么

Hindsight 是一个面向 AI Agent 的长期记忆系统，核心能力：

- **自动提取**：写入原始文本后，Hindsight 用 LLM 自动提取结构化事实（fact extraction）
- **观察层（Observations）**：定期将零散事实 consolidate 成稳定的、去重的、带证据的"观察"
- **语义 + BM25 + 图谱检索**：recall 时融合向量语义、关键词、实体图谱三种检索，经 cross-encoder rerank 返回最相关结果
- **Reflect**：对记忆做推理分析，输出综合认知
- **Mental Models**：可配置的预定义记忆模型（如 "用户画像"、"项目架构"），consolidation 后自动刷新

与 NovelFabric 现有 `memory.md` 文件系统的关键区别：

| | NovelFabric `memory/*` | Hindsight |
|---|---|---|
| 存储格式 | Markdown 文件 | PostgreSQL + pgvector |
| 提取方式 | LLM 直接写文件 | 后台自动 fact extraction + consolidation |
| 检索方式 | 文件扫描 / StoryRAG | 语义 + BM25 + 图谱 + rerank |
| 适用层 | 项目内源事实、可审计文本 | 跨项目/跨会话长期知识、用户偏好、研究索引 |

**定位互补**：NovelFabric 的文件优先原则（project.md、cards/、memory/ 作为 source of truth）保持不变。Hindsight 作为 **派生索引层**，可存跨项目长期记忆、用户偏好、研究结论索引、可复用上下文，不替代文件层。

## 2. 本机部署信息

Hindsight 已在本机 `local_container_services` 部署并运行：

```text
Docker Compose service:  hindsight
Image:                   ghcr.io/vectorize-io/hindsight:latest
API:                     http://127.0.0.1:8888
WebUI:                   http://127.0.0.1:9999
LAN:                     http://dbydd-mac.local:8888 (API)
                         http://dbydd-mac.local:9999 (WebUI)
MCP:                     http://127.0.0.1:8888/mcp/codex/
Data dir:                local_container_services/data/hindsight
LLM:                     AxonHub (http://axonhub:8090/v1), model generic-writer
```

### 已创建的 banks

| Bank ID | Template | 用途 | Mental Models |
|---------|----------|------|--------------|
| `hermes-default` | personal-assistant | Hermes default profile 跨会话记忆 | user-profile, active-tasks |
| `hermes-trader-alice` | personal-assistant + 投资扩展 | trader-alice profile 长期研究记忆 | user-profile, active-tasks, investment-context |
| `codex` | coding-agent | Codex CLI 项目记忆 | project-context, developer-preferences |

### 新建 NovelFabric 专用 bank（建议）

接 NovelFabric 时，建议新建一个专用 bank：

```bash
curl -sS -X POST http://127.0.0.1:8888/v1/default/banks/novelfabric/import \
  -H 'Content-Type: application/json' \
  -d '{
  "version": "1",
  "bank": {
    "retain_mission": "Extract narrative facts, character relationships, plot events, world-building details, simulation outcomes, user creative preferences, and research material references. Distinguish source facts from derived analysis.",
    "enable_observations": true,
    "observations_mission": "Track stable world-building facts, character arcs, plot continuity, user writing style preferences, and how the story evolves across sessions."
  },
  "mental_models": [
    {
      "id": "story-universe",
      "name": "Story Universe",
      "source_query": "What are the key world-building facts, rules, factions, locations, and their relationships?",
      "max_tokens": 4096,
      "trigger": {"refresh_after_consolidation": true}
    },
    {
      "id": "character-network",
      "name": "Character Network",
      "source_query": "Who are the main characters, what are their motivations, relationships, arcs, and how do they evolve?",
      "max_tokens": 4096,
      "trigger": {"refresh_after_consolidation": true}
    },
    {
      "id": "creative-preferences",
      "name": "Creative Preferences",
      "source_query": "What writing style, narrative techniques, tone, and creative directions does the user prefer?",
      "max_tokens": 1024,
      "trigger": {"refresh_after_consolidation": true}
    }
  ]
}'
```

## 3. API 接口参考

### 3.1 核心操作

#### Retain（写入记忆）

```bash
curl -X POST http://127.0.0.1:8888/v1/default/banks/{bank_id}/retain \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "角色「叶青」在第三章中失去了左手，此后依赖义肢。这一事件是与反派「沈渊」的首次正面冲突的后果。",
    "context": "第三章 - 叶青 vs 沈渊",
    "document_id": "chapter-3-events",
    "tags": ["character:叶青", "event:battle", "chapter:3"],
    "retain_async": false
  }'
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `content` | ✅ | 要存储的原始文本 |
| `context` | ❌ | 简短标签（如章节名、来源） |
| `document_id` | ❌ | 文档标识，用于按文档聚合。同一 document_id 多次 retain 时追加（≥ v0.5.0） |
| `tags` | ❌ | 标签数组，用于 recall 时过滤 |
| `retain_async` | ❌ | `false` = 同步等 LLM 提取完成再返回；`true` = 异步 |

#### Recall（检索记忆）

```bash
curl -X POST http://127.0.0.1:8888/v1/default/banks/{bank_id}/recall \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "叶青和沈渊之间的关系是什么？",
    "types": ["world", "experience", "observation"],
    "max_tokens": 2000,
    "budget": "mid",
    "tags": ["character:叶青", "character:沈渊"],
    "tags_match": "any"
  }'
```

| 字段 | 说明 |
|------|------|
| `types` | 检索哪些 fact 类型：`world`（世界事实）、`experience`（经历）、`observation`（consolidated 观察） |
| `budget` | `low` / `mid` / `high`，控制检索深度 |
| `tags` / `tags_match` | `any` = 匹配任一标签，`all` = 匹配所有标签 |

返回结构包含 `results[]`，每条有 `text`、`type`、`score`、`tags` 等。

#### Reflect（推理分析）

```bash
curl -X POST http://127.0.0.1:8888/v1/default/banks/{bank_id}/reflect \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "当前故事中有哪些未解决的伏笔？它们之间有什么关联？",
    "budget": "high",
    "context": "用于续写方向决策"
  }'
```

### 3.2 Bank 模板导入

```bash
# 导入模板到 bank（不存在则自动创建）
curl -X POST http://127.0.0.1:8888/v1/default/banks/{bank_id}/import \
  -H 'Content-Type: application/json' \
  -d @template.json

# 预检（不实际应用）
curl -X POST "http://127.0.0.1:8888/v1/default/banks/{bank_id}/import?dry_run=true" \
  -H 'Content-Type: application/json' \
  -d @template.json
```

模板格式见 [官方文档](https://hindsight.vectorize.io/developer/api/bank-templates) 或本机已缓存的模板文件：

```text
local_container_services/etc/hindsight/hermes-default.json
local_container_services/etc/hindsight/hermes-trader-alice.json
local_container_services/etc/hindsight/codex.json
```

### 3.3 其他有用的 API

```text
GET  /version                                        — 服务版本
GET  /v1/default/banks                               — 列出所有 banks
GET  /v1/default/banks/{bank_id}/config              — 查看 bank 配置
GET  /v1/default/banks/{bank_id}/mental-models       — 查看 mental models
POST /v1/default/banks/{bank_id}/mental-models/{id}/refresh  — 手动刷新 mental model
POST /v1/default/banks/{bank_id}/consolidate          — 手动触发 consolidation
GET  /v1/default/banks/{bank_id}/memories             — 列出 memories（分页）
```

## 4. 接入方式

NovelFabric 有三种接入路径，按复杂度递增：

### 方案 A：后端直接调 HTTP API（推荐起步）

在 Rust 后端用 `reqwest` 直接打 Hindsight HTTP API：

```text
NovelFabric backend (Rust)
  │
  ├─ 推演 session 结束后 → POST /retain（写入 session 产物）
  ├─ 角色行动决策前 → POST /recall（检索相关记忆）
  ├─ 报告生成前 → POST /reflect（深度分析）
  └─ 定期 → POST /consolidate（手动触发观察层更新）
```

优势：无额外依赖，符合文本优先原则，调用链清晰。

### 方案 B：MCP Server 集成

Hindsight 自带 MCP server（已启用）：

```text
MCP endpoint: http://127.0.0.1:8888/mcp/{bank_id}/
```

MCP 暴露的工具包括 `retain`、`recall`、`reflect` 等。适合在 agent runtime 中通过标准 MCP 协议调用。

NovelFabric 若后续接入外部 agent（如 Hermes），可直接配置：

```toml
# Hermes config.yaml
mcp_servers:
  novelfabric-hindsight:
    url: http://127.0.0.1:8888/mcp/novelfabric/
    enabled: true
```

### 方案 C：Python SDK

若 NovelFabric 有 Python 辅助脚本（如 StoryRAG 增强脚本）：

```python
from hindsight_client import Hindsight

client = Hindsight(base_url="http://127.0.0.1:8888")

# 写入
client.retain(
    bank_id="novelfabric",
    content="叶青在第三章失去左手...",
    context="chapter-3",
    tags=["character:叶青", "event:battle"]
)

# 检索
result = client.recall(
    bank_id="novelfabric",
    query="叶青和沈渊的关系",
    types=["world", "experience", "observation"]
)

# 推理
reflection = client.reflect(
    bank_id="novelfabric",
    query="当前未解决的伏笔",
    budget="high"
)
```

安装：`pip install hindsight-client`（本机 Hermes venv 已装）。

## 5. NovelFabric × Hindsight 融合建议

### 5.1 不改变 source of truth 原则

NovelFabric 的文件优先原则不变：

```
project.md / cards/ / memory/* / writing/ / simulation/ → source of truth
Hindsight bank: novelfabric → 派生索引 + 跨项目长期记忆
```

写入 Hindsight 的内容应是：
- 跨项目/跨会话才有价值的事实和索引
- 用户创作偏好、研究结论、长期可复用上下文
- **不是**：单次 session 的中间状态、临时调试信息、会一周后过期的内容

### 5.2 推演 session 生命周期中的写入点

```
StorySwarm session 开始
  ├─ agent 决策前 → recall 检索相关历史记忆
  ├─ 各角色行动 → 实时 collect facts
  ├─ session 结束 → retain 写入关键 facts（带 tags: session_id, character, event 等）
  └─ consolidation 自动 → observations 层自动构建
```

### 5.3 ReportAgent 整合

ReportAgent 生成报告前，可以：

1. `recall` 检索相关历史推演记忆（`types: ["world", "experience", "observation"]`）
2. `reflect` 做深度推理（如"哪些伏笔还未解决"、"哪些角色弧线需要推进"）
3. 将结果作为报告输入的一部分

### 5.4 Tags 命名约定（建议）

```text
character:{角色名}    — 角色相关记忆
event:{事件类型}      — 事件（battle, discovery, betrayal...）
chapter:{章节号}      — 章节引用
session:{session_id}  — 推演 session
project:{slug}        — 项目标识
type:world-building   — 世界观设定
type:plot-point       — 情节点
type:user-preference  — 用户偏好
```

## 6. 坑点速查

| 坑 | 现象 | 处理 |
|---|---|---|
| LLM API key 未配置 | retain 只返回 401 或服务启动后立即 exit | 检查 `.env` 中 `HINDSIGHT_LLM_API_KEY`，重启 service |
| AxonHub 前缀错误 | retain 返回 HTML 而非 JSON | 确认是 `http://axonhub:8090/v1`，不是 `/api/v1` |
| 未等待 consolidation | recall 返回 experience 但没有 observations | 异步 retain 需等 consolidation worker 跑完；同步 retain 不受影响 |
| bank 不存在 | import 自动创建；但直接 retain 到不存在的 bank 也行 | Hindsight ≥ v0.5：任何 bank 操作会隐式创建 |
| mental model 为空 | bank 创建后 mental models 是空的 | 模板 import 后会异步生成；需等 `operation_ids` 对应的 operation 完成 |
| 重启后数据丢失 | `./data/hindsight` 没有持久化挂载 | 确认 compose 中 `volumes: - ./data/hindsight:/home/hindsight/.pg0` |

## 7. 参考链接

- 官方文档：<https://hindsight.vectorize.io>
- Bank Templates Hub：<https://hindsight.vectorize.io/templates>
- Configuration 参考：<https://hindsight.vectorize.io/developer/configuration>
- Bank Templates API：<https://hindsight.vectorize.io/developer/api/bank-templates>
- Memory Banks API：<https://hindsight.vectorize.io/developer/api/memory-banks>
- GitHub：<https://github.com/vectorize-io/hindsight>
- 论文：<https://arxiv.org/abs/2512.12818>
