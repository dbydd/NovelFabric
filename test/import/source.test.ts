import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addImportSource,
  buildImportContextPack,
  chunkImportSource,
  normalizeImportSource,
  readImportInbox,
  validateImportWorkspace
} from "../../src/import/source.js";
import { contentHash } from "../../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const GB18030_NOVEL_BYTES = Buffer.from(
  "b5dad2bbd5c220d0c7c3c50d0ac9d9c5aed0d1c0b40d0ab5dab6fed5c220d3eab3c70d0ab5c6bbf0d2a1bbce0d0a",
  "hex"
);

describe("deterministic import services", () => {
  let workspacePath: string;
  let scratchPath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-import-test-workspace-"));
    scratchPath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-import-test-scratch-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.rm(scratchPath, { recursive: true, force: true });
  });

  it("adds GB18030-style source text and normalizes CRLF through audited workspace writes", async () => {
    const externalSource = path.join(scratchPath, "gb-source.txt");
    await fs.writeFile(externalSource, GB18030_NOVEL_BYTES);

    const result = await addImportSource({
      workspacePath,
      actor: "main_agent",
      sourcePath: externalSource,
      targetName: "gb-source.txt"
    });

    expect(result.source.encoding).toBe("gb18030");
    expect(result.source.content).toBe("第一章 星门\n少女醒来\n第二章 雨城\n灯火摇晃\n");
    expect(result.write.path).toBe("imports/source/gb-source.txt");
    expect(result.write.auditPath).toMatch(/^\.novelfabric\/audit\/files\//);
    await expect(fs.readFile(path.join(workspacePath, result.write.path), "utf8")).resolves.toBe(
      result.source.content
    );
  });

  it("normalizes a source file into imports/normalized", async () => {
    await fs.writeFile(
      path.join(workspacePath, "imports/source/crlf.txt"),
      "第1章 开始\r\n正文第一行\r\n",
      "utf8"
    );

    const result = await normalizeImportSource({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/crlf.txt"
    });

    expect(result.write.path).toBe("imports/normalized/crlf.txt");
    await expect(fs.readFile(path.join(workspacePath, result.write.path), "utf8")).resolves.toBe(
      "第1章 开始\n正文第一行\n"
    );
  });

  it("chunks non-fixture synthetic text with deterministic ranges and hashes", async () => {
    const sourceText = Array.from(
      { length: 36 },
      (_, index) => `合成文本第${String(index + 1)}行：这里用于测试通用切分。`
    ).join("\n");
    await fs.writeFile(
      path.join(workspacePath, "imports/source/synthetic.txt"),
      sourceText,
      "utf8"
    );

    const result = await chunkImportSource({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/synthetic.txt",
      maxChars: 220
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.manifestPath).toBe("imports/chunks/synthetic/manifest.json");
    expect(result.sourceHash).toBe(contentHash(sourceText));
    for (const chunk of result.chunks) {
      const saved = await fs.readFile(path.join(workspacePath, chunk.path), "utf8");
      expect(saved).toBe(sourceText.slice(chunk.charRange.start, chunk.charRange.end));
      expect(chunk.hash).toBe(contentHash(saved));
      expect(chunk.bytes).toBe(Buffer.byteLength(saved, "utf8"));
    }
  });

  it("builds context packs, lists inbox artifacts, and validates import health", async () => {
    const sourceText = "第一章 入口\n角色进入故事。\n第二章 选择\n角色做出选择。\n";
    await fs.writeFile(
      path.join(workspacePath, "imports/source/contextual.txt"),
      sourceText,
      "utf8"
    );
    const contextPack = await buildImportContextPack({
      workspacePath,
      actor: "main_agent",
      sourcePath: "imports/source/contextual.txt"
    });

    expect(contextPack.outputPath).toBe("simulation/context-packs/import-contextual.json");
    expect(contextPack.chapterCount).toBe(0);
    const packContent = JSON.parse(
      await fs.readFile(path.join(workspacePath, contextPack.outputPath), "utf8")
    ) as { readonly sourceExcerpt: string; readonly chapters: readonly unknown[] };
    expect(packContent.sourceExcerpt).toContain("第一章 入口");
    expect(packContent.chapters).toHaveLength(0);

    const inbox = await readImportInbox({ workspacePath });
    expect(inbox.sources.some((item) => item.path === "imports/source/contextual.txt")).toBe(true);
    expect(
      inbox.contextPacks.some(
        (item) => item.path === "simulation/context-packs/import-contextual.json"
      )
    ).toBe(true);

    const validation = await validateImportWorkspace({
      workspacePath,
      path: "imports/source/contextual.txt"
    });
    expect(validation.valid).toBe(true);
    expect(validation.checked).toEqual(["imports/source/contextual.txt"]);
    expect(validation.issues).toEqual([]);
  });
});
