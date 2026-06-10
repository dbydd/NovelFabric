# External Swarm Inference API

## Purpose

NovelFabric's native story runtime already stores source facts as project files, derives StoryRAG context from those files, advances StorySwarm sessions, and emits report artifacts. The external swarm inference API exposes that same text-first pipeline to **any external caller** that has a set of events, observations, incidents, research notes, or other source items and wants a reproducible multi-agent inference run.

The API is intentionally generic. It is not an OpenAlice adapter and it does not know about any single upstream product. A caller may set `domain` to values such as `market-impact`, `operations-risk`, `policy-analysis`, or another application-defined label; NovelFabric treats that label as scenario metadata and persists it with the run.

## Boundary rules

- Callers communicate with NovelFabric over HTTP or the generic client script.
- Callers never import Rust modules or write into NovelFabric's data directory directly.
- NovelFabric persists all accepted external source material as text/JSON files under the target project.
- Derived indexes remain derived. The source of truth is the accepted item text, inference manifest, simulation log, swarm round, and report markdown.
- Agent-facing skills/scripts may wrap the HTTP API, but they must keep the request schema generic.

## Endpoint contract

### `POST /api/external/swarm-inferences`

Creates or reuses an external inference run. `client_request_id` is optional but recommended; when present, NovelFabric uses it as an idempotency key.

Request shape:

```json
{
  "client_request_id": "caller-stable-id",
  "domain": "market-impact",
  "title": "Scenario title",
  "summary": "Why these items should be inferred together.",
  "items": [
    {
      "id": "source-item-id",
      "title": "Source item title",
      "content": "Full source text or framework-provided summary.",
      "published_at": "2026-06-01T12:00:00Z",
      "source": "Source system or publisher",
      "url": "https://example.invalid/item",
      "metadata": { "symbol": "AAPL" }
    }
  ],
  "questions": [
    "What impacts are plausible?",
    "Which uncertainties should be monitored?"
  ],
  "context": {
    "entity_cards": [
      {
        "id": "entity-aapl",
        "kind": "company",
        "name": "Example Corp",
        "summary": "Caller-provided entity card summary.",
        "evidence": ["source-item-id"]
      }
    ],
    "background": "Caller-provided scenario background.",
    "worldview": "Market, policy, social, or domain mechanisms that should constrain inference.",
    "research_notes": ["Caller-side hypotheses or uncertainties."]
  },
  "rounds": 1
}
```

Validation:

- `domain`, `title`, `summary`, at least one `item`, and at least one `question` are required.
- `rounds` defaults to `1` and is capped by the backend service limit.
- Item `metadata` is arbitrary JSON and is persisted as caller-provided context.
- `context` is optional but recommended. When missing required context, the response includes `context_requirements` asking the caller for entity cards or background before trusting the inference.
- The request must contain real caller-provided source items; the backend does not fabricate fallback items.

Response shape (v1 compatibility contract):

```json
{
  "inference_id": "external-...",
  "project_slug": "external-market-impact",
  "session_id": "external-...",
  "domain": "market-impact",
  "title": "Scenario title",
  "rounds_completed": 1,
  "item_count": 5,
  "artifact_paths": {
    "manifest": "projects/.../external/inferences/....json",
    "report": "projects/.../external/reports/....md",
    "input_items": ["projects/.../external/items/...md"],
    "session": "projects/.../simulation/sessions/....json",
    "swarm_rounds": ["projects/.../simulation/swarm/.../round-0001.json"],
    "context": "projects/.../external/context/....md",
    "role_reasoning": ["projects/.../external/role-reasoning/.../entity-analyst.md"]
  },
  "summary_markdown": "# ...",
  "context_requirements": {
    "domain": "market-impact",
    "title": "Scenario title",
    "requirements": [
      {
        "key": "entity_cards",
        "label": "人物/公司/组织卡",
        "question": "Please provide entity cards...",
        "required": true,
        "suggested_sources": ["OpenAlice market/news tools"]
      }
    ],
    "missing_required_keys": ["entity_cards"],
    "is_ready": false
  },
  "role_reasoning": [
    {
      "role": "entity-analyst",
      "model": null,
      "status": "llm_not_configured_fallback",
      "output_path": "projects/.../external/role-reasoning/.../entity-analyst.md",
      "summary": "# entity-analyst fallback reasoning..."
    }
  ]
}
```

