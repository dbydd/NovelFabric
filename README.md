# NovelFabric

![NovelFabric logo](./assets/logo/novelfabric-logo-large.svg)

NovelFabric 是一个**文本优先**的小说创作与推演平台：

- Rust 后端负责项目资源、时间线、记忆、卡片、写作、simulation 与受限 runtime
- Vue 前端负责网页工作区
- Electron 负责桌面封装
- 一切核心资源尽量落在文本文件中，便于审计、回滚与分叉

## 当前能力

### 后端
- 项目创建与文本资源管理
- cards / memory / timeline / writing / simulation API
- 最小 agent runtime：`read / glob / patch`
- LLM provider 兼容层
  - OpenAI Responses
  - OpenAI Chat Completions
  - Anthropic Messages
- 后端 CLI / config 文件支持

### 前端
- Vue 工作区
- 项目页、推演、创作、项目设定、记忆管理
- 通过 HTTP API 访问后端

### 桌面端
- Electron 封装现有前后端
- 自动读取桌面配置目录
- 启动时拉起 Rust backend 子进程

## 配置

### 后端 CLI

```sh
cargo run --manifest-path backend/Cargo.toml -- \
  --config ~/.config/novelfabric/config.toml \
  --bind-address 127.0.0.1:50000 \
  --data-dir backend/data
```

```sh
cargo run --manifest-path backend/Cargo.toml -- --write-default-config
cargo run --manifest-path backend/Cargo.toml -- --print-config
```

配置优先级：

```text
defaults < config file < env < CLI args
```

### 桌面配置目录

- Linux/macOS: `~/.config/novelfabric/`
- Linux with XDG: `$XDG_CONFIG_HOME/novelfabric/`
- Windows: `%APPDATA%\\novelfabric\\`

桌面端会用：

- `desktop.json`
- `backend.toml`

## 开发

### 后端验证

```sh
cargo fmt --manifest-path backend/Cargo.toml --all --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path backend/Cargo.toml -q
```

### 前端验证

```sh
npm --prefix frontend run type-check
npm --prefix frontend run test:unit -- --run
npm --prefix frontend run build
```

### 网页开发

```sh
npm --prefix frontend run dev
cargo run --manifest-path backend/Cargo.toml
```

### Electron

```sh
npm --prefix frontend run electron:dev
npm --prefix frontend run electron:pack
npm --prefix frontend run electron:dist
```

## 目录概览

```text
backend/     Rust 后端
frontend/    Vue + Electron 前端/桌面壳
assets/logo/ 项目 logo 与图标资源
```

## Logo 资产

- 大 logo: `assets/logo/novelfabric-logo-large.svg`
- 桌面图标: `assets/logo/novelfabric-icon-app.svg`
- 网页/Favicon 图标: `assets/logo/novelfabric-icon-web.svg`

## 说明

当前仓库仍处于快速迭代阶段，README 以当前可运行与可验证状态为准。
