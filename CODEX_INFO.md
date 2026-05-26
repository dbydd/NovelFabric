# CODEX_INFO.md

> 这是给未来新线程/新 agent 的高价值 handoff。
> 目标：减少重复排查，直接从当前最关键的真实状态继续推进 NovelFabric v2。

---

## 1. 当前项目总体状态

NovelFabric 已经不再是纯原型壳，已经具备：

1. Rust 后端真实领域层
   - project
   - import
   - cards
   - memory
   - timeline
   - simulation
   - writing
   - agents
   - llm

2. HTTP API 已打通的核心能力
   - projects
   - import
   - cards
   - memory
   - timeline
   - writing
   - simulation
   - agents
   - active simulation session

3. Vue 前端已经从 localStorage 假实现迁移到“后端优先”
   - settings
   - memory
   - writing
   - simulation

4. 已做过真实 LLM 小说测试
   - 使用 `/Users/dbydd/Downloads/test_novel.txt`
   - 真实生成并落盘了一篇同人

---

## 2. 重要文档

### 原始规格
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/PRODUCT_SPEC.md`

### v2 方向收束文档
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/PRODUCT_SPEC_2.md`

### 项目级自动注入约束文档
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/AGENTS.md`

### MiroFish 融合架构文档
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/docs/architecture/mirofish-fusion-plan.md`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/docs/architecture/story-graph-rag.md`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/docs/architecture/story-swarm-runtime.md`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/docs/architecture/implementation-roadmap-story-systems.md`

`PRODUCT_SPEC_2.md` 已明确：
- v2 不必重度复用 Codex 作为完整 agent 后端
- 正确方向是轻量、文件优先、skill-first 的 agent runtime
- 最小受限 skill 建议只有：
  - read
  - glob/search
  - patch/write
- 需要额外防护：
  - 失忆防护
  - OOC 防护
  - 规则一致性
  - 世界观一致性
  - 时间线一致性
- 原 `PRODUCT_SPEC.md` 中“小说创作平台一键发布”需求已后移到 **v3**

---

## 3. 当前 ultragoal 迭代目标

当前 `.omx/ultragoal/goals.json` 已重写为新一轮 v2 迭代：

- G011: 稳定 Responses 默认执行路径
- G012: 落地最小 agent skill runtime
- G013: 暴露受限 skill API
- G014: 把一条 agent 业务路径接到新 runtime
- G015: 验证并收尾本轮迭代

注意：
- Codex thread 里的旧 goal 仍显示为 complete，`create_goal` 在同线程会报“already has a goal”
- 这不是实现阻塞，是线程级工具限制
- 因此本轮主要依赖 `.omx/ultragoal` 工件持续推进

---

## 4. 端口约束（非常重要）

用户明确要求：
- 不要占用 `3000`
- 不要占用 `8080`
- NovelFabric 自身端口改到 `50000+`

当前已落实：

### 后端默认端口
- `127.0.0.1:50000`

### Docker
- backend: `50000:50000`
- frontend: `50001:80`

相关文件：
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/src/lib.rs`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/Dockerfile`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/docker-compose.yml`
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/frontend/src/lib/workspace.ts`

注意：
- `http://localhost:3000/v1` 是**外部 LLM provider/gateway**，不是 NovelFabric 自己的服务端口
- 不要再让 NovelFabric 占用 3000

---

## 5. LLM/provider 真实联调结论

### provider
- base URL: `http://localhost:3000/v1`
- key: 用户在对话里提供过，后续线程如需再次使用，应从用户消息上下文读取，不要再写进仓库文件

### 模型列表证据
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/data/llm-provider-models.json`

### 重要模型结论
- `generic-write` **不存在**
- `generic-writer` **存在且可用**

### 已兼容协议
当前 `backend/src/llm.rs` 已支持：
- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Messages

### 当前默认方向
- 新 runner 默认走 `responses`
- 通过环境变量控制：
  - `NOVELFABRIC_LLM_API_STYLE=responses`
  - `NOVELFABRIC_LLM_API_STYLE=chat`
  - `NOVELFABRIC_LLM_API_STYLE=anthropic`

### 重试约束
- 已加简单失败重试
- 不把失败/重试细节暴露给模型 prompt

---

## 6. Responses 适配真实状态（最关键）

### 已拿到真实 `/responses` 返回样本
文件：
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/data/llm-responses-smoke.json`

