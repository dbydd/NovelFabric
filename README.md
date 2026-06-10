# NovelFabric

NovelFabric 当前处于 **V5 完全重写准备阶段**。

`dev` 分支已经主动清空上一版实现，只保留项目文档、架构记录、验收标准和历史 handoff 资料，作为下一轮重写的约束输入。仓库当前不是可运行产品，也不承诺保留 V4 代码结构。

## 当前仓库内容

- 根目录项目说明文档：`PROJECT.md`、`PRODUCT_SPEC.md`、`PRODUCT_SPEC_2.md`、`CODEX_INFO.md`、`STATE.md`、`ROADMAP.md`、`AGENTS.md`
- `docs/` 下的架构、QA、研究与归档文档
- `design-system/novelfabric/MASTER.md` 设计系统文档

## 当前仓库不包含

- 可运行的 CLI / Web / bridge 代码
- 测试、构建脚本与依赖清单
- 运行时产物、fixture、示例工作区与本地状态目录

## 使用方式

进入下一轮实现前，先读这些文档：

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `AGENTS.md`

再根据具体任务进入 `docs/architecture/`、`docs/qa/` 与 `docs/research/`。

## 说明

- `main` 分支上的最近提交保留了 V4 根目录翻转后的检查点，可用于追溯历史。
- `dev` 分支是 V5 rewrite prep 分支，目标是从文档约束重新起盘，而不是在旧实现上继续修补。
