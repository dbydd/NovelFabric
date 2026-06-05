import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { addRuntimeCommands } from "../../src/commands/runtime.js";

describe("runtime command module", () => {
  it("registers the NovelFabric-wrapped pi runtime command surface", () => {
    const program = new Command();
    addRuntimeCommands(program);

    const runtime = findCommand(program, "runtime");
    expect(runtime).toBeDefined();
    if (runtime === undefined) return;

    expect(commandNames(runtime)).toEqual(
      expect.arrayContaining(["doctor", "config", "materialize", "extensions", "policy"])
    );

    const config = findCommand(runtime, "config");
    expect(config).toBeDefined();
    if (config !== undefined) {
      expect(commandNames(config)).toEqual(expect.arrayContaining(["path", "inspect"]));
    }

    const extensions = findCommand(runtime, "extensions");
    expect(extensions).toBeDefined();
    if (extensions !== undefined) {
      expect(commandNames(extensions)).toEqual(expect.arrayContaining(["list", "validate"]));
    }

    const policy = findCommand(runtime, "policy");
    expect(policy).toBeDefined();
    if (policy !== undefined) {
      expect(commandNames(policy)).toContain("inspect");
    }
  });
});

function findCommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find((command) => command.name() === name);
}

function commandNames(parent: Command): readonly string[] {
  return parent.commands.map((command) => command.name());
}
