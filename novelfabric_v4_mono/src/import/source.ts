import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";
import {
  contentHash,
  readWorkspaceBinaryFile,
  writeWorkspaceFile,
  type WorkspaceFileWriteResult
} from "../workspace/files.js";

export type ImportDecodeEncoding = "utf-8" | "gb18030";

export type DecodedImportText = {
  readonly content: string;
  readonly encoding: ImportDecodeEncoding;
  readonly replacements: number;
  readonly bytes: number;
  readonly hash: string;
  readonly lineCount: number;
  readonly charCount: number;
};

export type ImportWriteSummary = Pick<
  WorkspaceFileWriteResult,
  "path" | "hash" | "bytes" | "auditPath"
>;

export type ImportAddRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath?: string;
  readonly content?: string;
  readonly targetPath?: string;
  readonly targetName?: string;
  readonly reason?: string;
};

export type ImportAddResult = {
  readonly source: DecodedImportText;
  readonly write: ImportWriteSummary;
};

export type ImportNormalizeRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type ImportNormalizeResult = {
  readonly sourcePath: string;
  readonly source: DecodedImportText;
  readonly write: ImportWriteSummary;
};

export type ImportChunkRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath: string;
  readonly outputDir?: string;
  readonly maxChars?: number;
  readonly reason?: string;
};

export type ImportChunkManifest = {
  readonly kind: "novelfabric.import.chunks";
  readonly version: 1;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly maxChars: number;
  readonly chunks: readonly ImportChunk[];
};

export type ImportChunk = {
  readonly id: string;
  readonly index: number;
  readonly path: string;
  readonly charRange: SourceRange;
  readonly lineRange: SourceRange;
  readonly hash: string;
  readonly bytes: number;
};

export type ImportChunkResult = {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly manifestPath: string;
  readonly manifestHash: string;
  readonly chunks: readonly ImportChunk[];
  readonly writes: readonly ImportWriteSummary[];
};

export type ImportChapterizeRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath: string;
  readonly outputDir?: string;
  readonly reason?: string;
};

export type ImportChapterManifest = {
  readonly kind: "novelfabric.import.chapters";
  readonly version: 1;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly fallback: boolean;
  readonly chapters: readonly ImportChapter[];
};

export type ImportChapter = {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly heading: string | null;
  readonly path: string;
  readonly charRange: SourceRange;
  readonly lineRange: SourceRange;
  readonly hash: string;
  readonly bytes: number;
};

export type ImportChapterizeResult = {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly manifestPath: string;
  readonly manifestHash: string;
  readonly fallback: boolean;
  readonly chapters: readonly ImportChapter[];
  readonly writes: readonly ImportWriteSummary[];
};

export type ImportContextPackRequest = {
  readonly workspacePath: string;
  readonly actor: string;
  readonly sourcePath?: string;
  readonly chapterManifestPath?: string;
  readonly outputPath?: string;
  readonly reason?: string;
};

export type ImportContextPack = {
  readonly kind: "novelfabric.import.context-pack";
  readonly version: 1;
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly sourceExcerpt: string;
  readonly chapterManifestPath: string | null;
  readonly chapters: readonly ImportContextChapter[];
};

export type ImportContextChapter = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly hash: string;
};

export type ImportContextPackResult = {
  readonly sourcePath: string;
  readonly sourceHash: string;
  readonly outputPath: string;
  readonly outputHash: string;
  readonly chapterCount: number;
  readonly write: ImportWriteSummary;
};

export type ImportValidateRequest = {
  readonly workspacePath: string;
  readonly path?: string;
};

export type ImportValidateResult = {
  readonly valid: boolean;
  readonly checked: readonly string[];
  readonly issues: readonly ImportValidationIssue[];
};

export type ImportValidationIssue = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
};

export type ImportInboxRequest = {
  readonly workspacePath: string;
};

export type ImportInboxResult = {
  readonly sources: readonly ImportInboxItem[];
  readonly normalized: readonly ImportInboxItem[];
  readonly chunkManifests: readonly ImportInboxItem[];
  readonly chapterManifests: readonly ImportInboxItem[];
  readonly contextPacks: readonly ImportInboxItem[];
};

