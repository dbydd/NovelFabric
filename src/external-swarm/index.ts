import { createHash } from "node:crypto";

import { CommandFailure } from "../errors.js";
import { requireCapability, readCapabilityManifest } from "../workspace/capabilities.js";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace/files.js";
import { stableJson } from "../simulation/index.js";

const MAX_ROUNDS = 3;
const MAX_ITEMS = 24;
const CONTENT_PREVIEW_CHARS = 900;
const EXTERNAL_SWARM_CAPABILITY = "external_swarm.run";
const PROJECTS_DIR = "projects";
const GLOBAL_EXTERNAL_DIR = "external";
const ROLE_IDS = [
  "entity-analyst",
  "world-context-analyst",
  "impact-analyst",
  "risk-auditor"
] as const;

export type ExternalSwarmInferenceRequest = {
  readonly client_request_id?: string;
  readonly domain: string;
  readonly title: string;
  readonly summary: string;
  readonly items: readonly ExternalSwarmItem[];
  readonly questions: readonly string[];
  readonly context?: ExternalSwarmContext;
  readonly rounds?: number;
};

export type ExternalSwarmItem = {
  readonly id?: string;
  readonly title: string;
  readonly content: string;
  readonly published_at?: string;
  readonly source?: string;
  readonly url?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type ExternalSwarmContext = {
  readonly entity_cards?: readonly ExternalEntityCard[];
  readonly background?: string;
  readonly worldview?: string;
  readonly research_notes?: readonly string[];
};

export type ExternalEntityCard = {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly summary: string;
  readonly evidence?: readonly string[];
};

export type ExternalContextRequirement = {
  readonly key: string;
  readonly label: string;
  readonly question: string;
  readonly required: boolean;
  readonly suggested_sources: readonly string[];
};

export type ExternalContextRequirementsResponse = {
  readonly domain: string;
  readonly title: string;
  readonly requirements: readonly ExternalContextRequirement[];
  readonly missing_required_keys: readonly string[];
  readonly is_ready: boolean;
};

export type ExternalSwarmInferenceResponse = {
  readonly inference_id: string;
  readonly project_slug: string;
  readonly session_id: string;
  readonly domain: string;
  readonly title: string;
  readonly rounds_completed: number;
  readonly item_count: number;
  readonly artifact_paths: ExternalSwarmArtifacts;
  readonly summary_markdown: string;
  readonly context_requirements: ExternalContextRequirementsResponse;
  readonly role_reasoning: readonly ExternalRoleReasoning[];
};

export type ExternalSwarmArtifacts = {
  readonly manifest: string;
  readonly report: string;
  readonly input_items: readonly string[];
  readonly session: string;
  readonly swarm_rounds: readonly string[];
  readonly context: string | null;
  readonly role_reasoning: readonly string[];
};

export type ExternalRoleReasoning = {
  readonly role: string;
  readonly model: string | null;
  readonly status: string;
  readonly output_path: string;
  readonly summary: string;
};

export type ExternalSwarmInferRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly request: ExternalSwarmInferenceRequest;
  readonly reason?: string;
};

export type ExternalSwarmGetRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly inferenceId: string;
};

export type ExternalSwarmValidateRequest = ExternalSwarmGetRequest;

export type ExternalSwarmValidationResult = {
  readonly valid: boolean;
  readonly inference_id: string;
  readonly artifact_paths?: ExternalSwarmArtifacts;
  readonly issues: readonly ExternalSwarmValidationIssue[];
};

export type ExternalSwarmValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
};

export type ExternalSwarmMcpResult<TStructuredContent> = {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly structuredContent: TStructuredContent;
};

type ExternalSwarmManifest = {
  readonly response: ExternalSwarmInferenceResponse;
  readonly client_request_id: string | null;
  readonly questions: readonly string[];
};

type NormalizedExternalSwarmRequest = Required<
  Omit<ExternalSwarmInferenceRequest, "client_request_id" | "context">
> & {
  readonly client_request_id: string | null;
  readonly context: ExternalSwarmContext | null;
};

type InputArtifact = {
  readonly characterId: string;
  readonly path: string;
  readonly title: string;
  readonly content: string;
};