这个样本的关键结构：
- 顶层 `output`
- `output` 内可能混有不同 `type`
  - `reasoning`
  - `message`
- 真正文本通常在：
  - `output[].content[]`
  - `type == output_text`
  - `text` 字段

### 之前的坑
此前 `responses` 解析器失败的原因：
- 不能假设 `output[]` 中每个 item 都有 `content`
- 有些 item（例如 `reasoning`）没有 `content`
- 必须做动态过滤

### 当前状态
- `backend/src/llm.rs` 已改成对 `response.output: Vec<serde_json::Value>` 做动态扫描
- 这一步已经通过 `cargo clippy` 和 `cargo test`
- 且用 `responses` 路径重新跑 fanfic runner 后，已生成实际输出文件：
  - `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/data/fanfic-test-run-output-responses.md`

这意味着：
- **G011 基本已经完成**
- 下一线程无需再从零排查 responses 协议

---

## 7. 真实 fanfic 测试产物

### 测试小说
- `/Users/dbydd/Downloads/test_novel.txt`

### 测试项目目录
- `/Users/dbydd/vibe-agent-working-dir/git-projects/NovelFabric/backend/data/projects/fanfic-test-project`

### 关键产物
- 原创主角卡：
  - `backend/data/projects/fanfic-test-project/cards/characters/original-protagonist.md`
- 时间锚点：
  - `backend/data/projects/fanfic-test-project/timeline/timepoints/tp-origin.json`
- 同人章节：
  - `backend/data/projects/fanfic-test-project/writing/chapters/chapter-fanfic-001.md`
- 运行输出（chat 路径）：
  - `backend/data/fanfic-test-run-output.md`
- 运行输出（responses 路径）：
  - `backend/data/fanfic-test-run-output-responses.md`

### 已确认事实
- 已真实生成同人
- 自定角色已存在
- 内容约束在原著前十章背景范围内

---

## 8. StoryGraph / StoryRAG 已接入状态（2026-05-25）
### StorySwarm 最新状态（2026-05-25）
### ReportAgent 最新状态（2026-05-25）
### Interview / Deeper Analysis 最新状态（2026-05-25）
### Browser acceptance 最新状态（2026-05-25）
### Full-stack browser acceptance 最新状态（2026-05-25）
### ReportAgent 变体报告最新状态（2026-05-25）
### ReportAgent 变体的浏览器验收状态（2026-05-25）
### StorySwarm restricted runtime 最新状态（2026-05-25）
### StorySwarm runtime 文件变更证明（2026-05-25）
### StorySwarm role-aware planning 最新状态（2026-05-25）
### StorySwarm skill-aware target planning 最新状态（2026-05-25）
### StorySwarm skill semantics 最新状态（2026-05-25）
### StorySwarm skill metadata 最新状态（2026-05-25）
### StorySwarm richer skill metadata 最新状态（2026-05-25）
### StorySwarm non-append patch mode 最新状态（2026-05-25）
### StorySwarm patch mode 与 plan 可观测性最新状态（2026-05-25）
### Runtime plan UI 可用性最新状态（2026-05-25）
### System-role 文件变更可见性最新状态（2026-05-25）
### System-role 结果摘要可见性最新状态（2026-05-25）
### System-role 结构化结果可见性最新状态（2026-05-26）
### Diff-like summary hints 最新状态（2026-05-26）
- `Observed File Updates` 面板现在除了 path / mode / section / summary 之外，还会显示简化 diff-like hint，例如：
  - `before: ## Runtime Notes`
- 这让用户不只能看到“改了哪里”，还能看到“改之前指向的结构是什么”。
- 这层可见性已在三级验证中保持绿色：
  - unit/component
  - mocked browser acceptance
  - full-stack browser acceptance

- `Observed File Updates` 面板现在会同时显示：
  - file path
  - update mode
  - affected section marker（如 `## Runtime Notes`）
  - summary line
- 这使前端可见性从“写到哪个文件”进一步推进到“用什么 mode 改了哪个 section，并写了什么摘要”。
- 这层可见性经三级验证仍然是绿的：
  - unit/component
  - mocked browser acceptance
  - full-stack browser acceptance

- `System File Updates` 面板现在不只显示 target path，还会显示 runtime action content 的最新摘要行。
- 这让用户可以直接看到例如 `project audit note persisted` 这类结果，而不只是知道“写到了 history/project-audit-log.md”。
- 这层可见性已有三级证据：
  - component/unit 测试
  - mocked browser acceptance
  - full-stack browser acceptance

