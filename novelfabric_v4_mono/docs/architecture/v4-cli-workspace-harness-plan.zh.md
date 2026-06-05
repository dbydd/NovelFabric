# NovelFabric V4 CLI 工作区 Harness 规划

> 状态：在重新扫描文档和参考项目之后重写的规划。它取代之前偏“自研 LLM/workflow runtime”的方向，转为 CLI-first、pi agent SDK-backed 的工作区 harness。

## 1. 修正后的系统理解

NovelFabric V4 **不是**一个自研 LLM backend。

它是一个 **文本优先的工作区 harness**，提供：

- durable workspace files 作为事实源；
- capability-scoped CLI 命令；
- protected file policy；
- audit logs；
- agents 与 skills 作为文本约束；
- 可选 Web shell 作为 CLI 可视化界面；
- pi agent SDK / Hermes 作为语义执行层。

正确链路应是：

```text
pi / Hermes / pi agent SDK
  → NovelFabric skills / AGENTS 文本约束
  → novelfabric CLI 命令
  → shared workspace services
  → workspace files + audit
  → optional Web shell
```

因此，之前规划中“在 V4 里自己实现一套 LLM provider 层”的方向应当删除或降级为非主线。

---

## 2. 重新扫描后的文档结论

### 2.1 根文档

根文档已经很明确地说明：

- NovelFabric 是文本优先、文件优先的平台；
- V4 mono app 是 TypeScript CLI-first workspace harness；
- 角色/推演智能工作要移交给外部 agent + skill；
- external swarm HTTP/MCP 兼容面必须冻结；
- 浏览器验证必须走 Playwright。

### 2.2 V4 mono app AGENTS

V4 mono app 的目录级 AGENTS 明确：

- 不新增 Rust 主线；
- CLI 工具必须安全、可重复调用、机器可读；
- 所有写入必须经过 shared TypeScript service；
- 未来 pi bridge 不能绕过 CLI/capability 检查；
- external swarm 接口形状必须保持兼容。

### 2.3 skill / agent 约束优先

项目本身已经偏向把行为做成文本约束：

- `AGENTS.md`
- `SKILL.md`
- `soul.md`
- `memory.md`
- `skills/*.md`
- `.novelfabric/capabilities.toml`

所以未来的“智能”应先表达为 skill / prompt / capability text，而不是在后端代码里偷偷藏脑回路。

---

## 3. 核心结论

NovelFabric V4 应被重新定义为：

```text
NovelFabric = 小说文本工作区 harness
```

它负责：

- 工作区结构；
- 文件写入安全；
- 角色/技能约束；
- 上下文打包；
- 审计；
- 索引；
- 报告；
- CLI 操作；
- 可选 Web shell。

它不应继续作为：

- 自研 LLM provider backend；
- 通用 autonomous agent runtime；
- 角色 agent 的 shell 授权器；
- 隐式网络访问入口；
- 任意路径读写入口。

---

## 4. 设计原则

### 4.1 CLI first

任何功能都应先有 CLI 形态，再考虑 Web UI。

### 4.2 共享原语优先

优先复用已有 primitive：

- `read`
- `write`
- `bash`
- `glob/search`
- `validate`
- `report`
- `context-pack`

### 4.3 能写成 skill 的就写成 skill

如果某个行为可以被描述为约束，就应优先落成 skill / AGENTS / capability 文本，而不是隐藏在应用控制流里。

### 4.4 文件是事实

所有持久状态都应该落在 workspace 文件或可审计派生产物中。

### 4.5 不要隐藏 backend brain

不要在 NovelFabric 里再做一层“私有 LLM runtime”来覆盖 pi agent SDK。

### 4.6 不要样例特判

不要为 `test_novel.txt` 或任何 fixture 写特判逻辑。

### 4.7 浏览器只是 harness，不是事实源

浏览器控制应该触发 CLI-backed 操作，而不是自己发明一套语义流程。

---

## 5. CLI 命令拆分建议

下面是一份更贴合当前文档的命令地图。名字可再调整，但能力边界建议保留。

### 5.1 Workspace / Project

```bash
novelfabric project init
novelfabric project inspect
novelfabric project validate
novelfabric project list
novelfabric workspace doctor
novelfabric workspace layout
```

目标：

- 物化 workspace；
- 校验 layout；
- 显示 harness 能操作的内容。

