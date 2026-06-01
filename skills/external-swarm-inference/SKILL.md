---
name: external-swarm-inference
description: Call NovelFabric's generic external swarm inference API from caller-provided source items.
---

# External Swarm Inference

Use this skill when an agent or external program has real source items from its own framework and wants NovelFabric to run a text-first StorySwarm inference over them.

## Inputs

You need:

- NovelFabric API base URL (`NOVELFABRIC_API_BASE`, default `http://127.0.0.1:50000`).
- A caller-neutral domain label such as `market-impact`, `incident-response`, or `policy-analysis`.
- A title and summary explaining the scenario.
- One or more real source items supplied by the caller's own data framework.
- One or more questions for the swarm.

Do **not** fabricate source items. If the caller's framework cannot supply items, stop and report the missing precondition.

## Workflow

1. Normalize caller-provided items into the generic request shape:
   - `domain`
   - `title`
   - `summary`
   - `items[]` with `id`, `title`, `content`, optional `published_at`, `source`, `url`, and `metadata`
   - `questions[]`
   - `rounds`
2. Save the request as a JSON file so it can be audited.
3. Run the generic client:

   ```bash
   NOVELFABRIC_API_BASE=http://127.0.0.1:50000 \
     node scripts/external-swarm-infer.mjs --input request.json --out response.json
   ```

4. Read `response.json` and inspect:
   - `inference_id`
   - `artifact_paths.input_items`
   - `artifact_paths.swarm_rounds`
   - `artifact_paths.report`
   - `summary_markdown`
5. Report the result with citations to NovelFabric artifact paths. If available in the host agent, push the markdown report to the user-facing inbox or equivalent notification surface.

## Constraints

- Communicate via HTTP or the generic script only; do not import NovelFabric backend code.
- Treat NovelFabric artifact paths as the audit trail.
- Keep business-specific meaning in the request content. Do not add a bespoke endpoint for a single caller.
- Do not scrape, invent, or backfill source data inside this skill.
