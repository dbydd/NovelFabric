import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { actorHasCapability, readCapabilityManifest } from "../../src/workspace/capabilities.js";
import {
  initProject,
  inspectProject,
  listProjects,
  materializeWorkspace,
  validateProject
} from "../../src/workspace/project.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("project and workspace materialization services", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-project-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("initializes a new canonical project workspace", async () => {
    const workspacePath = path.join(tempRoot, "clockwork-city");

    const result = await initProject({ path: workspacePath, name: "Clockwork City" });

    expect(result.valid).toBe(true);
    expect(result.project).toEqual({
      slug: "clockwork-city",
      title: "Clockwork City",
      schemaVersion: "v4"
    });
    expect(result.created).toContain("project.json");
    expect(result.created).toContain(".novelfabric/capabilities.toml");
    await expect(fs.readFile(path.join(workspacePath, "project.md"), "utf8")).resolves.toContain(
      "# Clockwork City"
    );

    const inspected = await inspectProject(workspacePath);
    expect(inspected.valid).toBe(true);
    expect(inspected.project?.slug).toBe("clockwork-city");

    const manifest = await readCapabilityManifest(workspacePath);
    for (const capability of [
      "files.patch_protected",
      "cards.propose",
      "cards.apply",
      "memory.write_own",
      "memory.apply_shared",
      "simulation.create",
      "simulation.append_turn",
      "swarm.run",
      "external_swarm.run",
      "report.render",
      "report.apply",
      "writing.draft",
      "writing.apply",
      "runtime.manage",
      "agent.task.run"
    ]) {
      expect(actorHasCapability(manifest, "main_agent", capability), capability).toBe(true);
    }
    expect(actorHasCapability(manifest, "role_agent", "files.patch_protected")).toBe(false);
    expect(actorHasCapability(manifest, "role_agent", "swarm.run")).toBe(false);
  });

  it("rejects init into a non-empty target", async () => {
    const workspacePath = path.join(tempRoot, "existing");
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, "notes.txt"), "already here\n", "utf8");

    await expect(initProject({ path: workspacePath, name: "Existing" })).rejects.toMatchObject({
      code: "project_init_target_not_empty"
    });
  });

  it("materializes missing layout entries in an authorized existing workspace", async () => {
    const workspacePath = path.join(tempRoot, "valid-basic");
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.rm(path.join(workspacePath, "reports"), { recursive: true, force: true });

    const before = await validateProject(workspacePath);
    expect(before.valid).toBe(false);

    const result = await materializeWorkspace({
      workspacePath,
      template: "novel-project",
      actor: "main_agent"
    });

    expect(result.valid).toBe(true);
    expect(result.created).toContain("reports");
    expect(result.preserved).toContain("project.json");
    await expect(fs.stat(path.join(workspacePath, "reports"))).resolves.toMatchObject({});
  });

  it("refuses to materialize a wrong-kind layout conflict", async () => {
    const workspacePath = path.join(tempRoot, "valid-basic");
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await fs.rm(path.join(workspacePath, "reports"), { recursive: true, force: true });
    await fs.writeFile(path.join(workspacePath, "reports"), "not a directory\n", "utf8");

    await expect(
      materializeWorkspace({ workspacePath, template: "novel-project", actor: "main_agent" })
    ).rejects.toMatchObject({ code: "workspace_materialize_conflict" });
  });

  it("lists workspaces under a root without following non-workspace directories", async () => {
    const alpha = path.join(tempRoot, "alpha");
    const beta = path.join(tempRoot, "beta");
    await initProject({ path: alpha, name: "Alpha Project" });
    await fs.cp(VALID_FIXTURE, beta, { recursive: true });
    await fs.mkdir(path.join(tempRoot, "notes"), { recursive: true });

    const listed = await listProjects(tempRoot);

    expect(listed.validCount).toBe(2);
    expect(listed.invalidCount).toBe(0);
    expect(listed.projects.map((entry) => entry.slug).sort()).toEqual([
      "alpha-project",
      "valid-basic"
    ]);
  });
});