### 5.2 Files

现有方向正确，应继续做大：

```bash
novelfabric files tree
novelfabric files read
novelfabric files write
novelfabric files patch
novelfabric files protect-check
```

目标：

- 文件树、读、写、patch、保护检查统一走 audited path。

### 5.3 Agents / Skills

```bash
novelfabric agents list
novelfabric agents inspect
novelfabric agents materialize
novelfabric agents validate
novelfabric skills list
novelfabric skills read
novelfabric skills validate
```

目标：

- agent 是文本资产，不是黑盒 runtime 对象；
- skills 是持久行为契约；
- CLI 负责查看 agent 能做什么。

### 5.4 Import / Chapterize

```bash
novelfabric import inbox
novelfabric import normalize
novelfabric import chapterize
novelfabric import context-pack
novelfabric import validate
```

目标：

- 导入原文；
- 规范化；
- 切分；
- 生成给外部 agent 的 context pack。

### 5.5 Cards / Memory

```bash
novelfabric cards list
novelfabric cards read
novelfabric cards propose
novelfabric cards apply
novelfabric cards validate

novelfabric memory recall
novelfabric memory append
novelfabric memory propose-shared
```

目标：

- proposal/apply 分离；
- role memory 分离；
- shared memory 提案化。

### 5.6 Knowledge / Context Pack

```bash
novelfabric knowledge rebuild
novelfabric knowledge search
novelfabric knowledge context-pack
```

目标：

- StoryGraph / StoryRAG 仍是派生索引；
- 作为 agent 上下文，而不是事实源本身。

### 5.7 Simulation / StorySwarm

```bash
novelfabric simulation create
novelfabric simulation state
novelfabric simulation context-pack
novelfabric simulation propose-action
novelfabric simulation append-turn
novelfabric simulation validate
novelfabric simulation report
```

目标：

- deterministic state machine + 外部语义 agent action；
- 保持轮次顺序；
- 落盘 evidence 与 artifact。

### 5.8 Writing / Chapter

```bash
novelfabric writing context-pack
novelfabric writing apply-draft
novelfabric writing review
novelfabric writing export
```

目标：

- 写作是受控 CLI 流程，不是 UI-only feature。

### 5.9 Timeline / Branch

```bash
novelfabric timeline inspect
novelfabric timeline validate
novelfabric timeline branch-proposal
novelfabric timeline branch-apply
```

目标：

- 历史不能静默篡改；
- 所有过去改动要 branch proposal 化。

### 5.10 External Swarm Compatibility

```bash
novelfabric external-swarm infer
novelfabric external-swarm get
novelfabric external-swarm require-context
```

目标：

- 继续保留 frozen compatibility；
- 允许 CLI smoke 与 orchestration 入口。

---

## 6. pi Agent SDK 的定位

LLM / 智能层应由 pi agent SDK 处理，而不是 NovelFabric 自己做 provider 层。

因此：

- 不再把 `src/llm/provider.ts` 作为 V4 主线；
- 不再做自研 provider registry；
- 不再让 NovelFabric 变成 semantic loop 的 owner；
- NovelFabric 只做 workspace boundary、文件、安全、审计与能力校验。

pi agent SDK 应消费：

- context pack；
- skill 文本；
- 项目文档；
- agent memory；
- capability manifest；
- CLI 生成的 proposal。

然后 NovelFabric 再校验并持久化输出。

---

## 7. 技能 / agent 文本化模型

凡是能表达成约束的，都应该写成文本。

例子：

- `AGENTS.md`
- `SKILL.md`
- `soul.md`
- `memory.md`
- `capabilities.toml`
- `context-pack`
- proposal 文件
- review notes

建议的技能族：

- `import-normalize`
- `import-chapterize`
- `card-propose`
- `memory-recall`
- `memory-append`
- `storyrag-search`
- `context-pack-build`
- `role-propose-action`
- `kp-adjudicate`
- `world-update`
- `project-audit`
- `report-render`
- `chapter-draft`
- `chapter-review`
- `timeline-branch-proposal`

这些都应该是文本文件，可以被外部 agent 通过 CLI harness 读取。

---

## 8. 前端重新定位

Mono app UI 的角色不是业务逻辑拥有者。

它应该负责：

