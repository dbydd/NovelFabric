# NovelFabric v3 可用性修复规划

> 状态：v3 接待调研与迭代入口文档  
> 日期：2026-05-27  
> 目标：先把当前不可用/体验断点收敛成可执行规划；随后再通过 ultragoal 进入实现迭代。

---

## 1. v3 阶段定位

v3 的目标不是继续扩大概念面，而是解决“已经能跑但不好用/不可用”的核心问题。

本阶段优先级：

1. **拆书结果必须可用**：抛弃基于简单文本匹配生成角色卡/规则卡/世界观卡的主路径，改为 LLM 驱动的语义抽取与结构化落盘。
2. **LLM 调用必须可验证**：用户保存 provider、endpoint、key、model 后，系统必须能明确告诉用户是否真的能调用，失败原因是什么。
3. **Agent 必须真实消费技能卡**：不能只展示 `skills/*.md` 文件名；推演输出必须能证明 agent 的决策目标、写入范围、一致性检查来自技能卡契约。
4. **前端所有关键按钮必须有反馈**：保存 provider、保存默认模型、保存角色模型、导入、保存卡片/agent/skill 等操作都必须有 loading/success/error/验证结果。

---

## 2. 当前调研结论

### 2.1 拆书：已有 LLM 抽取雏形，但不可作为“可用拆书”宣称

**证据**

- `backend/src/import.rs:240-243`：导入时先尝试 `extract_semantic_assets(...).await`，失败后静默回退到 `extract_semantic_assets(normalized_text, chapters)` 规则路径。
- `backend/src/import.rs:323-350`：LLM 路径通过 `LlmConfigService::load_resolved("import")` 读取配置，并调用 `complete_chat`，但任何调用或解析错误都会被 `.ok()?`/`Option` 吞掉。
- `backend/src/import.rs:638-666`：fallback 会用 CJK 片段频次猜测角色名，并固定生成 `imported-worldview`、`imported-narrative-rules`。
- `backend/src/import.rs:669-737`：角色识别是 2-3 字 CJK 滑窗 + 停用词过滤，本质仍是简单规则匹配，容易把普通词、人称、碎片误当角色。
- `backend/src/import.rs:509-519`：LLM prompt 当前是单轮 JSON 抽取，全文只截取 12000 字符，章节摘要只取前 20 章片段。
- `backend/src/import.rs:522-584`：LLM JSON 只支持 characters/worldviews/rules 三类基础字段，缺少质量评分、证据路径、章节定位、冲突合并、增量修订等可用性信息。

**判断**

当前系统“支持 LLM 抽取”的代码已经存在，但用户实际体验可能仍退回规则拆书，而且 UI/报告不会明确显示本次导入到底使用了 LLM 还是 fallback。规则 fallback 保证了“有东西落盘”，但它正是 v3 需要抛弃的不可用路径。

### 2.2 LLM 稳定性：底层 provider 适配存在，但缺少用户可见健康检查

**证据**

- `backend/src/llm.rs:109-126`：`complete_chat` 有最多 3 次重试，仅对连接/超时、5xx、429 重试。
- `backend/src/llm.rs:140-238`：已支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 三种 API style。
- `backend/src/llm.rs:241-261`：provider 非 2xx 时会保留 status 和 body，但上层导入路径目前会吞掉错误并 fallback。
- `backend/src/config.rs:162-181`：`load_resolved(role_id)` 已实现 endpoint/key 与 role model 合并，未配置具体 role 时回退 default。
- `backend/src/import.rs:1274-1391`：已有 mock LLM 单测验证 import 能用持久化 LLM 配置生成角色卡和 agent skill。
- `frontend/src/views/SettingsView.vue:104-112`：保存 endpoint/default model 只写配置并显示“已保存”，不做 live test。
- `frontend/src/lib/workspace.ts:517-522`：通用 fetch 失败只抛 `request failed: status`，没有 provider body、字段错误、网络错误上下文。

**判断**

后端 LLM 适配层具备基本能力，但“保存配置成功”不等于“LLM 可调用”。v3 必须加入独立健康检查/烟测接口，并把结果显示在设置页和导入报告中。

### 2.3 Agent 技能卡：技能文件会被读取，但当前更接近“文件名驱动”而不是真正技能执行

**证据**

- `backend/src/project.rs:217-229`：新项目会为系统 agent 写入 `soul.md`、`memory.md`、一个技能文件。
- `backend/src/import.rs:353-385`：拆书生成角色 agent 时会写入 `skills/character-decision.md`。
- `backend/src/swarm.rs:290-327`：推演时读取 agent 的 `soul.md`、`memory.md`、`skills` 文件列表，并读取技能 metadata。
- `backend/src/swarm.rs:338-397`：metadata 只扫描每个 skill 文件前 8 行，且只识别小写 `target:`/`mode:`/`priority:`/`consistency:`/`scope:`/`section:`。
- `backend/src/import.rs:374-378` 写入的角色技能使用 `Intent:`/`Target:`/`Mode:`/`Scope:`/`Priority:`/`Consistency:` 首字母大写；`backend/src/project.rs:251-282` 的系统技能大多是 Markdown 标题/列表，不含 metadata 键。
- `backend/src/swarm.rs:522-569`：实际落盘目标主要按技能文件名判断，如 `character-decision.md`、`world-update.md`、`kp-adjudicate.md`，否则按 role fallback。
- `backend/src/swarm.rs:440-467`：reasoning summary 会展示 skill 文件名和 scope，但这不能证明技能正文被模型理解并执行。

