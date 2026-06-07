import { CommandFailure } from "../errors.js";
import type { JsonObject, JsonValue } from "../output.js";
import { readWorkspaceFile } from "../workspace/files.js";

export type CompletedAgentTaskDomainOutput = {
  readonly taskId: string;
  readonly resultPath: string;
  readonly resultHash: string;
  readonly summary: string;
  readonly citations: readonly string[];
  readonly sourceAnchors: readonly string[];
  readonly title?: string;
  readonly markdown?: string;
  readonly actionText?: string;
  readonly parsedJson: JsonObject;
};

export type CitationEvidence = {
  readonly path: string;
  readonly hash: string;
  readonly content: string;
};

export type ReadCompletedAgentTaskDomainOutputRequest = {
  readonly workspacePath: string;
  readonly taskId: string;
};

const PLACEHOLDER_PATTERN = /\b(?:placeholder|replace this text|pending|todo)\b|待替换|占位|示例/u;

export async function readCompletedAgentTaskDomainOutput(
  request: ReadCompletedAgentTaskDomainOutputRequest
): Promise<CompletedAgentTaskDomainOutput> {
  const taskId = normalizeTaskId(request.taskId);
  const resultPath = `.novelfabric/tasks/${taskId}/result.json`;
  const read = await readWorkspaceFile({ workspacePath: request.workspacePath, path: resultPath });
  const result = parseJsonObject(read.content, resultPath);

  if (result["kind"] !== "novelfabric.agent.task.result" || result["version"] !== 1) {
    throw invalidResult(resultPath, "Agent task result must be novelfabric.agent.task.result v1.");
  }
  if (result["taskId"] !== taskId) {
    throw invalidResult(resultPath, "Agent task result taskId must match the requested task.");
  }
  if (result["status"] !== "completed") {
    throw invalidResult(resultPath, "Agent task result must be completed before materialization.");
  }
  const runtimeEvidence = result["runtimeEvidence"];
  if (!isJsonObject(runtimeEvidence)) {
    throw invalidResult(resultPath, "Agent task result must include runtimeEvidence.");
  }
  validateRuntimeEvidence(runtimeEvidence, resultPath);

  const output = result["output"];
  if (!isJsonObject(output)) {
    throw invalidResult(resultPath, "Agent task result must include output.");
  }
  if (output["format"] !== "json") {
    throw outputInvalid(resultPath, "Agent task output must be JSON for domain materialization.");
  }
  const rawText = output["rawText"];
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    throw outputInvalid(resultPath, "Agent task output rawText must not be empty.");
  }
  const parsedJson = output["parsedJson"];
  if (!isJsonObject(parsedJson) || Object.keys(parsedJson).length === 0) {
    throw outputInvalid(
      resultPath,
      "Agent task JSON output must include a non-empty parsedJson object."
    );
  }

  const summary = requiredCleanText(parsedJson, "summary", resultPath, 12);
  const citations = requiredStringArray(parsedJson, "citations", resultPath);
  const sourceAnchors = requiredStringArray(parsedJson, "sourceAnchors", resultPath);
  const title = optionalCleanText(parsedJson, "title", resultPath, 2);
  const markdown = optionalCleanText(parsedJson, "markdown", resultPath, 12);
  const actionText = optionalCleanText(parsedJson, "actionText", resultPath, 12);

  return {
    taskId,
    resultPath: read.path,
    resultHash: read.hash,
    summary,
    citations,
    sourceAnchors,
    ...(title === undefined ? {} : { title }),
    ...(markdown === undefined ? {} : { markdown }),
    ...(actionText === undefined ? {} : { actionText }),
    parsedJson
  };
}

export async function readCitationEvidence(
  workspacePath: string,
  citations: readonly string[]
): Promise<readonly CitationEvidence[]> {
  if (citations.length === 0) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      "Agent task output must include at least one citation."
    );
  }
  const reads = await Promise.all(
    citations.map(async (citation) => readWorkspaceFile({ workspacePath, path: citation }))
  );
  return reads.map((read) => ({ path: read.path, hash: read.hash, content: read.content }));
}

export function requireWorkflowOutputKind(
  output: CompletedAgentTaskDomainOutput,
  expectedKind: string
): void {
  if (output.parsedJson["kind"] !== expectedKind || output.parsedJson["version"] !== 1) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      `Agent task output must be ${expectedKind} version 1.`
    );
  }
}

export function requireMarkdownOutput(
  output: CompletedAgentTaskDomainOutput,
  label: string
): string {
  if (output.markdown === undefined) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      `${label} must be explicitly provided by the agent output.`
    );
  }
  return assertMaterializedContent(output.markdown, label);
}