- `SimulationView.vue` 新增 `System File Updates` 面板，专门展示 swarm runtime 对 system-role 资源的目标文件。
- 这些 target 包括：
  - `cards/world/current-world-state.md`
  - `cards/rules/runtime-kp-rulings.md`
  - `history/project-audit-log.md`
  - `simulation/random-events.md`
- 这层可见性已经有三级证据：
  - component/unit 级测试
  - mocked browser acceptance
  - full-stack browser acceptance
- 这使 system-role 结果不再只是后端落盘事实，而是前端用户能立刻看到的变更线索。

- `Restricted Runtime Plan` 面板不再只是展示 raw action fields，现在已有更可读的 formatted label。
- `frontend/src/views/SimulationView.spec.ts` 已增加这块的前端单测。
- 浏览器验收已重跑通过：
  - mocked browser acceptance -> `1 passed`
  - full-stack browser acceptance -> `1 passed`
- 这一轮继续遵循用户的纠偏：不把“最小可运行”当成完成，而是继续打磨“更可用”的验收面。

- `AgentRoundAction` 现在除了 `ReplaceProjectSection` 外，还新增了 `AppendProjectSection`。
- 当前 metadata-driven patch modes 至少包含：
  - `replace_section`
  - `append_section`
- `backend/src/swarm.rs` 的 `render_turn_audit(...)` 现在会将 resolved runtime plan 显式写入 audit markdown，例如：
  - `append_audit -> ...`
  - `replace_section -> ...`
  - `append_section -> ...`
- 这让 swarm artifact 不只能看规则和证据，还能直接看到“本轮解析出的 runtime plan 到底是什么”。

- StorySwarm planning 现在不只会生成 append actions。新增：
  - `ReplaceProjectSection`
- `backend/src/simulation.rs` 会把这类 action 转成 `AgentRuntimePatchOperation::Replace`。
- 当前最小 non-append metadata strategy 已接入：
  - `mode: replace_section`
  - `section: Runtime Notes`
- 这使 skill metadata 不只决定“写到哪里”，还开始决定“怎么写”。
- 这是 StorySwarm 从 metadata-aware target selector 走向 metadata-driven restricted patch planner 的关键一步。

- skill metadata 已从 `target` / `mode` 扩展到更多 planning knobs：
  - `priority`
  - `consistency`
  - `scope`
- 当前已有的实际影响：
  - `priority` -> audit content 会记录不同优先级
  - `consistency` -> 可强制某个 consistency dimension 至少 WARN
  - `scope` -> 作为 additional target-hint alias 参与 target selection
- KP skill 测试现在不只断言 target=rules，还断言 metadata 会影响 audit content 和 consistency status。
- 这表明 StorySwarm planning 已经不只是 target selector，而是开始具备多 knob metadata-driven 特征。

- `backend/src/swarm.rs` 现在开始解析 skill 文本前几行的简单 metadata，形如：
  - `target: rules`
  - `mode: append_project`
- 解析结果会进入 planning inputs：
  - `target_hint`
  - `mode_hint`
- 当前 target/action planning 优先级变成：
  1. skill metadata hint
  2. skill filename semantic fallback
  3. role fallback
- 这是第一步从“filename-based skill semantics”走向“content/meta-based skill semantics”。

- `backend/src/swarm.rs` 现在不只是“读 skill names 并写进 summary”，而是开始让 skill filename 直接影响 target selection。
- 当前最小 skill semantics 规则：
  - `memory-summarize.md` / `character-decision.md` -> agent memory
  - `world-update.md` -> `cards/world/current-world-state.md`
  - `kp-adjudicate.md` -> `cards/rules/runtime-kp-rulings.md`
  - `project-audit.md` -> `history/project-audit-log.md`
- 已有测试断言这件事：给 KP agent 写入 `kp-adjudicate.md` 后，其 generated action target 确实是 rules file。
- 这表明 StorySwarm 已从 role-aware target planning 进一步变为 skill-aware target planning。

- `AgentRoundAction` 现在新增 `AppendProjectText`，不再只是 audit/memory append。
- 当前最小 role-specific target planning 已实现：
  - character -> `agents/<id>/memory.md`
  - world-maintainer -> `cards/world/current-world-state.md`
  - kp -> `cards/rules/runtime-kp-rulings.md`
  - project-auditor -> `history/project-audit-log.md`
  - random-event -> `simulation/random-events.md`
