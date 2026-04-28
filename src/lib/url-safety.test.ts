import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:dns/promises BEFORE importing the module — ESM hoisting.
const lookupMock = vi.fn<
  (host: string, opts?: unknown) => Promise<{ address: string; family: number }[]>
>();
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: (host: string, opts?: unknown) => lookupMock(host, opts),
  },
  lookup: (host: string, opts?: unknown) => lookupMock(host, opts),
}));

import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from "./url-safety";

beforeEach(() => {
  lookupMock.mockReset();
  // Default: every host resolves to a public IP unless a test
  // overrides. Keeps the happy-path tests focused.
  lookupMock.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
});

describe("assertSafeOutboundUrl", () => {
  describe("protocol guard", () => {
    it("rejects http://", async () => {
      await expect(
        assertSafeOutboundUrl("http://example.atlassian.net/x"),
      ).rejects.toMatchObject({ reason: "protocol" });
    });

    it("accepts https://", async () => {
      await expect(
        assertSafeOutboundUrl("https://example.atlassian.net/x"),
      ).resolves.toBeUndefined();
    });

    it("rejects unparseable URLs", async () => {
      await expect(
        assertSafeOutboundUrl("not a url"),
      ).rejects.toMatchObject({ reason: "parse" });
    });
  });

  describe("literal-IP guard", () => {
    it.each([
      ["loopback", "https://127.0.0.1/x"],
      ["127.255.255.255 still loopback", "https://127.255.255.255/x"],
      ["link-local 169.254", "https://169.254.169.254/latest/meta-data/"],
      ["10/8 RFC1918", "https://10.0.0.1/x"],
      ["172.16/12", "https://172.16.5.5/x"],
      ["192.168/16", "https://192.168.1.1/x"],
      ["100.64/10 CGNAT", "https://100.64.0.1/x"],
      ["multicast 224", "https://224.0.0.1/x"],
      ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/x"],
      ["IPv6 loopback ::1", "https://[::1]/x"],
      ["IPv6 link-local fe80", "https://[fe80::1]/x"],
      ["IPv6 unique-local fc00", "https://[fc00::1]/x"],
    ])("rejects %s literal", async (_label, url) => {
      await expect(assertSafeOutboundUrl(url)).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError,
      );
    });

    it("accepts a public IPv4 literal", async () => {
      // 8.8.8.8 isn't in any private range. DNS lookup still runs;
      // mock returns public.
      lookupMock.mockResolvedValueOnce([
        { address: "8.8.8.8", family: 4 },
      ]);
      await expect(
        assertSafeOutboundUrl("https://8.8.8.8/x"),
      ).resolves.toBeUndefined();
    });
  });

  describe("DNS-rebind guard", () => {
    it("rejects when host resolves to a private IP", async () => {
      lookupMock.mockResolvedValueOnce([
        { address: "10.0.0.5", family: 4 },
      ]);
      await expect(
        assertSafeOutboundUrl("https://attacker.example.com/x"),
      ).rejects.toMatchObject({ reason: "private-ip-resolved" });
    });

    it("rejects when ANY of the resolved records is private", async () => {
      // Multi-A response with one public, one private — should
      // reject, since fetch may pick the private one.
      lookupMock.mockResolvedValueOnce([
        { address: "203.0.113.5", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]);
      await expect(
        assertSafeOutboundUrl("https://mixed.example.com/x"),
      ).rejects.toMatchObject({ reason: "private-ip-resolved" });
    });

    it("rejects when DNS lookup throws", async () => {
      lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
      await expect(
        assertSafeOutboundUrl("https://nonexistent.example.com/x"),
      ).rejects.toMatchObject({ reason: "dns-fail" });
    });

    it("rejects when DNS lookup returns empty array", async () => {
      lookupMock.mockResolvedValueOnce([]);
      await expect(
        assertSafeOutboundUrl("https://empty.example.com/x"),
      ).rejects.toMatchObject({ reason: "dns-empty" });
    });

    it("accepts a public-only multi-A response", async () => {
      lookupMock.mockResolvedValueOnce([
        { address: "203.0.113.5", family: 4 },
        { address: "203.0.113.6", family: 4 },
      ]);
      await expect(
        assertSafeOutboundUrl("https://api.example.com/x"),
      ).resolves.toBeUndefined();
    });
  });

  describe("allow-list", () => {
    it("rejects hosts outside the allow-list", async () => {
      await expect(
        assertSafeOutboundUrl("https://example.com/x", {
          allowedHostSuffixes: [".atlassian.net"],
        }),
      ).rejects.toMatchObject({ reason: "host-not-allowed" });
    });

    it("accepts hosts matching a suffix", async () => {
      await expect(
        assertSafeOutboundUrl("https://acme.atlassian.net/x", {
          allowedHostSuffixes: [".atlassian.net"],
        }),
      ).resolves.toBeUndefined();
    });

    it("accepts the bare allow-listed host (no leading dot)", async () => {
      await expect(
        assertSafeOutboundUrl("https://atlassian.net/x", {
          allowedHostSuffixes: [".atlassian.net"],
        }),
      ).resolves.toBeUndefined();
    });
  });

  it("UnsafeOutboundUrlError surfaces a usable message + reason code", async () => {
    try {
      await assertSafeOutboundUrl("http://x.com");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeOutboundUrlError);
      const err = e as UnsafeOutboundUrlError;
      expect(err.reason).toBe("protocol");
      expect(err.message).toMatch(/https/i);
    }
  });
});
