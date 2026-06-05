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
    manifestPath: z.string().optional(),
    fallback: z.boolean().optional(),
    write: z.looseObject({ path: z.string() }).optional()
  })
});

type ImportEnvelope = z.infer<typeof importEnvelopeSchema>;

describe("novelfabric import CLI commands", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-import-cli-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("runs add, chapterize, context-pack, inbox, and validate commands through commander", async () => {
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

    const chapterize = await runImportCommand([
      "import",
      "chapterize",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--source",
      "imports/source/cli-import.txt",
      "--json"
    ]);
    expect(chapterize.command).toBe("import chapterize");
    expect(chapterize.data.manifestPath).toBe("imports/chapters/cli-import/manifest.json");
    expect(chapterize.data.fallback).toBe(false);

    const contextPack = await runImportCommand([
      "import",
      "context-pack",
      "--workspace",
      workspacePath,
      "--actor",
      "main_agent",
      "--chapter-manifest",
      "imports/chapters/cli-import/manifest.json",
      "--json"
    ]);
    expect(contextPack.command).toBe("import context-pack");
    expect(contextPack.data.sourcePath).toBe("imports/source/cli-import.txt");

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
  });
});

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
