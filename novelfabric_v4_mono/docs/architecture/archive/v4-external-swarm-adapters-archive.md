# V4 Completed Gap Archive — External Swarm REST/MCP Adapters

> Archived completion snapshot. Do not treat this file as the active next-iteration plan. Active planning lives in `../v4-cli-workspace-harness-plan.md`, `../v4-cli-command-contract.md`, and `../../qa/v4-full-usability-acceptance.md`.

## Commit-Level Traceability

- `1ca411d feat: add external swarm rest adapter` — frozen REST adapter for external swarm inference routes.
- `53987f0 feat: add external swarm mcp adapter` — frozen MCP adapter for external swarm tools.

## Archived Completion State

The V4 mono app has completed the external swarm REST/MCP adapter gap:

- `POST /api/external/swarm-inferences` is served by the V4 Web bridge and calls the shared external-swarm service.
- `GET /api/external/swarm-inferences/{inference_id}` returns persisted inference artifacts through the same service boundary.
- `/mcp` supports the frozen MCP `tools/list` and `tools/call` shapes.
- MCP tools include `external_swarm_infer`, `external_swarm_require_context`, and `external_swarm_get`.
- MCP responses preserve `structuredContent` and text content wrappers.
- REST/MCP adapters preserve idempotency, artifact path semantics, additive-field compatibility, and workspace write/audit behavior.

## Archived Verification Evidence

Accepted gates include:

```text
npm run typecheck
npm run lint
npm test
npm run format:check
```

Representative coverage:

- `test/external-swarm/index.test.ts` validates shared service artifacts, idempotency, and MCP structured result wrappers.
- `test/cli/external-swarm.test.ts` validates CLI compatibility commands.
- `test/web/bridge-plugin.test.ts` covers REST `POST`/`GET`, MCP `tools/list`, and MCP `tools/call` for the frozen external swarm tools.

## Important Boundary

The frozen external swarm compatibility surface must remain stable. Future changes must be additive or versioned and must keep the REST/MCP golden tests green.