**判断**

当前实现能证明“agent 有技能文件、推演时能看到技能文件名”，但还不能证明“agent 真正调用/遵循技能卡”。此外 metadata 大小写不匹配会导致导入角色技能的 `Target/Mode/Scope` 等提示无法被解析。

### 2.4 前端反馈：设置页关键按钮已有部分 status，但缺少统一 loading/error/验证反馈

**证据**

- `frontend/src/views/SettingsView.vue:104-112`：保存 endpoint/default model 成功后更新 `llmConfigStatus`；失败时无 try/catch，用户只能看到静默无反馈或未捕获错误。
- `frontend/src/views/SettingsView.vue:122-127`：保存角色覆盖成功后更新 `llmConfigStatus`；空 role id 时直接 return，无用户提示。
- `frontend/src/views/SettingsView.vue:84-88`、`98-102`、`129-138`：保存卡片、保存 agent、保存/删除 skill 没有 success/error 状态。
- `frontend/src/views/SettingsView.vue:141-148`：导入完成后只显示章节数，不显示 LLM 是否启用、是否 fallback、抽取质量、错误原因。
- `frontend/src/lib/workspace.ts:798-825`：导入 API 失败后会进入 local-only fallback，但 catch 不暴露原因，用户可能误以为后端导入成功。
- `frontend/e2e-fullstack/strict-import-simulation.spec.ts:17-19`：现有 strict acceptance 只断言保存 endpoint 状态含 `endpoint`，没有断言默认模型保存按钮、provider 修改、失败路径、live LLM test。

**判断**

“按钮按下去没反馈”的根因不是单个按钮，而是前端缺少统一的 mutation 状态模型：loading、success、error、last-saved-value、live validation result。v3 应建立统一模式，再覆盖设置页高频按钮。

---

## 3. v3 修改方案

### 3.1 拆书主路径改为 LLM-first / LLM-required

#### 目标

导入小说后，角色卡、技能卡、世界观卡、规则卡应由 LLM 基于文本证据创建；简单规则只允许保留在以下非语义层：

- 编码识别/UTF-8 normalization
- 章节切分初筛
- 文件名/id sanitize
- LLM 失败后的错误报告与人工修复入口

不再允许规则路径静默生成“看起来像可用”的角色/世界观/规则卡。

#### 方案

1. 增加 `ImportExtractionMode`：
   - `llm_required`：v3 默认；无有效 LLM 或 LLM 解析失败则导入文本/章节，但不生成语义卡片，报告明确失败。
   - `llm_assisted_with_review`：允许 LLM 低置信结果落入待确认区。
   - `deterministic_legacy`：仅测试/开发 fallback，不作为产品默认入口。
2. 拆书改为多阶段：
   - Stage A：章节切分与摘要。
   - Stage B：按章节窗口提取实体、世界观、规则、事件、证据。
   - Stage C：合并同名/别名角色，生成稳定 id。
   - Stage D：生成角色卡、初始 `soul.md`、`memory.md`、`skills/character-decision.md`。
   - Stage E：生成世界观卡、规则卡、导入质量报告。
3. LLM 输出 schema 必须包含：
   - `characters[]`: id/name/aliases/role_summary/motivation/knowledge_boundary/evidence[]/confidence
   - `world_cards[]`: id/title/summary/evidence[]/confidence
   - `rule_cards[]`: id/title/rule/constraints/evidence[]/confidence
   - `skills[]`: agent_id/file_name/intent/target/mode/scope/consistency/body
   - `warnings[]`: ambiguous entities/low evidence/conflicts
4. 导入报告必须显示：
   - 本次是否调用 LLM
   - 使用的 provider/base_url/model/api_style（不显示 key）
   - LLM 请求批次数、成功/失败数
   - schema 校验结果
   - 创建了哪些卡/agent/skill
   - 哪些内容低置信，需要用户复核

#### 验收

- mock LLM 集成测试证明：导入后生成多角色、多世界观、多规则卡，并保留证据。
- 失败路径测试证明：LLM 不可用时不生成规则猜测角色卡，UI 显示可理解错误和下一步。
- 浏览器验收必须看到“LLM semantic extraction: success/failed”，不能只看章节数。

### 3.2 LLM 健康检查与调用诊断

#### 目标

用户修改 provider、endpoint、API style、默认模型、角色模型后，能立即知道配置是否可调用。

#### 方案

1. 后端新增诊断接口：
   - `POST /api/config/llm-healthcheck`
   - 输入：可选 endpoint/role/model override；若为空则使用已保存配置。
   - 输出：`ok`, `role_id`, `model`, `api_style`, `latency_ms`, `provider_status`, `error_kind`, `error_message`, `response_preview`。
