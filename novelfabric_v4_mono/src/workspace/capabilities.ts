import { readFile } from "node:fs/promises";
import path from "node:path";

import { CommandFailure } from "../errors.js";
import { resolveInsideRoot } from "../fs/safe-path.js";

export type CapabilityManifest = {
  readonly actors: ReadonlyMap<string, ActorCapabilities>;
};

export type ActorCapabilities = {
  readonly allow: Set<string>;
  readonly deny: Set<string>;
};

export async function readCapabilityManifest(workspacePath: string): Promise<CapabilityManifest> {
  const resolved = resolveInsideRoot(workspacePath, path.join(".novelfabric", "capabilities.toml"));
  const content = await readFile(resolved.target, "utf8");
  return parseCapabilityManifest(content);
}

export function parseCapabilityManifest(content: string): CapabilityManifest {
  const actors = new Map<string, ActorCapabilities>();
  let activeActor: string | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;

    const sectionMatch = /^\[([A-Za-z0-9_-]+)\]$/.exec(line);
    if (sectionMatch !== null) {
      const sectionName = sectionMatch[1];
      if (sectionName === undefined) {
        throw new CommandFailure(
          "invalid_capability_manifest",
          `Invalid capability section: ${line}`
        );
      }
      activeActor = sectionName;
      if (!actors.has(activeActor)) {
        actors.set(activeActor, { allow: new Set<string>(), deny: new Set<string>() });
      }
      continue;
    }

    if (activeActor === undefined) {
      throw new CommandFailure(
        "invalid_capability_manifest",
        "Capability entries must be inside an actor section."
      );
    }

    const assignment = /^(allow|deny)\s*=\s*\[(.*)\]$/.exec(line);
    if (assignment === null) {
      throw new CommandFailure(
        "invalid_capability_manifest",
        `Invalid capability manifest line: ${line}`
      );
    }

    const capabilityList = parseTomlStringList(assignment[2] ?? "");
    const current = actors.get(activeActor);
    if (current === undefined) {
      throw new CommandFailure(
        "invalid_capability_manifest",
        `Actor '${activeActor}' was not initialized.`
      );
    }
    const targetSet = assignment[1] === "allow" ? current.allow : current.deny;
    for (const capability of capabilityList) {
      targetSet.add(capability);
    }
  }

  return { actors };
}

export function actorHasCapability(
  manifest: CapabilityManifest,
  actor: string,
  capability: string
): boolean {
  const actorCapabilities = manifest.actors.get(actor);
  if (actorCapabilities === undefined) return false;
  if (actorCapabilities.deny.has(capability)) return false;
  return actorCapabilities.allow.has(capability);
}

export function requireCapability(
  manifest: CapabilityManifest,
  actor: string,
  capability: string
): void {
  if (!actorHasCapability(manifest, actor, capability)) {
    throw new CommandFailure(
      "capability_denied",
      `Actor '${actor}' does not have required capability '${capability}'.`,
      3
    );
  }
}

export function requireAnyCapability(
  manifest: CapabilityManifest,
  actor: string,
  capabilities: readonly string[]
): void {
  if (capabilities.some((capability) => actorHasCapability(manifest, actor, capability))) {
    return;
  }

  throw new CommandFailure(
    "capability_denied",
    `Actor '${actor}' does not have any required capability: ${capabilities.join(", ")}.`,
    3
  );
}

function stripComment(line: string): string {
  const commentIndex = line.indexOf("#");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function parseTomlStringList(rawList: string): readonly string[] {
  const trimmed = rawList.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((entry) => parseTomlString(entry.trim()));
}

function parseTomlString(rawValue: string): string {
  const match = /^"([A-Za-z0-9._:-]+)"$/.exec(rawValue);
  if (match === null) {
    throw new CommandFailure(
      "invalid_capability_manifest",
      `Invalid capability string: ${rawValue}`
    );
  }
  return match[1] ?? "";
}
