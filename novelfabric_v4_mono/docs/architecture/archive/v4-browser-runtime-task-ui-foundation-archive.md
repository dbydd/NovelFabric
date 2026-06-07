# V4 Completed Gap Archive — Browser Runtime Task UI Foundation

> Archived completion snapshot. Active gaps now move to Web workflow orchestration, Playwright UI-only acceptance, semantic import, external swarm adapters, and domain capabilities.

## Completed Slice

This archive covers the browser runtime task UI foundation for NovelFabric's Web frontend.

### Commit

- `fc82fc6 feat: add browser runtime task ui foundation`

### Implemented Capabilities

**Runtime session prepare**

- Called on page mount when bridge is live
- Displays runtime policy profile, allowed tools, denied raw tools, SDK availability

**Bridge-backed agent task flow**

- Chat composer creates and runs agent tasks through bridge when bridge enabled
- Uses POST /api/bridge/agent/tasks/create and /run
- Runtime policy gate: composer checks policy validity before task creation
- Invalid/null policy shows error and stops before creating task

**Status/events polling**

- Polls POST /api/bridge/agent/tasks/status every 1-2 seconds
- Polls POST /api/bridge/agent/tasks/events for event timeline
- Stops polling on terminal status (completed/failed/aborted)

**Cancel/retry controls**

- Cancel button calls POST /api/bridge/agent/tasks/cancel
- Retry button calls POST /api/bridge/agent/tasks/retry
- Refresh button manually refreshes status

**Runtime status panel**

- Shows policy profile, allowed tools, denied raw tools
- Shows task status, event count, error
- Event timeline with sanitized event summaries
- No internal paths/secrets exposed

**Offline buffer behavior**

- When bridge not enabled, composer enters offline buffer mode
- Does not start runtime, does not write to disk
- Explicit messaging about offline state

### Test Coverage

Backend tests (pre-existing):

- Async run returns 202
- Immediate status shows running
- Duplicate active run returns 409
- Persistent SSE emits task.terminal
- Sanitized event fields

Frontend (manual browser verification):

- Runtime policy prepare on mount
- Task create/run through composer
- Status/events polling visible
- Cancel/retry controls functional
- Offline buffer behavior explicit

### Known Limitations

This is a **browser runtime task UI foundation**. NOT covered:

- **Web workflow orchestration**: No full workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
- **Playwright UI-only acceptance**: No automated browser-only workflow test
- **SSE/EventSource consumption**: Frontend uses polling, not real-time SSE
- **Result/artifact display**: No complete model output, domain artifacts, evidence, audit path display
- **Workflow job UI**: No workflow job/stage/artifact/evidence navigation
- **Semantic import/materialization**: No pi-backed import flow in browser

## Next Active Gap

After this foundation, the next active gap is:

**Web workflow orchestration + Playwright UI-only acceptance**

Priority:

1. Full Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
2. Playwright UI-only acceptance test
3. SSE/EventSource frontend consumption
4. Result/artifact display
5. Workflow job UI

Remaining higher-level gaps:

- Semantic import/materialization
- External swarm REST/MCP adapters
- Domain-specific capability tightening
