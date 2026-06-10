import { test, expect } from "./helpers/bridge-fixture.js";

test.describe("runtime composer", () => {
  test("runs a Web-safe runtime task from the chat composer", async ({
    page,
    baseURL,
    workspacePath
  }) => {
    const targetURL = new URL(baseURL);
    targetURL.searchParams.set("workspace", workspacePath);
    targetURL.searchParams.set("actor", "main_agent");

    await page.goto(targetURL.toString(), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "聊天 Buffer" }).click();

    const runtimePanel = page.getByLabel("Runtime task status").first();
    await expect(runtimePanel.getByText("Runtime Policy")).toBeVisible();
    await expect(runtimePanel.getByText("web-safe")).toBeVisible();
    await expect(runtimePanel.getByText(/raw tools:\s*denied/i)).toBeVisible();

    const prompt = page.getByLabel("Workspace task prompt");
    await prompt.fill(
      [
        "请执行一次网页端 runtime composer 健康检查。",
        "返回 JSON，summary 必须包含 NovelFabric runtime composer，",
        "sourceAnchors 至少包含 runtime-composer-e2e。"
      ].join(" ")
    );
    await page.getByRole("button", { name: "发送" }).click();

    await expect(runtimePanel.getByText(/running|completed|failed|aborted/i)).toBeVisible();
    const eventTimeline = runtimePanel.locator(".runtime-events");
    await expect(eventTimeline).toBeVisible();

    await expect
      .poll(async () => (await runtimePanel.locator(".tiny-chip").first().innerText()).trim(), {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000]
      })
      .toMatch(/completed|failed|aborted/i);

    await expect(runtimePanel.locator(".tiny-chip", { hasText: "completed" }).first()).toBeVisible({
      timeout: 120_000
    });
    await expect(eventTimeline.locator(".runtime-event-row").first()).toBeVisible();

    const runtimeText = await runtimePanel.innerText();
    expect(runtimeText).not.toContain(workspacePath);
    expect(runtimeText).not.toContain(".novelfabric/tasks");
    expect(runtimeText).not.toContain("sessionFile");
    expect(runtimeText).not.toMatch(/api[_-]?key|authorization|bearer\s+[a-z0-9._-]+/iu);
  });
});
