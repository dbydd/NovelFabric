# V4 Mono App Frontend Reference Study

> Scope: UI pattern synthesis and NovelFabric-specific decisions. Reference repositories were studied as architectural and interaction inspiration only; no implementation code or assets are copied into NovelFabric.

## Reference Repositories

| Project                                          | What was studied                                                   | Boundary                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| MiroFish (`github.com/666ghj/MiroFish`)          | staged swarm workflow, graph/process panels, report flow           | AGPL-3.0: architecture inspiration only              |
| open-webui (`github.com/open-webui/open-webui`)  | chat hierarchy, composer, room transcript, role separation         | UI pattern inspiration only                          |
| code-server (`github.com/coder/code-server`)     | workspace shell, file explorer, tabs, settings/config mental model | do not turn NovelFabric into generic VS Code hosting |
| infiplot (`github.com/zonghaoyuan/infiplot`)     | high-contrast visual cards, creative density                       | visual hierarchy inspiration only                    |
| Muse-Studio (`github.com/benjiyaya/Muse-Studio`) | storyboard, project/scene cards, agent-assisted media/story flow   | workflow inspiration only                            |

## Shared Design Language

1. **Workspace as the frame**: persistent shell, file tree, tabs, inspector, and task buffer make the project understandable to both humans and agents.
2. **Mode-specific center**: file editing, graph inspection, swarm orchestration, chat, and frozen API inspection need different center panels.
3. **Artifact-first review**: generated outputs should become files, reports, scene cards, logs, or context packs.
4. **Visible run state**: long-running or multi-agent flows should be staged as context → plan → action → artifact.
5. **High-density but legible**: Tokyo Night colors, compact rows, explicit focus/hover/selected states, and bordered collections keep dense story state readable.

## NovelFabric UI Decisions Captured

- Activity rail is only for project-level modes; directory-owned actions stay in directory managers.
- File manager rows follow VSCode semantics: click folder name to open a manager; only the disclosure triangle expands/collapses.
- Every manager-linked path must be visible in the workspace tree.
- Tabbar is for concrete open objects, not global modes. It supports horizontal overflow, mouse-wheel horizontal scrolling, dirty markers, close-last-tab behavior, and a fixed close-all control outside the scrollable strip.
- Closing the final tab switches to the chat buffer rather than forcing a placeholder tab.
- The editor is a real workspace editor in bridge mode: read/tree/write go through NovelFabric shared services, protected policy, base-hash conflict checks, and audit logs.
- Offline buffer mode is allowed for layout review, but product UI must not present it as durable storage.
- JSON uses a key/type/value tree-table preview instead of raw collapsible blocks.
- Chat is a first-class buffer inspired by open-webui, but it remains a workspace task surface rather than the whole product.
- Cluster graph interaction uses MiroFish/Obsidian-like affordances: D3 force layout, pan/zoom, dragging, parameter tuning, related file editing.
- UI copy should be production-neutral: avoid user-facing demo/example/placeholder wording inside the product shell.

## Integration Boundary

The correct write path is:

```text
Web shell → local bridge middleware → shared workspace service → text files + audit
```

The UI must not directly write workspace files from browser state or bypass capability checks. If a feature is not connected to bridge/services yet, label it as an offline buffer or planning surface and avoid implying persistence.

## Verification Pattern

For future UI work:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run web:build
npm run format:check
npm run cli -- web bridge --workspace fixtures/workspaces/valid-basic --port 50023 --actor main_agent --dry-run --json
```

For write-path changes, run a bridge smoke on a temporary workspace copy and verify `.novelfabric/audit/files/*.jsonl` creation.

A copy audit should also check that `src/web` does not contain user-facing demo/example/placeholder language after productization passes.