Compatibility note: `context_requirements`, `role_reasoning`, `artifact_paths.context`, and `artifact_paths.role_reasoning` are part of the current v1 response shape and must not be removed in V4.

### `GET /api/external/swarm-inferences/{inference_id}`

Reads the persisted inference manifest by id and returns the same response shape when the manifest exists.

## Text artifact layout

For a request with `domain = market-impact`, NovelFabric creates/reuses project slug `external-market-impact` and stores artifacts like:

```text
projects/external-market-impact/
├─ external/
│  ├─ context/<inference-id>.md
│  ├─ items/<inference-id>/<item-id>.md
│  ├─ inferences/<inference-id>.json
│  ├─ reports/<inference-id>.md
│  └─ role-reasoning/<inference-id>/*.md
├─ memory/global/external/<inference-id>/entries/*.md
├─ simulation/sessions/<session-id>.json
├─ simulation/logs/<session-id>.md
└─ simulation/swarm/<session-id>/round-0001.json
```

The markdown item files are citations. Reports and manifests must refer to those paths rather than hiding the evidence inside opaque state.

## Mapping external items into StorySwarm

The service maps a batch of external items to a short deterministic StorySwarm session:

- each item becomes a source artifact and a character-like participant agenda;
- caller `questions` become system directives for random-event, world-maintainer, KP, and project-auditor roles;
- each round advances through the existing order `characters -> random-event -> world-maintainer -> kp -> project-auditor`;
- generated swarm records and reports cite input artifact paths.

This mapping is a generic inference adapter. Application-specific interpretation belongs in the caller's `domain`, item metadata, questions, and downstream report reading.

## Compatibility and tests

This API is already consumed by local agent profiles, including Hermes/OpenAlice/TraderAlice-style workflows for market, sentiment, public-opinion, and external-event inference. V4 must preserve this v1 shape even if the internal implementation moves from the old backend service to the root-level TypeScript shared services or CLI-backed adapters.

Compatibility rules:

- Do not remove or rename request fields, response fields, artifact path fields, or MCP tool names.
- Do not change `client_request_id` idempotency behavior.
- Do not change the meaning of `project_slug`, `session_id`, or `artifact_paths` values.
- Additive fields are allowed if old clients can ignore them.
- Breaking changes require a new endpoint/tool version and migration notes.

Required test coverage before replacing internals:

- golden JSON fixture for a Hermes/TraderAlice-style request and response
- serializer test for the full `ExternalSwarmInferenceResponse`
- HTTP `POST /api/external/swarm-inferences` shape test
- HTTP `GET /api/external/swarm-inferences/{inference_id}` shape test
- artifact path tests for manifest/report/items/session/swarm rounds/context/role reasoning
- MCP parity tests in `docs/architecture/external-swarm-mcp.md`

## Idempotency and audit

If `client_request_id` is provided, the service derives a stable inference id from it. Reposting the same `client_request_id` returns the existing manifest instead of creating a duplicate run. The manifest records request metadata, item artifact paths, context requirement output, role reasoning output paths, session id, completed rounds, and report path so callers can audit or replay the run. Reused runs must keep the same response shape and artifact path semantics.

## Example clients

- A finance agent can set `domain: "market-impact"`, provide five framework-collected news items, and ask impact/uncertainty questions.
- An operations agent can set `domain: "incident-response"`, provide outage updates, and ask blast-radius questions.
- A policy research agent can set `domain: "policy-analysis"`, provide policy bulletins, and ask stakeholder-impact questions.

These examples all use the same endpoint and script; only the request content changes.
