# NovelFabric V4 Mono App 前端方案

> 状态：当前 Web shell 已达到可用工作区级别，支持离线 buffer 与 CLI-backed file bridge。Web surface 仍是 V4 TypeScript mono app 中通过 CLI 显式启动的可选界面。

## 1. 决策

NovelFabric V4 使用同包 Vue/Vite Web shell 承载工作区操作，但 Web UI 不是新的事实源。项目事实仍然是文本文件；任何持久写入都必须通过 NovelFabric CLI / shared TypeScript service，并经过 capability 检查和审计。

当前 mono app 包含：

- `novelfabric` CLI 命令；
- `web demo` 离线布局检查 / 兼容入口；
- `web bridge` CLI-backed workspace 文件编辑入口；
- `src/web/` 下的 Vue/Vite shell；
- `src/workspace/` 下的文件服务；
- `docs/` 下的设计与交接文档。

## 2. 当前 UI 契约

一级模式：

1. **Workspace**：bridge 模式下读取真实文件树、目录工作台、文件编辑器、protected asset indicators。
2. **Cluster Graph**：StoryGraph / StoryRAG 风格图谱，支持 D3 节点拖拽与关联文件编辑。
3. **Swarm Studio**：`Objective → Context Pack → Agent Plan → Swarm Rounds → Artifacts` 推演编排视图。
4. **Chat Runs**：OpenWebUI-like 常驻任务 buffer 与 composer。
5. **Frozen API**：external swarm REST/MCP 兼容面。

目录所属功能进入目录 manager，而不是 activity rail 一等入口：导入控件属于 `imports/source`，卡片 / 分镜属于 `cards`，产物 / 报告属于 `reports`。

## 3. 布局规则

桌面 shell：

```text
title/status bar
activity rail | workspace/context sidebar | tabbed story workbench | capability/runtime inspector
                                 bottom chat/task buffer
```

当前规则：

- 左侧 activity rail 只表达项目级功能：Workspace、Cluster Graph、Swarm、Chat。
- 资源侧栏分为文件 pane 与 session pane，并保留清晰 resize handle。
- 点击文件夹名称只打开目录 manager tab；只有左侧三角切换展开 / 收起。
- tabbar 只表达已打开文件 / manager，支持横向溢出；鼠标在 tabbar 区域内滚轮会横向滚动。
- “关闭全部”按钮位于滚动 tab strip 外侧，不会被 tab 挤掉。
- 关闭最后一个 tab 会切换到聊天 buffer；关闭 dirty 文件 tab 前会确认。
- 文件编辑器显示 dirty / loading / saving / error 状态和 protected 只读状态。
- JSON 文件使用 key / type / value 三列表格树预览。
- 聊天既是底部常驻 buffer，也是独立全页模式。
- manager 卡片不得链接到文件树不可见路径。

## 4. CLI-backed 文件编辑

生产编辑器链路：

```text
Web shell → local Vite bridge middleware → shared workspace file service → workspace text files
```

shared service 负责：

- workspace root 内路径安全校验；
- UTF-8 文本读写；
- protected path 分类；
- capability manifest 检查；
- 可选 `expectedBaseHash` 冲突检测；
- temp-file + rename 原子替换；
- `.novelfabric/audit/files/YYYY-MM-DD.jsonl` 审计记录。

相关命令：

```bash
npm run cli -- files tree --workspace <workspace> --json
npm run cli -- files read --workspace <workspace> --path project.md --json
npm run cli -- files write --workspace <workspace> --path writing/drafts/x.md --actor main_agent --stdin --json
```

protected files 包括 `.novelfabric/**`、`AGENTS.md`、`agents/*/soul.md`、`agents/*/memory.md`。写 protected 文件需要 `files.patch_protected`；普通写入需要 `project.manage` 或 `files.write`。

## 5. Web 启动模式

离线 / 兼容模式：

```bash
npm run cli -- web demo --port 50021 --dry-run --json
npm run cli -- web demo --port 50021 --json
```

CLI-backed workspace 模式：

```bash
npm run cli -- web bridge --workspace <workspace> --port 50023 --actor main_agent --dry-run --json
npm run cli -- web bridge --workspace <workspace> --port 50023 --actor main_agent --json
```

端口策略：

- NovelFabric Web 显式端口必须使用 `50000+`；
- 拒绝 `3000` 和 `8080`；
- dry-run 只输出 JSON diagnostics，不启动 Vite。

`web bridge` 启动时固定允许访问的 workspace 与 actor。浏览器请求不能临时切换到其它 workspace 或 actor。

## 6. 导入与图谱落地

- `imports/source` 上传在 bridge live 时会写入真实 workspace。
- 未连接 bridge 时，上传文本只进入离线 buffer，不写磁盘。
- bridge 写入成功后刷新 workspace tree。
- Cluster graph 节点编辑复用文件草稿 / 保存管线，而不是单独维护 UI-only 状态。

## 7. External Swarm 兼容性

UI 可以可视化兼容面，但不得重命名或重定义：

- `POST /api/external/swarm-inferences`
- `GET /api/external/swarm-inferences/{inference_id}`
- `POST /mcp`
- `external_swarm_infer`
- `external_swarm_require_context`
- `external_swarm_get`

## 8. 实现文件

- `src/web/App.vue` — shell 状态、文件编辑器、tab UX、图谱 / 聊天界面。
- `src/web/styles.css` — Tokyo Night 工作区样式。
- `src/web/bridge-plugin.ts` — file tree/read/write 本地 bridge middleware。
- `src/commands/web.ts` — `web demo` 与 `web bridge` 命令。
- `src/commands/files.ts` — `files tree/read/write` CLI 命令。
- `src/workspace/files.ts` — shared file service、hash/conflict/audit。
- `src/workspace/capabilities.ts` — capability manifest 解析与检查。
- `src/workspace/protection.ts` — protected path policy。

## 9. 验证

UI 相关变更后的最低验证：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
npm run format:check
npm run cli -- web demo --port 50021 --dry-run --json
npm run cli -- web bridge --workspace fixtures/workspaces/valid-basic --port 50023 --actor main_agent --dry-run --json
npm run cli -- files read --workspace fixtures/workspaces/valid-basic --path project.md --json
```

涉及写入链路时，应对 `fixtures/workspaces/valid-basic` 的临时副本运行真实 bridge smoke，并确认 `.novelfabric/audit/files/*.jsonl` 被创建。