export type ImportInboxItem = {
  readonly path: string;
  readonly bytes: number;
  readonly hash: string;
  readonly encoding?: ImportDecodeEncoding;
  readonly replacements?: number;
};

export type SourceRange = {
  readonly start: number;
  readonly end: number;
};

type LineSpan = {
  readonly line: number;
  readonly start: number;
  readonly end: number;
};

type HeadingSpan = {
  readonly line: number;
  readonly start: number;
  readonly heading: string;
};

type ResolvedWorkspaceRead = {
  readonly normalizedPath: string;
  readonly buffer: Buffer;
};

const DEFAULT_CHUNK_MAX_CHARS = 2400;
const MIN_CHUNK_MAX_CHARS = 200;
const MAX_CHUNK_MAX_CHARS = 50_000;
const SOURCE_EXCERPT_CHARS = 2000;

export async function addImportSource(request: ImportAddRequest): Promise<ImportAddResult> {
  const source = await resolveAddSourceText(request);
  const targetPath = resolveImportAddTarget(request, request.sourcePath);
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: targetPath,
    content: source.content,
    actor: request.actor,
    reason: request.reason ?? "import add"
  });
  return { source, write: summarizeWrite(write) };
}

export async function normalizeImportSource(
  request: ImportNormalizeRequest
): Promise<ImportNormalizeResult> {
  const source = await readDecodedWorkspaceText(request.workspacePath, request.sourcePath);
  const outputPath =
    request.outputPath ?? `imports/normalized/${stemForPath(request.sourcePath)}.txt`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content: source.content,
    actor: request.actor,
    reason: request.reason ?? "import normalize"
  });
  return {
    sourcePath: normalizeWorkspacePath(request.sourcePath),
    source,
    write: summarizeWrite(write)
  };
}

export async function chunkImportSource(request: ImportChunkRequest): Promise<ImportChunkResult> {
  const source = await readDecodedWorkspaceText(request.workspacePath, request.sourcePath);
  assertNonEmptySource(source.content, request.sourcePath);
  const maxChars = normalizeMaxChars(request.maxChars);
  const outputDir = request.outputDir ?? `imports/chunks/${stemForPath(request.sourcePath)}`;
  const sourcePath = normalizeWorkspacePath(request.sourcePath);
  const sourceHash = contentHash(source.content);
  const chunks = buildChunks(source.content, outputDir, maxChars);
  const writes: ImportWriteSummary[] = [];

  for (const chunk of chunks) {
    const chunkContent = source.content.slice(chunk.charRange.start, chunk.charRange.end);
    const write = await writeWorkspaceFile({
      workspacePath: request.workspacePath,
      path: chunk.path,
      content: chunkContent,
      actor: request.actor,
      reason: request.reason ?? "import chunk"
    });
    writes.push(summarizeWrite(write));
  }

  const manifest: ImportChunkManifest = {
    kind: "novelfabric.import.chunks",
    version: 1,
    sourcePath,
    sourceHash,
    maxChars,
    chunks
  };
  const manifestPath = `${normalizeWorkspacePath(outputDir)}/manifest.json`;
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: manifestPath,
    content: manifestContent,
    actor: request.actor,
    reason: request.reason ?? "import chunk manifest"
  });
  writes.push(summarizeWrite(manifestWrite));

  return {
    sourcePath,
    sourceHash,
    manifestPath,
    manifestHash: contentHash(manifestContent),
    chunks,
    writes
  };
}

