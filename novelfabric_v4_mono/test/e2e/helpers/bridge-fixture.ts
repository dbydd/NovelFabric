import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type BridgeFixture = {
  readonly page: Page;
  readonly workspacePath: string;
  readonly baseURL: string;
  readonly bridgePort: number;
};

export const test = base.extend<{
  readonly workspacePath: string;
  readonly bridgePort: number;
  readonly baseURL: string;
}>({
  bridgePort: async ({}, use) => {
    const port = await allocateNovelFabricPort();
    await use(port);
  },
  workspacePath: async ({}, use) => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-e2e-workspace-"));
    await fs.cp(fixtureWorkspacePath(), workspacePath, { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".novelfabric", "capabilities.toml"),
      [
        "[main_agent]",
        'allow = ["project.manage", "files.patch_protected"]',
        "",
        "[role_agent]",
        'allow = ["memory.recall", "simulation.append_turn"]',
        'deny = ["files.patch_protected", "external_swarm.run"]',
        ""
      ].join("\n"),
      "utf8"
    );

    try {
      await use(workspacePath);
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  },
  baseURL: async ({ bridgePort, workspacePath }, use) => {
    const bridge = startWebBridge({ workspacePath, port: bridgePort });
    const baseURL = `http://127.0.0.1:${bridgePort.toString()}/`;
    try {
      await waitForHttpOk(baseURL);
      await use(baseURL);
    } finally {
      await stopWebBridge(bridge);
    }
  }
});

export { expect };

function fixtureWorkspacePath(): string {
  return path.resolve(process.cwd(), "fixtures", "workspaces", "valid-basic");
}

async function allocateNovelFabricPort(): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 50_000 + Math.floor(Math.random() * 10_000);
    if (await canListen(port)) return port;
  }
  throw new Error("Unable to allocate a NovelFabric e2e port in the 50000+ range.");
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function startWebBridge(options: {
  readonly workspacePath: string;
  readonly port: number;
}): ChildProcessWithoutNullStreams {
  const child = spawn(
    "npm",
    [
      "run",
      "cli",
      "--",
      "web",
      "bridge",
      "--workspace",
      options.workspacePath,
      "--port",
      options.port.toString(),
      "--actor",
      "main_agent",
      "--json"
    ],
    {
      cwd: process.cwd(),
      detached: true,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: "pipe"
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

async function stopWebBridge(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    if (child.pid === undefined) {
      resolve();
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-(child.pid ?? 0), "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      resolve();
    }, 5_000).unref();
  });
}

async function waitForHttpOk(baseURL: string): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status.toString()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for web bridge at ${baseURL}: ${String(lastError)}`);
}
