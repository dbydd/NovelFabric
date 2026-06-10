import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { addAgentCommands } from "../../src/commands/agents.js";
import { addSkillCommands } from "../../src/commands/skills.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

const cliEnvelopeSchema = z.union([
  z.object({
    ok: z.literal(true),
    command: z.string(),
    data: z.looseObject({
      agents: z.array(z.looseObject({ id: z.string() })).optional(),
      skills: z
        .array(z.looseObject({ name: z.string(), qualifiedName: z.string().optional() }))
        .optional(),
      id: z.string().optional(),
      soul: z.looseObject({ content: z.string().nullable() }).optional(),
      content: z.string().optional(),
      valid: z.boolean().optional(),
      issueCount: z.number().optional()
    })
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() })
  })
]);

type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;

describe("agents and skills command modules", () => {
  let workspacePath: string;
  let configRoot: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "nf-agents-skills-test-"));
    configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nf-agents-skills-config-"));
    await fs.cp(VALID_FIXTURE, workspacePath, { recursive: true });
    await materializeAgentAndSkillFixtures(workspacePath, configRoot);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.rm(configRoot, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("lists and inspects workspace agents", async () => {
    const listResult = await runCommand(
      (program) => {
        addAgentCommands(program);
      },
      ["agents", "list", "--workspace", workspacePath, "--json"]
    );

    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.command).toBe("agents list");
      expect(listResult.data.agents?.map((agent) => agent.id)).toContain("main_agent");
      expect(listResult.data.agents?.map((agent) => agent.id)).toContain("role_agent");
    }

    const inspectResult = await runCommand(
      (program) => {
        addAgentCommands(program);
      },
      ["agents", "inspect", "--workspace", workspacePath, "--agent", "role_agent", "--json"]
    );

    expect(inspectResult.ok).toBe(true);
    if (inspectResult.ok) {
      expect(inspectResult.command).toBe("agents inspect");
      expect(inspectResult.data.id).toBe("role_agent");
      expect(inspectResult.data.soul?.content).toContain("Role Agent Soul");
    }
  });

  it("validates agents and reports missing required text assets", async () => {
    await fs.mkdir(path.join(workspacePath, "agents", "broken_agent"), { recursive: true });

    const result = await runCommand(
      (program) => {
        addAgentCommands(program);
      },
      ["agents", "validate", "--workspace", workspacePath, "--json"]
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command).toBe("agents validate");
      expect(result.data.valid).toBe(false);
      expect(result.data.issueCount).toBeGreaterThan(0);
    }
    expect(process.exitCode).toBe(2);
  });

  it("lists, reads, and validates workspace and config-root skills", async () => {
    const listResult = await runCommand(
      (program) => {
        addSkillCommands(program);
      },
      ["skills", "list", "--workspace", workspacePath, "--config-root", configRoot, "--json"]
    );

    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.command).toBe("skills list");
      expect(listResult.data.skills?.map((skill) => skill.qualifiedName)).toEqual([
        "workspace-guard",
        "role_agent/role-play",
        "global/runtime-policy",
        "template/card-writer"
      ]);
    }

    const readResult = await runCommand(
      (program) => {
        addSkillCommands(program);
      },
      [
        "skills",
        "read",
        "--workspace",
        workspacePath,
        "--config-root",
        configRoot,
        "--skill",
        "role_agent/role-play",
        "--json"
      ]
    );

    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.command).toBe("skills read");
      expect(readResult.data.content).toContain("# Role Play");
    }

    const validateResult = await runCommand(
      (program) => {
        addSkillCommands(program);
      },
      ["skills", "validate", "--workspace", workspacePath, "--config-root", configRoot, "--json"]
    );

    expect(validateResult.ok).toBe(true);
    if (validateResult.ok) {
      expect(validateResult.command).toBe("skills validate");
      expect(validateResult.data.valid).toBe(true);
      expect(validateResult.data.issueCount).toBe(0);
    }
  });

  it("reports ambiguous skill names unless a qualified name is used", async () => {
    await fs.writeFile(
      path.join(configRoot, "pi", "skills", "workspace-guard.md"),
      "# Runtime Workspace Guard\n\nUse NovelFabric guarded tools only.\n",
      "utf8"
    );

    await expect(
      runCommand(
        (program) => {
          addSkillCommands(program);
        },
        [
          "skills",
          "read",
          "--workspace",
          workspacePath,
          "--config-root",
          configRoot,
          "--skill",
          "workspace-guard",
          "--json"
        ]
      )
    ).rejects.toMatchObject({ code: "skill_ambiguous" });
  });
});

async function materializeAgentAndSkillFixtures(
  workspacePath: string,
  configRoot: string
): Promise<void> {
  await fs.mkdir(path.join(workspacePath, "agents", "role_agent", "skills"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, "agents", "role_agent", "profile.json"),
    JSON.stringify({ id: "role_agent", name: "Role Agent" }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(workspacePath, "agents", "role_agent", "soul.md"),
    "# Role Agent Soul\n\nStay in character and write proposals through NovelFabric commands.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(workspacePath, "agents", "role_agent", "memory.md"),
    "# Role Agent Memory\n\nNo durable memories yet.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(workspacePath, "agents", "role_agent", "skills", "role-play.md"),
    "# Role Play\n\nUse character constraints and cite workspace paths.\n",
    "utf8"
  );
  await fs.mkdir(path.join(workspacePath, ".pi", "skills"), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, ".pi", "skills", "workspace-guard.md"),
    "# Workspace Guard\n\nUse NovelFabric safe file commands.\n",
    "utf8"
  );

  await fs.mkdir(path.join(configRoot, "pi", "skills"), { recursive: true });
  await fs.mkdir(path.join(configRoot, "templates", "skills"), { recursive: true });
  await fs.writeFile(
    path.join(configRoot, "pi", "skills", "runtime-policy.md"),
    "# Runtime Policy\n\nDeny raw bash, raw write, and raw edit.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(configRoot, "templates", "skills", "card-writer.md"),
    "# Card Writer\n\nProduce card proposals for validation.\n",
    "utf8"
  );
}

async function runCommand(
  register: (program: Command) => void,
  args: readonly string[]
): Promise<CliEnvelope> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  register(program);

  const stdout = await captureStdout(async () => {
    await program.parseAsync(["node", "novelfabric", ...args], { from: "node" });
  });
  return cliEnvelopeSchema.parse(JSON.parse(stdout.trim()));
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  };
  try {
    await action();
    return stdout;
  } finally {
    process.stdout.write = originalWrite;
  }
}