export async function chapterizeImportSource(
  request: ImportChapterizeRequest
): Promise<ImportChapterizeResult> {
  const source = await readDecodedWorkspaceText(request.workspacePath, request.sourcePath);
  assertNonEmptySource(source.content, request.sourcePath);
  const outputDir = request.outputDir ?? `imports/chapters/${stemForPath(request.sourcePath)}`;
  const sourcePath = normalizeWorkspacePath(request.sourcePath);
  const sourceHash = contentHash(source.content);
  const chapterBuild = buildChapters(source.content, outputDir, stemForPath(request.sourcePath));
  const writes: ImportWriteSummary[] = [];

  for (const chapter of chapterBuild.chapters) {
    const chapterContent = source.content.slice(chapter.charRange.start, chapter.charRange.end);
    const write = await writeWorkspaceFile({
      workspacePath: request.workspacePath,
      path: chapter.path,
      content: chapterContent,
      actor: request.actor,
      reason: request.reason ?? "import chapterize"
    });
    writes.push(summarizeWrite(write));
  }

  const manifest: ImportChapterManifest = {
    kind: "novelfabric.import.chapters",
    version: 1,
    sourcePath,
    sourceHash,
    fallback: chapterBuild.fallback,
    chapters: chapterBuild.chapters
  };
  const manifestPath = `${normalizeWorkspacePath(outputDir)}/manifest.json`;
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestWrite = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: manifestPath,
    content: manifestContent,
    actor: request.actor,
    reason: request.reason ?? "import chapter manifest"
  });
  writes.push(summarizeWrite(manifestWrite));

  return {
    sourcePath,
    sourceHash,
    manifestPath,
    manifestHash: contentHash(manifestContent),
    fallback: chapterBuild.fallback,
    chapters: chapterBuild.chapters,
    writes
  };
}

export async function buildImportContextPack(
  request: ImportContextPackRequest
): Promise<ImportContextPackResult> {
  const chapterManifest = await readOptionalChapterManifest(request);
  const sourcePath = normalizeWorkspacePath(
    request.sourcePath ?? chapterManifest?.sourcePath ?? failMissingContextPackSource()
  );
  const source = await readDecodedWorkspaceText(request.workspacePath, sourcePath);
  const chapters =
    chapterManifest?.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      path: chapter.path,
      hash: chapter.hash
    })) ?? [];
  const pack: ImportContextPack = {
    kind: "novelfabric.import.context-pack",
    version: 1,
    sourcePath,
    sourceHash: contentHash(source.content),
    sourceExcerpt: source.content.slice(0, SOURCE_EXCERPT_CHARS),
    chapterManifestPath:
      request.chapterManifestPath === undefined
        ? null
        : normalizeWorkspacePath(request.chapterManifestPath),
    chapters
  };
  const outputPath =
    request.outputPath ?? `simulation/context-packs/import-${stemForPath(sourcePath)}.json`;
  const content = `${JSON.stringify(pack, null, 2)}\n`;
  const write = await writeWorkspaceFile({
    workspacePath: request.workspacePath,
    path: outputPath,
    content,
    actor: request.actor,
    reason: request.reason ?? "import context-pack"
  });

  return {
    sourcePath,
    sourceHash: pack.sourceHash,
    outputPath: normalizeWorkspacePath(outputPath),
    outputHash: contentHash(content),
    chapterCount: chapters.length,
    write: summarizeWrite(write)
  };
}

