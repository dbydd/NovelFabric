import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin } from "vite";
import { z } from "zod";

import { CommandFailure, isCommandFailure } from "../errors.js";
import { readWorkspaceFile, readWorkspaceTree, writeWorkspaceFile } from "../workspace/files.js";

const readRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().min(1)
});

const writeRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  actor: z.string().min(1),
  expectedBaseHash: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
});

export function novelFabricBridgePlugin(): Plugin {
  return {
    name: "novelfabric-local-file-bridge",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleBridgeRequest(request, response, next);
      });
    }
  };
}

async function handleBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void
): Promise<void> {
  const routePath =
    request.url === undefined ? "" : new URL(request.url, "http://localhost").pathname;
  if (!routePath.startsWith("/api/bridge/files/")) {
    next();
    return;
  }

  if (process.env["NOVELFABRIC_WEB_BRIDGE"] !== "1") {
    writeJson(response, 404, {
      ok: false,
      error: {
        code: "bridge_disabled",
        message: "NovelFabric file bridge is disabled for this web surface."
      }
    });
    return;
  }

  try {
    const workspacePath = bridgeWorkspacePath();
    if (request.method === "POST" && routePath === "/api/bridge/files/read") {
      const body = readRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      const result = await readWorkspaceFile({ workspacePath, path: body.path });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/files/tree") {
      const body = readRequestSchema
        .pick({ workspacePath: true })
        .parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      const result = await readWorkspaceTree({ workspacePath });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === "POST" && routePath === "/api/bridge/files/write") {
      const body = writeRequestSchema.parse(await readJsonBody(request));
      assertBridgeWorkspaceMatches(body.workspacePath, workspacePath);
      assertBridgeActorMatches(body.actor, bridgeActor());
      const result = await writeWorkspaceFile({
        workspacePath,
        path: body.path,
        content: body.content,
        actor: body.actor,
        ...(body.expectedBaseHash === undefined ? {} : { expectedBaseHash: body.expectedBaseHash }),
        ...(body.reason === undefined ? {} : { reason: body.reason })
      });
      writeJson(response, 200, { ok: true, data: result });
      return;
    }

    throw new CommandFailure(
      "bridge_route_not_found",
      `Unsupported bridge route ${request.method ?? "GET"} ${routePath}.`,
      404
    );
  } catch (error) {
    writeBridgeError(response, error);
  }
}

function bridgeWorkspacePath(): string {
  const configured = process.env["NOVELFABRIC_WEB_BRIDGE_WORKSPACE"];
  if (configured === undefined || configured.trim().length === 0) {
    throw new CommandFailure(
      "bridge_workspace_unset",
      "File bridge requires NOVELFABRIC_WEB_BRIDGE_WORKSPACE.",
      500
    );
  }
  return configured;
}

function bridgeActor(): string {
  const configured = process.env["NOVELFABRIC_WEB_BRIDGE_ACTOR"];
  if (configured === undefined || configured.trim().length === 0) return "main_agent";
  return configured;
}

function assertBridgeWorkspaceMatches(
  requestedWorkspace: string,
  configuredWorkspace: string
): void {
  if (path.resolve(requestedWorkspace) === path.resolve(configuredWorkspace)) return;
  throw new CommandFailure(
    "bridge_workspace_mismatch",
    "Bridge requests may only target the workspace selected when the bridge was launched.",
    403
  );
}

function assertBridgeActorMatches(requestedActor: string, configuredActor: string): void {
  if (requestedActor === configuredActor) return;
  throw new CommandFailure(
    "bridge_actor_mismatch",
    "Bridge writes may only use the actor selected when the bridge was launched.",
    403
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding("utf8");
  let raw = "";
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      raw += chunk;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new CommandFailure("invalid_bridge_json", "Bridge request body must be valid JSON.", 400);
  }
}

function writeBridgeError(response: ServerResponse, error: unknown): void {
  if (error instanceof Error && isCommandFailure(error)) {
    writeJson(response, httpStatusForCommandFailure(error), {
      ok: false,
      error: { code: error.code, message: error.message }
    });
    return;
  }

  if (error instanceof z.ZodError) {
    writeJson(response, 400, {
      ok: false,
      error: { code: "invalid_bridge_request", message: z.prettifyError(error) }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected non-error bridge failure.";
  writeJson(response, 500, {
    ok: false,
    error: { code: "bridge_unexpected_error", message }
  });
}

function httpStatusForCommandFailure(error: CommandFailure): number {
  if (error.exitCode === 3) return 403;
  if (error.exitCode === 4) return 409;
  if (error.exitCode >= 400 && error.exitCode <= 599) return error.exitCode;
  return 400;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}
