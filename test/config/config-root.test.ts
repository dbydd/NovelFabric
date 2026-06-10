import { describe, expect, it } from "vitest";

import { resolveConfigRoot } from "../../src/config/config-root.js";
import type { Environment } from "../../src/environment.js";
import { CommandFailure } from "../../src/errors.js";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    home: undefined,
    xdgConfigHome: undefined,
    platform: "linux" as const,
    ...overrides
  };
}

describe("resolveConfigRoot", () => {
  describe("when XDG_CONFIG_HOME is set", () => {
    it("resolves to $XDG_CONFIG_HOME/novelfabric", () => {
      const env = makeEnvironment({
        home: "/home/user",
        xdgConfigHome: "/custom/xdg"
      });
      const result = resolveConfigRoot(env);
      expect(result.configRoot).toBe("/custom/xdg/novelfabric");
      expect(result.source).toBe("xdg-config-home");
      expect(result.novelfabricDirectory).toBe("novelfabric");
    });

    it("takes precedence over HOME even when HOME is set", () => {
      const env = makeEnvironment({
        home: "/home/user",
        xdgConfigHome: "/xdg/override"
      });
      const result = resolveConfigRoot(env);
      expect(result.configRoot).toBe("/xdg/override/novelfabric");
      expect(result.source).toBe("xdg-config-home");
    });
  });

  describe("when XDG_CONFIG_HOME is unset or empty", () => {
    it("resolves to $HOME/.config/novelfabric when XDG_CONFIG_HOME is undefined", () => {
      const env = makeEnvironment({
        home: "/home/user",
        xdgConfigHome: undefined
      });
      const result = resolveConfigRoot(env);
      expect(result.configRoot).toBe("/home/user/.config/novelfabric");
      expect(result.source).toBe("home-default");
    });

    it("resolves to $HOME/.config/novelfabric when XDG_CONFIG_HOME is empty string", () => {
      const env = makeEnvironment({
        home: "/home/user",
        xdgConfigHome: ""
      });
      const result = resolveConfigRoot(env);
      expect(result.configRoot).toBe("/home/user/.config/novelfabric");
      expect(result.source).toBe("home-default");
    });
  });

  describe("when neither HOME nor XDG_CONFIG_HOME is available", () => {
    it("throws CommandFailure with code config_root_unresolved when both are undefined", () => {
      const env = makeEnvironment({
        home: undefined,
        xdgConfigHome: undefined
      });
      expect(() => resolveConfigRoot(env)).toThrow(CommandFailure);
      try {
        resolveConfigRoot(env);
      } catch (error) {
        expect(error).toBeInstanceOf(CommandFailure);
        if (error instanceof CommandFailure) {
          expect(error.code).toBe("config_root_unresolved");
          expect(error.exitCode).toBe(1);
        }
      }
    });

    it("throws CommandFailure when both are empty strings", () => {
      const env = makeEnvironment({
        home: "",
        xdgConfigHome: ""
      });
      expect(() => resolveConfigRoot(env)).toThrow(CommandFailure);
    });

    it("throws CommandFailure when HOME is undefined and XDG_CONFIG_HOME is empty", () => {
      const env = makeEnvironment({
        home: undefined,
        xdgConfigHome: ""
      });
      expect(() => resolveConfigRoot(env)).toThrow(CommandFailure);
    });
  });
});
