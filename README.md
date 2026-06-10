# NovelFabric V5

NovelFabric V5 当前是一个 **agent workspace harness** 项目，不是 WebUI 产品，也不是自有多智能体 runtime。

## 当前主线

当前不是“先写 CLI/代码再用”，而是：

- 先设计 workspace templates
- 先把约束写进 `AGENTS.md` / `SOUL.md` / `.agents/skills/`
- 让 agent 在工作区内直接读取这些文件
- 通过 Bash + Git 执行实际操作

典型使用姿势：

```bash
cd workspace
pi
```

随后 agent 读取：

- `AGENTS.md`
- `SOUL.md`
- `template.json`
- `.agents/skills/**`

## 当前 active 文档入口

- [AGENTS.md](./AGENTS.md)
- [PROJECT.md](./PROJECT.md)
- [SOUL.md](./SOUL.md)
- [V5_PROJECT_PLAN.md](./V5_PROJECT_PLAN.md)
- [docs/architecture/v5-boundary.md](./docs/architecture/v5-boundary.md)
- [docs/architecture/v5-workspace-contract.md](./docs/architecture/v5-workspace-contract.md)
- [docs/architecture/v5-template-spec.md](./docs/architecture/v5-template-spec.md)
- [docs/architecture/v5-inheritance-matrix.md](./docs/architecture/v5-inheritance-matrix.md)

## 当前模板方向

首发模板：

- `blank-root`
- `novel-basic`
- `tooling-only`
- `analysis-research`

每个模板至少包含：

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `template.json`

## 当前重点

当前重点不是工具封装，而是：

- 先利用已安装到 `~/.agents/skills/` 的全局 prompt engineering skills
- 再在模板内补 NovelFabric 本地适配层 skills
- bash + git 工作流约定
- 模板内 few-shot / conventions 文件
- 文本优先、约束优先、可重现优先

历史资料已整体移入 `archived_docs/`，仅作追溯参考，不默认代表现行架构。
