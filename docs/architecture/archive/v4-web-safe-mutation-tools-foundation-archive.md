# V4 Completed Gap Archive — Web-safe Mutation Tools Foundation

> Archived completion snapshot. Subsequent work has since completed Web runtime event stream, lifecycle orchestration, Web workflow binding, semantic import, external swarm adapters, and domain capabilities; see active docs for any newly opened gap.

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

### Historical Limitations at Archive Time

This archive captured the **mutation tools foundation** only. At the time of this archive, the following foundations had not yet landed:

- Web runtime event stream and lifecycle orchestration;
- browser-side runtime controls and workflow binding;
- semantic import/materialization;
- external swarm REST/MCP adapters;
- domain-specific capability tightening.

Those follow-up foundations were completed later and archived separately: structured event streaming, async/SSE runtime foundations, browser runtime task UI, Web workflow orchestration, semantic import/materialization, external swarm adapters, and domain-specific capabilities. Treat this section as historical context, not as current follow-up scope.
