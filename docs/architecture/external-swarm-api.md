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
  "rounds": 1
}
```

Validation:

- `domain`, `title`, `summary`, at least one `item`, and at least one `question` are required.
- `rounds` defaults to `1` and is capped by the backend service limit.
- Item `metadata` is arbitrary JSON and is persisted as caller-provided context.
- The request must contain real caller-provided source items; the backend does not fabricate fallback items.

Response shape:

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
    "swarm_rounds": ["projects/.../simulation/swarm/.../round-0001.json"]
  },
  "summary_markdown": "# ..."
}
```

### `GET /api/external/swarm-inferences/{inference_id}`

Reads the persisted inference manifest by id and returns the same response shape when the manifest exists.

## Text artifact layout

For a request with `domain = market-impact`, NovelFabric creates/reuses project slug `external-market-impact` and stores artifacts like:

```text
projects/external-market-impact/
├─ external/
│  ├─ items/<inference-id>/<item-id>.md
│  ├─ inferences/<inference-id>.json
│  └─ reports/<inference-id>.md
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

## Idempotency and audit

If `client_request_id` is provided, the service derives a stable inference id from it. Reposting the same `client_request_id` returns the existing manifest instead of creating a duplicate run. The manifest records request metadata, item artifact paths, session id, completed rounds, and report path so callers can audit or replay the run.

## Example clients

- A finance agent can set `domain: "market-impact"`, provide five framework-collected news items, and ask impact/uncertainty questions.
- An operations agent can set `domain: "incident-response"`, provide outage updates, and ask blast-radius questions.
- A policy research agent can set `domain: "policy-analysis"`, provide policy bulletins, and ask stakeholder-impact questions.

These examples all use the same endpoint and script; only the request content changes.
