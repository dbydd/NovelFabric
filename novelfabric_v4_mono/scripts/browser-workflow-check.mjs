import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..");
const rootDir = path.resolve(repoDir, "..");
const fixture = path.join(repoDir, "fixtures/workspaces/valid-basic");
const testNovel = path.join(rootDir, "test_novel.txt");
const workspace = await mkdtemp(path.join(os.tmpdir(), "nf-browser-workflow-"));
await cp(fixture, workspace, { recursive: true });
const port = 50031;
const server = spawn(
  "npm",
  [
    "run",
    "cli",
    "--",
    "web",
    "bridge",
    "--workspace",
    workspace,
    "--port",
    String(port),
    "--actor",
    "main_agent"
  ],
  {
    cwd: repoDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: "/Users/dbydd" }
  }
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function cleanup() {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rm(workspace, { recursive: true, force: true });
}

try {
  const url = `http://127.0.0.1:${port}/?workspace=${encodeURIComponent(workspace)}&actor=main_agent`;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (i === 79) throw new Error(`server did not start: ${serverLog}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const blockers = [];
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(repoDir, "browser-workflow-before.png"),
    fullPage: true
  });

  try {
    await page.getByRole("button", { name: "directory imports" }).click({ timeout: 5000 });
    await page.getByRole("button", { name: /source inbox/i }).click({ timeout: 5000 });
  } catch {
    await page.getByRole("button", { name: "文件管理" }).click();
    await page.getByText("imports/source").first().click({ timeout: 5000 });
  }

  await page.locator('input[type="file"]').setInputFiles(testNovel);
  await page.waitForTimeout(1000);

  for (let i = 1; i <= 10; i += 1) {
    await page.getByRole("button", { name: /Source Inbox/ }).click();
    if (i % 2 === 0) {
      await page.locator("select").selectOption("custom");
      const input = page.locator(".workflow-field input");
      await input.fill(`原创角色${i}`);
    } else {
      await page.locator("select").selectOption("aria");
    }
    await page.getByRole("button", { name: "执行完整闭环" }).click();
    const label = String(i).padStart(2, "0");
    await page.getByText(`browser-chapter-${label}.md`).first().waitFor({ timeout: 30000 });
    await page.getByText(`浏览器闭环章节 ${label}`).waitFor({ timeout: 10000 });
  }

  await page.screenshot({ path: path.join(repoDir, "browser-workflow-after.png"), fullPage: true });
  const finalText = await page.locator("body").innerText();
  const expectations = ["浏览器闭环章节 10", "Bridge Live"];
  for (const expected of expectations) {
    if (!finalText.includes(expected)) blockers.push(`missing visible evidence: ${expected}`);
  }
  await browser.close();

  if (blockers.length > 0) {
    console.log(JSON.stringify({ ok: false, workspace, blockers }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          ok: true,
          workspace,
          rounds: 10,
          screenshots: ["browser-workflow-before.png", "browser-workflow-after.png"]
        },
        null,
        2
      )
    );
  }
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        workspace,
        error: error instanceof Error ? error.message : String(error),
        serverLog
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
