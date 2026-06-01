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

### `external_swarm_get`

Reads a persisted external swarm inference by `inference_id`.

## Boundary

External agents should prefer MCP tools. The underlying REST API remains the backend's internal and programmatic compatibility surface, but OpenAlice-style workspace agents must not call it directly. This keeps agent behavior tool-mediated while preserving a generic service API for non-agent programs.
