import { CommandFailure } from "../errors.js";
import type {
  NovelFabricSemanticImportArtifact,
  SemanticImportCardSeed
} from "../import/semantic.js";
import type { JsonObject } from "../output.js";
import { appendWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";

export type CanonicalCardKind = "character" | "scene" | "world" | "rule";

export type CanonicalWriteSummary = {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly auditPath: string;
};

export type CanonicalMemoryMaterializeResult = {
  readonly semanticPath: string;
  readonly writes: readonly CanonicalWriteSummary[];
};

export type CanonicalTimelineMaterializeResult = {
  readonly semanticPath: string;
  readonly writes: readonly CanonicalWriteSummary[];
};

export type CanonicalVerifyResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly CanonicalVerifyIssue[];
};

export type CanonicalVerifyIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

type CanonicalCitation = {
  readonly path: string;
  readonly hash?: string;
};

export type CanonicalCardDraft = {
  readonly kind: CanonicalCardKind;
  readonly title: string;
  readonly summary: string;
  readonly sourceAnchors: readonly string[];
  readonly citations: readonly CanonicalCitation[];
  readonly provenance: string;
};

const CARD_QUALITY_MIN_CHARS = 80;
const MEMORY_QUALITY_MIN_CHARS = 80;
const CHAPTER_QUALITY_MIN_CHARS = 120;
const TEMPLATE_PATTERN =
  /\b(?:placeholder|replace this text|pending|todo|source card|workspace card)\b|待替换|占位|模板|示例/u;

export function cardKindDirectory(kind: CanonicalCardKind): string {
  switch (kind) {
    case "character":
      return "cards/characters";
    case "scene":
      return "cards/scenes";
    case "world":
      return "cards/world";
    case "rule":
      return "cards/rules";
  }
}

export async function readSemanticImportArtifact(request: {
  readonly workspacePath: string;
  readonly semanticPath: string;
}): Promise<NovelFabricSemanticImportArtifact> {
  const read = await readWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.semanticPath
  });
  const parsed = parseJsonObject(read.content, read.path);
  if (!isSemanticImportArtifact(parsed)) {
    throw new CommandFailure(
      "invalid_semantic_import_artifact",
      `Semantic import artifact '${read.path}' has an invalid shape.`
    );
  }
  return parsed;
}

export function buildCanonicalCardDrafts(
  semantic: NovelFabricSemanticImportArtifact
): readonly CanonicalCardDraft[] {
  const drafts: CanonicalCardDraft[] = [];
  for (const character of semantic.characters) {
    drafts.push({
      kind: "character",
      title: character.name,
      summary: character.summary,
      sourceAnchors: character.sourceAnchors,
      citations: semantic.citations,
      provenance: `${semantic.sourcePath}#characters`
    });
  }
  for (const seed of semantic.cardSeeds) {
    const kind = cardKindFromSeed(seed);
    if (kind === "character" && drafts.some((draft) => draft.title === seed.title)) continue;
    drafts.push({
      kind,
      title: seed.title,
      summary: seed.summary,
      sourceAnchors: seed.sourceAnchors,
      citations: semantic.citations,
      provenance: `${semantic.sourcePath}#cardSeeds`
    });
  }
  for (const event of semantic.events) {
    if (!drafts.some((draft) => draft.kind === "scene" && draft.title === event.title)) {
      drafts.push({
        kind: "scene",
        title: event.title,
        summary: event.summary,
        sourceAnchors: event.sourceAnchors,
        citations: semantic.citations,
        provenance: `${semantic.sourcePath}#events`
      });
    }
  }
  if (!drafts.some((draft) => draft.kind === "world")) {
    drafts.push({
      kind: "world",
      title: `${sourceTitle(semantic.sourcePath)} 世界约束`,
      summary: semantic.summary,
      sourceAnchors: semantic.sourceAnchors,
      citations: semantic.citations,
      provenance: `${semantic.sourcePath}#summary`
    });
  }
  return dedupeCardDrafts(drafts).map(ensureCardDraftQuality);
}