export async function validateImportWorkspace(
  request: ImportValidateRequest
): Promise<ImportValidateResult> {
  const checked: string[] = [];
  const issues: ImportValidationIssue[] = [];

  if (request.path !== undefined) {
    await validateImportPath(request.workspacePath, request.path, checked, issues);
  } else {
    const sourcePaths = await listFilesUnder(request.workspacePath, "imports/source");
    if (sourcePaths.length === 0) {
      issues.push({
        severity: "warning",
        code: "import_inbox_empty",
        path: "imports/source",
        message: "Import source inbox is empty."
      });
    }
    for (const sourcePath of sourcePaths) {
      await validateImportPath(request.workspacePath, sourcePath, checked, issues);
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    checked,
    issues
  };
}

export async function readImportInbox(request: ImportInboxRequest): Promise<ImportInboxResult> {
  const [sources, normalized, chunkManifests, chapterManifests, contextPacks] = await Promise.all([
    readInboxItems(request.workspacePath, "imports/source", true),
    readInboxItems(request.workspacePath, "imports/normalized", true),
    readInboxItems(request.workspacePath, "imports/chunks", false, "manifest.json"),
    readInboxItems(request.workspacePath, "imports/chapters", false, "manifest.json"),
    readInboxItems(request.workspacePath, "simulation/context-packs", false, ".json")
  ]);
  return { sources, normalized, chunkManifests, chapterManifests, contextPacks };
}

export function decodeAndNormalizeImportText(buffer: Buffer): DecodedImportText {
  const candidates = [decodeCandidate(buffer, "utf-8"), decodeCandidate(buffer, "gb18030")];
  const chosen = [...candidates].sort((left, right) => {
    if (left.replacements !== right.replacements) return left.replacements - right.replacements;
    return left.encoding === "utf-8" ? -1 : 1;
  })[0];
  if (chosen === undefined) {
    throw new CommandFailure("import_decode_failed", "Could not decode import source text.");
  }
  const content = normalizeImportedText(chosen.content);
  return {
    content,
    encoding: chosen.encoding,
    replacements: chosen.replacements,
    bytes: buffer.byteLength,
    hash: contentHash(content),
    lineCount: countLines(content),
    charCount: content.length
  };
}

export function normalizeImportedText(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

async function resolveAddSourceText(request: ImportAddRequest): Promise<DecodedImportText> {
  if (request.sourcePath !== undefined && request.content !== undefined) {
    throw new CommandFailure("invalid_import_input", "Use only one of sourcePath or content.");
  }
  if (request.sourcePath !== undefined) {
    const buffer = await readFile(request.sourcePath);
    return decodeAndNormalizeImportText(buffer);
  }
  if (request.content !== undefined) {
    return decodeAndNormalizeImportText(Buffer.from(request.content, "utf8"));
  }
  throw new CommandFailure("invalid_import_input", "Import add requires sourcePath or content.");
}

function resolveImportAddTarget(request: ImportAddRequest, sourcePath: string | undefined): string {
  if (request.targetPath !== undefined && request.targetName !== undefined) {
    throw new CommandFailure("invalid_import_target", "Use only one of targetPath or targetName.");
  }
  if (request.targetPath !== undefined) return normalizeImportTargetPath(request.targetPath);
  const rawName =
    request.targetName ?? (sourcePath === undefined ? "stdin.txt" : path.basename(sourcePath));
  return `imports/source/${safeFileName(rawName)}`;
}

function normalizeImportTargetPath(targetPath: string): string {
  const normalized = normalizeWorkspacePath(targetPath);
  if (!normalized.startsWith("imports/source/") || normalized.endsWith("/")) {
    throw new CommandFailure(
      "invalid_import_target",
      "Import add target path must be a file under imports/source/."
    );
  }
  return normalized;
}

async function readDecodedWorkspaceText(
  workspacePath: string,
  requestedPath: string
): Promise<DecodedImportText> {
  const resolved = await readWorkspaceBuffer(workspacePath, requestedPath);
  return decodeAndNormalizeImportText(resolved.buffer);
}

async function readWorkspaceBuffer(
  workspacePath: string,
  requestedPath: string
): Promise<ResolvedWorkspaceRead> {
  const binary = await readWorkspaceBinaryFile({ workspacePath, path: requestedPath });
  return {
    normalizedPath: binary.path,
    buffer: binary.buffer
  };
}

function decodeCandidate(buffer: Buffer, encoding: ImportDecodeEncoding): DecodedCandidate {
  const decoder = new TextDecoder(encoding);
  const content = decoder.decode(buffer);
  return { encoding, content, replacements: countReplacementCharacters(content) };
}

type DecodedCandidate = {
  readonly encoding: ImportDecodeEncoding;
  readonly content: string;
  readonly replacements: number;
};

function countReplacementCharacters(content: string): number {
  let count = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charAt(index) === "\uFFFD") count += 1;
  }
  return count;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (maxChars === undefined) return DEFAULT_CHUNK_MAX_CHARS;
  if (
    !Number.isInteger(maxChars) ||
    maxChars < MIN_CHUNK_MAX_CHARS ||
    maxChars > MAX_CHUNK_MAX_CHARS
  ) {
    throw new CommandFailure(
      "invalid_import_chunk_size",
      `Chunk size must be an integer between ${MIN_CHUNK_MAX_CHARS.toString()} and ${MAX_CHUNK_MAX_CHARS.toString()}.`
    );
  }
  return maxChars;
}

