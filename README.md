# NovelFabric

![NovelFabric logo](./assets/logo/novelfabric-logo-large.svg)

NovelFabric 当前主线是一个位于仓库根目录的 **V4 TypeScript mono app**：`novelfabric` CLI、可选 Vue Web shell，以及受控 pi agent bridge 共享同一套工作区服务层。

核心约束：

- 文本优先，项目事实必须落在可审计文件中
- CLI-first，Web 只是共享服务层上的显式适配面
- agent 推理外置，NovelFabric 负责工作区原语、校验、保护与审计
- external swarm HTTP/MCP 兼容面保持可用

## 当前能力范围

- `novelfabric` CLI 覆盖：`config`、`workspace`、`project`、`files`、`runtime`、`agents`、`agent`、`skills`、`import`、`cards`、`memory`、`knowledge`、`recall`、`context-pack`、`simulation`、`swarm`、`report`、`writing`、`workflow`、`external-swarm`、`web`
- 工作区原语：受限读写、路径保护、workspace doctor、模板与 capability manifest、上下文包、验证与报告
- 语义导入、canonical resource materialization、workflow 编排、domain artifact 落盘
- external swarm REST/MCP 兼容适配
- 可选 Vue Web shell 与 Playwright UI-only 验收

## 快速开始

安装依赖：

```sh
npm install
```

根目录验证命令：

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
```

常用 CLI smoke：

```sh
npm run cli -- config path --json
npm run cli -- workspace doctor --path fixtures/workspaces/valid-basic --json
npm run cli -- web demo --port 50021 --dry-run --json
```

Playwright 工作流验收：

```sh
npm run test:e2e
npm run test:e2e:workflow
```

## 配置

NovelFabric 默认使用自己的 XDG 配置目录：

- macOS / Linux: `~/.config/novelfabric/`
- with XDG: `$XDG_CONFIG_HOME/novelfabric/`

其中 V4 pi 包装运行时默认位于：

```sh
$XDG_CONFIG_HOME/novelfabric/pi/
```

若未设置 `XDG_CONFIG_HOME`，则回退到：

```text
$HOME/.config/novelfabric/pi/
```

配置优先级：

```text
workspace pins < XDG config < packaged defaults < env fallback < CLI flags
```

## 开发

启动 Web shell 开发服务器：

```sh
npm run web:dev
```

预览构建结果：

```sh
npm run web:preview
```

## 目录概览

```text
src/         V4 TypeScript CLI、workspace services、Web shell、bridge
test/        Vitest 与 Playwright 验收
fixtures/    工作区与流程 fixture
docs/        架构、QA 与研究文档
assets/logo/ Logo 与图标资源
```

## Logo 资产

- 大 logo: `assets/logo/novelfabric-logo-large.svg`
- 桌面图标: `assets/logo/novelfabric-icon-app.svg`
- 网页/Favicon 图标: `assets/logo/novelfabric-icon-web.svg`

## 说明

旧 `backend/`、`frontend/` 和 `novelfabric_v4_mono/` staging 目录已经退出主线。README 以当前根目录 V4 mono app 的可验证状态为准。
