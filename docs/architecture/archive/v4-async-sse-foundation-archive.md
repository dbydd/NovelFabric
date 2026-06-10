# V4 Completed Gap Archive — Web Bridge Async Agent Run + Persistent SSE Event Stream Foundation

> Archived completion snapshot. Subsequent work has since completed browser runtime UI, Web workflow orchestration, semantic import, external swarm adapters, and domain capabilities; see active docs for any newly opened gap.

## Completed Slice

This archive covers the async agent run and persistent SSE event stream foundation for NovelFabric's Web bridge.

### Commits

- `2816408 feat: add async web bridge run registry`
- `fd329b2 feat: add persistent sse polling stream`

### Implemented Capabilities

**Async run registry** (`src/agent-runtime/task-runner.ts`)

- `startAgentTaskRun()` launches `runAgentTask()` in background, returns immediately
- Tracks active runs in in-memory Map keyed by workspace+task
- Duplicate active runs rejected with `bridge_agent_task_already_running`
- Completed tasks cannot be restarted (use retry route)
- Early failures write durable failed result/event via `ensureDurableFailureEvidence()`

**Async /run route**

- Returns 202 with `{ taskId, status: "running", eventStreamAvailable: true }`
- Status route prefers durable terminal state over in-memory registry
- Immediate /status after /run shows "running"

**Persistent SSE polling stream**

- `/api/bridge/agent/tasks/stream` keeps connection open
- Polls events.jsonl periodically (configurable interval)
- Emits `event: snapshot` initially with cursor-based events
- Emits `event: events` for new entries from cursor
- Emits `event: task.terminal` when task reaches terminal state
- Emits `event: stream.timeout` at max duration (configurable, default 5 min)
- Request close/abort cleans up interval/timeout
- Active stream count tracked for testing

**Structured sanitized event fields**

- `runtimeEventType`: normalized SDK event subtype, restricted to safe enum values
- `toolName`: sanitized through `sanitizeBridgeErrorMessage()`, bounded to 96 chars
- `denialCode`: sanitized similarly
- `valid`, `textBytes`, `terminal`, `sequence`: safe structured fields
- No raw message, internal paths, session files, or secrets exposed

### Test Coverage

- Async run returns 202 before completion
- Immediate /status shows running
- Duplicate active run returns 409
- Concurrent duplicate run: one 202, one 409
- Durable terminal state preferred over in-memory registry
- Persistent SSE emits task.terminal after completion
- Stream cleanup on request close/abort
- Malicious structured fields (toolName, denialCode, runtimeEventType) sanitized in stream output
- Failed run writes durable sanitized result/event

### Historical Limitations at Archive Time

This is a **backend streaming foundation**. Not yet covered at the time of this archive:

- **Browser runtime UI**: at archive time, the frontend did not yet consume the SSE stream
- **Web workflow orchestration**: at archive time, UI controls for the full workflow had not yet landed
- **Playwright UI-only acceptance**: at archive time, browser-only workflow tests had not yet landed
- **In-flight cancellation**: at archive time, cancel could mark aborted but could not stop a running SDK session
- **Cross-process run registry**: at archive time, the registry was in-memory only and not restart-resilient

## Historical Next Steps (later archived)

At the time of this archive, the next work was:

**Browser runtime UI + Web workflow orchestration + Playwright UI-only acceptance**

Priority:

1. Browser-visible runtime panel consuming SSE stream
2. UI controls for start/status/stream/cancel/retry
3. Full Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
4. Playwright UI-only acceptance test

Historical Next Steps (later archived):

The follow-up foundations listed below were later completed and archived; they are retained here only to preserve the historical handoff context.

- Semantic import/materialization
- External swarm REST/MCP adapters
- Domain-specific capability tightening

These items have since been archived as completed foundations.