export async function createOrGetExternalSwarmInference(
  request: ExternalSwarmInferRequest
): Promise<ExternalSwarmInferenceResponse> {
  await requireExternalSwarmCapability(request.workspacePath, request.actor);
  const normalizedRequest = normalizeExternalSwarmRequest(request.request);
  validateExternalSwarmRequest(normalizedRequest);
  const inferenceId = buildExternalSwarmInferenceIdForNormalized(normalizedRequest);
  const existing = await tryReadExternalSwarmManifest(request.workspacePath, inferenceId);
  if (existing !== null) return existing.response;

  const projectSlug = `external-${slugify(normalizedRequest.domain)}`;
  const contextRequirements =
    analyzeExternalSwarmContextRequirementsForNormalized(normalizedRequest);
  const itemArtifacts = await writeInputItems({
    workspacePath: request.workspacePath,
    actor: request.actor,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    projectSlug,
    inferenceId,
    items: normalizedRequest.items
  });
  const contextPath = await writeWorkspaceTextArtifact({
    workspacePath: request.workspacePath,
    actor: request.actor,
    reason: request.reason ?? "external swarm context write",
    path: projectContextPath(projectSlug, inferenceId),
    content: renderContextMarkdown(normalizedRequest, contextRequirements)
  });
  const roleReasoning = await writeRoleReasoning({
    workspacePath: request.workspacePath,
    actor: request.actor,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    projectSlug,
    inferenceId,
    request: normalizedRequest,
    artifacts: itemArtifacts,
    requirements: contextRequirements
  });
  const sessionId = inferenceId;
  const swarmRoundPaths = await writeSwarmRounds({
    workspacePath: request.workspacePath,
    actor: request.actor,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    projectSlug,
    sessionId,
    request: normalizedRequest,
    artifacts: itemArtifacts
  });
  const sessionPath = await writeWorkspaceTextArtifact({
    workspacePath: request.workspacePath,
    actor: request.actor,
    reason: request.reason ?? "external swarm session write",
    path: projectSessionPath(projectSlug, sessionId),
    content: stableJson({
      schemaVersion: "novelfabric.external-swarm.session.v1",
      session_id: sessionId,
      project_slug: projectSlug,
      domain: normalizedRequest.domain,
      title: normalizedRequest.title,
      status: "deterministic_compatibility_wrapper",
      rounds_completed: normalizedRequest.rounds,
      item_artifacts: itemArtifacts.map((artifact) => artifact.path),
      swarm_rounds: swarmRoundPaths
    })
  });
  const reportPath = projectReportPath(projectSlug, inferenceId);
  const summaryMarkdown = renderReport(normalizedRequest, itemArtifacts, swarmRoundPaths);
  await writeWorkspaceTextArtifact({
    workspacePath: request.workspacePath,
    actor: request.actor,
    reason: request.reason ?? "external swarm report write",
    path: reportPath,
    content: summaryMarkdown
  });

  const manifestPath = projectManifestPath(projectSlug, inferenceId);
  const response: ExternalSwarmInferenceResponse = {
    inference_id: inferenceId,
    project_slug: projectSlug,
    session_id: sessionId,
    domain: normalizedRequest.domain,
    title: normalizedRequest.title,
    rounds_completed: normalizedRequest.rounds,
    item_count: normalizedRequest.items.length,
    artifact_paths: {
      manifest: manifestPath,
      report: reportPath,
      input_items: itemArtifacts.map((artifact) => artifact.path),
      session: sessionPath,
      swarm_rounds: swarmRoundPaths,
      context: contextPath,
      role_reasoning: roleReasoning.map((reasoning) => reasoning.output_path)
    },
    summary_markdown: summaryMarkdown,
    context_requirements: contextRequirements,
    role_reasoning: roleReasoning
  };
  const manifest: ExternalSwarmManifest = {
    response,
    client_request_id: normalizedRequest.client_request_id,
    questions: normalizedRequest.questions
  };
  await writeWorkspaceTextArtifact({
    workspacePath: request.workspacePath,
    actor: request.actor,
    reason: request.reason ?? "external swarm project manifest write",
    path: manifestPath,
    content: stableJson(manifest)
  });
  await writeWorkspaceTextArtifact({
    workspacePath: request.workspacePath,
    actor: request.actor,
    reason: request.reason ?? "external swarm global manifest write",
    path: globalManifestPath(inferenceId),
    content: stableJson(manifest)
  });
  return response;
}