function assertNonEmptySource(content: string, sourcePath: string): void {
  if (content.trim().length === 0) {
    throw new CommandFailure("empty_import_source", `Import source '${sourcePath}' is empty.`);
  }
}

function buildChunks(content: string, outputDir: string, maxChars: number): readonly ImportChunk[] {
  const spans = lineSpans(content);
  const ranges: { start: number; end: number; lineStart: number; lineEnd: number }[] = [];
  let currentStart: number | null = null;
  let currentEnd = 0;
  let currentLineStart = 1;
  let currentLineEnd = 1;

  const flush = (): void => {
    if (currentStart === null) return;
    ranges.push({
      start: currentStart,
      end: currentEnd,
      lineStart: currentLineStart,
      lineEnd: currentLineEnd
    });
    currentStart = null;
  };

  const appendPiece = (start: number, end: number, line: number): void => {
    if (currentStart !== null && currentEnd - currentStart + end - start > maxChars) flush();
    if (currentStart === null) {
      currentStart = start;
      currentLineStart = line;
    }
    currentEnd = end;
    currentLineEnd = line;
  };

  for (const span of spans) {
    let cursor = span.start;
    while (cursor < span.end) {
      const pieceEnd = Math.min(span.end, cursor + maxChars);
      appendPiece(cursor, pieceEnd, span.line);
      cursor = pieceEnd;
    }
  }
  flush();

  return ranges.map((range, index) => {
    const id = `chunk-${String(index + 1).padStart(3, "0")}`;
    const chunkContent = content.slice(range.start, range.end);
    return {
      id,
      index: index + 1,
      path: `${normalizeWorkspacePath(outputDir)}/${id}.txt`,
      charRange: { start: range.start, end: range.end },
      lineRange: { start: range.lineStart, end: range.lineEnd },
      hash: contentHash(chunkContent),
      bytes: Buffer.byteLength(chunkContent, "utf8")
    };
  });
}

function buildChapters(
  content: string,
  outputDir: string,
  fallbackTitle: string
): { readonly fallback: boolean; readonly chapters: readonly ImportChapter[] } {
  const headings = findChapterHeadings(content);
  if (headings.length === 0) {
    const title = fallbackTitle.length === 0 ? "全文" : fallbackTitle;
    return {
      fallback: true,
      chapters: [
        makeChapter(content, outputDir, 1, title, null, 0, content.length, 1, countLines(content))
      ]
    };
  }

  const starts: { title: string; heading: string | null; start: number; line: number }[] = [];
  const firstHeading = headings[0];
  if (
    firstHeading !== undefined &&
    firstHeading.start > 0 &&
    content.slice(0, firstHeading.start).trim().length > 0
  ) {
    starts.push({ title: "开篇", heading: null, start: 0, line: 1 });
  }
  for (const heading of headings) {
    starts.push({
      title: heading.heading,
      heading: heading.heading,
      start: heading.start,
      line: heading.line
    });
  }

  const chapters = starts.map((start, index) => {
    const next = starts[index + 1];
    const end = next === undefined ? content.length : next.start;
    const lineEnd = next === undefined ? countLines(content) : Math.max(start.line, next.line - 1);
    return makeChapter(
      content,
      outputDir,
      index + 1,
      start.title,
      start.heading,
      start.start,
      end,
      start.line,
      lineEnd
    );
  });
  return { fallback: false, chapters };
}

function makeChapter(
  content: string,
  outputDir: string,
  index: number,
  title: string,
  heading: string | null,
  start: number,
  end: number,
  lineStart: number,
  lineEnd: number
): ImportChapter {
  const id = `chapter-${String(index).padStart(3, "0")}`;
  const chapterContent = content.slice(start, end);
  return {
    id,
    index,
    title,
    heading,
    path: `${normalizeWorkspacePath(outputDir)}/${id}.txt`,
    charRange: { start, end },
    lineRange: { start: lineStart, end: lineEnd },
    hash: contentHash(chapterContent),
    bytes: Buffer.byteLength(chapterContent, "utf8")
  };
}

