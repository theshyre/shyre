import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  hashCode,
  formatCodesForDownload,
} from "./backup-codes";

describe("backup-codes", () => {
  describe("generateBackupCodes", () => {
    it("generates 10 codes", async () => {
      const { plainCodes, hashedCodes } = await generateBackupCodes();
      expect(plainCodes).toHaveLength(10);
      expect(hashedCodes).toHaveLength(10);
    });

    it("generates codes in XXXX-XXXX format", async () => {
      const { plainCodes } = await generateBackupCodes();
      for (const code of plainCodes) {
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      }
    });

    it("generates unique codes", async () => {
      const { plainCodes } = await generateBackupCodes();
      const unique = new Set(plainCodes);
      expect(unique.size).toBe(plainCodes.length);
    });

    it("generates unique hashes", async () => {
      const { hashedCodes } = await generateBackupCodes();
      const unique = new Set(hashedCodes);
      expect(unique.size).toBe(hashedCodes.length);
    });

    it("hashes are 64 char hex strings (SHA-256)", async () => {
      const { hashedCodes } = await generateBackupCodes();
      for (const hash of hashedCodes) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  describe("hashCode", () => {
    it("produces consistent hash for same input", async () => {
      const h1 = await hashCode("ABCD-EFGH");
      const h2 = await hashCode("ABCD-EFGH");
      expect(h1).toBe(h2);
    });

    it("normalizes hyphens and case", async () => {
      const h1 = await hashCode("ABCD-EFGH");
      const h2 = await hashCode("abcdefgh");
      expect(h1).toBe(h2);
    });

    it("different codes produce different hashes", async () => {
      const h1 = await hashCode("ABCD-EFGH");
      const h2 = await hashCode("HGFE-DCBA");
      expect(h1).not.toBe(h2);
    });
  });

  describe("formatCodesForDownload", () => {
    it("includes app name in header", () => {
      const result = formatCodesForDownload(["ABCD-EFGH"], "Shyre");
      expect(result).toContain("Shyre");
    });

    it("includes all codes numbered", () => {
      const codes = ["AAAA-BBBB", "CCCC-DDDD"];
      const result = formatCodesForDownload(codes, "Shyre");
      expect(result).toContain("1. AAAA-BBBB");
      expect(result).toContain("2. CCCC-DDDD");
    });

    it("includes warning about single use", () => {
      const result = formatCodesForDownload(["ABCD-EFGH"], "Shyre");
      expect(result).toContain("only be used once");
    });
  });
});
