# CODEX_INFO.md

> NovelFabric 项目继续开发 handoff。目标是记录稳定约束、当前能力边界、验证入口与环境坑点；详细历史流水不要继续追加到这里，最新一次迭代状态看 `STATE.md`。

---

## 1. 项目定位

NovelFabric 是文本优先的小说创作与推演平台：

- 旧主线为 Rust 后端 + Vue 前端；V4 新主线正在收束为 TypeScript `novelfabric_v4_mono`（旧 staging 名 `backend_v2`）CLI-first mono app + 可选 Vue Web shell。
- 所有项目内可变资源以文本/结构化文件落盘。
- 角色 agent 是受限文本智能体，不是完整 shell/coding agent。
- 图谱、RAG、索引、报告都属于文本事实的派生层，不能替代源文件。

必读入口仍按 `AGENTS.md` 指定顺序：

1. `PROJECT.md`
2. `PRODUCT_SPEC.md`
3. `PRODUCT_SPEC_2.md`
4. `CODEX_INFO.md`
5. `STATE.md`
6. `docs/architecture/mirofish-fusion-plan.md`（涉及 MiroFish/RAG/群体智能/报告时）
7. `docs/architecture/story-graph-rag.md`
8. `docs/architecture/story-swarm-runtime.md`
9. `docs/architecture/implementation-roadmap-story-systems.md`

---

## 2. 当前真实状态摘要

当前项目已经具备真实后端领域层与前端页面，不是纯壳：

- project / import / cards / memory / timeline / simulation / writing / agents / llm
- 受限 runtime 的 read/glob/patch/write 方向已进入实现线
- StoryGraph / StoryRAG / StorySwarm / ReportAgent 已有后端与前端闭环
- `test_novel.txt` 是 canonical browser acceptance fixture

最新一次实现与验证状态看 `STATE.md`。当前 `STATE.md` 已记录：

- LLM endpoint/key 与 role model config 已拆分
- GraphRAG 可视化已接入
- strict browser acceptance 已用 `test_novel.txt` 跑通

---

## 3. 端口与外部 provider 约束

用户明确要求：

- NovelFabric 不占用 `3000`
- NovelFabric 不占用 `8080`
- NovelFabric 服务端口使用 `50000+`

当前默认：

- 后端：`127.0.0.1:50000`
- Docker backend：`50000:50000`
- Docker frontend：`50001:80`

注意：

- `http://localhost:3000/v1` 是外部 LLM provider/gateway，不是 NovelFabric 自己的服务端口。
- 不要把 provider key 写进仓库或文档。

---

## 4. LLM 配置模型

LLM 后端连接信息与模型选择必须分开：

### Endpoint / key 层

接口：

- `GET /api/config/llm-endpoint`
- `PUT /api/config/llm-endpoint`

落盘：

```text
config/llm.json
```

字段：

- `provider`
- `base_url`
- `api_key`
- `api_style`

### Role model 层

接口：

- `GET /api/config/llm-roles`
- `GET /api/config/llm-roles/:role_id`
- `PUT /api/config/llm-roles/:role_id`
- `DELETE /api/config/llm-roles/:role_id`

落盘：

```text
config/roles.json
```

字段：

- `role_id`
- `model`
- optional `api_style`

规则：

- 所有角色默认继承 `default`。
- 手动配置某个 role 后覆盖默认模型；API style 可继承 endpoint，也可按 role 覆盖。
- Settings UI 支持对选中的 role 直接运行 LLM healthcheck，返回结果必须显示 role_id / provider / model / API style。
- 旧式 `llm-settings` 只作为兼容路径，不应继续扩展为主配置模型。

已知 provider 事实：

- 默认本地写作模型使用 `generic-writer`，该模型存在且可用。
- 角色覆盖 healthcheck 已通过 browser path 验证：保存 `kp` role override 后，浏览器可测试该 role 并在 reload 后看到覆盖配置仍存在。
- `backend/src/llm.rs` 已支持 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages。
- Responses 返回解析不能假设每个 `output[]` 都有 `content`；必须动态过滤 `output_text`。

---

## 5. Story systems 当前边界

统一主线：

```text
StoryGraph → StoryRAG → StorySwarm → ReportAgent → optional external adapters
```

### StoryGraph / StoryRAG

- 派生产物位于 `projects/<slug>/knowledge/`。
- 已有 API：
  - `POST /api/projects/:slug/knowledge/rebuild`
  - `GET /api/projects/:slug/knowledge/graph/nodes`
  - `GET /api/projects/:slug/knowledge/graph/edges`
  - `GET /api/projects/:slug/knowledge/graph/episodes`
  - `GET /api/projects/:slug/rag/quick?query=...`
  - `GET /api/projects/:slug/rag/panorama?query=...`
  - `GET /api/projects/:slug/rag/insight?query=...`
- 最新实现会派生 `MENTIONED_IN` / `VALID_IN_TIMELINE` edges，供 GraphRAG 可视化使用。

### StorySwarm

默认顺序仍是：

```text
characters -> random-event -> world-maintainer -> kp -> project-auditor
```

当前实现重点：

- 结构化 round context/output
- 受限 runtime patch/write 落盘
- agent soul/memory/skills 参与上下文
- system-role 文件更新可见性
- audit / memory / project text 有可追溯记录

### ReportAgent / Interview

已有报告与采访闭环：

- simulation report
- consistency report
- branch-impact report
- writing prewrite report
- interview record

报告必须尽量包含 source path / RAG facts / session logs / timeline 或 branch 依据，不能变成泛摘要。

---

## 6. Browser acceptance 约束

