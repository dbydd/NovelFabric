# NovelFabric V4 前后端联合实现设计文档

> 状态：设计阶段文档，尚未实现。基于 2026-06-05 的 gap 分析编写。

## 1. 设计目标

把当前 mono app 从"UI + 文件落盘 + bridge plumbing"升级为可跑通一次真实业务的闭环：

```text
上传/导入原文 → LLM 拆书 → 结构化写卡 → StoryRAG/context → 角色跑团 → StorySwarm → ReportAgent → 章节生成 → 浏览器可操作完成全程
```

### 约束

- CLI-first / text-first / 文件优先。
- 不准为测试样例（test_novel.txt 或其他）做特判代码。
- 不准绕过 capability / protected policy / audit / safe path。
- 冻结外部 swarm REST/MCP 表面不变。
- 所有持久事实必须留在 auditable 文本或结构化文件中，不引入 hidden DB。
- 浏览器测试只能通过 Playwright 操作页面控件，不准走浏览器 console 或直接 API。

---

## 2. 总体架构

```text
Web 浏览器 (Vue)
    ↓ (通过 fetch + 页面按钮)
Vite bridge middleware  (src/web/bridge-plugin.ts)
    ↓
Workflow service layer  (src/workflow/service.ts)
    ↓
LLM provider adapter   (src/llm/provider.ts)
Import pipeline        (src/import/)
Card extraction        (src/cards/)
StoryRAG / knowledge   (src/knowledge/)
Role run               (src/role/)
Swarm orchestrator     (src/swarm/)
Report agent           (src/report/)
Chapter generator      (src/chapter/)
    ↓ (所有持久写入)
Shared file service    (src/workspace/files.ts)
    ├─ safe path check
    ├─ protected policy
    ├─ capability manifest
    ├─ base hash conflict
    ├─ atomic write
    └─ audit JSONL
    ↓
Workspace text files
```

### 2.1 新增目录结构

```
src/
  llm/                    LLM provider 抽象层
    provider.ts           chatText / chatJson / streamText 接口
    validator.ts          结构化输出 parse / repair / evidence
    evidence.ts           evidence JSONL logger
  workflow/               工作流引擎
    types.ts              WorkflowJob / StageId / JobStatus 等类型
    job.ts                创建/序列化/反序列化 job
    service.ts            start / advance / retry / abort
    stage-runner.ts       对每个 stageId 的路由分发
  import/                 拆书
    normalize.ts          文本清洗与章节候选切分
    chunk.ts              chunkId / sourceRange / offset
    chapterize.ts         章节初分与 proposal
    synopsis.ts           LLM 摘要
  cards/                  卡片
    schema.ts             character / scene / world / rule 卡片 schema
    extract.ts            LLM 提取卡片
    merge.ts              新卡与已有卡片冲突检测
    apply.ts              写入 workspace 卡片文件
  knowledge/              知识索引与检索
    index.ts              entity / relation / chunk 索引重建
    search.ts             quick_search / panorama_search / insight_forge
    context-pack.ts       按 role / capability / redaction 组装 context pack
  role/                   角色推理
    run.ts                action proposal + reasoning + memory delta
    memory-policy.ts      main-agent / role-agent 权限策略
  swarm/                  集群推演
    orchestrator.ts       轮次编排
    round-runner.ts       单轮执行
    compat-serializer.ts  外部兼容面序列化
  report/                 报告
    agent.ts              consistency audit + branch impact + chapter readiness
  chapter/                章节生成
    generator.ts          LLM-backed 章节起草与 metadata
  web/
    workflow-api.ts       bridge workflow API 调用封装
    WorkflowPanel.vue     (未来拆分) 工作流面板组件
    JobEvidencePanel.vue  (未来拆分) evidence 证据面板
```

### 2.2 保留现有模块不变

```text
src/workspace/files.ts         — 保持不变，写入唯一入口
src/workspace/capabilities.ts  — 保持不变，权限检查
src/workspace/protection.ts    — 保持不变，protected path 策略
src/fs/safe-path.ts            — 保持不变
src/commands/files.ts          — 保持不变
src/commands/web.ts            — 扩展 web bridge 工作路由
src/web/bridge-plugin.ts       — 扩展 workflow API 路由
src/web/App.vue                — 逐步扩展 job/workflow UI
src/web/workspace-tree.ts      — 保持不变
```

