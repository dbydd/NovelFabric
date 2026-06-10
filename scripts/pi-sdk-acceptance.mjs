#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expectedWorkflowModel, resolvePiModelRoles } from "./pi-model-roles.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureWorkspace = path.join(repoRoot, "fixtures", "workspaces", "valid-basic");
const cliPath = path.join(repoRoot, "src", "cli.ts");

const taskId = "pi-sdk-acceptance";
const actor = "main_agent";
const requiredAnchors = ["叶小伟醒来", "城市边缘传来钟声"];

const input = {
  kind: "novelfabric.pi-sdk.acceptance.input",
  version: 1,
  sourceTitle: "pi SDK acceptance source",
  sourceText: "第一章 开端\n叶小伟醒来，城市边缘传来钟声。\n第二章 余波\n新的选择被摆在桌面。",
  requiredSourceAnchors: requiredAnchors,
  requiredCitation: "第二章"
};

const outputSchema = {
  type: "object",
  required: ["kind", "version", "summary", "sourceAnchors", "citations"],
  properties: {
    kind: { type: "string" },
    version: { type: "number" },
    summary: { type: "string", minLength: 24 },
    sourceAnchors: {
      type: "array",
      minItems: requiredAnchors.length,
      containsAllText: requiredAnchors,
      containsOnlyText: requiredAnchors,
      items: { type: "string", minLength: 2 }
    },
    citations: {
      type: "array",
      minItems: 1,
      containsText: "第二章",
      items: { type: "string", minLength: 2 }
    }
  }
};

