import path from "node:path";

import { describe, expect, it } from "vitest";

import { CommandFailure } from "../../src/errors.js";
import { resolveInsideRoot } from "../../src/fs/safe-path.js";

describe("resolveInsideRoot", () => {
  describe("paths inside the workspace root", () => {
    it("resolves a relative subdirectory path", () => {
      const result = resolveInsideRoot("/workspace", "sub/dir");
      expect(result.root).toBe("/workspace");
      expect(result.target).toBe(path.resolve("/workspace/sub/dir"));
    });

    it("resolves '.' to the root itself", () => {
      const result = resolveInsideRoot("/workspace", ".");
      expect(result.target).toBe("/workspace");
      expect(result.relativePath).toBe("");
    });

    it("resolves a nested file path", () => {
      const result = resolveInsideRoot("/workspace", ".novelfabric/workspace.json");
      expect(result.target).toBe("/workspace/.novelfabric/workspace.json");
    });
  });

  describe("paths outside the workspace root", () => {
    it("rejects a parent-directory escape with ..", () => {
      expect(() => resolveInsideRoot("/workspace", "../escape")).toThrow(CommandFailure);
    });

    it("rejects a deep parent escape", () => {
      expect(() => resolveInsideRoot("/workspace", "sub/../../escape")).toThrow(CommandFailure);
    });

    it("rejects an absolute path outside the root", () => {
      expect(() => resolveInsideRoot("/workspace", "/etc/passwd")).toThrow(CommandFailure);
    });

    it("throws CommandFailure with code path_outside_workspace", () => {
      try {
        resolveInsideRoot("/workspace", "../outside");
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(CommandFailure);
        if (error instanceof CommandFailure) {
          expect(error.code).toBe("path_outside_workspace");
        }
      }
    });
  });
});