function findChapterHeadings(content: string): readonly HeadingSpan[] {
  const spans = lineSpans(content);
  const headings: HeadingSpan[] = [];
  for (const span of spans) {
    const rawLine = content.slice(span.start, span.end).replace(/\n$/, "");
    const heading = rawLine.trim();
    if (isChineseChapterHeading(heading)) {
      headings.push({ line: span.line, start: span.start, heading });
    }
  }
  return headings;
}

function isChineseChapterHeading(line: string): boolean {
  if (line.length === 0 || line.length > 80) return false;
  const number = "[零〇一二两三四五六七八九十百千万0-9]+";
  const chineseChapter = new RegExp(`^第${number}[章节回卷集部篇](?:[\\s\\u3000:：、.．·-].*)?$`);
  if (chineseChapter.test(line)) return true;
  if (/^(序章|楔子|引子|前言|尾声|后记)(?:[\s\u3000:：、.．·-].*)?$/.test(line)) return true;
  return /^Chapter\s+[0-9]+\b.*$/i.test(line);
}

function lineSpans(content: string): readonly LineSpan[] {
  if (content.length === 0) return [];
  const spans: LineSpan[] = [];
  let cursor = 0;
  let line = 1;
  while (cursor < content.length) {
    const newline = content.indexOf("\n", cursor);
    const end = newline === -1 ? content.length : newline + 1;
    spans.push({ line, start: cursor, end });
    cursor = end;
    line += 1;
  }
  return spans;
}

async function readOptionalChapterManifest(
  request: ImportContextPackRequest
): Promise<ImportChapterManifest | null> {
  if (request.chapterManifestPath === undefined) return null;
  const resolved = await readWorkspaceBuffer(request.workspacePath, request.chapterManifestPath);
  const parsed = JSON.parse(resolved.buffer.toString("utf8")) as unknown;
  return parseChapterManifest(parsed, request.chapterManifestPath);
}

function parseChapterManifest(value: unknown, requestedPath: string): ImportChapterManifest {
  if (
    !isRecord(value) ||
    value["kind"] !== "novelfabric.import.chapters" ||
    !Array.isArray(value["chapters"])
  ) {
    throw new CommandFailure(
      "invalid_import_chapter_manifest",
      `Path '${requestedPath}' is not an import chapter manifest.`
    );
  }
  const sourcePath = value["sourcePath"];
  const sourceHash = value["sourceHash"];
  const fallback = value["fallback"];
  if (
    typeof sourcePath !== "string" ||
    typeof sourceHash !== "string" ||
    typeof fallback !== "boolean"
  ) {
    throw new CommandFailure(
      "invalid_import_chapter_manifest",
      `Path '${requestedPath}' has invalid chapter manifest metadata.`
    );
  }
  return {
    kind: "novelfabric.import.chapters",
    version: 1,
    sourcePath,
    sourceHash,
    fallback,
    chapters: value["chapters"].map((chapter, index) =>
      parseManifestChapter(chapter, index, requestedPath)
    )
  };
}

function parseManifestChapter(value: unknown, index: number, requestedPath: string): ImportChapter {
  if (!isRecord(value)) {
    throw new CommandFailure(
      "invalid_import_chapter_manifest",
      `Chapter ${String(index + 1)} in '${requestedPath}' is invalid.`
    );
  }
  const id = value["id"];
  const title = value["title"];
  const chapterPath = value["path"];
  const hash = value["hash"];
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof chapterPath !== "string" ||
    typeof hash !== "string"
  ) {
    throw new CommandFailure(
      "invalid_import_chapter_manifest",
      `Chapter ${String(index + 1)} in '${requestedPath}' is missing required fields.`
    );
  }
  return {
    id,
    index: index + 1,
    title,
    heading: typeof value["heading"] === "string" ? value["heading"] : null,
    path: chapterPath,
    charRange: parseRange(value["charRange"]),
    lineRange: parseRange(value["lineRange"]),
    hash,
    bytes: typeof value["bytes"] === "number" ? value["bytes"] : 0
  };
}

function parseRange(value: unknown): SourceRange {
  if (!isRecord(value) || typeof value["start"] !== "number" || typeof value["end"] !== "number") {
    return { start: 0, end: 0 };
  }
  return { start: value["start"], end: value["end"] };
}

