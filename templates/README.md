# Templates

NovelFabric V5 当前采用 **template-first** 的 workspace harness 方向。

这四个模板不是产品脚手架，也不是运行时骨架；它们是 **目录语义 + 约束文件 + 本地 skills 栈** 的组合，用来让单个工作区从一开始就保持文本优先、文件优先、可审计。

## 先选哪个模板

| 模板 | 适合什么 | 核心目录语义 | 不适合什么 |
| --- | --- | --- | --- |
| `blank-root` | 先开一个最小、低假设、root-first 的工作区 | 默认只信 root，本轮结构必须被论证 | 已经明确需要叙事 / 工具 / 研究分层 |
| `novel-basic` | 长篇叙事、世界观、跑团素材管理 | `canon/` 真相、`inbox/` 原始输入、`artifacts/` 派生产物 | 不是故事真相维护，而是工具或研究 |
| `tooling-only` | 可复用脚本、协议、自动化、operator 工具面 | `tools/` 可复用、`artifacts/` 一次性产物 | 产品脚手架或研究资料管理 |
| `analysis-research` | 证据收集、阅读笔记、比较分析、研究报告 | `sources/` 证据、`notes/` 解释、`artifacts/` 交付 | 叙事真相管理或纯工具仓 |

## 共同组成

每个首发模板至少包含：

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `template.json`

共同含义：

- `AGENTS.md`：目录与行为边界
- `SOUL.md`：该模板下的 operator 默认姿态
- `.agents/skills/`：本地 prompt / workflow 控制栈
- `template.json`：模板元信息与 `protectList`

## 首次阅读顺序

无论选哪个模板，第一次进入都建议按这个顺序：

1. 根级 `../AGENTS.md`
2. 模板自己的 `AGENTS.md`
3. 模板自己的 `SOUL.md`
4. 模板自己的 `template.json`
5. 模板自己的 `.agents/skills/README.md`
6. 再进入模板目录下各子目录 `README.md`

## 保护面怎么理解

所有模板都会把这些面视为高压力区：

- `AGENTS.md`
- `SOUL.md`
- `template.json`
- `.agents/skills/**`

此外，不同模板还会额外保护自己的核心 durable 面，例如：

- `novel-basic` 保护 `canon/**`
- `tooling-only` 保护 `tools/**`
- `analysis-research` 保护 `notes/**`

人类可扫读的判断方式：

- 改的是工作区规则、技能协议、模板元信息，通常就是高压力面
- 改的是未来会被持续依赖的“真相层 / 工具层 / 判断层”，通常也是高压力面
- 高压力面应先读现状、单目的修改、并让 diff 与审计说明能看出意图

## 典型选型问题

如果你主要在问：

- “现在连目录都还没想好，只想先把规则立住” → `blank-root`
- “我需要维护 accepted story truth” → `novel-basic`
- “我需要沉淀可重复执行的脚本或协议” → `tooling-only`
- “我需要把原始证据、工作笔记、最终报告拆开” → `analysis-research`

## 迁移与换模板提示

模板不是多项目管理器；一个模板 fork 出来就是一个独立工作区。

如果你已经在某个模板里出现稳定漂移，不要悄悄把它变成另一个模板的弱化版：

- `blank-root` 开始稳定出现故事真相分层 → 考虑切到 `novel-basic`
- `blank-root` 或 `analysis-research` 开始出现 durable operator 工具面 → 考虑切到 `tooling-only`
- `tooling-only` 开始长期维护资料、解释、报告链路 → 考虑切到 `analysis-research`

迁移时优先保留：

- 现有 `AGENTS.md` / `SOUL.md` / `.agents/skills/` 的可审计规则
- 对 durable 面的保护说明
- 能明确解释目录语义的 README

## 当前推荐阅读

- `../AGENTS.md`
- `../PROJECT.md`
- `../README.md`
- `../docs/architecture/v5-boundary.md`
- `../docs/architecture/v5-template-spec.md`
- `../docs/architecture/v5-workspace-contract.md`
- `../docs/architecture/v5-inheritance-matrix.md`