export async function getExternalSwarmInference(
  request: ExternalSwarmGetRequest
): Promise<ExternalSwarmInferenceResponse> {
  await requireExternalSwarmCapability(request.workspacePath, request.actor);
  const manifest = await tryReadExternalSwarmManifest(request.workspacePath, request.inferenceId);
  if (manifest === null) {
    throw new CommandFailure(
      "external_swarm_not_found",
      `External swarm inference '${request.inferenceId}' was not found.`
    );
  }
  return manifest.response;
}

export async function requireExternalSwarmContext(
  request: ExternalSwarmInferRequest
): Promise<ExternalContextRequirementsResponse> {
  await requireExternalSwarmCapability(request.workspacePath, request.actor);
  const normalizedRequest = normalizeExternalSwarmRequest(request.request);
  validateExternalSwarmRequest(normalizedRequest);
  return analyzeExternalSwarmContextRequirementsForNormalized(normalizedRequest);
}

export async function validateExternalSwarmInference(
  request: ExternalSwarmValidateRequest
): Promise<ExternalSwarmValidationResult> {
  await requireExternalSwarmCapability(request.workspacePath, request.actor);
  const issues: ExternalSwarmValidationIssue[] = [];
  const manifest = await tryReadExternalSwarmManifest(request.workspacePath, request.inferenceId);
  if (manifest === null) {
    return {
      valid: false,
      inference_id: request.inferenceId,
      issues: [
        {
          code: "external_swarm_not_found",
          message: `External swarm inference '${request.inferenceId}' was not found.`
        }
      ]
    };
  }
  const artifactPaths = manifest.response.artifact_paths;
  for (const artifactPath of requiredArtifactPaths(artifactPaths)) {
    try {
      await readWorkspaceFile({ workspacePath: request.workspacePath, path: artifactPath });
    } catch (error) {
      issues.push({
        code: "external_swarm_artifact_missing",
        message: error instanceof Error ? error.message : "External swarm artifact is missing.",
        path: artifactPath
      });
    }
  }
  return {
    valid: issues.length === 0,
    inference_id: request.inferenceId,
    artifact_paths: artifactPaths,
    issues
  };
}

export function toMcpStructuredResult<TStructuredContent>(
  structuredContent: TStructuredContent
): ExternalSwarmMcpResult<TStructuredContent> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

export function buildExternalSwarmInferenceId(request: ExternalSwarmInferenceRequest): string {
  const normalizedRequest = normalizeExternalSwarmRequest(request);
  return buildExternalSwarmInferenceIdForNormalized(normalizedRequest);
}

function buildExternalSwarmInferenceIdForNormalized(
  normalizedRequest: NormalizedExternalSwarmRequest
): string {
  if (normalizedRequest.client_request_id !== null) {
    const slug = slugify(normalizedRequest.client_request_id);
    const hash = stableHash(`${normalizedRequest.domain}:${normalizedRequest.client_request_id}`);
    return `external-${slug}-${hash}`;
  }
  const slug = slugify(normalizedRequest.title);
  const hash = stableHash(JSON.stringify(normalizedRequest));
  return `external-${slug}-${hash}`;
}

export function analyzeExternalSwarmContextRequirements(
  request: ExternalSwarmInferenceRequest
): ExternalContextRequirementsResponse {
  return analyzeExternalSwarmContextRequirementsForNormalized(
    normalizeExternalSwarmRequest(request)
  );
}

