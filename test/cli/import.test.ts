import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { addImportCommands } from "../../src/commands/import.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const importEnvelopeSchema = z.object({
  ok: z.literal(true),
  command: z.string(),
  data: z.looseObject({
    sourcePath: z.string().optional(),
    write: z.looseObject({ path: z.string() }).optional(),
    artifactPath: z.string().optional()
  })
});

type ImportEnvelope = z.infer<typeof importEnvelopeSchema>;

describe("novelfabric import CLI commands", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-import-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await grantProtectedTaskWrite(workspacePath);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("runs add, context-pack, semantic, inbox, and validate commands through commander", async () => {
    const add = await runImportCommand([
      "import",
      "add",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--content",
      "第一章 起点\r\n角色抵达。\r\n第二章 回声\r\n角色回应。\r\n",
      "--target-name",
      "cli-import.txt",
      "--json"
    ]);
    expect(add.command).toBe("import add");
    expect(add.data.write?.path).toBe("imports/source/cli-import.txt");

    const contextPack = await runImportCommand([
      "import",
      "context-pack",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/cli-import.txt",
      "--json"
    ]);
    expect(contextPack.command).toBe("import context-pack");
    expect(contextPack.data.sourcePath).toBe("imports/source/cli-import.txt");

    const semantic = await runImportCommand([
      "import",
      "semantic",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/cli-import.txt",
      "--context-pack",
      "simulation/context-packs/import-cli-import.json",
      "--output",
      "imports/semantic/cli-import.json",
      "--json"
    ]);
    expect(semantic.command).toBe("import semantic");
    expect(semantic.data).toMatchObject({ artifactPath: "imports/semantic/cli-import.json" });
    const savedSemantic = JSON.parse(
      await fs.readFile(path.join(workspacePath, "imports/semantic/cli-import.json"), "utf8")
    ) as { readonly sourceAnchors: readonly string[]; readonly cardSeeds: readonly unknown[] };
    expect(savedSemantic.sourceAnchors.length).toBeGreaterThanOrEqual(2);
    for (const anchor of savedSemantic.sourceAnchors) {
      expect("第一章 起点\n角色抵达。\n第二章 回声\n角色回应。\n").toContain(anchor);
    }
    expect(savedSemantic.cardSeeds.length).toBeGreaterThan(0);

    const inbox = await runImportCommand([
      "import",
      "inbox",
      "--workspace",
      workspacePath,
      "--json"
    ]);
    expect(inbox.command).toBe("import inbox");

    const validate = await runImportCommand([
      "import",
      "validate",
      "--workspace",
      workspacePath,
      "--path",
      "imports/source/cli-import.txt",
      "--json"
    ]);
    expect(validate.command).toBe("import validate");
  }, 360000);
});

async function grantProtectedTaskWrite(workspacePath: string): Promise<void> {
  await fs.writeFile(
    path.join(workspacePath, ".novelfabric", "capabilities.toml"),
    [
      "[main_agent]",
      'allow = ["project.manage", "files.patch_protected", "report.render", "knowledge.query", "external_swarm.run", "report.apply", "cards.propose", "cards.apply", "writing.draft", "writing.apply", "writing.export", "simulation.create", "simulation.append_turn", "swarm.run", "memory.recall", "memory.write_own", "memory.propose_shared", "memory.apply_shared"]',
      "",
      "[role_agent]",
      'allow = ["memory.recall", "simulation.append_turn"]',
      'deny = ["files.patch_protected", "external_swarm.run"]',
      ""
    ].join("\n"),
    "utf8"
  );
}

async function runImportCommand(args: readonly string[]): Promise<ImportEnvelope> {
  const program = new Command();
  program.exitOverride();
  program.name("novelfabric-test");
  addImportCommands(program);

  let stdout = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  const captureWrite: typeof process.stdout.write = (chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  process.stdout.write = captureWrite;
  try {
    await program.parseAsync(["node", "novelfabric-test", ...args]);
  } finally {
    process.stdout.write = originalWrite;
  }
  return importEnvelopeSchema.parse(JSON.parse(stdout));
}