- 这些变更仍然是经由 `AgentRuntimeService.patch(...)` 执行，没有绕开 restricted runtime。
- simulation 测试现在还会额外断言这些 system-role target file 真实被写入。
- 这意味着 StorySwarm 已从“输出 append notes”进一步推进到“不同 role 变更不同项目资源”。

- `backend/src/swarm.rs` 已从“只基于 session/rag/logs”进一步推进，现在 planning 会显式读取：
  - `agents/<agent>/soul.md`
  - `agents/<agent>/memory.md`
  - `agents/<agent>/skills/*.md`
- 这些输入已经反映到：
  - `reasoning_summary`
  - runtime append action content
- 测试现在会为 character agent 预先写入自定义 `soul.md` / `memory.md` / `skills/character-decision.md`，并断言 generated output 确实包含这些 asset 线索（例如 `Aria Soul`、`character-decision`）。
- 这说明 StorySwarm 已不只是 role-name-aware，而是开始 agent-asset-aware。

- 新增了 simulation 层面的直接测试，确认 `apply_swarm_outputs(...)` 不只是调用了 runtime，而是真正把文本追加到：
  - `agents/<id>/memory.md`
  - `agents/<id>/audit/runtime-round-log.md`
- 目前 runtime action 已有最小 role-aware 差异化描述：
  - character decision persisted
  - random event note persisted
  - world maintenance note persisted
  - kp ruling persisted
  - project audit note persisted
- 这是目前最强的一条证据，证明 StorySwarm 已经不只是“生成 structured context”，而是会引发 restricted runtime 落盘。

- 新增 `backend/src/agent_output.rs`，引入更明确的 structured agent round output：
  - `AgentRoundOutput`
  - `AgentRoundAction`
  - `ConsistencyChecks`
  - `ConsistencyStatus`
- `backend/src/swarm.rs` 的 `SwarmTurnRecord` 现在不只有 `contexts`，还有 `outputs`。
- 这些 `outputs` 不再只是解释性结构；`backend/src/simulation.rs` 会在 round 构建后调用 `apply_swarm_outputs(...)`，经由 `AgentRuntimeService.patch(...)` 真实执行 restricted append actions。
- 当前最小真实执行路径已具备：
  - structured agent output
  - restricted runtime patch/write
  - agent memory/audit file mutation
  - swarm/report/browser 链路可继续消费这些产物
- 这仍不是最终的 role-specific runtime planner，但已从“事后分析”推进到“结构化输出会触发 restricted runtime 落盘”。

- `frontend/e2e/vue.spec.ts` 已扩展为视觉验证以下按钮：
  - 当前推演报告
  - 一致性审计
  - 分支影响分析
  - 续写预备报告
  - interview 采访记录
- `frontend/e2e-fullstack/story-systems.spec.ts` 也已扩展覆盖这些报告变体，并在真实 backend 上生成 branch / prewrite 所需的 timepoint 与 branch 数据。
- 已重跑通过：
  - `npm run test:e2e -- --project=chromium` -> `1 passed`
  - `npx playwright test --config=playwright.fullstack.config.ts --project=chromium` -> `1 passed`

- ReportAgent 不再只有 simulation report。现在新增：
  - `POST /api/projects/:slug/reports/consistency`
  - `POST /api/projects/:slug/reports/branch-impact`
  - `POST /api/projects/:slug/reports/writing-prewrite`
- `ReportKind` 现在包含：
  - `simulation`
  - `consistency`
  - `branch-impact`
  - `writing`
- 已实现的报告变体：
  - 一致性审计报告
  - 分支影响分析
  - 续写预备报告
- 后端已增加对这三类报告的生成测试。
- 前端 `/project/:slug/reports` 已增加对应按钮与输入框，可直接生成并查看这些报告。

- 新增 `frontend/playwright.fullstack.config.ts`，可启动：
  - Rust backend: `127.0.0.1:50090`
  - Vite frontend: `127.0.0.1:5174`
  - data dir: `/tmp/novelfabric-fullstack-e2e-data`（可用 `NOVELFABRIC_E2E_DATA_DIR` 覆盖）
- 新增 `frontend/e2e-fullstack/story-systems.spec.ts`，走真实 Rust backend + 真实 Vue browser path。
- 已通过：
  - `npx playwright test --config=playwright.fullstack.config.ts --project=chromium` -> `1 passed`