export function renderCanonicalCardMarkdown(draft: CanonicalCardDraft): string {
  return `${[
    `# ${draft.title}`,
    "",
    `kind: ${draft.kind}`,
    `title: ${draft.title}`,
    `summary: ${draft.summary}`,
    "",
    "## Summary",
    draft.summary,
    "",
    "## Source Anchors",
    ...nonEmptyUnique(draft.sourceAnchors).map((anchor) => `- ${anchor}`),
    "",
    "## Citations",
    ...draft.citations.map((citation) =>
      citation.hash === undefined ? `- ${citation.path}` : `- ${citation.path} @ ${citation.hash}`
    ),
    "",
    "## Provenance",
    `- semantic: ${draft.provenance}`
  ].join("\n")}\n`;
}

export async function materializeCanonicalMemory(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly semanticPath: string;
  readonly sessionId: string;
  readonly roleAgent: string;
  readonly reason?: string;
}): Promise<CanonicalMemoryMaterializeResult> {
  const semantic = await readSemanticImportArtifact(request);
  const writes: CanonicalWriteSummary[] = [];
  const globalContent = renderMemoryMarkdown({
    title: `Import Memory ${request.sessionId}`,
    summary: semantic.summary,
    facts: [
      ...semantic.characters.map((character) => `${character.name}: ${character.summary}`),
      ...semantic.events.map((event) => `${event.title}: ${event.summary}`)
    ],
    anchors: semantic.sourceAnchors,
    citations: semantic.citations,
    provenance: request.semanticPath
  });
  writes.push(
    await writeCanonicalText({
      workspacePath: request.workspacePath,
      actor: request.actor,
      path: `memory/global/import-${safePathSegment(request.sessionId)}.md`,
      content: globalContent,
      reason: request.reason ?? "canonical memory materialize"
    })
  );
  for (let index = 0; index < Math.min(semantic.chapters.length, 4); index += 1) {
    const chapter = semantic.chapters[index];
    if (chapter === undefined) continue;
    writes.push(
      await writeCanonicalText({
        workspacePath: request.workspacePath,
        actor: request.actor,
        path: `memory/chapters/${(index + 1).toString().padStart(3, "0")}-${safePathSegment(chapter.title)}.md`,
        content: renderMemoryMarkdown({
          title: chapter.title,
          summary: chapter.summary,
          facts: semantic.events
            .filter((event) => intersects(event.sourceAnchors, chapter.sourceAnchors))
            .map((event) => `${event.title}: ${event.summary}`),
          anchors: chapter.sourceAnchors,
          citations: semantic.citations,
          provenance: request.semanticPath
        }),
        reason: request.reason ?? "canonical chapter memory materialize"
      })
    );
  }
  writes.push(
    await writeCanonicalText({
      workspacePath: request.workspacePath,
      actor: request.actor,
      path: `memory/agents/${safePathSegment(request.roleAgent)}.md`,
      content: renderMemoryMarkdown({
        title: `${request.roleAgent} import briefing`,
        summary: `Agent ${request.roleAgent} receives source-grounded context from ${semantic.sourcePath}.`,
        facts: semantic.characters
          .slice(0, 8)
          .map((character) => `${character.name}: ${character.summary}`),
        anchors: semantic.sourceAnchors,
        citations: semantic.citations,
        provenance: request.semanticPath
      }),
      reason: request.reason ?? "canonical agent memory materialize"
    })
  );
  return { semanticPath: request.semanticPath, writes };
}

export async function materializeCanonicalTimeline(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly semanticPath: string;
  readonly sessionId: string;
  readonly reason?: string;
}): Promise<CanonicalTimelineMaterializeResult> {
  const semantic = await readSemanticImportArtifact(request);
  const events = semantic.events.map((event, index) => ({
    id: `event-${(index + 1).toString().padStart(3, "0")}-${safePathSegment(event.title)}`,
    sequence: index + 1,
    title: event.title,
    summary: event.summary,
    sourceAnchors: event.sourceAnchors,
    citations: semantic.citations,
    provenance: request.semanticPath
  }));
  const timeline = {
    kind: "novelfabric.timeline.index",
    version: 1,
    mainBranch: "main",
    branches: [
      {
        id: "main",
        title: "Main Timeline",
        source: semantic.sourcePath,
        eventCount: events.length
      }
    ],
    events,
    updatedFrom: request.semanticPath,
    updatedAt: new Date().toISOString()
  } as const;
  const branch = {
    kind: "novelfabric.timeline.branch",
    version: 1,
    id: "main",
    title: "Main Timeline",
    source: semantic.sourcePath,
    events,
    citations: semantic.citations,
    provenance: request.semanticPath
  } as const;
  const writes = [
    await writeCanonicalText({
      workspacePath: request.workspacePath,
      actor: request.actor,
      path: "timeline/index.json",
      content: stableJson(timeline),
      reason: request.reason ?? "canonical timeline index materialize"
    }),
    await writeCanonicalText({
      workspacePath: request.workspacePath,
      actor: request.actor,
      path: "timeline/branches/main.json",
      content: stableJson(branch),
      reason: request.reason ?? "canonical timeline branch materialize"
    })
  ];
  return { semanticPath: request.semanticPath, writes };
}

export async function writeCanonicalSimulationLog(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sessionId: string;
  readonly turnPath: string;
  readonly turnHash: string;
  readonly summary: string;
  readonly reason?: string;
}): Promise<CanonicalWriteSummary> {
  const entry = {
    kind: "novelfabric.simulation.log-entry",
    version: 1,
    sessionId: request.sessionId,
    turnPath: request.turnPath,
    turnHash: request.turnHash,
    summary: request.summary,
    loggedAt: new Date().toISOString()
  } as const;
  return writeCanonicalText({
    workspacePath: request.workspacePath,
    actor: request.actor,
    path: `simulation/logs/${safePathSegment(request.sessionId)}.jsonl`,
    content: `${JSON.stringify(entry)}\n`,
    reason: request.reason ?? "canonical simulation log materialize",
    append: true
  });
}

export async function verifyCanonicalWorkflowCompleteness(request: {
  readonly workspacePath: string;
  readonly semanticPath: string;
  readonly completedStageIds: readonly string[];
  readonly requireAll?: boolean;
}): Promise<CanonicalVerifyResult> {
  const checked: string[] = [request.semanticPath];
  const issues: CanonicalVerifyIssue[] = [];
  const semantic = await readSemanticImportArtifact(request);
  const completed = new Set(request.completedStageIds);
  const requireAll = request.requireAll === true || completed.has("writing.review");
  const requireAfter = (stage: string): boolean => requireAll || completed.has(stage);
  if (requireAfter("cards.apply")) {
    await verifyCardCategory({
      workspacePath: request.workspacePath,
      kind: "character",
      semantic,
      checked,
      issues,
      titleCandidates: semantic.characters.map((character) => character.name)
    });
    for (const kind of ["world", "scene"] as const) {
      await verifyCardCategory({
        workspacePath: request.workspacePath,
        kind,
        semantic,
        checked,
        issues
      });
    }
    if (semanticHasRuleEvidence(semantic)) {
      await verifyCardCategory({
        workspacePath: request.workspacePath,
        kind: "rule",
        semantic,
        checked,
        issues
      });
    }
  }
  if (requireAfter("memory.materialize")) {
    await verifyAnyMarkdown({
      workspacePath: request.workspacePath,
      bases: ["memory/global", "memory/chapters", "memory/agents"],
      code: "canonical_memory_missing",
      minChars: MEMORY_QUALITY_MIN_CHARS,
      semantic,
      checked,
      issues
    });
  }
  if (requireAfter("timeline.materialize")) {
    await verifyTimeline({ workspacePath: request.workspacePath, semantic, checked, issues });
  }
  if (requireAfter("swarm.task.create")) {
    await verifySimulationResources({ workspacePath: request.workspacePath, checked, issues });
  }
  if (requireAfter("writing.apply")) {
    await verifyAnyMarkdown({
      workspacePath: request.workspacePath,
      bases: ["writing/chapters"],
      code: "canonical_chapter_missing",
      minChars: CHAPTER_QUALITY_MIN_CHARS,
      semantic,
      checked,
      issues,
      allowDeclaredSourceAnchors: true
    });
  }
  return { valid: issues.every((issue) => issue.severity !== "error"), checked, issues };
}

function cardKindFromSeed(seed: SemanticImportCardSeed): CanonicalCardKind {
  if (seed.kind === "character") return "character";
  if (seed.kind === "scene" || seed.kind === "plot") return "scene";
  if (seed.kind === "world") return "world";
  const text = `${seed.title}\n${seed.summary}\n${seed.sourceAnchors.join("\n")}`;
  if (/规则|制度|约束|身份|党员|公安|不能|必须|权限|纪律|law|rule|constraint/iu.test(text)) {
    return "rule";
  }
  return "world";
}

function semanticHasRuleEvidence(semantic: NovelFabricSemanticImportArtifact): boolean {
  return [...semantic.cardSeeds, ...semantic.events].some((item) =>
    /规则|制度|约束|身份|党员|公安|不能|必须|权限|纪律|law|rule|constraint/iu.test(
      `${item.title}\n${item.summary}\n${item.sourceAnchors.join("\n")}`
    )
  );
}

function ensureCardDraftQuality(draft: CanonicalCardDraft): CanonicalCardDraft {
  const summary = draft.summary.trim();
  if (summary.length < 12) {
    throw new CommandFailure(
      "canonical_card_quality_failed",
      `Card '${draft.title}' summary is too short to be materialized.`
    );
  }
  if (draft.sourceAnchors.length === 0 || draft.citations.length === 0) {
    throw new CommandFailure(
      "canonical_card_quality_failed",
      `Card '${draft.title}' requires source anchors and citations.`
    );
  }
  return draft;
}

function renderMemoryMarkdown(request: {
  readonly title: string;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly anchors: readonly string[];
  readonly citations: readonly CanonicalCitation[];
  readonly provenance: string;
}): string {
  const facts = request.facts.length > 0 ? request.facts : [request.summary];
  return `${[
    `# ${request.title}`,
    "",
    "## Summary",
    request.summary,
    "",
    "## Facts",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "## Source Anchors",
    ...nonEmptyUnique(request.anchors).map((anchor) => `- ${anchor}`),
    "",
    "## Citations",
    ...request.citations.map((citation) =>
      citation.hash === undefined ? `- ${citation.path}` : `- ${citation.path} @ ${citation.hash}`
    ),
    "",
    "## Provenance",
    `- semantic: ${request.provenance}`
  ].join("\n")}\n`;
}

async function verifyCardCategory(request: {
  readonly workspacePath: string;
  readonly kind: CanonicalCardKind;
  readonly semantic: NovelFabricSemanticImportArtifact;
  readonly checked: string[];
  readonly issues: CanonicalVerifyIssue[];
  readonly titleCandidates?: readonly string[];
}): Promise<void> {
  const paths = await listFiles(request.workspacePath, cardKindDirectory(request.kind), [".md"]);
  request.checked.push(...paths);
  if (paths.length === 0) {
    request.issues.push({
      severity: "error",
      code: `canonical_${request.kind}_card_missing`,
      path: cardKindDirectory(request.kind),
      message: `Expected at least one ${request.kind} card from semantic evidence.`
    });
    return;
  }
  const contents = await Promise.all(
    paths.map(async (cardPath) =>
      readWorkspaceFile({ workspacePath: request.workspacePath, path: cardPath })
    )
  );
  const combined = contents.map((read) => read.content).join("\n");
  if (
    request.titleCandidates !== undefined &&
    !request.titleCandidates.some((title) => combined.includes(title))
  ) {
    request.issues.push({
      severity: "error",
      code: "canonical_character_identity_missing",
      path: cardKindDirectory(request.kind),
      message:
        "Character cards must use extracted semantic character identities, not workflow role titles."
    });
  }
  for (const read of contents) {
    assertContentQuality({
      content: read.content,
      path: read.path,
      minChars: CARD_QUALITY_MIN_CHARS,
      semantic: request.semantic,
      issues: request.issues
    });
  }
}

async function verifyAnyMarkdown(request: {
  readonly workspacePath: string;
  readonly bases: readonly string[];
  readonly code: string;
  readonly minChars: number;
  readonly semantic: NovelFabricSemanticImportArtifact;
  readonly checked: string[];
  readonly issues: CanonicalVerifyIssue[];
  readonly allowDeclaredSourceAnchors?: boolean;
}): Promise<void> {
  const paths = (
    await Promise.all(request.bases.map((base) => listFiles(request.workspacePath, base, [".md"])))
  ).flat();
  request.checked.push(...paths);
  if (paths.length === 0) {
    request.issues.push({
      severity: "error",
      code: request.code,
      path: request.bases.join(","),
      message: `Expected canonical markdown resources under ${request.bases.join(", ")}.`
    });
    return;
  }
  for (const filePath of paths) {
    const read = await readWorkspaceFile({ workspacePath: request.workspacePath, path: filePath });
    assertContentQuality({
      content: read.content,
      path: read.path,
      minChars: request.minChars,
      semantic: request.semantic,
      issues: request.issues,
      ...(request.allowDeclaredSourceAnchors === undefined
        ? {}
        : { allowDeclaredSourceAnchors: request.allowDeclaredSourceAnchors })
    });
    if (request.allowDeclaredSourceAnchors === true) {
      await validateDeclaredChapterEvidence({
        workspacePath: request.workspacePath,
        content: read.content,
        path: read.path,
        issues: request.issues
      });
    }
  }
}

async function verifySimulationResources(request: {
  readonly workspacePath: string;
  readonly checked: string[];
  readonly issues: CanonicalVerifyIssue[];
}): Promise<void> {
  const turnPaths = await listFiles(request.workspacePath, "simulation/turns", [".json"]);
  const logPaths = await listFiles(request.workspacePath, "simulation/logs", [".jsonl", ".json"]);
  request.checked.push(...turnPaths, ...logPaths);
  if (turnPaths.length === 0) {
    request.issues.push({
      severity: "error",
      code: "canonical_simulation_turn_missing",
      path: "simulation/turns",
      message: "Expected at least one canonical simulation turn."
    });
  }
  if (logPaths.length === 0) {
    request.issues.push({
      severity: "error",
      code: "canonical_simulation_log_missing",
      path: "simulation/logs",
      message: "Expected at least one canonical simulation log."
    });
  }
  const validTurnHashes = new Map<string, string>();
  for (const turnPath of turnPaths) {
    const read = await readWorkspaceFile({ workspacePath: request.workspacePath, path: turnPath });
    validTurnHashes.set(read.path, read.hash);
    const turn = parseJsonObject(read.content, read.path);
    if (turn["schemaVersion"] !== "novelfabric.simulation.turn.v1") {
      request.issues.push({
        severity: "error",
        code: "canonical_simulation_turn_invalid",
        path: read.path,
        message: "Simulation turn must use novelfabric.simulation.turn.v1."
      });
    }
    for (const field of [
      "sessionId",
      "agent",
      "stage",
      "summary",
      "proposalPath",
      "appendedBy"
    ] as const) {
      if (typeof turn[field] !== "string" || turn[field].trim().length === 0) {
        request.issues.push({
          severity: "error",
          code: "canonical_simulation_turn_missing_field",
          path: read.path,
          message: `Simulation turn must include non-empty '${field}'.`
        });
      }
    }
    const action = turn["action"];
    if (
      !isRecord(action) ||
      typeof action["text"] !== "string" ||
      action["text"].trim().length < 12
    ) {
      request.issues.push({
        severity: "error",
        code: "canonical_simulation_turn_missing_action",
        path: read.path,
        message: "Simulation turn must include a substantive action decision."
      });
    }
    for (const field of ["citations", "evidence"] as const) {
      const values = turn[field];
      if (
        !Array.isArray(values) ||
        !values.some((item) => typeof item === "string" && item.length > 0)
      ) {
        request.issues.push({
          severity: "error",
          code: "canonical_simulation_turn_missing_evidence",
          path: read.path,
          message: `Simulation turn must include non-empty ${field}.`
        });
      }
    }
  }
  for (const logPath of logPaths) {
    const read = await readWorkspaceFile({ workspacePath: request.workspacePath, path: logPath });
    for (const line of read.content.split(/\r?\n/u).filter((item) => item.trim().length > 0)) {
      const entry = parseJsonObject(line, read.path);
      if (entry["kind"] !== "novelfabric.simulation.log-entry") {
        request.issues.push({
          severity: "error",
          code: "canonical_simulation_log_invalid",
          path: read.path,
          message: "Simulation log entries must use novelfabric.simulation.log-entry."
        });
        continue;
      }
      const turnPath = entry["turnPath"];
      const turnHash = entry["turnHash"];
      if (typeof turnPath !== "string" || typeof turnHash !== "string") {
        request.issues.push({
          severity: "error",
          code: "canonical_simulation_log_missing_turn_ref",
          path: read.path,
          message: "Simulation log entry must include turnPath and turnHash."
        });
        continue;
      }
      if (validTurnHashes.get(turnPath) !== turnHash) {
        request.issues.push({
          severity: "error",
          code: "canonical_simulation_log_turn_hash_mismatch",
          path: read.path,
          message: `Simulation log entry does not match turn hash for '${turnPath}'.`
        });
      }
    }
  }
}

async function validateDeclaredChapterEvidence(request: {
  readonly workspacePath: string;
  readonly content: string;
  readonly path: string;
  readonly issues: CanonicalVerifyIssue[];
}): Promise<void> {
  const citations = declaredCitations(request.content);
  if (citations.length === 0) {
    request.issues.push({
      severity: "error",
      code: "canonical_chapter_citations_missing",
      path: request.path,
      message: "Chapter must include declared citations with workspace paths and hashes."
    });
    return;
  }
  for (const citation of citations) {
    try {
      const read = await readWorkspaceFile({
        workspacePath: request.workspacePath,
        path: citation.path
      });
      if (citation.hash !== read.hash) {
        request.issues.push({
          severity: "error",
          code: "canonical_chapter_citation_hash_mismatch",
          path: request.path,
          message: `Chapter citation '${citation.path}' has stale hash '${citation.hash}'.`
        });
      }
    } catch (error) {
      request.issues.push({
        severity: "error",
        code: "canonical_chapter_citation_unreadable",
        path: request.path,
        message:
          error instanceof Error
            ? error.message
            : `Chapter citation '${citation.path}' is unreadable.`
      });
    }
  }
}

function declaredCitations(
  content: string
): readonly { readonly path: string; readonly hash: string }[] {
  const match = /## Citations\s+([\s\S]*?)(?:\n## |\n---|$)/iu.exec(content);
  if (match?.[1] === undefined) return [];
  return match[1]
    .split(/\r?\n/u)
    .map((line) => /^-\s+(.+?)\s+@\s+(sha256:[a-f0-9]{64})\s*$/iu.exec(line.trim()))
    .filter((matchValue): matchValue is RegExpExecArray => matchValue !== null)
    .map((matchValue) => ({ path: matchValue[1] ?? "", hash: matchValue[2] ?? "" }))
    .filter((citation) => citation.path.length > 0 && citation.hash.length > 0);
}

async function verifyTimeline(request: {
  readonly workspacePath: string;
  readonly semantic: NovelFabricSemanticImportArtifact;
  readonly checked: string[];
  readonly issues: CanonicalVerifyIssue[];
}): Promise<void> {
  const paths = [
    "timeline/index.json",
    ...(await listFiles(request.workspacePath, "timeline/branches", [".json"]))
  ];
  request.checked.push(...paths);
  try {
    const read = await readWorkspaceFile({
      workspacePath: request.workspacePath,
      path: "timeline/index.json"
    });
    const parsed = parseJsonObject(read.content, read.path);
    const events = parsed["events"];
    if (!Array.isArray(events) || events.length === 0) {
      request.issues.push({
        severity: "error",
        code: "canonical_timeline_empty",
        path: read.path,
        message: "timeline/index.json must contain semantic event entries."
      });
    }
    assertContentQuality({
      content: read.content,
      path: read.path,
      minChars: 80,
      semantic: request.semantic,
      issues: request.issues
    });
  } catch (error) {
    request.issues.push({
      severity: "error",
      code: "canonical_timeline_missing",
      path: "timeline/index.json",
      message: error instanceof Error ? error.message : "timeline/index.json is unreadable."
    });
  }
}

function hasDeclaredCitation(content: string): boolean {
  const match = /## Citations\s+([\s\S]*?)(?:\n## |\n---|$)/iu.exec(content);
  if (match?.[1] === undefined) return false;
  return match[1].split(/\r?\n/u).some((line) => /^-\s*\S.{1,}/u.test(line.trim()));
}

function hasDeclaredSourceAnchor(content: string): boolean {
  const match = /## Source Anchors\s+([\s\S]*?)(?:\n## |\n---|$)/iu.exec(content);
  if (match?.[1] === undefined) return false;
  return match[1].split(/\r?\n/u).some((line) => /^-\s*\S.{1,}/u.test(line.trim()));
}

function assertContentQuality(request: {
  readonly content: string;
  readonly path: string;
  readonly minChars: number;
  readonly semantic: NovelFabricSemanticImportArtifact;
  readonly issues: CanonicalVerifyIssue[];
  readonly allowDeclaredSourceAnchors?: boolean;
}): void {
  const trimmed = request.content.trim();
  if (trimmed.length < request.minChars) {
    request.issues.push({
      severity: "error",
      code: "canonical_content_too_short",
      path: request.path,
      message: `Canonical content is too short in '${request.path}'.`
    });
  }
  if (TEMPLATE_PATTERN.test(trimmed.toLocaleLowerCase())) {
    request.issues.push({
      severity: "error",
      code: "canonical_content_template_shell",
      path: request.path,
      message: `Canonical content '${request.path}' appears to be a template or generic role card.`
    });
  }
  const hasAnchor =
    request.semantic.sourceAnchors.some(
      (anchor) => anchor.length > 0 && trimmed.includes(anchor)
    ) ||
    (request.allowDeclaredSourceAnchors === true && hasDeclaredSourceAnchor(trimmed));
  const hasCitation =
    request.semantic.citations.some((citation) => trimmed.includes(citation.path)) ||
    (request.allowDeclaredSourceAnchors === true && hasDeclaredCitation(trimmed));
  if (!hasAnchor || !hasCitation) {
    request.issues.push({
      severity: "error",
      code: "canonical_content_missing_evidence",
      path: request.path,
      message: `Canonical content '${request.path}' must include source anchors and citations.`
    });
  }
}

async function listFiles(
  workspacePath: string,
  base: string,
  suffixes: readonly string[]
): Promise<readonly string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(workspacePath);
  const start = path.resolve(root, base);
  if (!start.startsWith(root)) return [];
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix))) {
        result.push(path.relative(root, absolute).replaceAll(path.sep, "/"));
      }
    }
  }
  await walk(start);
  return result.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

async function writeCanonicalText(request: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly path: string;
  readonly content: string;
  readonly reason: string;
  readonly append?: boolean;
}): Promise<CanonicalWriteSummary> {
  if (request.append === true) {
    const write = await appendWorkspaceFile({
      workspacePath: request.workspacePath,
      path: request.path,
      content: request.content,
      actor: request.actor,
      reason: request.reason
    });
    return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
  }
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: request.path,
    content: request.content,
    actor: request.actor,
    reason: request.reason
  });
  return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
}

function dedupeCardDrafts(drafts: readonly CanonicalCardDraft[]): readonly CanonicalCardDraft[] {
  const byKind = new Map<CanonicalCardKind, CanonicalCardDraft[]>();
  for (const draft of drafts) {
    const existing = byKind.get(draft.kind) ?? [];
    existing.push(draft);
    byKind.set(draft.kind, existing);
  }
  const output: CanonicalCardDraft[] = [];
  for (const [, group] of byKind) {
    const kept: CanonicalCardDraft[] = [];
    for (const candidate of group) {
      const dominated = kept.some(
        (existing) =>
          existing.title.includes(candidate.title) || candidate.title.includes(existing.title)
      );
      if (!dominated) {
        kept.push(candidate);
      } else {
        const shorterIdx = kept.findIndex(
          (existing) =>
            candidate.title.includes(existing.title) &&
            candidate.title.length < existing.title.length
        );
        if (shorterIdx >= 0) {
          kept[shorterIdx] = candidate;
        }
      }
    }
    output.push(...kept);
  }
  return output;
}

function sourceTitle(sourcePath: string): string {
  return (
    sourcePath
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/u, "") ?? "source"
  );
}

function safePathSegment(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe.length === 0 ? "resource" : safe;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonObject(content: string, filePath: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new CommandFailure(
      "invalid_json_artifact",
      `Invalid JSON in '${filePath}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(parsed)) {
    throw new CommandFailure(
      "invalid_json_artifact",
      `Expected '${filePath}' to contain an object.`
    );
  }
  return parsed;
}

function isSemanticImportArtifact(value: unknown): value is NovelFabricSemanticImportArtifact {
  return (
    isRecord(value) &&
    value["kind"] === "novelfabric.import.semantic" &&
    value["version"] === 1 &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceHash"] === "string" &&
    typeof value["contextPackPath"] === "string" &&
    typeof value["contextPackHash"] === "string" &&
    typeof value["summary"] === "string" &&
    Array.isArray(value["chapters"]) &&
    Array.isArray(value["characters"]) &&
    Array.isArray(value["events"]) &&
    Array.isArray(value["cardSeeds"]) &&
    Array.isArray(value["sourceAnchors"]) &&
    Array.isArray(value["citations"])
  );
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some((item) => right.includes(item));
}

function nonEmptyUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