最终验收必须走浏览器 UI 路径。以下不算完整功能验收：

- 直接 API 调用代替用户操作
- 浏览器 console 操作非交互元素
- 直接发送网络流量绕过界面

当前 strict fixture：

```text
test_novel.txt
```

验收路径应覆盖：

1. 浏览器创建项目
2. 浏览器保存 LLM endpoint/key
3. 浏览器保存 default model
4. 浏览器上传 `test_novel.txt`
5. 验证导入报告与角色资产
6. 浏览器进入知识层并重建 StoryGraph/RAG
7. 验证 GraphRAG 可视化与 edge list
8. 浏览器检查 agent soul/memory/skills
9. 浏览器通过可编辑轮数输入推进 10 轮 simulation
10. 浏览器在创作页导出正文文本并检查下载行为

---

## 7. 验证命令

### Backend

当前 Hermes profile 下建议显式指定用户 HOME / Rust 工具，避免 profile-local cargo registry 与 rustup wrapper 问题：

```bash
HOME=/Users/dbydd \
CARGO_HOME=/Users/dbydd/.cargo \
RUSTC=/opt/homebrew/bin/rustc \
RUSTDOC=/opt/homebrew/bin/rustdoc \
/opt/homebrew/bin/cargo test --manifest-path backend/Cargo.toml -q
```

```bash
HOME=/Users/dbydd \
CARGO_HOME=/Users/dbydd/.cargo \
RUSTC=/opt/homebrew/bin/rustc \
RUSTDOC=/opt/homebrew/bin/rustdoc \
/opt/homebrew/bin/cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

### Frontend

```bash
npm run test:unit -- --run
npm run type-check
npm run build
```

当前全量 frontend unit suite 已恢复通过：9 files / 24 tests。不要再把 Electron Vitest 环境问题当作当前 known issue；若后续复发，应以新的验证输出更新 `STATE.md`。

### Full-stack browser acceptance

首选使用 Playwright `webServer` 自动启动后端、Vite 与本地 LLM provider：

```bash
cd frontend && \
HOME=/Users/dbydd \
CARGO_HOME=/Users/dbydd/.cargo \
RUSTC=/opt/homebrew/bin/rustc \
RUSTDOC=/opt/homebrew/bin/rustdoc \
NOVELFABRIC_CARGO=/opt/homebrew/bin/cargo \
PLAYWRIGHT_BROWSERS_PATH=/Users/dbydd/Library/Caches/ms-playwright \
npm run test:e2e:fullstack
```

当前 fullstack suite 通过：8 specs using 1 worker。配置默认使用：

- backend: `127.0.0.1:50003`
- Vite frontend: `127.0.0.1:50004`
- local LLM provider fixture: `127.0.0.1:50112`

其中 browser-only acceptance specs 只能用真实 UI 操作作为成功证据；`story-systems.spec.ts` 是明确标注的 API-assisted fullstack coverage，不能算作 browser-only acceptance。当前错误报告窄切片覆盖 Settings healthcheck 的 auth / model_not_found / provider_5xx / network 可见错误、backend timeout 分类覆盖，以及 Import invalid-schema 可见失败报告。

---

## 8. 环境坑点

- 当前 Hermes profile 的 `HOME` 默认是 `~/.hermes/profiles/hermes-coding/home`，不是 `/Users/dbydd`。
- Cargo/Playwright 在该 profile HOME 下容易读到错误 registry/cache。
- `/opt/homebrew/opt/rustup/bin/cargo` wrapper 在本 session 中可能报 permission denied。
- 优先使用 `/opt/homebrew/bin/cargo`，并显式设置 `RUSTC=/opt/homebrew/bin/rustc`、`RUSTDOC=/opt/homebrew/bin/rustdoc`。
- Playwright 浏览器缓存使用 `/Users/dbydd/Library/Caches/ms-playwright`。

---

## 9. V4 mono app staging

- `novelfabric_v4_mono/` 已由旧 `backend_v2/` staging 改名而来。
- 新 V4 代码仍坚持 TypeScript strict、文本优先、CLI 原语优先。
- 可选 Web shell 位于同一包内，通过显式 CLI/script 启动，默认 50000+ 端口。
- 当前 Web demo 仅用于布局评审，不连接后端 API，不承担 external swarm 兼容实现。
- 未来内置 `@earendil-works/pi-coding-agent` 时，pi SDK 只能作为 bridge；项目事实写入仍需通过 NovelFabric CLI/capability manifest/protected path checks/audit。

## 10. 文档维护规则

- `PROJECT.md`：只放 source-of-truth 索引、架构锁定和 definition of done。
- `AGENTS.md`：只放 agent 必须遵守的项目级常驻约束。
- `STATE.md`：只放最新阶段、最新验证证据、当前 known issues。
- `CODEX_INFO.md`：只放可复用 handoff，不再追加逐轮流水。
- `docs/architecture/*.md`：只放架构约束与路线图，改变 StoryGraph/RAG/Swarm/ReportAgent 边界时同步更新。

---

## 11. 继续开发时的优先级

1. 继续推进 `novelfabric_v4_mono`：在当前 layout-only Web shell 之后，优先补 CLI-backed project/fs primitives、capability manifest、external swarm compatibility fixture，再接真实 Web bridge。
2. 继续把 split LLM config 接入更多 import/runtime 路径。
3. 强化 StoryGraph 关系抽取，不要只依赖简单字符串提及。
4. 保持 browser-only acceptance，不要用 API 直调冒充完整验收。
5. 保持 `npm run test:unit -- --run` 与 `npm run test:e2e:fullstack` 绿色；若失败，先更新 `STATE.md` 再继续相关改动。