- full-stack 验收覆盖：
  - browser 创建 project
  - real backend API 写 character / chapter / simulation session
  - browser 重建 StoryGraph
  - browser 推进 simulation
  - API 验证 StorySwarm round artifact
  - browser 生成 ReportAgent simulation report
  - browser 生成 interview record
  - real backend API 验证 report list
- 注意：Vite base URL 是 `/novelfabric/`，full-stack test 页面路径必须用 `/novelfabric/project/...`。

- 已给顶部 workspace nav 增加：
  - `知识层` -> `/project/:slug/knowledge`
  - `报告中心` -> `/project/:slug/reports`
- 新增 `frontend/src/views/ReportsView.spec.ts`，覆盖 report/interview 组件行为。
- `frontend/e2e/vue.spec.ts` 已从 Vite 默认测试替换为 NovelFabric 闭环验收：
  - project list
  - knowledge rebuild / RAG hit
  - simulation advance
  - StorySwarm audit panel
  - report generation
  - interview generation
- 已安装 Playwright Chromium，真实浏览器验收通过：
  - `npm run test:e2e -- --project=chromium` -> `1 passed`
- 注意：该 e2e 使用 page.route mock 后端 API，用来验证前端集成面与用户路径；下一步可再做启动 Rust backend + temp data dir 的 full-stack acceptance。

- 新增 API：`POST /api/projects/:slug/simulation/sessions/:session_id/interview`。
- 请求格式：
  - `agent_ids: string[]`
  - `questions: string[]`
- 采访落盘：
  - `projects/<slug>/simulation/sessions/<session_id>/interviews/interview-round-000N.md`
- 回答约束：优先基于 agent soul / memory，session logs，StorySwarm context，StoryRAG facts；若 RAG 无命中，则回退到 `simulation/logs/<session>.md` 审计引用。
- 前端 `/project/:slug/reports` 已增加采访入口：可输入采访对象和问题，生成并查看 interview markdown 正文。

- 新增 `backend/src/report.rs`，已有 ReportAgent MVP。
- 已接入 API：
  - `POST /api/projects/:slug/reports/simulation`
  - `GET /api/projects/:slug/reports`
  - `GET /api/projects/:slug/reports/:kind/:id`
- 推演报告落盘目录：
  - `projects/<slug>/reports/simulation/<session-id>-round-<round>.md`
- 报告不再是普通摘要，至少包含：
  - 输入范围
  - 本轮关键事实
  - 因果链
  - 角色态度变化
  - 世界观/规则影响
  - 时间线与分支风险
  - 续写建议
  - `## 引用`
- `## 引用` 会尽量列出 `source_path`；若 StoryRAG 暂时无命中，则回退到 `simulation/logs/<session>.md` 作为最低审计引用。
- 前端新增报告中心：`/project/:slug/reports`，可生成当前轮次的推演报告，查看报告列表与正文。

- `backend/src/swarm.rs` 不再只是 `SwarmTurnContext` 结构。现在已有 `SwarmService`，会在 simulation round 完成后构建结构化 `SwarmTurnRecord`。
- `backend/src/simulation.rs` 的 `advance_round(...)` 已接入 StorySwarm：每轮推进后会自动落盘
  - `simulation/swarm/<session-id>/round-000N.json`
  - `simulation/swarm/<session-id>/round-000N.md`
- 新增查询 API：
  - `GET /api/projects/:slug/simulation/sessions/:session_id/swarm/:round`
- 当前实现仍是“结构化上下文/一致性检查/审计落盘”的最小闭环，不是最终的全角色 runtime 执行器。
- 当前 RAG 证据策略：优先走 StoryRAG 检索；若命中为空，则回退到本轮 simulation log 作为最低审计证据，保证每轮都有可追溯文本依据。
- 前端 `SimulationView.vue` 已新增 StorySwarm 审计面板，推进一轮后可直接看到每个 agent 的 intent / reasoning summary / consistency checks。


本线程已确认并补齐：

### 后端已真正暴露 API
- `POST /api/projects/:slug/knowledge/rebuild`
- `GET /api/projects/:slug/knowledge/graph/nodes`
- `GET /api/projects/:slug/knowledge/graph/edges`
- `GET /api/projects/:slug/knowledge/graph/episodes`
- `GET /api/projects/:slug/rag/quick?query=...`
- `GET /api/projects/:slug/rag/panorama?query=...`
- `GET /api/projects/:slug/rag/insight?query=...`

