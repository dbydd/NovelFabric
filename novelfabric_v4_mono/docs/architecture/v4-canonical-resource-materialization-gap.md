# NovelFabric V4 Gap: Canonical Resource Materialization

> Active V4 gap document. This is the canonical definition for the next implementation phase: making a NovelFabric project produce the full set of canonical workspace resources from a source novel, not only a workflow spine plus pi-backed task/domain artifacts.

## 1. Gap Summary

As of 2026-06-08, NovelFabric V4 has proven:

- CLI-first workspace harness commands exist and are test-covered.
- `project init`, `import add`, deterministic import stages, and workflow planning/start/step/verify work.
- `import.semantic` creates source-grounded semantic import artifacts with characters, events, cardSeeds, sourceAnchors, and citations.
- `cards.propose` / `cards.apply` can produce card artifacts.
- `knowledge.rebuild` produces derived graph/index artifacts.
- `simulation.session.create`, `simulation.context-pack`, `swarm.plan`, and `swarm.task.create` execute with real pi-backed evidence.
- `report.task.create` produces report artifacts.
- `writing.context-pack` and `writing.draft` produce writing task/draft artifacts.
- `workflow verify` enforces hashed evidence, stage integrity, and domain artifact evidence for pi-task stages.

What has **not** been proven is full canonical business completeness for a NovelFabric project:

- multiple canonical card types are not populated correctly;
- `memory/**`, `timeline/**`, `simulation/turns`, `simulation/logs`, and `writing/chapters` remain empty or incomplete after a real workflow run;
- the current card proposal path can produce a generic role-title character card instead of extracted-character-backed cards.

This gap must remain open until a real-path run produces the canonical NovelFabric project resources with source-cited content.

## 2. Authoritative Product Requirements

The canonical project shape is not optional UI decoration. It is the product contract:

- a basic NovelFabric project consists of character cards, rule cards, world-setting cards, and a memory layer;
- import/book-splitting should produce those canonical resources from a source novel;
- chapter memory should be organized by timepoints;
- canonical resources must remain editable, auditable, rollback-capable, and rebuildable from source text.

Authoritative references:

- `../PRODUCT_SPEC.md` — explicit product requirements for cards, rules, world, memory, chapterized import, timeline branching, and simulation/editor loops.
- `../PRODUCT_SPEC_2.md` — source-of-truth asset list including `cards/characters/*.md`, `cards/rules/*.md`, `cards/world/*.md`, `memory/**`, and `timeline/**`.
- `../AGENTS.md` — canonical card directories and import→canonical resource expectations.

## 3. Current Evidence From `test_novel.txt`

The latest real-path run over `test_novel.txt` ended with this workspace state:

### 3.1 Proven Workflow Spine

Proven artifacts include:

- `imports/semantic/test-novel-real-2.json`
- `proposals/cards/test-novel-real-2-role-card.json`
- `cards/characters/aria-source-card.md`
- `knowledge/indexes/...`
- `knowledge/graph/...`
- `simulation/context-packs/...`
- `simulation/sessions/test-novel-real-2/swarm/...`
- `reports/test-novel-real-2-consistency.json`
- `writing/drafts/test-novel-real-2.json`
- `workflow verify: true`

### 3.2 Missing Canonical Resources

The same run left these directories empty or materially incomplete:

- `cards/rules/` — empty
- `cards/scenes/` — empty
- `cards/world/` — empty
- `memory/agents/` — empty
- `memory/branches/` — empty
- `memory/chapters/` — empty
- `memory/global/` — empty
- `timeline/branches/` — empty
- `simulation/turns/` — empty
- `simulation/logs/` — empty
- `writing/chapters/` — empty

### 3.3 Incorrect Card Materialization

Semantic import extracted rich book-splitting evidence:

- `characters`: `叶小伟`, `张岚`, `陈副科长`, `舅舅`, `老张`, `刘二`, `闫德志`, `刘建平`
- `events`: `叶小伟借枪备行`, `穿越事件`, `办公室对峙`, `制服疑团`, `亮明党员身份`
- `cardSeeds`: `character`, `other`, `plot`, `other`, `other`, `other`, `other`

But applied cards only produced one generic character card:

- `cards/characters/aria-source-card.md`

Because the workflow `cards.propose` path currently uses:

- `kind: "character"`
- `title: `${request.plan.role} Source Card``

So canonical card coverage collapsed into a role-title artifact instead of extracting protagonist/world/scene/rule resources.

## 4. Root Causes

This gap is caused by four related shortcomings:

1. **Semantic card-seed mapping is incomplete.**  
   `import.semantic` produces `cardSeeds`, but downstream workflow logic does not project all seed kinds into canonical card families.

2. **Card proposal path is too narrow.**  
   `cards.propose` is currently centered on a single deterministic or role-centric character card. It does not yet implement multi-type card proposal from semantic evidence.

3. **Canonical resource completeness is not validated.**  
   `workflow verify` currently enforces pi-task evidence and domain artifact presence, but it does not enforce that canonical resource directories are populated when semantic evidence indicates they should exist.

4. **Writing path stops at draft.**  
   `writing.draft` exists, but there is no applied canonical chapter artifact path exercised by the current workflow.

## 5. Dependency Order

Canonical resource materialization should be implemented in this order:

1. **Semantic import → canonical card mapping**
2. **Multi-type card proposal/apply**
3. **Memory materialization**
4. **Timeline materialization**
5. **Simulation turns/logs materialization**
6. **Writing canonical chapter apply**
7. **Workflow verification / acceptance tightening**
8. **Browser acceptance completeness**

This order is required because cards, memory, and timeline are canonical project facts. Later simulation/report/writing completeness depends on those facts existing.

## 6. Required Acceptance Standard

A future real-path run is complete only if it proves canonical resource coverage, not only task completion.

### 6.1 Cards Acceptance

Required:

- `cards/characters` must contain extracted character cards, not only a generic role card.
- `cards/world` must contain at least one world-setting card derived from semantic evidence.
- `cards/rules` must contain at least one rule/constraint card, or an explicit validated artifact that records “no rule found” without silently leaving the category empty when semantic evidence implies constraints exist.
- `cards/scenes` must contain at least one scene card from semantic events or chapter evidence.
- Every card must include:
  - `kind`
  - `title`
  - `summary`
  - `sourceAnchors`
  - `citations`
  - provenance to semantic import or related canonical artifacts
- No card may be accepted as valid if its content is only a generic template shell or full raw excerpt without structured card content.

### 6.2 Memory Acceptance

Required:

- at least one memory path among `memory/global`, `memory/chapters`, `memory/agents` must be populated after import/workflow completion;
- memory entries must cite source evidence;
- role-agent memory must not leak private facts from other agents unless explicitly authorized.

### 6.3 Timeline Acceptance

Required:

- `timeline/index.json` must no longer remain an empty branches structure;
- timeline entries must derive from semantic events or chapter timepoints;
- timeline entries must carry source anchors/citations.

### 6.4 Simulation Acceptance

Required:

- completed simulation work must leave canonical evidence under `simulation/turns` and/or `simulation/logs`;
- turn records must identify actor/role, input context, action decision, and evidence references;
- session lifecycle must be visible beyond domain artifact templates.

### 6.5 Writing Acceptance

Required:

- writing must reach canonical chapter apply, not only `writing/drafts`;
- canonical chapter output must be source-grounded, non-empty, and structurally valid;
- writing review/audit paths must be exercised when apply occurs.

### 6.6 Verification Acceptance

Required:

- `workflow verify` must reject canonical resource gaps when semantic evidence says those resource categories should exist;
- CLI and Playwright acceptance must verify workspace completeness, not only `workflow verify: true`.

## 7. Required Tests

No implementation of this gap may be accepted without these tests:

1. **Card coverage test**  
   Proves `import.semantic` cardSeeds produce multiple canonical card kinds, not only `character`.

2. **Character identity test**  
   Proves protagonist-backed character cards are created from extracted characters, not from the workflow role name.

3. **World/rule/scene coverage test**  
   Proves non-empty canonical card files exist when semantic evidence provides world constraints, rules, or scenes.

4. **Memory materialization test**  
   Proves at least one canonical memory path is populated with source-cited content.

5. **Timeline materialization test**  
   Proves timeline entries are created from semantic import/chapter/event evidence.

6. **Simulation turn/log test**  
   Proves simulation work leaves canonical turn or log evidence.

7. **Canonical chapter apply test**  
   Proves `writing/chapters/*.md` is produced from validated writing work, not only `writing/drafts`.

8. **Workflow completeness test**  
   Proves `workflow verify` fails when semantic evidence indicates canonical resource categories should exist but the workspace remains empty.

## 8. Reviewer / Verifier Archival Criteria

This gap may be archived only when:

- a real-path run over `test_novel.txt` produces non-empty `cards/characters`, `cards/world`, `cards/scenes`, `cards/rules`, memory, timeline, and chapter evidence;
- the applied character set reflects extracted book characters, not generic role-title cards;
- semantic cardSeeds map to canonical card kinds in service/workflow behavior and tests;
- `workflow verify` and acceptance tests enforce canonical completeness;
- Playwright and CLI acceptance verify workspace completeness, not only task/status completion;
- reviewer confirms no fixture-specific special-casing remains.

## 9. Non-Goals

- No fixture-specific code for `test_novel.txt`.
- No NovelFabric-owned provider runtime as the V4 mainline.
- No bypassing canonical resource coverage by treating task/result evidence alone as product completeness.
- No hiding canonical resource gaps behind successful `workflow verify` results when semantic evidence indicates those resources should exist.

## 10. Recommended Implementation Slice Order

Recommended implementation slices:

1. Define canonical resource expectations from semantic import evidence.
2. Extend card proposal/apply to generate multiple card kinds.
3. Fix character card identity to use extracted characters.
4. Add world/scene/rule materialization from semantic seeds/events.
5. Add memory materialization from semantic events/chapters.
6. Add timeline materialization from semantic events/chapters.
7. Add simulation turn/log materialization path.
8. Add canonical chapter apply path for writing.
9. Tighten `workflow verify` and acceptance for canonical completeness.
10. Update browser acceptance to inspect canonical workspace resources.

## 11. Current Status

Status as of 2026-06-08:

- previous framework/architecture ledger remains archived and closed;
- this canonical resource materialization gap is an **open fresh active gap**;
- implementation should start here, not in new Web/runtime/adapter feature-chasing.