function analyzeExternalSwarmContextRequirementsForNormalized(
  normalizedRequest: NormalizedExternalSwarmRequest
): ExternalContextRequirementsResponse {
  const context = normalizedRequest.context;
  const hasEntityCards = (context?.entity_cards ?? []).length > 0;
  const hasBackground = (context?.background ?? "").trim().length > 0;
  const hasWorldview = (context?.worldview ?? "").trim().length > 0;
  const hasResearchNotes = (context?.research_notes ?? []).length > 0;
  const requirements = [
    {
      key: "entity_cards",
      label: "人物/公司/组织卡",
      question:
        "请提供这次推演涉及的公司、人物、组织或资产卡：它是谁、业务/角色、利益暴露、已知风险、证据来源。",
      required: true,
      suggested_sources: ["OpenAlice market/news tools", "company filings or profile tools"]
    },
    {
      key: "background",
      label: "背景设定",
      question:
        "请提供主体 agent 查到的背景设定：为什么这些材料要放在同一场景里推演、近期上下文、关键因果假设。",
      required: true,
      suggested_sources: ["OpenAlice news archive", "market data context"]
    },
    {
      key: "worldview",
      label: "世界观/市场机制",
      question:
        "请提供推演世界观：市场机制、政策/地缘/行业约束、哪些规则在这个场景里必须保持一致。",
      required: false,
      suggested_sources: ["Alice macro/economy tools", "agent research notes"]
    },
    {
      key: "research_notes",
      label: "主体 agent 研究笔记",
      question: "请提供主体 agent 已经整理的研究笔记、疑点、需要 NovelFabric 重点检验的假设。",
      required: false,
      suggested_sources: ["workspace markdown notes", "inbox/user instructions"]
    }
  ].filter((requirement) => {
    if (requirement.key === "entity_cards") return !hasEntityCards;
    if (requirement.key === "background") return !hasBackground;
    if (requirement.key === "worldview") return !hasWorldview;
    if (requirement.key === "research_notes") return !hasResearchNotes;
    return true;
  });
  const missingRequiredKeys = requirements
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.key);
  return {
    domain: normalizedRequest.domain,
    title: normalizedRequest.title,
    requirements,
    missing_required_keys: missingRequiredKeys,
    is_ready: missingRequiredKeys.length === 0
  };
}

function normalizeExternalSwarmRequest(
  request: ExternalSwarmInferenceRequest
): NormalizedExternalSwarmRequest {
  return {
    client_request_id: optionalTrimmed(request.client_request_id),
    domain: request.domain,
    title: request.title,
    summary: request.summary,
    items: request.items.map((item) => ({ ...item, metadata: item.metadata ?? {} })),
    questions: [...request.questions],
    context: request.context ?? null,
    rounds: request.rounds ?? 1
  };
}

function validateExternalSwarmRequest(request: NormalizedExternalSwarmRequest): void {
  if (request.domain.trim().length === 0) {
    throw new CommandFailure("invalid_external_swarm_request", "domain must not be empty.");
  }
  if (request.title.trim().length === 0) {
    throw new CommandFailure("invalid_external_swarm_request", "title must not be empty.");
  }
  if (request.summary.trim().length === 0) {
    throw new CommandFailure("invalid_external_swarm_request", "summary must not be empty.");
  }
  if (request.items.length === 0 || request.items.length > MAX_ITEMS) {
    throw new CommandFailure(
      "invalid_external_swarm_request",
      `items length must be between 1 and ${MAX_ITEMS.toString()}.`
    );
  }
  if (request.questions.length === 0) {
    throw new CommandFailure("invalid_external_swarm_request", "questions must not be empty.");
  }
  if (!Number.isInteger(request.rounds) || request.rounds < 1 || request.rounds > MAX_ROUNDS) {
    throw new CommandFailure(
      "invalid_external_swarm_request",
      `rounds must be between 1 and ${MAX_ROUNDS.toString()}.`
    );
  }
  for (const item of request.items) {
    if (item.title.trim().length === 0 || item.content.trim().length === 0) {
      throw new CommandFailure(
        "invalid_external_swarm_request",
        "each item requires title and content."
      );
    }
  }
}

async function requireExternalSwarmCapability(workspacePath: string, actor: string): Promise<void> {
  const manifest = await readCapabilityManifest(workspacePath);
  requireCapability(manifest, actor, EXTERNAL_SWARM_CAPABILITY);
}

async function tryReadExternalSwarmManifest(
  workspacePath: string,
  inferenceId: string
): Promise<ExternalSwarmManifest | null> {
  try {
    const read = await readWorkspaceFile({ workspacePath, path: globalManifestPath(inferenceId) });
    const parsed = JSON.parse(read.content) as unknown;
    return parseExternalSwarmManifest(parsed, read.path);
  } catch (error) {
    if (error instanceof CommandFailure && error.code === "invalid_external_swarm_manifest") {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new CommandFailure(
        "invalid_external_swarm_manifest",
        `External swarm manifest '${globalManifestPath(inferenceId)}' is not valid JSON.`
      );
    }
    return null;
  }
}