---

## 3. 数据契约（schema-first）

### 3.1 WorkflowJob

```typescript
// src/workflow/types.ts

type WorkflowStageId =
  | "import"
  | "chunk"
  | "card-extract"
  | "card-apply"
  | "storyrag"
  | "context-pack"
  | "role-run"
  | "swarm"
  | "report"
  | "chapter";

type JobStatus = "queued" | "running" | "waiting_user" | "failed" | "completed";

type WorkflowJob = {
  readonly jobId: string;
  readonly workspaceRoot: string;
  readonly actor: string;
  readonly sourcePaths: readonly string[];
  readonly stages: readonly WorkflowStageState[];
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

文件落地位置：

```text
.novelfabric/workflows/<jobId>/job.json
.novelfabric/workflows/<jobId>/stages/<stageId>.json
.novelfabric/workflows/<jobId>/evidence/<stageId>.jsonl
```

### 3.2 卡片 Schema

```typescript
// src/cards/schema.ts

type CardKind = "character" | "scene" | "world" | "rule";

type CardProposalStatus = "proposal" | "accepted" | "rejected";

type CardProposal = {
  readonly cardId: string;
  readonly kind: CardKind;
  readonly name: string;
  readonly sourceRefs: readonly string[];
  readonly content: string;
  readonly confidence: number;
  readonly proposalStatus: CardProposalStatus;
  readonly tags: readonly string[];
  readonly conflictWith: readonly string[];
};
```

### 3.3 Evidence Log

```typescript
// src/llm/evidence.ts

type EvidenceEntry = {
  readonly timestamp: string;
  readonly jobId: string;
  readonly stageId: string;
  readonly provider: string;
  readonly model: string;
  readonly inputHash: string;
  readonly promptHash: string;
  readonly schemaHash: string;
  readonly outputHash: string;
  readonly durationMs: number;
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number };
  readonly repairCount: number;
  readonly failureCode: string | null;
};
```

### 3.4 StorySwarm 轮次模型

```typescript
// src/swarm/types.ts

type SwarmRoundOrder = ["characters", "random-event", "world-maintainer", "kp", "project-auditor"];

type SwarmRound = {
  readonly roundIndex: number;
  readonly agentId: string;
  readonly input: string;
  readonly output: string;
  readonly reasoning: string;
  readonly evidenceRefs: readonly string[];
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly artifactPath: string;
};
```

### 3.5 章节 Metadata

```typescript
// src/chapter/types.ts

type ChapterMetadata = {
  readonly chapterId: string;
  readonly title: string;
  readonly sources: readonly string[];
  readonly evidence: readonly string[];
  readonly risks: readonly string[];
  readonly unresolvedConflicts: readonly string[];
  readonly wordCount: number;
  readonly status: "draft" | "reviewed" | "applied";
};
```

---

## 4. CLI 命令设计

所有命令共享现有 `--json` / `--dry-run` 输出模式。

```bash
# Provider
novelfabric provider health --json
novelfabric provider models --json

# Workflow
novelfabric workflow start --workspace <path> --source imports/source/x.txt --actor main_agent --json
novelfabric workflow status --workspace <path> --job <id> --json
novelfabric workflow continue --workspace <path> --job <id> --json
novelfabric workflow retry --workspace <path> --job <id> --stage <stage> --json
novelfabric workflow abort --workspace <path> --job <id> --json

# Import
novelfabric import prepare --workspace <path> --path imports/source/x.txt --json
novelfabric import inspect --workspace <path> --source <id> --json

# Cards
novelfabric cards extract --workspace <path> --job <id> --json
novelfabric cards apply --workspace <path> --card <id> --json

# StoryRAG
novelfabric storyrag rebuild --workspace <path> --job <id> --json
novelfabric storyrag search --workspace <path> --query <text> --json
novelfabric context-pack build --workspace <path> --job <id> --role <role> --json

# Role
novelfabric role run --workspace <path> --job <id> --role <role> --json
novelfabric role propose-action --workspace <path> --job <id> --role <role> --json