### 重要纠偏
之前仓库里虽然已经有：
- `backend/src/story_graph.rs`
- `backend/src/story_rag.rs`
- `backend/src/swarm.rs`

但这些模块没有完整纳入 `backend/src/lib.rs` 的 crate surface / AppState / router，等于“文件存在，但不算真实后端能力”。
本轮已把它们真正接到后端 HTTP 面。

### 前端已新增知识层页面
- `frontend/src/views/KnowledgeView.vue`
- 路由：`/project/:slug/knowledge`

该页面已支持：
- 手动触发 graph rebuild
- quick search
- panorama search
- insight forge
- 浏览 node/episode 命中与 source path

### 新增验证
- 路由级测试覆盖 knowledge rebuild + rag quick search
- 为 `Storage` 增加递归列举能力，支持 `memory/**` 扫描

### 当前边界
- `swarm.rs` 仍只是 `SwarmTurnContext` 结构定义，不是完整多角色推演 orchestrator
- StoryRAG 还没有正式注入 simulation round execution path
- ReportAgent 还未形成后端 API 闭环

## 8. 当前验证状态

最近一次明确通过：

### 后端
- `cargo test --manifest-path backend/Cargo.toml`
- `cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings`

### 前端
- `npm --prefix frontend run test:unit`
- `npm --prefix frontend run type-check`
- `npm --prefix frontend run build`

如果新线程继续动后端 skill runtime，结束前应重新跑这五组验证。

---

## 9. 当前与 v2 方向的偏差

用户有一句非常关键的话：

> Codex 其实有点重，这个软件里的 agent 不需要接触系统环境；他们只需要读文本、搜文本、补丁式写文本，技能也只是保存角色能力设定。

所以，未来线程不要再往“完整 shell agent / 重环境执行”方向走。

正确方向应是：

### 不要做
- 默认 shell agent
- 让角色直接接触系统环境
- 让角色任意执行命令
- 让角色读写项目外文件

### 应该做
- Rust 内实现轻量 runtime
- 受限 skill 面：`read / glob / patch`
- 角色技能文本化
- 写前快照
- 失忆防护
- OOC 防护
- 规则/世界观/时间线检查

---

## 10. 下一线程最值得直接开始的任务

优先顺序建议：

### 第一优先级：G012 落地最小 skill runtime
实现一个新后端模块，例如：
- `backend/src/skills.rs`
- `backend/src/runtime.rs`

建议最小接口：

1. `read`
- 读取指定文件
- 读取允许范围内文件

2. `glob`
- 根据模式枚举允许范围内的文件

3. `patch`
- 对文本做受控替换或创建新文件
- 必须仅限项目目录内部

要求：
- 严格测试
- 不能突破当前目录/项目边界
- 不能是 shell wrapper，要是真正的 Rust 文件原语

### 第二优先级：G013 暴露受限 skill API
建议 HTTP API：
- `POST /api/projects/{slug}/skills/read`
- `POST /api/projects/{slug}/skills/glob`
- `POST /api/projects/{slug}/skills/patch`

或者等价内部 service 层，先后端自用后再暴露。

### 第三优先级：G014 接一条真实业务路径
最适合先接的一条路径：
- reviewer
或
- project-auditor

原因：
- 相对安全
- 以读文本和写审计/review note 为主
- 最符合 `read/glob/patch` 最小 runtime

建议不要一上来先接 world-maintainer 或全推演 orchestrator，复杂度高。

---

## 11. 新线程启动建议 prompt（可直接复用）

可以在新线程里这样开局：

```text
读取 CODEX_INFO.md、PRODUCT_SPEC.md、PRODUCT_SPEC_2.md。
当前 NovelFabric 已完成真实后端切片、真实 fanfic 测试与 responses 协议兼容初步打通。
不要重复做 provider/端口排查。
直接从 G012 开始：实现 v2 最小 agent skill runtime（read/glob/patch），要求文本优先、受限执行面、可测试、不可接触 shell。
完成后继续做 G013 和 G014。
```

---

## 12. 额外提醒

- 当前仓库里很多文件都还是未提交状态，`git status` 会显示整仓未跟踪；新线程不要被这个噪音干扰
- 用户明确说过：**在完全访问权限模式下，只允许修改当前目录内文件**
- 不要去修改 `Downloads/test_novel.txt`
- 外部 provider 地址仍是 `http://localhost:3000/v1`，它是外部依赖，不是本项目端口

