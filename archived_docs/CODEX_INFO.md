# CODEX_INFO.md

> NovelFabric 当前处于 V5 完全重写前的清场阶段。这个文件记录的是当前分支真实状态、历史定位与后续进入实现前必须知道的边界。

---

## 1. 当前分支真实状态

- 当前分支：`dev`
- 当前目标：为 V5 完全重写准备一个只保留项目文档的干净仓库
- 当前仓库不包含可运行代码、测试、依赖、构建配置、fixture、运行时状态目录
- 当前仓库保留：根级说明文档、`docs/` 文档树、`design-system/novelfabric/MASTER.md`

不要把这个分支误判为“V4 还能继续修”的实现分支。这里的主要价值是约束、历史和架构记录，不是执行面。

---

## 2. 历史定位

- `main` 上最近的检查点提交保留了“V4 翻转到仓库根目录后的最终快照”。
- `dev` 在该检查点基础上清空了除文档以外的内容，明确表示下一步是重写，不是继续做旧代码修补。
- V4 相关规划、验收标准、命令契约、归档 foundation 文档都保留在 `docs/` 中，供 V5 参考或取舍。

---

## 3. 必读顺序

进入 V5 设计或实现前，至少按这个顺序读：

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `AGENTS.md`

如涉及架构收敛，再读：

- `docs/architecture/mirofish-fusion-plan.md`
- `docs/architecture/story-graph-rag.md`
- `docs/architecture/story-swarm-runtime.md`
- `docs/architecture/implementation-roadmap-story-systems.md`
- 全部 V4 相关 plan / contract / archive 文档

---

## 4. 当前开发含义

在 `dev` 分支上，“开始开发”现在意味着：

- 先重新定义 V5 的 active architecture 与 execution surface
- 明确哪些 V4 约束继承，哪些废弃，哪些重写
- 在新增实现前先补新的规划、边界和验收文档

不意味着：

- 把旧 V4 文件逐步搬回来
- 假定已有 CLI、Web shell、bridge、runtime 还能直接沿用
- 默认已有测试命令、构建链、目录结构仍然有效

---

## 5. 仍然有效的高层约束

- NovelFabric 仍然是文本优先、文件优先、可审计的小说创作与推演平台。
- agent 仍应被视为受限文本智能体，而不是默认拥有任意系统权限的 shell agent。
- 图谱、RAG、索引、报告都只能是文本事实的派生产物，不能替代源事实。
- 之前关于 MiroFish 融合边界、external swarm 兼容面、workspace 能力边界的文档，仍然需要被显式评估后再决定继承或废弃。

---

## 6. 当前不存在的东西

以下内容在本分支当前都不存在，任何文档若需要它们，都应视为历史记录而不是现状：

- `package.json` / npm scripts
- `src/` / `test/` / `fixtures/`
- `public/` / `scripts/` / `dist/`
- 可运行的 V4 CLI、Web、bridge、external swarm adapter 实现
- 本地依赖安装状态与构建输出

---

## 7. 后续进入 V5 前的最低要求

在这个分支上重新开始实现前，至少要先补清：

1. V5 的主实现语言和运行边界
2. V5 的目录结构与 source of truth 文件布局
3. V5 对 V4 历史能力的继承/废弃清单
4. V5 的验证命令与最小可用性验收门槛

如果这些还没写清，就不要把新实现误称为“已进入稳定开发”。
