# AGENTS.md

> NovelFabric V5 的当前项目级常驻约束。
> 本文件是当前仓库的 active source of truth。`archived_docs/` 仅供追溯，不再默认代表现行架构。

## 1. 当前项目是什么

NovelFabric V5 是一个 **agent workspace harness** 项目。

当前主线不是：

- WebUI 产品
- 前后端分离应用
- NovelFabric 自有长驻 runtime
- 内建 StorySwarm / StoryGraph / StoryRAG / ReportAgent 服务
- 必须依赖自研 CLI / Rust 工具才能使用的系统

当前主线是：

- 工作区模板
- 约束文件
- skill 注入
- Bash + Git 操作约定
- prompt engineering 相关本地 skills
- 受保护文本修改与可重现审计

## 2. 最高优先级约束

1. V5 采用 `Workspace Only` 边界。
2. V5 采用 `clean break`；V2/V4 的 Web、HTTP API、internal swarm、旧兼容承诺默认废弃。
3. 一切能写进 `AGENTS.md`、`SOUL.md`、skill、模板与约束文件的内容，不写成代码。
4. 默认优先 skill；当前阶段优先 Bash + Git + 文本协议，不优先自研工具面。
5. 单个模板 fork 出来就是一个独立工作区；不以 `projects/*` 多项目管理器为默认根形态。
6. 模板实例必须是 git 仓库；受保护文件更新必须自动 commit 或遵循模板声明的审计约束。
7. `archived_docs/` 是历史输入，不是现行实现承诺。

## 3. 当前内建范围

当前阶段只把下面这些内容视为 active 主线：

- 内置 workspace templates
- `template.json` 模板元信息规范
- `.agents/skills/` 下的本地 prompt / workflow skills
- 通过 bash + git 执行的工作区操作约定
- 通过文本协议驱动的 commit message / context packing / review loop

不要默认内建：

- 自研 CLI
- Rust 工具链
- MiroFish adapter
- StoryGraph / StoryRAG / StorySwarm / ReportAgent
- 任意 Web shell
- 任意内部 HTTP API

## 4. 模板约束

首发模板当前已确定：

- `blank-root`
- `novel-basic`
- `tooling-only`
- `analysis-research`

每个模板必须：

- 带 `AGENTS.md`
- 带 `SOUL.md`
- 带 `.agents/skills/`
- 带 `template.json`

每个模板可选：

- `.pi/`
- 任意目录骨架，例如 `canon/`、`artifacts/`、`inbox/`

模板与子目录都允许继续嵌套放置：

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `.pi/`

用于给 subagent 注入更局部的约束、角色设定与技能能力。

## 5. `template.json` 当前要求

- 文件名固定为 `template.json`
- 必填字段：`name`、`description`、`protectList`
- `protectList` 同时支持相对路径与 glob
- 模板变量首阶段仅支持简单 key-value 替换
- 变量默认作用于文本文件内容以及文件/目录名，不处理二进制文件

## 6. 历史文档使用方式

如果需要参考历史文档，先看：

- `PROJECT.md`
- `V5_PROJECT_PLAN.md`
- `docs/architecture/v5-boundary.md`
- `docs/architecture/v5-workspace-contract.md`
- `docs/architecture/v5-template-spec.md`
- `docs/architecture/v5-inheritance-matrix.md`

只有在需要追溯历史方案时，才进入 `archived_docs/`。

## 7. 明确禁止的方向

- 不要把 `archived_docs/PRODUCT_SPEC.md` 的 Web/Vue/前后端分离要求带回 V5 最小版本。
- 不要把 `archived_docs/docs/architecture/story-swarm-runtime.md` 的内建推演主循环继续实现成 NovelFabric 自有 runtime。
- 不要按 `archived_docs/docs/architecture/implementation-roadmap-story-systems.md` 直接重建后端模块与 HTTP API。
- 不要为了兼容历史而恢复 internal swarm、旧 MCP/REST 承诺。
- 不要让工具替 agent 写死 markdown 组织形式；相关组织应尽量留给模板约束和 agent 自身。
- 不要再把“必须先写 CLI/代码”当成当前阶段前提。

## 8. 完成门槛

任何宣称完成的 V5 变更，至少要说明：

1. 改了哪些 active 文档或模板
2. 是否改变了 `template.json`、模板集合、skills 协议或 Bash/Git 工作流约定
3. 是否影响 git 可重现性约束
4. 哪些仍未实现，只是文档或模板决策