2. `complete_chat` 增强：
   - 给 reqwest client 设置超时。
   - 错误分类：network/timeout/auth/model_not_found/rate_limit/provider_5xx/schema_parse。
   - 上层不得用 `.ok()?` 静默吞错；必须把错误写入 import report。
3. 设置页增加：
   - “保存并测试”按钮或保存后自动测试。
   - 单独“测试当前配置”按钮。
   - 默认模型/角色模型保存后显示 resolved config 与 test result。
4. Browser acceptance 增加 mock LLM 或可控 provider 测试，证明保存 provider/model 后真的触发 healthcheck。

#### 验收

- 后端单测覆盖三种 API style 的成功解析和失败分类。
- 前端单测覆盖保存成功、保存失败、healthcheck 成功、healthcheck 失败。
- 浏览器验收覆盖 provider 改名、default model 改名、角色 model 覆盖后的可见反馈。

### 3.3 Agent 技能卡真实参与推演

#### 目标

推演结果必须能证明 agent 读取并遵循技能卡，而不是仅凭 role 或文件名 fallback。

#### 方案

1. 定义技能卡 frontmatter/metadata 标准，大小写不敏感：
   ```markdown
   ---
   intent: character-decision
   target: memory
   mode: append
   scope: character
   consistency: ooc
   ---
   # character-decision
   ...
   ```
2. 解析完整 frontmatter，不再只扫前 8 行小写键。
3. 系统 agent 模板和导入角色 skill 统一写入 frontmatter。
4. `SwarmService` 输出新增 `skill_invocations[]`：
   - skill file
   - parsed intent/target/mode/scope
   - selected output action
   - evidence paths
   - blocked/warn reason
5. 若 agent 拥有技能卡但技能 schema 无效，推演应 WARN/BLOCK，并在 UI 中提示去修复 skill。
6. 中期方案：将 LLM-backed agent round 接入 `complete_chat(load_resolved(agent_id))`，让角色/系统 agent 基于 soul、memory、skill、StoryRAG facts 输出结构化 JSON，再由 runtime 应用 patch/write。

#### 验收

- 单测覆盖大小写 metadata 与 frontmatter parsing。
- 单测覆盖不同技能 target 导致不同落盘路径。
- 浏览器 Simulation 页展示每个 agent 本轮调用了哪个 skill、为什么写入该文件。
- 修改 skill target 后，下一轮推演的目标文件变化可见。

### 3.4 前端按钮反馈与可用性闭环

#### 目标

所有关键 mutation 都必须给用户明确反馈：正在做什么、成功保存了什么、失败原因是什么、是否需要重试。

#### 方案

1. 在 `SettingsView` 建立统一 mutation state：
   - `pendingAction`
   - `statusByAction`
   - `errorByAction`
   - `lastSavedAt`
2. 覆盖按钮：
   - 保存 Endpoint / Key
   - 保存默认模型
   - 保存角色覆盖
   - 测试 LLM 配置
   - 上传导入
   - 保存/删除卡片
   - 保存 Agent 资产
   - 保存/删除 skill
3. `fetchJson` 返回更完整错误：status、body、path。
4. 禁止导入失败后静默 local-only fallback；如果保留 local fallback，必须显示“后端导入失败，当前仅为本地预览，不会参与后端推演”。
5. Playwright 增加按钮反馈断言：每个关键按钮 click 后都出现 loading 或 status，并在失败 mock 下出现错误提示。

#### 验收

- 前端单测覆盖所有设置页关键按钮状态。
- 浏览器验收覆盖修改 provider、修改默认模型名、保存角色覆盖，并断言 UI 反馈与 reload 后值一致。
- 错误路径必须可见，不能只在 console 中失败。

---

## 4. 建议 ultragoal 迭代拆分

### Goal 1 — LLM healthcheck and visible settings feedback

范围：后端 healthcheck、前端保存/测试反馈、错误分类、测试覆盖。

优先原因：没有 LLM 可调用性验证，LLM 拆书无法可信推进。

### Goal 2 — LLM-required import extraction contract

范围：导入 schema、多阶段抽取、禁用语义 fallback、导入报告显示 LLM 结果。

优先原因：直接解决当前拆书不可用主痛点。

### Goal 3 — Skill card contract and invocation evidence

范围：技能 frontmatter、大小写兼容解析、`skill_invocations[]`、Simulation UI 证据。

优先原因：解决“agent 是否真的调用技能卡”的可验证性问题。

### Goal 4 — Browser acceptance expansion for v3 usability

范围：Playwright 覆盖 provider/model 修改反馈、healthcheck、LLM 拆书成功/失败、skill invocation evidence。

优先原因：v3 是可用性阶段，验收必须走用户路径而不是 API-only。

---

## 5. 非目标与边界

- 不把 Rust 后端替换成 Python 后端。
- 不引入数据库作为唯一真相源。
- 不复制 MiroFish AGPL 实现代码。
- 不把规则拆书作为默认产品路径继续粉饰可用性。
- 不把“配置保存成功”当作“LLM 可用”。
- 不把“技能文件存在”当作“agent 已调用技能”。

