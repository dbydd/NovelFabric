import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inspectWorkspace } from "../../src/workspace/doctor.js";
import { canonicalLayout } from "../../src/workspace/layout.js";

const VALID_FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/workspaces/valid-basic");

describe("inspectWorkspace", () => {
  describe("valid-basic fixture", () => {
    it("reports the fixture as valid", async () => {
      const report = await inspectWorkspace(VALID_FIXTURE);
      expect(report.valid).toBe(true);
      expect(report.missingCount).toBe(0);
      expect(report.wrongKindCount).toBe(0);
    });

    it("reports all canonical entries as present", async () => {
      const report = await inspectWorkspace(VALID_FIXTURE);
      expect(report.presentCount).toBe(canonicalLayout.length);
      expect(report.requiredCount).toBe(canonicalLayout.length);
    });

    it("has a check entry for every canonical layout entry", async () => {
      const report = await inspectWorkspace(VALID_FIXTURE);
      expect(report.checks).toHaveLength(canonicalLayout.length);
      for (const check of report.checks) {
        expect(check.status).toBe("present");
      }
    });

    it("resolves workspaceRoot to the absolute fixture path", async () => {
      const report = await inspectWorkspace(VALID_FIXTURE);
      expect(report.workspaceRoot).toBe(path.resolve(VALID_FIXTURE));
    });
  });

  describe("incomplete workspace", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-doctor-test-"));
      // Create only a subset of the required layout:
      // - "cards" directory (present), but its subdirectories are missing
      // - "project.md" file (present)
      await fs.mkdir(path.join(tempDir, "cards"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "project.md"), "# test project\n");
    });

    afterAll(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("reports the workspace as invalid", async () => {
      const report = await inspectWorkspace(tempDir);
      expect(report.valid).toBe(false);
    });

    it("reports missing entries with missingCount > 0", async () => {
      const report = await inspectWorkspace(tempDir);
      expect(report.missingCount).toBeGreaterThan(0);
    });

    it("reports some present entries for the items we created", async () => {
      const report = await inspectWorkspace(tempDir);
      expect(report.presentCount).toBeGreaterThan(0);
    });

    it("presentCount + missingCount equals requiredCount when no wrong-kind entries", async () => {
      const report = await inspectWorkspace(tempDir);
      expect(report.presentCount + report.missingCount + report.wrongKindCount).toBe(
        report.requiredCount
      );
      expect(report.requiredCount).toBe(canonicalLayout.length);
    });

    it("reports 'cards' as present and 'cards/characters' as missing", async () => {
      const report = await inspectWorkspace(tempDir);
      const cardsCheck = report.checks.find((c) => c.path === "cards");
      const charactersCheck = report.checks.find((c) => c.path === "cards/characters");

      expect(cardsCheck).toBeDefined();
      expect(charactersCheck).toBeDefined();
      if (cardsCheck !== undefined && charactersCheck !== undefined) {
        expect(cardsCheck.status).toBe("present");
        expect(charactersCheck.status).toBe("missing");
      }
    });
  });
});
