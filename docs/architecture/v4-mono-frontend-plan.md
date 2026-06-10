# NovelFabric V4 Mono App Frontend Plan

> Status: usable workspace shell with an offline buffer mode and a CLI-backed file bridge. The web surface remains optional and is started explicitly from the V4 TypeScript mono app.

## 1. Decision

NovelFabric V4 uses a same-package Vue/Vite web shell for workspace operation, but the web UI is not a separate source of truth. Project facts remain text files, and every durable mutation must route through NovelFabric CLI/shared TypeScript services with capability checks and audit.

The mono app currently contains:

- `novelfabric` CLI commands;
- `web demo` for offline layout review / compatibility;
- `web bridge` for CLI-backed workspace file editing;
- Vue/Vite shell code under `src/web/`;
- file services under `src/workspace/`;
- design and handoff docs under `docs/`.

## 2. Current UI Contract

Primary modes:

1. **Workspace** — real file tree in bridge mode, directory workbenches, file editor, protected asset indicators.
2. **Cluster Graph** — StoryGraph / StoryRAG style graph surface with draggable D3 nodes and related file editing.
3. **Swarm Studio** — staged `Objective → Context Pack → Agent Plan → Swarm Rounds → Artifacts` orchestration view.
4. **Chat Runs** — persistent OpenWebUI-like task buffer and composer.
5. **Frozen API** — external swarm REST/MCP compatibility surface.

Directory-owned capabilities live in directory managers rather than first-level activity rail items. Import controls belong to `imports/source`; card/storyboard work belongs to `cards`; artifacts and reports belong to `reports`.

## 3. Layout Rules

Desktop shell:

```text
title/status bar
activity rail | workspace/context sidebar | tabbed story workbench | capability/runtime inspector
                                 bottom chat/task buffer
```

Current rules:

- Left activity rail is function-only: Workspace, Cluster Graph, Swarm, Chat.
- The resource sidebar has a file pane and session pane with visible resize handles.
- Folder name clicks open directory manager tabs; only the left disclosure triangle expands/collapses folders.
- The tabbar is only for opened files/managers, supports horizontal overflow, and mouse wheel inside the tabbar scrolls horizontally.
- The close-all-tabs control is outside the scrollable tab strip so it cannot be squeezed out.
- Closing the final tab switches to the chat buffer; closing dirty file tabs asks for confirmation.
- File editor tabs show dirty/loading/saving/error status and protected read-only state.
- JSON files use a tree-table visual preview with key/type/value columns.
- Chat remains a first-class bottom buffer and full-page mode.
- Manager cards must never link to paths invisible from the file tree.

## 4. CLI-Backed File Editing

The production editor path is:

```text
Web shell → local Vite bridge middleware → shared workspace file service → workspace text files
```

The shared service enforces:

- workspace-root safe path containment;
- UTF-8 text reads/writes;
- protected path classification;
- capability manifest checks;
- optional `expectedBaseHash` conflict detection;
- temp-file + rename replacement;
- audit JSONL records under `.novelfabric/audit/files/YYYY-MM-DD.jsonl`.

Relevant commands:

```bash
npm run cli -- files tree --workspace <workspace> --json
npm run cli -- files read --workspace <workspace> --path project.md --json
npm run cli -- files write --workspace <workspace> --path writing/drafts/x.md --actor main_agent --stdin --json
```

Protected files include `.novelfabric/**`, `AGENTS.md`, `agents/*/soul.md`, and `agents/*/memory.md`. Protected writes require `files.patch_protected`; ordinary writes require `project.manage` or `files.write`.

## 5. Web Launch Modes

Compatibility/offline mode:

```bash
npm run cli -- web demo --port 50021 --dry-run --json
npm run cli -- web demo --port 50021 --json
```

CLI-backed workspace mode:

```bash
npm run cli -- web bridge --workspace <workspace> --port 50023 --actor main_agent --dry-run --json
npm run cli -- web bridge --workspace <workspace> --port 50023 --actor main_agent --json
```

Port policy:

- explicit NovelFabric web ports must be `50000+`;
- `3000` and `8080` are rejected;
- dry-run prints JSON diagnostics without starting Vite.

`web bridge` sets the only workspace and actor the local bridge may use. Browser requests cannot switch to a different workspace or actor.

## 6. Agent Runtime Boundary

The Web shell is for nontechnical users and must not expose raw pi/bash controls. When Web actions need semantic work, the mono app should use the NovelFabric-wrapped pi SDK runtime described in `v4-cli-workspace-harness-plan.md`:

```text
Web control → bridge → NovelFabric runtime policy → pi SDK session → NovelFabric CLI/custom tools → workspace files + audit
```

Runtime requirements:

- use NovelFabric-owned pi config paths under `~/.config/novelfabric/pi/` or `$XDG_CONFIG_HOME/novelfabric/pi/`;
- load NovelFabric-approved extensions such as sandbox/path guard, permission gate, and CLI-only write tools;
- default-deny unrestricted `bash`, raw `write`, raw `edit`, arbitrary network, and arbitrary path access for Web sessions;
- show runtime policy, job/task state, evidence, validation errors, and audit paths in the UI.

## 7. Import and Graph Integration

- `imports/source` upload writes to the selected workspace through the bridge when live.
- Without a bridge, uploaded source text remains an offline buffer and is not written to disk.
- Successful bridge writes refresh the workspace tree.
- Cluster graph node editing reuses the same file draft/save pipeline as editor tabs.

## 8. External Swarm Compatibility

The UI may visualize but must not rename or redefine:

- `POST /api/external/swarm-inferences`
- `GET /api/external/swarm-inferences/{inference_id}`
- `POST /mcp`
- `external_swarm_infer`
- `external_swarm_require_context`
- `external_swarm_get`

## 9. Implementation Files

- `src/web/App.vue` — shell state, file editor, tab UX, graph/chat surfaces.
- `src/web/styles.css` — Tokyo Night workspace shell styling.
- `src/web/bridge-plugin.ts` — local bridge middleware for file tree/read/write.
- `src/commands/web.ts` — `web demo` and `web bridge` commands.
- `src/commands/files.ts` — `files tree/read/write` CLI commands.
- `src/workspace/files.ts` — shared file service, hash/conflict/audit.
- `src/workspace/capabilities.ts` — capability manifest parsing/checks.
- `src/workspace/protection.ts` — protected path policy.

## 10. Verification

Minimum checks after UI work:

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

For write-path changes, run a real bridge smoke against a temporary copy of `fixtures/workspaces/valid-basic` and verify `.novelfabric/audit/files/*.jsonl` is created.
