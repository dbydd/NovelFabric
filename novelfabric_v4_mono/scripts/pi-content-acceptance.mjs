#!/usr/bin/env node

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  expectedAcceptanceModel,
  expectedWorkflowModel,
  resolvePiModelRoles
} from "./pi-model-roles.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureWorkspace = path.join(repoRoot, "fixtures", "workspaces", "valid-basic");
const cliPath = path.join(repoRoot, "src", "cli.ts");
const piBin = path.join(repoRoot, "node_modules", ".bin", "pi");

const sourceText = [
  "第一章 开端",
  "叶小伟醒来，城市边缘传来钟声。",
  "第二章 余波",
  "新的选择被摆在桌面。",
  ""
].join("\n");

const requiredTerms = ["叶小伟", "钟声", "第二章"];

async function main() {
  const runtime = await loadNovelFabricPiRuntimeConfig();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-pi-acceptance-"));
  const workspacePath = path.join(tempRoot, "workspace");
  try {
    await fs.cp(fixtureWorkspace, workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      '[main_agent]\nallow = ["project.manage", "files.patch_protected", "external_swarm.run"]\n',
      "utf8"
    );

    await cli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      "imports/source/pi-acceptance.txt",
      "--actor",
      "main_agent",
      "--content",
      sourceText,
      "--json"
    ]);
    await cli([
      "workflow",
      "plan",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/pi-acceptance.txt",
      "--role",
      "main_agent",
      "--plan-id",
      "pi-acceptance",
      "--json"
    ]);
    await cli([
      "workflow",
      "start",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--plan",
      "pi-acceptance",
      "--json"
    ]);
    for (const stage of ["import.normalize", "import.chapterize", "import.context-pack"]) {
      await cli([
        "workflow",
        "step",
        "--workspace",
        workspacePath,
        "--actor",
        "main_agent",
        "--job",
        "pi-acceptance",
        "--input",
        JSON.stringify({ stage }),
        "--json"
      ]);
    }

    const artifacts = await cli([
      "workflow",
      "artifacts",
      "--workspace",
      workspacePath,
      "--job",
      "pi-acceptance",
      "--json"
    ]);
    assert(
      artifacts.data.artifactCount >= 3,
      `Expected workflow artifacts to contain real import data, got ${String(artifacts.data.artifactCount)}.`
    );

    const contextPackPath = findArtifactPath(
      artifacts,
      "import.context-pack",
      "import-context-pack"
    );
    const contextPack = await cli([
      "files",
      "read",
      "--workspace",
      workspacePath,
      "--path",
      contextPackPath,
      "--json"
    ]);
    const contextContent = String(contextPack.data.content ?? "");
    for (const term of requiredTerms) {
      assert(
        contextContent.includes(term),
        `Workflow context pack is missing required term: ${term}`
      );
    }

    const agentJson = await runPiWithValidationRetry(runtime, workspacePath, contextContent);

    const agentOutputContent = `${JSON.stringify(
      {
        kind: "novelfabric.pi.acceptance.output",
        version: 1,
        runtimeRoot: runtime.runtimeRoot,
        workflowModel: runtime.workflowModel,
        acceptanceModel: runtime.acceptanceModel,
        workflowJobId: "pi-acceptance",
        semanticExecution: true,
        agent: agentJson
      },
      null,
      2
    )}\n`;
    await cli([
      "files",
      "write",
      "--workspace",
      workspacePath,
      "--path",
      "reports/pi-acceptance-output.json",
      "--actor",
      "main_agent",
      "--content",
      agentOutputContent,
      "--json"
    ]);

    const saved = await cli([
      "files",
      "read",
      "--workspace",
      workspacePath,
      "--path",
      "reports/pi-acceptance-output.json",
      "--json"
    ]);
    const savedContent = String(saved.data.content ?? "");
    validateSavedOutput(savedContent, runtime);

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeRoot: runtime.runtimeRoot,
          workflowProvider: runtime.workflowProvider,
          workflowModel: runtime.workflowModel,
          acceptanceProvider: runtime.acceptanceProvider,
          acceptanceModel: runtime.acceptanceModel,
          workspacePath,
          contextPackPath,
          outputPath: "reports/pi-acceptance-output.json"
        },
        null,
        2
      )
    );
  } finally {
    if (process.env.NOVELFABRIC_KEEP_PI_ACCEPTANCE_WORKSPACE !== "1") {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
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
      `NovelFabric pi acceptance requires ${settingsPath}. Run \`npm run cli -- runtime materialize --actor main_agent --json\`, then configure modelDefaults for generic-writer, testModelDefaults for flash-vibe, and credentials. ${errorMessage(error)}`
    );
  }
  let roles;
  try {
    roles = resolvePiModelRoles(parsed, settingsPath);
  } catch (error) {
    fail(errorMessage(error));
  }
  return { runtimeRoot, settingsPath, ...roles };
}

async function runPiWithValidationRetry(runtime, workspacePath, contextContent) {
  const attempts = Number(process.env.NOVELFABRIC_PI_ACCEPTANCE_ATTEMPTS ?? "3");
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const agentJson = await runPi(runtime, workspacePath, contextContent);
      validateAgentJson(agentJson);
      return agentJson;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.error(
          `[pi-acceptance] attempt ${attempt.toString()} failed; retrying: ${errorMessage(error)}`
        );
      }
    }
  }
  fail(`pi acceptance failed after ${attempts.toString()} attempts. ${errorMessage(lastError)}`);
}