- 启动 CLI-backed workflow；
- 展示 job 状态；
- 展示 evidence / artifact；
- 展示 file preview 和 review surface；
- 通过 bridge-backed write primitive 做受控编辑；
- 保持 browser-only acceptance。

UI 应该调用 workflow 命令，而不是发明一个独立语义 runtime。

### 8.1 UI 控件应映射到 CLI 操作

示例流程：

```text
上传 source
  → CLI import normalize
  → CLI import chapterize
  → CLI import context-pack
  → pi-agent-driven card proposals
  → CLI cards apply
  → CLI simulation propose-action
  → CLI simulation append-turn
  → CLI simulation report
  → CLI writing apply-draft
```

### 8.2 浏览器不是 backend

只要浏览器里有一个按钮，就应该有一个 CLI primitive 或 CLI-backed bridge 在后面。

---

## 9. 参考项目的吸收方式

参考项目只吸收 workspace / harness 规律，不吸收实现代码。

### 9.1 OpenAlice

可吸收：

- workspace as boundary；
- satellite workspace 思维；
- capability isolated tooling；
- file-native artifact flow。

不要吸收：

- 把 NovelFabric 变成通用 PTY manager；
- 复制 runtime 实现。

### 9.2 autogal

可吸收：

- agent harness around file artifacts；
- CLI-first loops；
- role/profile separation；
- text-native operation logs。

不要吸收：

- 让游戏化或多代理基础设施绕开 NovelFabric 原语。

### 9.3 Auto-PPT

可吸收：

- workspace template assembly；
- artifact generation pipeline；
- clear input/output directories；
- command-based generation flow。

不要吸收：

- 把 NovelFabric 改成演示工具；
- 用 UI-only generation 伪装完整流程。

---

## 10. 新的阶段划分

### Phase 1 — CLI Contract Freeze

- 列出所有必要 CLI 命令；
- 更新架构文档和 AGENTS；
- 定义 JSON envelope 与错误码；
- 保持现有 file commands 与 workspace doctor。

### Phase 2 — Agent / Skill Materialization

- 默认 agent 资产；
- skill 模板；
- 角色约束文本；
- capability manifest 绑定角色。

### Phase 3 — Import / Chapterize CLI

- txt inbox；
- 编码规范化；
- chunking；
- 章节候选；
- context pack；
- 不内置 LLM extraction。

### Phase 4 — Proposal / Apply Model

- cards / memory / simulation / writing 统一采用 proposal/apply；
- pi agent 生成 proposal；
- CLI 校验、写入、audit。

### Phase 5 — StoryGraph / StoryRAG CLI

- 派生索引；
- search/context-pack；
- evidence-rich 输出。

### Phase 6 — Simulation / StorySwarm CLI

- state machine；
- action proposal；
- append-turn；
- report；
- branch / timeline validation。

### Phase 7 — Writing / Chapter CLI

- draft/review/apply/export；
- chapter evidence；
- 路径审计。

### Phase 8 — pi Agent SDK Bridge

- 用 pi agent SDK 跑语义；
- NovelFabric CLI 仍是写入门槛；
- 浏览器和 agent 都在 CLI-backed bridge 之后。

### Phase 9 — Web Shell Rewire

- UI 控件绑定 CLI 命令；
- Playwright 仅控件级操作；
- 取消模板式成功路径。

### Phase 10 — End-to-End Acceptance

- 多 fixture 浏览器跑通；
- 真实 semantic execution；
- 无遗留阻塞点。

---

## 11. 成功标准

未来浏览器 / 业务流程只有在满足以下条件时，才算真正成功：

- 语义工作真的由 pi agent SDK / 外部 agent 执行；
- import / chapterization 输出有意义的结构化结果；
- cards / context packs / role actions / swarm rounds / reports / chapters 都被落盘；
- 所有持久写入都通过 NovelFabric CLI；
- browser controls 只是 orchestrate CLI-backed work；
- 没有对 fixture 的特判。

---

## 12. 结论

新的方向应该是：

```text
NovelFabric = CLI-first workspace harness
pi agent SDK = semantic execution layer
skills / AGENTS = behavior constraints
workspace files = truth
Web UI = human control surface
```

这比“在 NovelFabric 里自己搓一个 LLM/workflow backend”更符合当前文档和用户要求，也更适合后续前后端联合开发。
