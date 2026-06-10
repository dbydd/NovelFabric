import { type Page } from "@playwright/test";
import { access } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./helpers/bridge-fixture.js";

type WorkflowSnapshot = {
  readonly text: string;
  readonly completed: number;
  readonly total: number;
  readonly done: boolean;
  readonly failed: boolean;
  readonly stepRunStatus?: string;
  readonly errorSummary: string;
};

type StepWaitResult = {
  readonly state: "advanced" | "done" | "failed";
  readonly snapshot: WorkflowSnapshot;
};

const WORKFLOW_STEP_TIMEOUT_MS = 900_000;
const WORKFLOW_TOTAL_TIMEOUT_MS = 2_400_000;

test.describe("source workflow", () => {
  test("runs a source inbox workflow through the browser controls", async ({
    page,
    baseURL,
    workspacePath
  }) => {
    test.setTimeout(WORKFLOW_TOTAL_TIMEOUT_MS);
    page.setDefaultTimeout(120_000);

    const testNovelPath = path.resolve(process.cwd(), "test_novel.txt");
    await access(testNovelPath);

    const targetURL = new URL(baseURL);
    targetURL.searchParams.set("workspace", workspacePath);
    targetURL.searchParams.set("actor", "main_agent");

    await page.goto(targetURL.toString(), { waitUntil: "networkidle" });
    await openSourceInbox(page);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(testNovelPath);
    await expect(page.getByRole("heading", { name: "imports/source/test_novel.txt" })).toBeVisible({
      timeout: 120_000
    });
    await expect(page.getByText("saved · real workspace").first()).toBeVisible({
      timeout: 120_000
    });

    await openSourceInbox(page);
    await page.getByLabel("带入角色").selectOption("aria");
    await page.getByRole("button", { name: "创建真实工作流" }).click();

    const statusPanel = page.locator(".workflow-status-box").first();
    await expect(statusPanel).toBeVisible({ timeout: 120_000 });
    await expect(statusPanel).toContainText(/Job/);
    await expect(statusPanel).toContainText(/状态/);

    const stepButton = page.getByRole("button", { name: "执行下一步" });
    let snapshot: WorkflowSnapshot;

    for (let step = 0; step < 24; step += 1) {
      snapshot = await readWorkflowSnapshot(page);
      if (snapshot.done) break;
      expect(
        snapshot.failed,
        `Workflow failed before step ${step.toString()}:\n${snapshot.text}`
      ).toBe(false);

      const previousCompleted = snapshot.completed;
      await expect(stepButton).toBeEnabled({ timeout: 120_000 });
      await stepButton.click();

      const stepResult = await waitForWorkflowStepTerminal(page, previousCompleted);
      await refreshWorkflowStatusFromUi(page);
      expect(
        stepResult.state,
        `Workflow step ${step.toString()} failed:\n${stepResult.snapshot.text}`
      ).not.toBe("failed");
    }

    snapshot = await readWorkflowSnapshot(page);
    expect(snapshot.failed, `Workflow ended in failed state:\n${snapshot.text}`).toBe(false);
    expect(snapshot.done, `Workflow did not reach done/completed state:\n${snapshot.text}`).toBe(
      true
    );
    expect(snapshot.completed).toBeGreaterThan(0);
    expect(snapshot.completed).toBe(snapshot.total);

    await page.getByRole("button", { name: "验证结果" }).click();
    const verifyPanel = page.locator(".workflow-verify-panel").first();
    await expect(verifyPanel).toBeVisible({ timeout: 120_000 });
    await expect(verifyPanel.locator("strong")).toHaveText("验证通过");
    await expect(verifyPanel).not.toContainText("验证未通过");

    const artifactList = page.locator(".workflow-artifact-list").first();
    await expect(artifactList).toBeVisible({ timeout: 120_000 });
    await expect(artifactList.locator("article").first()).toBeVisible();
    await expect(artifactList).toContainText("swarm-output");
    await expect(artifactList).toContainText("report-artifact");
    await expect(artifactList).toContainText("writing-draft");
    await expect(artifactList).toContainText(/novelfabric\.swarm\.output|simulation\/rounds\//u);
    await expect(artifactList).toContainText(/novelfabric\.report\.artifact|reports\//u);
    await expect(artifactList).toContainText(/novelfabric\.writing\.draft|writing\/drafts\//u);

    await openArtifactByName(page, "writing-draft");

    const editor = page.locator(".file-editor-card").first();
    await expect(editor).toBeVisible({ timeout: 120_000 });
    const content = await editor.locator("textarea").first().inputValue();
    assertFinalArtifactContent(content);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(workspacePath);
    expect(bodyText).not.toContain(".novelfabric/tasks");
    expect(bodyText).not.toContain("sessionFile");
    expect(bodyText).not.toMatch(/api[_-]?key|authorization|bearer\s+[a-z0-9._-]+/iu);
  });
});

async function openSourceInbox(page: Page): Promise<void> {
  try {
    await page.getByRole("button", { name: "directory imports" }).click({ timeout: 20_000 });
    await page.getByRole("button", { name: /source inbox/i }).click({ timeout: 20_000 });
  } catch {
    await page.getByRole("button", { name: "文件管理" }).click();
    await page.getByText("imports/source").first().click({ timeout: 20_000 });
  }
  await expect(page.getByRole("heading", { name: "真实工作流" })).toBeVisible({
    timeout: 60_000
  });
}

async function readWorkflowSnapshot(page: Page): Promise<WorkflowSnapshot> {
  const bodyText = await page.locator("body").innerText();
  const statusText = await page
    .locator(".workflow-status-box")
    .first()
    .innerText()
    .catch(() => "");
  const errorText = await page
    .locator(".error-text")
    .last()
    .innerText()
    .catch(() => "");
  const text = `${statusText}\n${errorText}\n${bodyText}`;
  const progressMatch = /(\d+)\/(\d+)/u.exec(statusText);
  const completed = progressMatch === null ? 0 : Number.parseInt(progressMatch[1] ?? "0", 10);
  const total = progressMatch === null ? 0 : Number.parseInt(progressMatch[2] ?? "0", 10);
  const stepRunStatus = /step\s+([a-z-]+)/iu.exec(statusText)?.[1];
  const failed = /failed|工作流执行失败|真实工作流创建失败|验证未通过/iu.test(text);
  return {
    text,
    completed,
    total,
    done:
      total > 0 &&
      completed >= total &&
      (/\bcompleted\b/iu.test(statusText) || /下一步\s*完成/u.test(statusText)),
    failed,
    ...(stepRunStatus === undefined ? {} : { stepRunStatus }),
    errorSummary: errorText.trim().slice(0, 1_000)
  };
}

async function openArtifactByName(page: Page, artifactName: string): Promise<void> {
  const artifactList = page.locator(".workflow-artifact-list").first();
  const artifactCard = artifactList.locator("article", { hasText: artifactName }).first();
  await expect(artifactCard).toBeVisible({ timeout: 120_000 });
  await expect(artifactCard).not.toContainText("[internal-task-artifact]");
  await artifactCard.getByRole("button").first().click();
}

function assertFinalArtifactContent(content: string): void {
  const normalized = content.trim();
  expect(normalized.length).toBeGreaterThan(240);
  expect(normalized).toMatch(/叶小伟|小叶同志/u);
  expect(normalized).toMatch(/装备科|五四式手枪|公安局|临时工/u);
  expect(normalized).toMatch(/第1章|这是哪里|国庆长假/u);
  expect(normalized).not.toMatch(/placeholder|todo|lorem ipsum|待补充|示例|模板内容/u);
  expect(normalized).not.toMatch(/只输出|OUTPUT_SCHEMA_JSON|sourceAnchors must contain/iu);
}

async function waitForWorkflowStepTerminal(
  page: Page,
  previousCompleted: number
): Promise<StepWaitResult> {
  const deadline = Date.now() + WORKFLOW_STEP_TIMEOUT_MS;
  let lastSnapshot = await readWorkflowSnapshot(page);

  while (Date.now() < deadline) {
    await refreshWorkflowStatusFromUi(page);
    lastSnapshot = await readWorkflowSnapshot(page);

    if (lastSnapshot.failed) return { state: "failed", snapshot: lastSnapshot };
    if (lastSnapshot.done) return { state: "done", snapshot: lastSnapshot };
    if (lastSnapshot.completed > previousCompleted) {
      return { state: "advanced", snapshot: lastSnapshot };
    }

    const status = lastSnapshot.stepRunStatus;
    if (status === "failed") return { state: "failed", snapshot: lastSnapshot };
    if (status === "completed" && lastSnapshot.completed <= previousCompleted) {
      await page.waitForTimeout(1_000);
      await refreshWorkflowStatusFromUi(page);
      lastSnapshot = await readWorkflowSnapshot(page);
      if (lastSnapshot.completed > previousCompleted) {
        return { state: "advanced", snapshot: lastSnapshot };
      }
      if (lastSnapshot.failed) return { state: "failed", snapshot: lastSnapshot };
    }

    await page.waitForTimeout(status === "running" ? 5_000 : 2_000);
  }

  throw new Error(
    [
      `Timed out waiting for workflow step to finish after ${WORKFLOW_STEP_TIMEOUT_MS.toString()}ms.`,
      `Previous completed: ${previousCompleted.toString()}.`,
      `Last completed: ${lastSnapshot.completed.toString()}/${lastSnapshot.total.toString()}.`,
      `Last stepRun: ${lastSnapshot.stepRunStatus ?? "unknown"}.`,
      `Error: ${lastSnapshot.errorSummary || "none"}.`,
      `Status text: ${lastSnapshot.text.slice(0, 2_000)}`
    ].join("\n")
  );
}

async function refreshWorkflowStatusFromUi(page: Page): Promise<void> {
  const refreshButton = page.getByRole("button", { name: "刷新状态" });
  await expect(refreshButton).toBeEnabled({ timeout: 120_000 });
  await refreshButton.click();
  await page.waitForTimeout(250);
}