async function runPi(runtime, workspacePath, contextContent) {
  const prompt = [
    "You are running NovelFabric V4 hard pi acceptance.",
    "Read the supplied workflow context and return ONLY one compact JSON object. No markdown. No code fences.",
    "The JSON object must have these fields: semanticExecution true, summary, characters array, evidence array, nextAction.",
    "The summary and evidence must mention the exact terms: 叶小伟, 钟声, 第二章.",
    "Do not use tools. Do not write files. The test harness will validate and write your output.",
    "WORKFLOW_CONTEXT:",
    contextContent
  ].join("\n");

  const promptPath = path.join(workspacePath, ".novelfabric", "pi-acceptance-prompt.md");
  await fs.writeFile(promptPath, prompt, "utf8");
  const piResult = spawnSync(
    piBin,
    [
      "--print",
      "--no-tools",
      "--no-session",
      "--provider",
      runtime.acceptanceProvider,
      "--model",
      runtime.acceptanceThinking === undefined
        ? runtime.acceptanceModel
        : `${runtime.acceptanceModel}:${runtime.acceptanceThinking}`,
      `@${promptPath}`
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: runtime.runtimeRoot,
        PI_SKIP_VERSION_CHECK: "1"
      },
      timeout: Number(process.env.NOVELFABRIC_PI_ACCEPTANCE_TIMEOUT_MS ?? "180000"),
      maxBuffer: 1024 * 1024 * 5,
      encoding: "utf8"
    }
  );
  if (piResult.error !== undefined || piResult.status !== 0) {
    fail(
      `pi process failed. status=${String(piResult.status)} signal=${String(piResult.signal)} error=${errorMessage(
        piResult.error
      )}\nSTDOUT:\n${piResult.stdout}\nSTDERR:\n${piResult.stderr}`
    );
  }

  const text = `${piResult.stdout}\n${piResult.stderr}`.trim();
  const jsonText = extractFirstJsonObject(text);
  if (jsonText === undefined) {
    fail(`pi output did not include a JSON object. Output:\n${text}`);
  }
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    fail(`pi output JSON could not be parsed. ${errorMessage(error)}\nJSON:\n${jsonText}`);
  }
}

async function cli(args) {
  const { stdout } = await execFileAsync("npx", ["tsx", cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 3
  });
  const envelope = JSON.parse(stdout);
  if (envelope.ok !== true) {
    fail(`CLI failed for ${args.join(" ")}: ${stdout}`);
  }
  return envelope;
}

function findArtifactPath(envelope, stage, name) {
  const artifacts = envelope.data.artifacts;
  if (!Array.isArray(artifacts)) {
    fail("workflow artifacts output did not contain an artifacts array.");
  }
  const artifact = artifacts.find((item) => item.stage === stage && item.name === name);
  if (artifact === undefined || typeof artifact.path !== "string") {
    fail(`Missing workflow artifact ${stage}/${name}.`);
  }
  return artifact.path;
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function validateAgentJson(value) {
  retryableAssert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "pi output must be a JSON object."
  );
  retryableAssert(value.semanticExecution === true, "pi output must set semanticExecution=true.");
  retryableAssert(
    typeof value.summary === "string" && value.summary.trim().length >= 20,
    "pi summary must be substantive."
  );
  retryableAssert(
    Array.isArray(value.characters) && value.characters.includes("叶小伟"),
    "pi characters must include 叶小伟."
  );
  retryableAssert(
    Array.isArray(value.evidence) && value.evidence.length > 0,
    "pi evidence must be non-empty."
  );
  retryableAssert(
    value.evidence.every((item) => typeof item === "string" && item.trim().length >= 4),
    "pi evidence entries must be substantive strings."
  );
  retryableAssert(
    typeof value.nextAction === "string" && value.nextAction.trim().length >= 8,
    "pi nextAction must be substantive."
  );
  const serialized = JSON.stringify(value);
  for (const term of requiredTerms) {
    retryableAssert(serialized.includes(term), `pi output is missing required term: ${term}`);
  }
}

function validateSavedOutput(content, runtime) {
  assert(content.trim().length > 0, "Saved pi output is empty.");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    fail(`Saved pi output is not valid JSON. ${errorMessage(error)}`);
  }
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    "Saved pi output must be a JSON object."
  );
  assert(
    parsed.kind === "novelfabric.pi.acceptance.output",
    "Saved pi output has the wrong artifact kind."
  );
  assert(parsed.semanticExecution === true, "Saved pi output is missing semanticExecution=true.");
  assert(
    parsed.workflowModel === runtime.workflowModel &&
      parsed.workflowModel === expectedWorkflowModel,
    "Saved pi output did not record generic-writer as the workflow model."
  );
  assert(
    parsed.acceptanceModel === runtime.acceptanceModel &&
      parsed.acceptanceModel === expectedAcceptanceModel,
    "Saved pi output did not record flash-vibe as the acceptance model."
  );
  validateAgentJson(parsed.agent);
  const serialized = JSON.stringify(parsed);
  for (const term of requiredTerms) {
    assert(serialized.includes(term), `Saved pi output is missing required term: ${term}`);
  }
}

function retryableAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(`[pi-acceptance] ${message}`);
  process.exit(1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

await main();