function parseExternalSwarmManifest(value: unknown, artifactPath: string): ExternalSwarmManifest {
  if (!isRecord(value) || !isRecord(value["response"])) {
    throw new CommandFailure(
      "invalid_external_swarm_manifest",
      `External swarm manifest '${artifactPath}' must contain a response object.`
    );
  }
  return value as ExternalSwarmManifest;
}

async function writeInputItems(input: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly reason?: string;
  readonly projectSlug: string;
  readonly inferenceId: string;
  readonly items: readonly ExternalSwarmItem[];
}): Promise<readonly InputArtifact[]> {
  const artifacts: InputArtifact[] = [];
  for (const [index, item] of input.items.entries()) {
    const itemSlug = uniqueItemSlug(index, item.id ?? item.title);
    const outputPath = projectItemPath(input.projectSlug, input.inferenceId, itemSlug);
    const write = await writeWorkspaceTextArtifact({
      workspacePath: input.workspacePath,
      actor: input.actor,
      reason: input.reason ?? "external swarm input item write",
      path: outputPath,
      content: renderItemMarkdown(index, item)
    });
    artifacts.push({
      characterId: `item-${(index + 1).toString().padStart(3, "0")}`,
      path: write,
      title: item.title,
      content: item.content
    });
  }
  return artifacts;
}

async function writeRoleReasoning(input: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly reason?: string;
  readonly projectSlug: string;
  readonly inferenceId: string;
  readonly request: NormalizedExternalSwarmRequest;
  readonly artifacts: readonly InputArtifact[];
  readonly requirements: ExternalContextRequirementsResponse;
}): Promise<readonly ExternalRoleReasoning[]> {
  const outputs: ExternalRoleReasoning[] = [];
  for (const role of ROLE_IDS) {
    const summary = fallbackRoleReasoning(role, input.request, input.artifacts, input.requirements);
    const outputPath = projectRoleReasoningPath(input.projectSlug, input.inferenceId, role);
    const writtenPath = await writeWorkspaceTextArtifact({
      workspacePath: input.workspacePath,
      actor: input.actor,
      reason: input.reason ?? "external swarm role reasoning write",
      path: outputPath,
      content: renderRoleReasoningMarkdown(
        role,
        null,
        "pi_runtime_not_invoked_deterministic",
        summary
      )
    });
    outputs.push({
      role,
      model: null,
      status: "pi_runtime_not_invoked_deterministic",
      output_path: writtenPath,
      summary
    });
  }
  return outputs;
}

async function writeSwarmRounds(input: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly reason?: string;
  readonly projectSlug: string;
  readonly sessionId: string;
  readonly request: NormalizedExternalSwarmRequest;
  readonly artifacts: readonly InputArtifact[];
}): Promise<readonly string[]> {
  const paths: string[] = [];
  for (let round = 1; round <= input.request.rounds; round += 1) {
    const outputPath = projectSwarmRoundPath(input.projectSlug, input.sessionId, round);
    const writtenPath = await writeWorkspaceTextArtifact({
      workspacePath: input.workspacePath,
      actor: input.actor,
      reason: input.reason ?? "external swarm round write",
      path: outputPath,
      content: stableJson({
        schemaVersion: "novelfabric.external-swarm.round.v1",
        session_id: input.sessionId,
        round,
        order: ["characters", "random-event", "world-maintainer", "kp", "project-auditor"],
        status: "deterministic_compatibility_wrapper",
        character_actions: input.artifacts.map((artifact) => ({
          character_id: artifact.characterId,
          summary: `Source item '${artifact.title}' contributes evidence from ${artifact.path}. Content preview: ${preview(artifact.content, CONTENT_PREVIEW_CHARS)}.`
        })),
        system_directives: buildSystemDirectives(input.request, round)
      })
    });
    paths.push(writtenPath);
  }
  return paths;
}