# Swarm
novelfabric swarm run --workspace <path> --job <id> --json
novelfabric swarm status --workspace <path> --job <id> --json

# Report
novelfabric report build --workspace <path> --job <id> --json

# Chapter
novelfabric chapter build --workspace <path> --job <id> --json
```

---

## 5. Bridge API 设计

新增 workflow 路由，与现有的 `files/tree` / `files/read` / `files/write` 并列。

```text
POST /api/bridge/workflow/start
POST /api/bridge/workflow/continue
POST /api/bridge/workflow/retry
POST /api/bridge/workflow/abort
POST /api/bridge/workflow/status
POST /api/bridge/workflow/artifacts
POST /api/bridge/cards/apply
POST /api/bridge/context-pack/build
POST /api/bridge/chapter/apply
```

所有请求携带：

```json
{
  "workspace": "/abs/workspace",
  "actor": "main_agent",
  "jobId": "wf-2026-0605-001",
  "stage": "chapter"
}
```

所有响应格式：

```json
{
  "ok": true,
  "jobId": "wf-2026-0605-001",
  "status": "completed",
  "artifacts": ["reports/wf-2026-0605-001/consistency-audit.md"],
  "evidence": ["reports/wf-2026-0605-001/evidence/chapter.jsonl"]
}
```

错误响应仍保持：

```json
{
  "ok": false,
  "error": { "code": "capability_denied", "message": "...", "exitCode": 3 }
}
```

错误码映射：

| error 条件                     | HTTP | exitCode |
| ------------------------------ | ---- | -------- |
| capability_denied              | 403  | 3        |
| file_conflict                  | 409  | 4        |
| workflow_stage_failed          | 422  | 5        |
| file_not_found / job_not_found | 404  | 1        |
| invalid_request / parse error  | 400  | 1        |
| provider_unavailable           | 502  | 6        |

---

## 6. Provider 配置设计

配置来源优先级：

```text
XDG_CONFIG_HOME/novelfabric/workflow-models.toml
   ↓
$HOME/.config/novelfabric/workflow-models.toml
   ↓
环境变量 NOVELFABRIC_WORKFLOW_MODEL_*  fallback
   ↓
CLI 参数 --provider / --model / --temperature (per-invocation override)
```

示例：

```toml
# ~/.config/novelfabric/workflow-models.toml

[import]
provider = "openai"
model = "gpt-4o"
temperature = 0.2
jsonMode = true

[cards]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
temperature = 0.3
jsonMode = true

[role]
provider = "openai"
model = "gpt-4o-mini"
temperature = 0.6
jsonMode = false

[report]
provider = "openai"
model = "gpt-4o"
temperature = 0.3
jsonMode = false