function failMissingContextPackSource(): never {
  throw new CommandFailure(
    "invalid_import_context_pack_input",
    "import context-pack requires --source or --chapter-manifest."
  );
}

async function validateImportPath(
  workspacePath: string,
  requestedPath: string,
  checked: string[],
  issues: ImportValidationIssue[]
): Promise<void> {
  try {
    const resolved = await readWorkspaceBuffer(workspacePath, requestedPath);
    const decoded = decodeAndNormalizeImportText(resolved.buffer);
    checked.push(resolved.normalizedPath);
    if (decoded.content.trim().length === 0) {
      issues.push({
        severity: "error",
        code: "empty_import_source",
        path: resolved.normalizedPath,
        message: "Import text is empty after normalization."
      });
    }
    if (decoded.replacements > 0) {
      issues.push({
        severity: "warning",
        code: "import_decode_replacements",
        path: resolved.normalizedPath,
        message: `Decoded with ${String(decoded.replacements)} replacement characters.`
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      issues.push({
        severity: "error",
        code: "import_validate_read_failed",
        path: requestedPath,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

async function readInboxItems(
  workspacePath: string,
  directory: string,
  decodeText: boolean,
  matchName?: string
): Promise<readonly ImportInboxItem[]> {
  const files = await listFilesUnder(workspacePath, directory, matchName);
  const items = await Promise.all(
    files.map(async (filePath) => {
      const resolved = await readWorkspaceBuffer(workspacePath, filePath);
      const text = decodeText ? decodeAndNormalizeImportText(resolved.buffer) : null;
      const hash = text === null ? bufferHash(resolved.buffer) : text.hash;
      return {
        path: resolved.normalizedPath,
        bytes: resolved.buffer.byteLength,
        hash,
        ...(text === null ? {} : { encoding: text.encoding, replacements: text.replacements })
      };
    })
  );
  return items.sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
}

async function listFilesUnder(
  workspacePath: string,
  directory: string,
  matchName?: string
): Promise<readonly string[]> {
  const resolved = resolveInsideRoot(workspacePath, directory);
  try {
    const directoryStat = await lstat(resolved.target);
    if (!directoryStat.isDirectory()) return [];
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  await mkdir(resolved.target, { recursive: true });
  const entries = await readdir(resolved.target, { withFileTypes: true });
  const paths = await collectFiles(resolved.root, resolved.relativePath, entries, matchName);
  return [...paths].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

async function collectFiles(
  rootPath: string,
  relativeDirectory: string,
  entries: readonly Dirent[],
  matchName: string | undefined
): Promise<readonly string[]> {
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const childPath = normalizeWorkspacePath(path.join(relativeDirectory, entry.name));
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) {
        const childEntries = await readdir(path.join(rootPath, childPath), { withFileTypes: true });
        return collectFiles(rootPath, childPath, childEntries, matchName);
      }
      if (entry.isFile() && matchesInboxFile(entry.name, matchName)) return [childPath];
      return [];
    })
  );
  return nested.flat();
}

function matchesInboxFile(fileName: string, matchName: string | undefined): boolean {
  if (matchName === undefined) return true;
  if (matchName.startsWith(".")) return fileName.endsWith(matchName);
  return fileName === matchName;
}

function bufferHash(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function summarizeWrite(write: WorkspaceFileWriteResult): ImportWriteSummary {
  return { path: write.path, hash: write.hash, bytes: write.bytes, auditPath: write.auditPath };
}

function safeFileName(rawName: string): string {
  const baseName = path.basename(rawName).trim();
  if (baseName.length === 0 || baseName === "." || baseName === "..") {
    throw new CommandFailure("invalid_import_target", "Import target file name is empty.");
  }
  return baseName.replace(/[\\/:*?"<>|]/g, "_");
}

function stemForPath(filePath: string): string {
  const baseName = path.basename(filePath);
  const extension = path.extname(baseName);
  const stem = extension.length === 0 ? baseName : baseName.slice(0, -extension.length);
  return safeFileName(stem).replace(/\s+/g, "-");
}

function normalizeWorkspacePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