async function writeWorkspaceTextArtifact(input: {
  readonly workspacePath: string;
  readonly actor: string;
  readonly reason: string;
  readonly path: string;
  readonly content: string;
}): Promise<string> {
  const write = await writeWorkspaceFile({
    workspacePath: input.workspacePath,
    path: input.path,
    content: input.content,
    actor: input.actor,
    reason: input.reason
  });
  return write.path;
}

function requiredArtifactPaths(artifacts: ExternalSwarmArtifacts): readonly string[] {
  return [
    artifacts.manifest,
    artifacts.report,
    ...artifacts.input_items,
    artifacts.session,
    ...artifacts.swarm_rounds,
    ...(artifacts.context === null ? [] : [artifacts.context]),
    ...artifacts.role_reasoning
  ];
}

function buildSystemDirectives(
  request: NormalizedExternalSwarmRequest,
  round: number
): Readonly<Record<string, string>> {
  const questions = request.questions.join(" | ");
  return {
    "random-event": `Round ${round.toString()}: infer plausible second-order developments for domain '${request.domain}'. Questions: ${questions}`,
    "world-maintainer": `Round ${round.toString()}: maintain cross-item consistency, source boundaries, and uncertainty notes for '${request.title}'.`,
    kp: "Adjudicate which effects are direct, indirect, uncertain, or unsupported; keep every claim tied to cited input artifacts.",
    "project-auditor":
      "Audit the inference for missing citations, overreach, duplicate evidence, and follow-up monitoring needs."
  };
}

function renderContextBlock(context: ExternalSwarmContext | null): string {
  if (context === null) return "No caller-provided context yet.";
  const lines: string[] = [];
  if ((context.entity_cards ?? []).length > 0) {
    lines.push("## Entity cards");
    for (const card of context.entity_cards ?? []) {
      lines.push(
        `- ${card.name} (${card.kind}, id=${card.id}): ${card.summary} Evidence: ${(card.evidence ?? []).join(", ")}`
      );
    }
  }
  if ((context.background ?? "").trim().length > 0) {
    lines.push("", "## Background", context.background ?? "");
  }
  if ((context.worldview ?? "").trim().length > 0) {
    lines.push("", "## Worldview", context.worldview ?? "");
  }
  if ((context.research_notes ?? []).length > 0) {
    lines.push(
      "",
      "## Research notes",
      ...(context.research_notes ?? []).map((note) => `- ${note}`)
    );
  }
  return lines.length === 0 ? "No caller-provided context yet." : lines.join("\n");
}

