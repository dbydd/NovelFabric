# V4 Completed Gap Archive — Web-safe SDK Tools Suite Foundation

> Archived completion snapshot. Active gaps now move to mutation tools, Web runtime event stream, Web workflow orchestration, extension packaging, and full usability acceptance.

## Completed Slice: Web-safe SDK Tools Suite Foundation

This archive covers the read-only Web-safe custom tools foundation for NovelFabric's wrapped pi agent SDK runtime.

### Commits

- `e3f3ba3 feat: add web-safe sdk custom tools`
- `5ab8b6e feat: add validate target namespace restrictions`

### Implemented Tools

**`novelfabric_read_file`**

- Read non-protected workspace text files
- Protected path precheck before file read
- Parent traversal rejection via safe-path guard
- Returns content, hash, bytes, protected=false metadata

**`novelfabric_validate`**

- Read-only validation dispatcher
- Supported targets: context-pack, workflow, report, writing-draft, swarm-output, cards-proposal, memory-proposal
- All path-based targets namespace-restricted (see below)
- Workflow target jobId-only
- Returns compact valid/issues summary without raw content

**`novelfabric_context_pack`**

- Build mode: bounded context pack generation (limit <= 20)
- Validate mode: validate existing context packs
- Both modes restricted to `knowledge/context-packs/` namespace
- Workspace/actor bound from host closure, not model params

**`novelfabric_report`**

- List mode: enumerate reports without content
- Show mode: bounded preview (max 4000 chars), path restricted to `reports/`
- Validate mode: validate report artifacts, path restricted to `reports/artifacts/`
- All paths safe-path and protected checked

### Namespace Restrictions

All validation targets have namespace restrictions enforced via `precheckNonProtectedPathInNamespace()`:

| Target            | Allowed Namespace          |
| ----------------- | -------------------------- |
| `context-pack`    | `knowledge/context-packs/` |
| `report`          | `reports/artifacts/`       |
| `writing-draft`   | `writing/drafts/`          |
| `swarm-output`    | `simulation/rounds/`       |
| `cards-proposal`  | `proposals/cards/`         |
| `memory-proposal` | `proposals/memory/`        |
| `workflow`        | jobId-only (no path)       |

### SDK Session Configuration

- Raw builtin tools disabled: `noTools: "builtin"`
- Only NovelFabric custom tools exposed via `customTools` option
- Tool allowlist: `novelfabric_read_file`, `novelfabric_validate`, `novelfabric_context_pack`, `novelfabric_report`
- Extensions disabled (`noExtensions: true`) for this foundation slice

### Test Coverage

**Direct tool tests**: `test/agent-runtime/web-safe-tools.test.ts`

- 22 tests covering tool allowlist, namespace restrictions, protected path denial, traversal rejection, bounded report preview, validation dispatcher

**SDK adapter tests**: `test/agent-runtime/pi-adapter.test.ts`

- Tool allowlist assertions
- Custom tools in SDK session options
- No raw builtin tools exposure

**Bridge tests**: `test/web/bridge-plugin.test.ts`

- Runtime prepare route shows allowed tools
- Sanitized bridge responses

**Acceptance gate**: `test:pi-sdk-acceptance`

- Real SDK session with generic-writer
- Custom tools exposed in session options
- No raw tools available

### Known Limitations

This is a **read-only foundation**. The following are NOT covered:

- **Mutation tools**: `novelfabric_write_file`, `novelfabric_apply_proposal`, `novelfabric_apply_domain_artifact`
- **Real-time event streaming**: Current bridge stream is snapshot-only
- **Web UI workflow binding**: No browser-side runtime controls yet
- **NovelFabric SDK extensions**: Current implementation uses custom tools, not distributable extension packages
- **Tool request/denial trace**: Policy-level denial exists, but runtime-level denial events not fully proven
- **Full usability acceptance**: Several `it.todo` contract tests remain pending

## Next Active Gap

After this foundation, the next active gap is:

**Mutation tools + Web runtime event stream + Web workflow orchestration**

Priority order:

1. Implement `novelfabric_write_file` (restricted namespace, capability, audit)
2. Implement `novelfabric_apply_proposal` (card/memory/report/draft/swarm apply)
3. Upgrade bridge stream from snapshot to real-time event stream
4. Add browser-visible runtime controls and event trace
5. Complete Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
6. Package NovelFabric SDK extensions for distribution
7. Close remaining `it.todo` acceptance contracts
