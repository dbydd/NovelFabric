#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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

    const agentJson = await runPi(runtime, workspacePath, contextContent);
    validateAgentJson(agentJson);

    const agentOutputContent = `${JSON.stringify(
      {
        kind: "novelfabric.pi.acceptance.output",
        version: 1,
        runtimeRoot: runtime.runtimeRoot,
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
    assert(
      savedContent.includes("semanticExecution"),
      "Saved pi output is missing semanticExecution."
    );
    for (const term of requiredTerms) {
      assert(savedContent.includes(term), `Saved pi output is missing required term: ${term}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeRoot: runtime.runtimeRoot,
          provider: runtime.defaultProvider,
          model: runtime.defaultModel,
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
      `NovelFabric pi acceptance requires ${settingsPath}. Run \`npm run cli -- runtime materialize --actor main_agent --json\`, then configure defaultProvider/defaultModel and credentials. ${errorMessage(error)}`
    );
  }
  const defaultProvider = stringField(parsed, "defaultProvider");
  const defaultModel = stringField(parsed, "defaultModel");
  if (defaultProvider === undefined || defaultModel === undefined) {
    fail(
      `${settingsPath} must define string fields defaultProvider and defaultModel for hard pi acceptance. Current runtime materialization is metadata-only; add model config before running this test.`
    );
  }
  return { runtimeRoot, settingsPath, defaultProvider, defaultModel };
}

async function runPi(runtime, workspacePath, contextContent) {
  const prompt = [
    "You are running NovelFabric V4 hard pi acceptance.",
    "Read the supplied workflow context. Return ONLY JSON between the markers.",
    "The JSON must have: semanticExecution true, summary, characters array, evidence array, and nextAction.",
    "The summary/evidence must mention the exact terms: 叶小伟, 钟声, 第二章.",
    "Do not use tools. Do not write files. The test harness will validate and write your output.",
    "NOVELFABRIC_CONTEXT_BEGIN",
    contextContent,
    "NOVELFABRIC_CONTEXT_END",
    "NOVELFABRIC_RESULT_JSON_BEGIN",
    "{",
    '  "semanticExecution": true,',
    '  "summary": "...",',
    '  "characters": ["叶小伟"],',
    '  "evidence": ["..."],',
    '  "nextAction": "..."',
    "}",
    "NOVELFABRIC_RESULT_JSON_END"
  ].join("\n");

  const { stdout, stderr } = await execFileAsync(
    piBin,
    [
      "--print",
      "--no-tools",
      "--no-session",
      "--provider",
      runtime.defaultProvider,
      "--model",
      runtime.defaultModel,
      prompt
    ],
    {
      cwd: workspacePath,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: runtime.runtimeRoot,
        PI_CODING_AGENT_SESSION_DIR: path.join(workspacePath, ".novelfabric", "pi-sessions"),
        PI_SKIP_VERSION_CHECK: "1"
      },
      timeout: Number(process.env.NOVELFABRIC_PI_ACCEPTANCE_TIMEOUT_MS ?? "180000"),
      maxBuffer: 1024 * 1024 * 5
    }
  ).catch((error) => {
    if (error instanceof Error) {
      fail(
        `pi process failed. ${error.message}\nSTDOUT:\n${String(error.stdout ?? "")}\nSTDERR:\n${String(error.stderr ?? "")}`
      );
    }
    throw error;
  });

  const text = `${stdout}\n${stderr}`;
  const match = /NOVELFABRIC_RESULT_JSON_BEGIN\s*([\s\S]*?)\s*NOVELFABRIC_RESULT_JSON_END/.exec(
    text
  );
  if (match === null) {
    fail(`pi output did not include required JSON markers. Output:\n${text}`);
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`pi output JSON could not be parsed. ${errorMessage(error)}\nJSON:\n${match[1]}`);
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

function validateAgentJson(value) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "pi output must be a JSON object."
  );
  assert(value.semanticExecution === true, "pi output must set semanticExecution=true.");
  assert(
    typeof value.summary === "string" && value.summary.trim().length >= 20,
    "pi summary must be substantive."
  );
  assert(
    Array.isArray(value.characters) && value.characters.includes("叶小伟"),
    "pi characters must include 叶小伟."
  );
  assert(
    Array.isArray(value.evidence) && value.evidence.length > 0,
    "pi evidence must be non-empty."
  );
  const serialized = JSON.stringify(value);
  for (const term of requiredTerms) {
    assert(serialized.includes(term), `pi output is missing required term: ${term}`);
  }
}

function stringField(value, key) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const field = value[key];
    if (typeof field === "string" && field.trim().length > 0) return field;
  }
  return undefined;
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