export function requireActionTextOutput(
  output: CompletedAgentTaskDomainOutput,
  label: string
): string {
  if (output.actionText === undefined) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      `${label} must be explicitly provided by the agent output.`
    );
  }
  return assertMaterializedContent(output.actionText, label);
}

export function assertSourceAnchorsGrounded(
  sourceAnchors: readonly string[],
  citationEvidence: readonly CitationEvidence[],
  resultPath: string
): void {
  for (const anchor of sourceAnchors) {
    const grounded = citationEvidence.some((citation) => citation.content.includes(anchor));
    if (!grounded) {
      throw new CommandFailure(
        "domain_materialization_anchor_not_found",
        `Source anchor '${anchor}' from '${resultPath}' was not found in any cited workspace file.`
      );
    }
  }
}

export function assertMaterializedContent(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 12) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      `${label} must contain substantive non-empty content.`
    );
  }
  if (PLACEHOLDER_PATTERN.test(trimmed.toLocaleLowerCase())) {
    throw new CommandFailure(
      "domain_materialization_output_invalid",
      `${label} contains placeholder text and cannot be materialized.`
    );
  }
  return trimmed;
}

function requiredCleanText(
  value: JsonObject,
  field: string,
  resultPath: string,
  minimumLength: number
): string {
  const text = value[field];
  if (typeof text !== "string") {
    throw outputInvalid(resultPath, `Agent task output must include string field '${field}'.`);
  }
  const trimmed = text.trim();
  if (trimmed.length < minimumLength) {
    throw outputInvalid(
      resultPath,
      `Agent task output field '${field}' must contain at least ${minimumLength.toString()} characters.`
    );
  }
  rejectPlaceholder(trimmed, resultPath, field);
  return trimmed;
}

function optionalCleanText(
  value: JsonObject,
  field: string,
  resultPath: string,
  minimumLength: number
): string | undefined {
  const text = value[field];
  if (text === undefined) return undefined;
  if (typeof text !== "string") {
    throw outputInvalid(resultPath, `Agent task output field '${field}' must be a string.`);
  }
  const trimmed = text.trim();
  if (trimmed.length < minimumLength) {
    throw outputInvalid(
      resultPath,
      `Agent task output field '${field}' must contain at least ${minimumLength.toString()} characters.`
    );
  }
  rejectPlaceholder(trimmed, resultPath, field);
  return trimmed;
}

function requiredStringArray(
  value: JsonObject,
  field: string,
  resultPath: string
): readonly string[] {
  const raw = value[field];
  if (!Array.isArray(raw)) {
    throw outputInvalid(resultPath, `Agent task output must include array field '${field}'.`);
  }
  const items = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length !== raw.length || items.length === 0) {
    throw outputInvalid(
      resultPath,
      `Agent task output field '${field}' must contain non-empty strings.`
    );
  }
  for (const item of items) {
    rejectPlaceholder(item, resultPath, field);
  }
  return [...new Set(items)];
}

function rejectPlaceholder(value: string, resultPath: string, field: string): void {
  if (PLACEHOLDER_PATTERN.test(value.toLocaleLowerCase())) {
    throw outputInvalid(
      resultPath,
      `Agent task output field '${field}' contains placeholder text.`
    );
  }
}

function validateRuntimeEvidence(runtimeEvidence: JsonObject, resultPath: string): void {
  for (const field of ["provider", "model"] as const) {
    const value = runtimeEvidence[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidResult(resultPath, `Agent task runtimeEvidence must include '${field}'.`);
    }
  }
  const stdoutBytes = runtimeEvidence["stdoutBytes"];
  if (typeof stdoutBytes !== "number" || !Number.isFinite(stdoutBytes) || stdoutBytes <= 0) {
    throw invalidResult(
      resultPath,
      "Agent task runtimeEvidence must include positive stdoutBytes."
    );
  }
}

function parseJsonObject(content: string, filePath: string): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch (error) {
    throw new CommandFailure(
      "domain_materialization_invalid_agent_result",
      `Agent task result '${filePath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isJsonObject(parsed)) {
    throw invalidResult(filePath, "Agent task result must be a JSON object.");
  }
  return parsed;
}

function normalizeTaskId(taskId: string): string {
  const normalized = taskId.trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    throw new CommandFailure(
      "invalid_agent_task_id",
      "Agent task id may only contain letters, numbers, dot, underscore, and hyphen."
    );
  }
  return normalized;
}

function invalidResult(resultPath: string, message: string): CommandFailure {
  return new CommandFailure(
    "domain_materialization_invalid_agent_result",
    `${message} Path: ${resultPath}`
  );
}

function outputInvalid(resultPath: string, message: string): CommandFailure {
  return new CommandFailure(
    "domain_materialization_output_invalid",
    `${message} Path: ${resultPath}`
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
