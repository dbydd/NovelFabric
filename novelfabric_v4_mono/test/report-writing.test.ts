import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyReportArtifact,
  createReportTask,
  listReports,
  showReport,
  validateReportArtifact,
  type NovelFabricReportArtifact
} from "../src/report/index.js";
import {
  applyWritingDraft,
  buildWritingContextPack,
  createWritingDraftTask,
  exportWriting,
  reviewChapter,
  type NovelFabricWritingDraft
} from "../src/writing/index.js";
import { contentHash, readWorkspaceFile, writeWorkspaceFile } from "../src/workspace/files.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../fixtures/workspaces/valid-basic");

describe("report and writing deterministic services", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-report-writing-test-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md",
      content: "# Chapter One\n\nAria opens the west gate.\n",
      actor: "main_agent",
      reason: "seed chapter"
    });
    await writeWorkspaceFile({
      workspacePath,
      path: "simulation/sessions/session-001.json",
      content: '{"id":"session-001","status":"ready"}\n',
      actor: "main_agent",
      reason: "seed session"
    });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("creates report tasks, validates report artifacts, applies reports, and lists/shows them", async () => {
    const task = await createReportTask({
      workspacePath,
      actor: "main_agent",
      session: "session-001",
      kind: "consistency"
    });
    expect(task.taskPath).toMatch(/^reports\/tasks\/report-consistency-/);
    expect(task.reportPath).toBe("reports/consistency-session-001.md");

    const citation = await readWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md"
    });
    const artifact: NovelFabricReportArtifact = {
      kind: "novelfabric.report.artifact",
      version: 1,
      reportKind: "consistency",
      session: "session-001",
      title: "Consistency Report",
      markdown: "# Consistency Report\n\nNo blocking contradiction found.",
      citations: [{ path: citation.path, hash: citation.hash }]
    };
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/artifacts/consistency-session-001.json",
      content: `${JSON.stringify(artifact, null, 2)}\n`,
      actor: "main_agent",
      reason: "seed report artifact"
    });

    const validation = await validateReportArtifact({
      workspacePath,
      artifactPath: "reports/artifacts/consistency-session-001.json"
    });
    expect(validation.valid).toBe(true);
    expect(validation.checked).toContain("writing/chapters/chapter-001.md");

    const applied = await applyReportArtifact({
      workspacePath,
      actor: "main_agent",
      artifactPath: "reports/artifacts/consistency-session-001.json",
      outputPath: "reports/consistency-session-001.md"
    });
    expect(applied.reportPath).toBe("reports/consistency-session-001.md");

    const listed = await listReports({ workspacePath });
    expect(listed.reports.map((report) => report.path)).toContain(
      "reports/consistency-session-001.md"
    );

    const shown = await showReport({ workspacePath, path: "reports/consistency-session-001.md" });
    expect(shown.content).toContain("No blocking contradiction");
  });

  it("rejects report artifacts with stale citation hashes", async () => {
    const citation = await readWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md"
    });
    const artifact: NovelFabricReportArtifact = {
      kind: "novelfabric.report.artifact",
      version: 1,
      reportKind: "consistency",
      session: "session-001",
      title: "Stale Report",
      markdown: "# Stale Report\n",
      citations: [{ path: citation.path, hash: contentHash("old") }]
    };
    await writeWorkspaceFile({
      workspacePath,
      path: "reports/artifacts/stale.json",
      content: `${JSON.stringify(artifact, null, 2)}\n`,
      actor: "main_agent"
    });

    const validation = await validateReportArtifact({
      workspacePath,
      artifactPath: "reports/artifacts/stale.json"
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("citation_hash_mismatch");
  });

  it("builds writing context, creates draft task, applies draft, reviews, and exports chapters", async () => {
    const pack = await buildWritingContextPack({
      workspacePath,
      actor: "main_agent",
      session: "session-001"
    });
    expect(pack.outputPath).toBe("writing/context-packs/session-001.json");
    expect(pack.citationCount).toBeGreaterThan(0);

    const task = await createWritingDraftTask({
      workspacePath,
      actor: "main_agent",
      contextPackPath: pack.outputPath
    });
    expect(task.taskPath).toMatch(/^writing\/drafts\/tasks\/writing-draft-session-001-/);

    const chapter = await readWorkspaceFile({
      workspacePath,
      path: "writing/chapters/chapter-001.md"
    });
    const draft: NovelFabricWritingDraft = {
      kind: "novelfabric.writing.draft",
      version: 1,
      title: "Chapter Two",
      markdown: "# Chapter Two\n\nAria writes the next move into the record.",
      citations: [{ path: chapter.path, hash: chapter.hash }]
    };
    await writeWorkspaceFile({
      workspacePath,
      path: "writing/drafts/chapter-two.json",
      content: `${JSON.stringify(draft, null, 2)}\n`,
      actor: "main_agent",
      reason: "seed writing draft"
    });

    const applied = await applyWritingDraft({
      workspacePath,
      actor: "main_agent",
      draftPath: "writing/drafts/chapter-two.json",
      outputPath: "writing/chapters/chapter-002.md"
    });
    expect(applied.chapterPath).toBe("writing/chapters/chapter-002.md");

    const review = await reviewChapter({
      workspacePath,
      chapterPath: "writing/chapters/chapter-002.md"
    });
    expect(review.valid).toBe(true);
    expect(review.wordCount).toBeGreaterThan(0);

    const exported = await exportWriting({
      workspacePath,
      actor: "main_agent",
      format: "markdown",
      outputPath: "writing/exports/all.md"
    });
    expect(exported.exportPath).toBe("writing/exports/all.md");
    expect(exported.chapterCount).toBeGreaterThanOrEqual(2);
  });
});