async function main() {
  const runtime = await loadNovelFabricPiRuntimeConfig();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-sdk-acceptance-"));
  const workspacePath = path.join(tempRoot, "workspace");
  try {
    await fs.cp(fixtureWorkspace, workspacePath, { recursive: true });
    await grantTempAgentTaskCapabilities(workspacePath);

    await cli([
      "agent",
      "task",
      "create",
      "--workspace",
      workspacePath,
      "--actor",
      actor,
      "--task-id",
      taskId,
      "--title",
      "pi SDK acceptance",
      "--instruction",
      [
        "Return exactly one JSON object and no markdown.",
        "Summarize the source text.",
        "Copy sourceAnchors exactly from input.requiredSourceAnchors.",
        "Add at least one citation string containing 第二章.",
        "Do not use tools, read files, write files, edit files, execute bash, or access the network."
      ].join(" "),
      "--input-json",
      JSON.stringify(input),
      "--output-schema-json",
      JSON.stringify(outputSchema),
      "--json"
    ]);

    await cli([
      "agent",
      "run",
      "--workspace",
      workspacePath,
      "--actor",
      actor,
      "--task",
      taskId,
      "--runtime",
      "pi-sdk",
      "--json"
    ]);

    const result = await readTaskJson(workspacePath, "result.json");
    validateResult(result, runtime, workspacePath);

    const validation = await cli([
      "agent",
      "output",
      "validate",
      "--workspace",
      workspacePath,
      "--task",
      taskId,
      "--json"
    ]);
    assert(validation.data.valid === true, "agent output validate must accept the SDK result.");

    const eventsText = await readTaskText(workspacePath, "events.jsonl");
    validateEvents(eventsText);

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeRoot: runtime.runtimeRoot,
          provider: runtime.workflowProvider,
          model: runtime.workflowModel,
          workspacePath,
          taskId,
          resultPath: `.novelfabric/tasks/${taskId}/result.json`,
          eventsPath: `.novelfabric/tasks/${taskId}/events.jsonl`
        },
        null,
        2
      )
    );
  } finally {
    if (process.env.NOVELFABRIC_KEEP_PI_SDK_ACCEPTANCE_WORKSPACE !== "1") {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function grantTempAgentTaskCapabilities(workspacePath) {
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      'allow = ["project.manage", "files.write", "files.patch_protected", "report.render", "knowledge.query"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function loadNovelFabricPiRuntimeConfig() {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (!home && !xdg) {
    fail("HOME or XDG_CONFIG_HOME is required to resolve NovelFabric pi runtime config.");
  }
  const novelfabricConfigRoot = xdg
    ? path.join(xdg, "novelfabric")
    : path.join(home, ".config", "novelfabric");
  const runtimeRoot = path.join(novelfabricConfigRoot, "pi");
  const settingsPath = path.join(runtimeRoot, "settings.json");
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch (error) {
    fail(
      `NovelFabric pi SDK acceptance requires ${settingsPath}. Run \`npm run cli -- runtime materialize --actor main_agent --json\`, then configure modelDefaults for generic-writer and SDK credentials. ${errorMessage(error)}`
    );
  }
  let roles;
  try {
    roles = resolvePiModelRoles(parsed, settingsPath);
  } catch (error) {
    fail(errorMessage(error));
  }
  assert(
    roles.workflowModel === expectedWorkflowModel,
    `pi-sdk acceptance must use ${expectedWorkflowModel} as the workflow model.`
  );
  return { runtimeRoot, settingsPath, ...roles };
}

async function readTaskJson(workspacePath, fileName) {
  const envelope = await cli([
    "files",
    "read",
    "--workspace",
    workspacePath,
    "--path",
    `.novelfabric/tasks/${taskId}/${fileName}`,
    "--json"
  ]);
  try {
    return JSON.parse(String(envelope.data.content ?? ""));
  } catch (error) {
    fail(`Task ${fileName} is not valid JSON. ${errorMessage(error)}`);
  }
}

async function readTaskText(workspacePath, fileName) {
  const envelope = await cli([
    "files",
    "read",
    "--workspace",
    workspacePath,
    "--path",
    `.novelfabric/tasks/${taskId}/${fileName}`,
    "--json"
  ]);
  return String(envelope.data.content ?? "");
}

function validateResult(result, runtime, workspacePath) {
  assert(isObject(result), "result.json must be a JSON object.");
  assert(result.kind === "novelfabric.agent.task.result", "result kind mismatch.");
  assert(result.taskId === taskId, "result taskId mismatch.");
  assert(result.status === "completed", "pi-sdk result must be completed.");
  assert(result.runtime === "pi-sdk", "result runtime must be pi-sdk.");
  assert(isObject(result.runtimeEvidence), "runtimeEvidence is required.");
  assert(result.runtimeEvidence.engine === "sdk", "runtimeEvidence.engine must be sdk.");
  assert(
    result.runtimeEvidence.toolPolicy === "sdk-web-safe-custom-tools",
    "runtimeEvidence.toolPolicy must be sdk-web-safe-custom-tools."
  );
  assert(
    result.runtimeEvidence.contextPolicy === "sdk-no-context-files",
    "runtimeEvidence.contextPolicy must be sdk-no-context-files."
  );
  assert(
    result.runtimeEvidence.sessionPolicy === "workspace-session-dir",
    "runtimeEvidence.sessionPolicy must be workspace-session-dir."
  );
  assert(
    result.runtimeEvidence.provider === runtime.workflowProvider,
    "runtimeEvidence provider must match workflow model role."
  );
  assert(
    result.runtimeEvidence.model === runtime.workflowModel,
    "runtimeEvidence model must match workflow model role."
  );
  assert(
    typeof result.runtimeEvidence.sessionDirectory === "string" &&
      result.runtimeEvidence.sessionDirectory.includes(
        path.join(workspacePath, ".novelfabric", "pi-sessions")
      ),
    "runtimeEvidence must record the workspace session directory."
  );
  assert(
    Number(result.runtimeEvidence.stdoutBytes) > 0,
    "runtimeEvidence.stdoutBytes must be positive."
  );
  assert(isObject(result.output), "result output is required.");
  assert(result.output.format === "json", "SDK output must be parsed as JSON.");
  assert(
    typeof result.output.rawText === "string" && result.output.rawText.length > 0,
    "rawText required."
  );
  assert(isObject(result.output.parsedJson), "parsedJson object required.");
  assert(typeof result.output.parsedJson.summary === "string", "summary required.");
  assert(Array.isArray(result.output.parsedJson.sourceAnchors), "sourceAnchors array required.");
  for (const anchor of requiredAnchors) {
    assert(
      result.output.parsedJson.sourceAnchors.includes(anchor),
      `sourceAnchors must include exact anchor '${anchor}'.`
    );
  }
  assert(Array.isArray(result.output.parsedJson.citations), "citations array required.");
  assert(
    result.output.parsedJson.citations.some(
      (citation) => typeof citation === "string" && citation.includes("第二章")
    ),
    "citations must include 第二章."
  );
}

function validateEvents(eventsText) {
  const events = eventsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  assert(
    events.some((event) => event.type === "created"),
    "events must include created."
  );
  assert(
    events.some((event) => event.type === "pi-started"),
    "events must include pi-started."
  );
  assert(
    events.some((event) => event.type === "pi-completed"),
    "events must include pi-completed."
  );
  const sdkEvents = events.filter((event) => event.type === "pi-sdk-event");
  assert(sdkEvents.length > 0, "events must include pi-sdk-event entries.");
  const messages = sdkEvents.map((event) => String(event.message ?? ""));
  assert(
    messages.some((message) => message.includes("session.started")),
    "SDK events must include session.started."
  );
  assert(
    messages.some((message) => message.includes("session.completed")),
    "SDK events must include session.completed."
  );
  assert(
    messages.some((message) => message.includes("model output")),
    "SDK events must include model output."
  );
}

async function cli(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("npx", ["tsx", cliPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      timeout: Number(process.env.NOVELFABRIC_PI_SDK_ACCEPTANCE_CLI_TIMEOUT_MS ?? "240000"),
      maxBuffer: 1024 * 1024 * 8
    }));
  } catch (error) {
    fail(formatCliFailure(args, error));
  }
  const envelope = JSON.parse(stdout);
  if (envelope.ok !== true) {
    fail(
      `CLI returned non-ok envelope for ${args.join(" ")}: ${redactAndBoundDiagnosticText(stdout)}`
    );
  }
  return envelope;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`[pi-sdk-acceptance] ${message}`);
  process.exit(1);
}

function formatCliFailure(args, error) {
  const output = [
    `CLI failed for ${args.join(" ")}. ${redactAndBoundDiagnosticText(errorMessage(error), 2000)}`,
    "stdout:",
    redactAndBoundDiagnosticText(error?.stdout ?? ""),
    "stderr:",
    redactAndBoundDiagnosticText(error?.stderr ?? "")
  ];
  return output.join("\n");
}

function redactAndBoundDiagnosticText(value, maxLength = 4000) {
  const raw = String(value ?? "");
  const redacted = raw
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;"']+/gi, "$1<redacted>")
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;"']+/gi, "$1$2<redacted>")
    .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+={0,2}/gi, "$1<redacted>")
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, "sk-<redacted>")
    .replace(/((?:access[_-]?|refresh[_-]?|id[_-]?)?token\s*[:=]\s*)[^\s,;"']+/gi, "$1<redacted>")
    .replace(/(secret\s*[:=]\s*)[^\s,;"']+/gi, "$1<redacted>");
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength)}\n<truncated ${redacted.length - maxLength} chars>`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

await main();
