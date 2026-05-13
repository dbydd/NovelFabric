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

