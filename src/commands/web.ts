import type { Command } from "commander";
import { createServer, type ViteDevServer } from "vite";

import { CommandFailure } from "../errors.js";
import { writeJson } from "../output.js";
import { resolveOutputMode, type JsonOutputOptions } from "./options.js";

const DEFAULT_DEMO_HOST = "127.0.0.1";
const DEFAULT_DEMO_PORT = 50021;
const RESERVED_PORTS = new Set([3000, 8080]);

export function addWebCommands(program: Command): void {
  const web = program.command("web").description("Optional NovelFabric V4 mono app web surfaces");

  web
    .command("demo")
    .description("Start or describe the layout-only mono app demo")
    .option("--host <host>", "Host to bind", DEFAULT_DEMO_HOST)
    .option("--port <port>", "Port to bind; defaults to a 50000+ NovelFabric port")
    .option("--dry-run", "Print launch diagnostics without starting the Vite server")
    .option("--json", "Print machine-readable JSON (default; records explicit output intent)")
    .action(async (options: WebDemoOptions) => {
      const host = options.host ?? DEFAULT_DEMO_HOST;
      const port = parseDemoPort(options.port);
      const url = `http://${host}:${port.toString()}/`;
      const payload = {
        mode: "layout-only-demo",
        host,
        port,
        url,
        backendApi: "disabled",
        piAgentBridge: "disabled",
        staticData: "src/web/App.vue inline static data",
        constraints: {
          noBackendCalls: true,
          externalSwarmApiFrozen: true,
          cliFirstRuntime: true,
          defaultPortRange: "50000+"
        },
        outputMode: resolveOutputMode(options)
      } as const;

      if (options.dryRun === true) {
        writeJson({ ok: true, command: "web demo", data: payload });
        return;
      }

      const server = await createViteServer(host, port);
      await server.listen();
      writeJson({ ok: true, command: "web demo", data: payload });
      installShutdownHandlers(server);
    });

  web
    .command("bridge")
    .description("Start or describe the CLI-backed local file editor bridge")
    .requiredOption("--workspace <path>", "Workspace root that the bridge may read/write")
    .option("--actor <actor>", "Capability manifest actor for editor writes", "main_agent")
    .option("--host <host>", "Host to bind", DEFAULT_DEMO_HOST)
    .option("--port <port>", "Port to bind; defaults to a 50000+ NovelFabric port")
    .option("--dry-run", "Print launch diagnostics without starting the Vite server")
    .option("--json", "Print machine-readable JSON (default; records explicit output intent)")
    .action(async (options: WebBridgeOptions) => {
      const host = options.host ?? DEFAULT_DEMO_HOST;
      const port = parseDemoPort(options.port);
      const url = `http://${host}:${port.toString()}/?workspace=${encodeURIComponent(
        options.workspace
      )}&actor=${encodeURIComponent(options.actor)}`;
      const payload = {
        mode: "cli-backed-file-bridge",
        host,
        port,
        url,
        workspaceRoot: options.workspace,
        actor: options.actor,
        backendApi: "cli-backed-bridge",
        piAgentBridge: "web-safe-session-prepare",
        constraints: {
          noDirectWebWrites: true,
          fileWritesUseSharedServices: true,
          externalSwarmApiFrozen: true,
          cliFirstRuntime: true,
          defaultPortRange: "50000+"
        },
        outputMode: resolveOutputMode(options)
      } as const;

      if (options.dryRun === true) {
        writeJson({ ok: true, command: "web bridge", data: payload });
        return;
      }

      process.env["NOVELFABRIC_WEB_BRIDGE"] = "1";
      process.env["NOVELFABRIC_WEB_BRIDGE_WORKSPACE"] = options.workspace;
      process.env["NOVELFABRIC_WEB_BRIDGE_ACTOR"] = options.actor;
      const server = await createViteServer(host, port);
      await server.listen();
      writeJson({ ok: true, command: "web bridge", data: payload });
      installShutdownHandlers(server);
    });
}

type WebDemoOptions = JsonOutputOptions & {
  readonly host?: string;
  readonly port?: string;
  readonly dryRun?: boolean;
};

type WebBridgeOptions = WebDemoOptions & {
  readonly workspace: string;
  readonly actor: string;
};

function parseDemoPort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_DEMO_PORT;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed.toString() !== rawPort || parsed < 1 || parsed > 65535) {
    throw new CommandFailure("invalid_web_port", `Invalid web demo port '${rawPort}'.`);
  }

  if (RESERVED_PORTS.has(parsed) || parsed < 50000) {
    throw new CommandFailure(
      "reserved_web_port",
      `Port ${parsed.toString()} is reserved by project policy; use an explicit 50000+ port for NovelFabric.`
    );
  }

  return parsed;
}

async function createViteServer(host: string, port: number): Promise<ViteDevServer> {
  return createServer({
    root: process.cwd(),
    logLevel: "silent",
    server: {
      host,
      port,
      strictPort: true
    }
  });
}

function installShutdownHandlers(server: ViteDevServer): void {
  const closeServer = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void closeServer();
  });
  process.once("SIGTERM", () => {
    void closeServer();
  });
}
