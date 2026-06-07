# V4 Completed Gap Archive — Web-safe Mutation Tools Foundation

> Archived completion snapshot. Active gaps now move to Web runtime event stream, lifecycle orchestration, Web workflow binding, semantic import, external swarm adapters, and domain capabilities.

## Completed Slice: Web-safe Mutation Tools Foundation

This archive covers the Web-safe mutation tools for NovelFabric's wrapped pi agent SDK runtime.

### Commits

- `cb919b0 feat: add web-safe write file tool`
- `eb423fd feat: add web-safe apply proposal tool`
- `202f90c fix: add apply_proposal to web-safe policy allowlist`

### Implemented Tools

**`novelfabric_write_file`**

- Write files through `writeWorkspaceFile()` service
- Namespace allowlist: `proposals/cards/`, `proposals/memory/`, `writing/drafts/`, `reports/generated/`, `simulation/rounds/`, `simulation/turns/`
- Protected paths rejected even if actor has capability
- Existing files require `expectedBaseHash` for conflict detection
- Workspace/actor bound from host closure, not model params
- Response sanitized: path/hash/bytes/auditPath, no content echo

**`novelfabric_apply_proposal`**

- Discriminated dispatcher for 5 proposal kinds:
  - `card-proposal` → `applyCardProposal()`
  - `memory-proposal` → `applySharedMemoryProposal()`
  - `swarm-output` → `applySwarmOutput()`
  - `report-artifact` → `applyReportArtifact()`
  - `writing-draft` → `applyWritingDraft()`
- Namespace prechecks on input paths (proposals/cards/, proposals/memory/, simulation/rounds/, reports/artifacts/, writing/drafts/)
- Output path restrictions per kind (memory/global/, reports/, writing/chapters/)
- Each apply service validates before applying
- Returns sanitized apply summary without raw content

### Policy Consistency

After fix `202f90c`, `novelfabric_apply_proposal` is present in:

- SDK custom tool manifest (`WEB_SAFE_CUSTOM_TOOL_NAMES`)
- Web-safe policy allowlist (`WEB_SAFE_ALLOWED_TOOLS`)
- Runtime materialized policy (`webSafeRuntimePolicy().allowedNovelFabricTools`)
- All relevant tests

### Test Coverage

**Write tool tests**: `test/agent-runtime/web-safe-tools.test.ts`

- Positive: write card proposals, writing drafts
- Negative: protected paths, wrong namespace, traversal, stale hash, missing hash, content echo prevention, model params ignored

**Apply tool tests**: `test/agent-runtime/web-safe-tools.test.ts`

- Positive: apply each of 5 kinds
- Negative: invalid kind, missing fields, wrong input namespace, wrong output namespace

**Policy tests**: `test/agent-runtime/pi-adapter.test.ts`

- Tool allowlist includes all 6 Web-safe tools
- Session options include all custom tools
- Policy validation accepts apply_proposal

### Known Limitations

This is a **mutation tools foundation**. The following are NOT covered:

- **Web runtime event stream**: Current bridge stream is snapshot-only, not real-time
- **Web workflow binding**: No browser-side runtime controls yet
- **Semantic import**: Source text → cards/chapters/timeline/memory not yet implemented
- **External swarm REST/MCP adapters**: Frozen compatibility surface not yet landed
- **Domain-specific capabilities**: Still using broad project/file capabilities

## Next Active Gap

After this foundation, the next active gap is:

**Web runtime event stream and lifecycle orchestration**

Priority:

1. Browser-visible runtime event stream
2. Bounded/redacted event envelopes
3. Denial trace
4. Retry/cancel lifecycle evidence
5. Stable Web bridge session/task event model
6. Web UI binding to runtime/session controls

After that:

- Web full workflow binding
- Semantic import/materialization
- External swarm REST/MCP adapters
- Domain-specific capability tightening
