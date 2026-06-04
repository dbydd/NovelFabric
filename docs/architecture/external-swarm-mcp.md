# External Swarm Remote MCP

NovelFabric exposes its generic external swarm inference capability through a remote MCP endpoint so agents can use tools instead of calling naked REST APIs.

## Endpoint

- URL: `POST /mcp`
- Transport: JSON-RPC over HTTP, compatible with Streamable HTTP clients that send JSON requests.
- Server info: `novelfabric`

The endpoint supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/*` as no-response notifications

## Tools

### `external_swarm_infer`

Runs NovelFabric's generic external StorySwarm inference over caller-provided source items. Input schema matches the generic external inference request:

- `client_request_id` optional idempotency key
- `domain`
- `title`
- `summary`
- `items[]`
- `questions[]`
- `rounds`

The result is returned in MCP `structuredContent` and mirrored as pretty JSON text content. Artifact paths remain NovelFabric text-first paths.

### `external_swarm_require_context`

Inspects a proposed external swarm inference request and returns missing context requirements before the caller runs inference. This lets a main agent ask for entity cards, background, worldview, or research notes instead of sending under-specified items into the swarm.

The returned `structuredContent` shape is `ExternalContextRequirementsResponse`:

- `domain`
- `title`
- `requirements[]`
- `missing_required_keys[]`
- `is_ready`

### `external_swarm_get`

Reads a persisted external swarm inference by `inference_id`.

## Compatibility

These MCP tools are part of the v1 compatibility surface used by external agent profiles. V4 may move implementation internals behind CLI/shared services, but must preserve:

- tool names: `external_swarm_infer`, `external_swarm_require_context`, `external_swarm_get`
- `tools/list` schemas for current request fields
- `tools/call` result shape with both `content[0].text` and `structuredContent`
- `structuredContent` parity with the HTTP response shape for `external_swarm_infer` and `external_swarm_get`
- JSON-RPC error behavior for invalid arguments and missing inference ids

Required tests:

- `tools/list` exposes all three tools.
- `tools/list` schema stays in parity with the HTTP request shape, including optional `context`.
- `external_swarm_require_context` returns missing required keys for an under-specified request.
- `external_swarm_infer` returns the same field names as HTTP v1, including `context_requirements`, `role_reasoning`, `artifact_paths.context`, and `artifact_paths.role_reasoning`.
- `external_swarm_get` returns the persisted inference shape.

Known additive fix: the current Rust request struct accepts optional `context`; if the MCP advertised input schema omits `context`, add it to the schema rather than removing request support.

## Boundary

External agents should prefer MCP tools. The underlying REST API remains a frozen programmatic compatibility surface for non-agent callers and existing local integrations; it must not be treated as disposable internal plumbing during V4. OpenAlice-style workspace agents should still call the MCP tools rather than naked REST endpoints so agent behavior stays tool-mediated while programmatic clients keep a stable service API.
