# V4 Completed Gap Archive — Web Bridge Async Agent Run + Persistent SSE Event Stream Foundation

> Archived completion snapshot. Active gaps now move to browser runtime UI, Web workflow orchestration, Playwright UI-only acceptance, semantic import, external swarm adapters, and domain capabilities.

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

### Known Limitations

This is a **backend streaming foundation**. NOT covered:

- **Browser runtime UI**: Frontend doesn't consume SSE stream yet
- **Web workflow orchestration**: No UI controls for full workflow
- **Playwright UI-only acceptance**: No browser-only workflow test
- **In-flight cancellation**: Cancel can mark aborted but can't stop running SDK session
- **Cross-process run registry**: In-memory only, not restart-resilient

## Next Active Gap

After this foundation, the next active gap is:

**Browser runtime UI + Web workflow orchestration + Playwright UI-only acceptance**

Priority:

1. Browser-visible runtime panel consuming SSE stream
2. UI controls for start/status/stream/cancel/retry
3. Full Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
4. Playwright UI-only acceptance test

Remaining higher-level gaps:

- Semantic import/materialization
- External swarm REST/MCP adapters
- Domain-specific capability tightening