function renderContextMarkdown(
  request: NormalizedExternalSwarmRequest,
  requirements: ExternalContextRequirementsResponse
): string {
  const lines = [
    "# External inference context",
    "",
    `- Domain: \`${request.domain}\``,
    `- Title: ${request.title}`,
    `- Ready: ${requirements.is_ready.toString()}`,
    "",
    "## Provided context",
    "",
    renderContextBlock(request.context)
  ];
  if (requirements.requirements.length > 0) {
    lines.push("", "## Context NovelFabric asks the caller to provide");
    for (const requirement of requirements.requirements) {
      lines.push(`- **${requirement.label}** (\`${requirement.key}\`): ${requirement.question}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function fallbackRoleReasoning(
  role: string,
  request: NormalizedExternalSwarmRequest,
  artifacts: readonly InputArtifact[],
  requirements: ExternalContextRequirementsResponse
): string {
  const lines = [
    `# ${role} deterministic compatibility reasoning`,
    "",
    "No network, LLM, or provider was invoked by this CLI compatibility wrapper.",
    `Scenario: ${request.domain} / ${request.title}`,
    `Items considered: ${artifacts.length.toString()}`
  ];
  if (!requirements.is_ready) {
    lines.push("", "## Ask caller for more context");
    for (const requirement of requirements.requirements) {
      lines.push(`- ${requirement.label}: ${requirement.question}`);
    }
  }
  lines.push("", "## Evidence artifacts");
  for (const artifact of artifacts) {
    lines.push(`- \`${artifact.path}\` - ${artifact.title}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderRoleReasoningMarkdown(
  role: string,
  model: string | null,
  status: string,
  output: string
): string {
  return `# Role reasoning: ${role}\n\n- Status: \`${status}\`\n- Model: \`${model ?? "n/a"}\`\n\n${output}`;
}

function renderItemMarkdown(index: number, item: ExternalSwarmItem): string {
  const metadata = JSON.stringify(item.metadata ?? {}, null, 2);
  return `# Source item ${(index + 1).toString()}: ${item.title}\n\n- Source id: ${item.id ?? ""}\n- Source: ${item.source ?? ""}\n- Published at: ${item.published_at ?? ""}\n- URL: ${item.url ?? ""}\n\n## Content\n\n${item.content}\n\n## Metadata\n\n\`\`\`json\n${metadata}\n\`\`\`\n`;
}

function renderReport(
  request: NormalizedExternalSwarmRequest,
  artifacts: readonly InputArtifact[],
  swarmRounds: readonly string[]
): string {
  const requirements = analyzeExternalSwarmContextRequirementsForNormalized(request);
  const lines = [
    `# External Swarm Inference: ${request.title}`,
    "",
    `- Domain: \`${request.domain}\``,
    `- Items: ${artifacts.length.toString()}`,
    `- Rounds: ${request.rounds.toString()}`,
    "- Runtime: deterministic CLI compatibility wrapper; no network, LLM, or provider invoked.",
    "",
    "## Scenario summary",
    "",
    request.summary,
    "",
    "## Questions",
    "",
    ...request.questions.map((question) => `- ${question}`),
    "",
    "## Source artifacts"
  ];
  for (const artifact of artifacts) {
    lines.push(`- \`${artifact.path}\` - ${artifact.title}`);
  }
  lines.push("", "## Context status", "");
  if (requirements.is_ready) {
    lines.push("Provided context satisfies required NovelFabric context gates.");
  } else {
    lines.push("NovelFabric asks the caller for more context before trusting this inference:");
    for (const requirement of requirements.requirements) {
      lines.push(`- ${requirement.label}: ${requirement.question}`);
    }
  }
  lines.push("", "## Swarm rounds");
  for (const roundPath of swarmRounds) {
    lines.push(`- \`${roundPath}\``);
  }
  return `${lines.join("\n")}\n`;
}

function projectItemPath(projectSlug: string, inferenceId: string, itemSlug: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/external/items/${inferenceId}/${itemSlug}.md`;
}

function projectManifestPath(projectSlug: string, inferenceId: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/external/inferences/${inferenceId}.json`;
}

function projectReportPath(projectSlug: string, inferenceId: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/external/reports/${inferenceId}.md`;
}

function projectContextPath(projectSlug: string, inferenceId: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/external/context/${inferenceId}.md`;
}

function projectRoleReasoningPath(projectSlug: string, inferenceId: string, role: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/external/role-reasoning/${inferenceId}/${role}.md`;
}

function projectSessionPath(projectSlug: string, sessionId: string): string {
  return `${PROJECTS_DIR}/${projectSlug}/simulation/sessions/${sessionId}.json`;
}

function projectSwarmRoundPath(projectSlug: string, sessionId: string, round: number): string {
  return `${PROJECTS_DIR}/${projectSlug}/simulation/swarm/${sessionId}/round-${round.toString().padStart(4, "0")}.json`;
}

function globalManifestPath(inferenceId: string): string {
  return `${GLOBAL_EXTERNAL_DIR}/inferences/${inferenceId}.json`;
}

function uniqueItemSlug(index: number, value: string): string {
  return `${(index + 1).toString().padStart(3, "0")}-${slugify(value)}`;
}

function slugify(value: string): string {
  let slug = "";
  for (const character of value) {
    if (/^[a-z0-9]$/.test(character)) {
      slug += character;
    } else if (/^[A-Z]$/.test(character)) {
      slug += character.toLocaleLowerCase();
    } else if (!slug.endsWith("-")) {
      slug += "-";
    }
    if (slug.length >= 56) break;
  }
  const trimmed = slug.replace(/^-+|-+$/g, "");
  return trimmed.length === 0 ? "item" : trimmed;
}

function preview(value: string, maxChars: number): string {
  const output = value.slice(0, maxChars);
  return value.length > maxChars ? `${output}...` : output;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

function optionalTrimmed(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
