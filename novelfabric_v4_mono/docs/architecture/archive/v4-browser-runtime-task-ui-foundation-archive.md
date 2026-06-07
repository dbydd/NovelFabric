# V4 Completed Gap Archive — Browser Runtime Task UI Foundation

> Archived completion snapshot. Subsequent work has since completed Web workflow orchestration, Playwright UI-only acceptance, semantic import, external swarm adapters, and domain capabilities; see active docs for any newly opened gap.

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

### Historical Limitations at Archive Time

This is a **browser runtime task UI foundation**. Not yet covered at the time of this archive:

- **At archive time**: full workflow binding and automated browser-only workflow acceptance had not yet landed; later archive entries record their completion.
- **SSE/EventSource consumption**: at archive time, the frontend used polling rather than real-time SSE
- **Result/artifact display**: at archive time, complete model output, domain artifacts, evidence, and audit path display had not yet landed
- **Workflow job UI**: at archive time, workflow job/stage/artifact/evidence navigation had not yet landed
- **At archive time**: semantic import/materialization had not yet landed; later archive entries record its completion.

## Historical Next Steps (later archived)

At the time of this archive, the next work was:

**Web workflow orchestration + Playwright UI-only acceptance**

Priority:

1. Full Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
2. Playwright UI-only acceptance test
3. SSE/EventSource frontend consumption
4. Result/artifact display
5. Workflow job UI

The listed higher-level gaps have since been archived as completed foundations; they are retained here only to preserve the historical handoff context.