[chapter]
provider = "openai"
model = "gpt-4o"
temperature = 0.7
jsonMode = false
```

---

## 7. 实现阶段与任务

### 阶段 A: Workflow Contract + Job Runtime

预期 1–2 周。

任务：

- [ ] `src/workflow/types.ts` — 所有 schema 类型
- [ ] `src/workflow/job.ts` — 创建 / 序列化 / 持久化 job
- [ ] `src/workflow/service.ts` — start / advance / retry / abort
- [ ] `src/workflow/stage-runner.ts` — stage 分发
- [ ] `src/commands/workflow.ts` — CLI 命令
- [ ] `src/web/workflow-api.ts` — bridge API 调用封装
- [ ] `src/web/bridge-plugin.ts` — 扩展 workflow 路由
- [ ] 单测：schema parse, stage transition, precondition rejection
- [ ] CLI fixture 测试

### 阶段 B: LLM Provider + Evidence

预期 1–2 周。

任务：

- [ ] `src/llm/provider.ts` — chatText / chatJson / streamText
- [ ] `src/llm/validator.ts` — 结构化输出 parse / repair
- [ ] `src/llm/evidence.ts` — evidence JSONL logger
- [ ] `src/config/workflow-model.ts` — 配置读取
- [ ] `src/commands/provider.ts` — health / models
- [ ] mock provider 单测
- [ ] structured output parse / repair 单测

### 阶段 C: Import Pipeline

预期 1–2 周。

任务：

- [ ] `src/import/normalize.ts` — 文本清洗 + 章节候选
- [ ] `src/import/chunk.ts` — chunkId + sourceRange
- [ ] `src/import/chapterize.ts` — LLM 章节切分
- [ ] `src/import/synopsis.ts` — LLM 章节摘要
- [ ] `src/commands/import.ts`
- [ ] `src/web/workflow-api.ts` — import bridge API
- [ ] import UI 控件
- [ ] 单测与 fixture 测试

### 阶段 D: Card Extraction

预期 1 周。

任务：

- [ ] `src/cards/schema.ts`
- [ ] `src/cards/extract.ts`
- [ ] `src/cards/merge.ts`
- [ ] `src/cards/apply.ts`
- [ ] `src/commands/cards.ts`
- [ ] 卡片关联整理
- [ ] 卡片审核 apply UI
- [ ] 单测与 fixture 测试

### 阶段 E: Knowledge Index + Search

预期 2 周。

任务：

- [ ] `src/knowledge/index.ts` — entity / relation / chunk 索引
- [ ] `src/knowledge/search.ts` — quick_search / panorama_search / insight_forge
- [ ] `src/knowledge/context-pack.ts`
- [ ] `src/commands/storyrag.ts`
- [ ] RAG 预览 UI + context pack UI
- [ ] 单测与 fixture 测试

### 阶段 F: Role Reasoning

预期 1 周。

任务：

- [ ] `src/role/run.ts`
- [ ] `src/role/memory-policy.ts`
- [ ] `src/commands/role.ts`
- [ ] session / turn / memory 模型
- [ ] role run UI + action proposal UI
- [ ] 单测与 fixture 测试

### 阶段 G: StorySwarm

预期 2 周。

任务：

- [ ] `src/swarm/orchestrator.ts`
- [ ] `src/swarm/round-runner.ts`
- [ ] `src/swarm/compat-serializer.ts`
- [ ] `src/swarm/artifact-writer.ts`
- [ ] `src/commands/swarm.ts`
- [ ] 外部兼容性 golden fixtures
- [ ] swarm stage pipeline UI
- [ ] 单测与 fixture 测试

### 阶段 H: ReportAgent + Chapter

预期 2 周。

任务：

- [ ] `src/report/agent.ts`
- [ ] `src/chapter/generator.ts`
- [ ] `src/chapter/types.ts`
- [ ] `src/commands/report.ts`
- [ ] `src/commands/chapter.ts`
- [ ] report 预览 UI
- [ ] chapter review/apply UI
- [ ] 单测与 fixture 测试

### 阶段 I: Browser Workflow UI + Job Execution Mode

预期 2 周。

任务：

- [ ] workflow panel 组件
- [ ] stage graph / error card / evidence links
- [ ] waiting_user 审核控件
- [ ] job retry / abort 控件
- [ ] Playwright-only end-to-end 测试（2 种 source）
- [ ] 10 轮浏览器验收

### 阶段 J: Acceptance Gate

预期 1 周。

任务：

- [ ] `test_novel.txt` 全链路
- [ ] 另一个 source fixture 全链路
- [ ] 浏览器 10 轮连续 run
- [ ] evidence file 完整性检查
- [ ] audit log 完整性检查
- [ ] external swarm 兼容性 golden test 保持通过

---

## 8. 验证要求

### 每个阶段

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
npm run format:check
```

### Bridge / Workflow

```bash
npm run cli -- web bridge --workspace fixtures/workspaces/valid-basic --port 50023 --actor main_agent --dry-run --json
npm run cli -- workflow status --workspace <test-workspace> --job <id> --json
```

### 浏览器验收

```bash
node scripts/browser-workflow-check.mjs
```

验收条件：

- 至少 1 次 `test_novel.txt` 全链路完成
- 至少 1 次另一个 source fixture 全链路完成
- 浏览器 10 轮 job 完成
- 产物是 LLM-backed，不是模板伪造
- 所有写入带 audit
- evidence 文件齐全
- external swarm 兼容性测试仍然通过

---

## 9. 非目标

- 不做 provider key management UI。
- 不在 Web app 中实现自动角色调度。
- 不允许浏览器直接写入 workspace 文件。
- 不在 V4 主线里新增 Rust crate。
- 不复制 old backend 的 LLM adapter 实现。
- 不允许对于测试样例的特判代码。
