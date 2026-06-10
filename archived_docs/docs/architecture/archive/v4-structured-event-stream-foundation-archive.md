# V4 Completed Gap Archive — Web Runtime Structured Event Stream And Lifecycle Foundation

> Archived completion snapshot. Subsequent work has since completed the later browser/runtime/workflow/import/external-swarm/capability foundations; see active docs for any newly opened gap.

## Completed Slice

This archive covers the structured runtime event stream and lifecycle foundation for NovelFabric's Web bridge.

### Commits

- `88b4e67 feat: add structured runtime event fields and cursor stream`

### Implemented Capabilities

**Structured AgentTaskEvent fields**

- `runtimeEventType`: normalized SDK event subtype (session.started, model.output, tool.requested, tool.denied, validation.completed, session.completed, session.failed)
- `toolName`: for tool.requested/tool.denied events
- `denialCode`: for tool.denied events
- `valid`: for validation.completed events
- `textBytes`: for model.output events (byte count, not raw text)
- `terminal`: marks completion/failure/abort events
- `sequence`: event ordering

**Cursor-based stream**

- `/api/bridge/agent/tasks/stream` accepts `cursor` parameter
- Returns events from cursor onwards
- Response includes `cursor`, `nextCursor`, `eventCount`
- Terminal task status emits `task.terminal` SSE event

**Durable failure records**

- Run failure writes durable `failed` result with sanitized notes
- Failed event persisted to events.jsonl with sanitized message
- Internal paths, session files, credentials redacted before write

**Bridge response sanitization**

- Event summaries return structured fields without raw message
- Error responses sanitized through `sanitizeBridgeErrorMessage()`
- No internal paths, session files, raw text, or secrets exposed

### Test Coverage

- Stream returns structured runtime subtypes (tool.denied, model.output, pi-completed)
- Stream supports cursor (cursor 0 returns all, cursor N returns later only)
- Terminal status emits task.terminal event
- Run failure writes durable failed result/event with sanitized message
- Durable artifacts don't contain injected internal paths/secrets

### Historical Limitations at Archive Time

This is a **structured event stream foundation**. Not yet covered at the time of this archive:

- **Real-time streaming**: at archive time, the stream was snapshot-style SSE rather than open/live incremental
- **Browser UI binding**: at archive time, visible runtime panels/controls had not yet consumed these routes
- **Workflow-level Web orchestration**: at archive time, the browser did not yet run the full workflow through runtime routes
- **Denial trace UX**: at archive time, structured denial events existed without browser-visible display/recovery
- **At archive time**: deeper session lifecycle, long-running updates, and retry UX were not yet integrated; later archive entries record subsequent foundations.

## Historical Next Steps (later archived)

At the time of this archive, the next work was:

**Real-time streaming + browser runtime UI + Web workflow orchestration**

Priority:

1. Real-time incremental event stream (not just cursor snapshots)
2. Browser-visible runtime panels and controls
3. Full Web workflow binding (upload → import → cards → RAG → swarm → report → chapter → editor)
4. Denial trace UX
5. Session lifecycle depth

Historical Next Steps (later archived):

The follow-up foundations listed below were later completed and archived; they are retained here only to preserve the historical handoff context.

- Semantic import/materialization
- External swarm REST/MCP adapters
- Domain-specific capability tightening

These items have since been archived as completed foundations.
