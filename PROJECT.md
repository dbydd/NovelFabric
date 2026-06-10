# NovelFabric V5

## 项目定位

NovelFabric V5 当前不是传统小说平台产品，而是一个 **agent workspace harness**。

当前主线是：

- 用模板创建工作区
- 用 `AGENTS.md` / `SOUL.md` / `.agents/skills/` 注入约束
- 用 Bash + Git 执行实际操作
- 先利用已安装到 `~/.agents/skills/` 的全局 prompt engineering skills，再由本地 skills 做 NovelFabric 适配
- 用 git 保证关键文本修改的可追溯、可重现与可回滚

## 当前边界

V5 当前明确不做：

- WebUI
- 前后端分离应用
- NovelFabric 自有长驻 runtime
- StorySwarm / StoryGraph / StoryRAG / ReportAgent 内建实现
- 为兼容 V2/V4 而保留的旧 HTTP API / internal swarm / MCP 承诺
- 把自研 CLI / Rust 工具当成当前阶段必须前提

V5 当前明确要做：

- 工作区模板体系
- 模板元信息规范 `template.json`
- `.agents/skills/` 下的本地工作流与 prompt engineering 协议
- 基于 Bash + Git 的工作区操作约定
- 基于 git 的 protected-file 变更审计

## 当前仓库结构

- 根级 active 文档：`AGENTS.md`、`PROJECT.md`、`README.md`、`SOUL.md`、`V5_PROJECT_PLAN.md`
- 现行架构文档：`docs/architecture/v5-*.md`
- 现行模板：`templates/`
- 历史资料：`archived_docs/`

## 使用模型

典型姿势不是“运行一个 NovelFabric 程序”，而是：

```bash
cd workspace
pi
```

然后让 agent 读取：

- `AGENTS.md`
- `SOUL.md`
- `template.json`
- `.agents/skills/**`

再通过 bash + git 完成工作区操作。

## 当前状态

当前仓库已进入 **template-first / skill-first** 阶段。

已确认重点包括：

- 单模板 fork 即单工作区
- 根级强制：`AGENTS.md`、`SOUL.md`、`.agents/skills/`
- `.pi/` 可选
- 模板骨架自由，不强制 `canon/`、`artifacts/`、`inbox/`
- 模板必须带 `template.json`
- `protectList` 完全由模板声明
- prompt engineering 相关本地 skills 先行
- Bash + Git 为当前操作主线

## 后续工作

后续优先继续：

- 细化模板内容
- 增强本地 skills
- 明确 bash/git 操作协议
- 清理仍然残留的 CLI/Rust 主线文档表述
