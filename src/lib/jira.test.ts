import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub out url-safety so the tests don't actually DNS-resolve.
// Production behavior is exercised in url-safety.test.ts.
vi.mock("./url-safety", () => ({
  assertSafeOutboundUrl: vi.fn().mockResolvedValue(undefined),
  UnsafeOutboundUrlError: class extends Error {
    reason: string;
    constructor(message: string, reason: string) {
      super(message);
      this.reason = reason;
    }
  },
}));

import { fetchJiraIssue, validateJiraCreds } from "./jira";
import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from "./url-safety";

// vi.stubGlobal completely replaces globalThis.fetch with a mock that
// survives mockReset (a spy gets unwrapped by mockReset, breaking the
// next test's assertions). vi.unstubAllGlobals in afterEach restores.
const fetchMock = vi.fn<typeof fetch>();

const creds = {
  baseUrl: "https://acme.atlassian.net",
  email: "alice@example.com",
  apiToken: "TOKEN",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(assertSafeOutboundUrl).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJiraIssue", () => {
  it("returns parsed { key, summary, browseUrl } on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: "PROJ-1", fields: { summary: "Fix login" } }),
        { status: 200 },
      ),
    );
    const { data, error } = await fetchJiraIssue("PROJ-1", creds);
    expect(error).toBeNull();
    expect(data).toEqual({
      key: "PROJ-1",
      summary: "Fix login",
      browseUrl: "https://acme.atlassian.net/browse/PROJ-1",
    });
  });

  it("strips a trailing slash from the base URL when building browseUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: "PROJ-2", fields: { summary: "x" } }),
        { status: 200 },
      ),
    );
    const { data } = await fetchJiraIssue("PROJ-2", {
      ...creds,
      baseUrl: "https://acme.atlassian.net/",
    });
    expect(data?.browseUrl).toBe("https://acme.atlassian.net/browse/PROJ-2");
  });

  it("falls back to the requested key when the response omits one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ fields: {} }), { status: 200 }),
    );
    const { data } = await fetchJiraIssue("PROJ-3", creds);
    expect(data?.key).toBe("PROJ-3");
    expect(data?.summary).toBe("");
  });

  it("returns the upstream status on a non-OK response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    const { data, error } = await fetchJiraIssue("PROJ-X", creds);
    expect(data).toBeNull();
    expect(error?.status).toBe(404);
  });

  it("returns status: 0 on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { data, error } = await fetchJiraIssue("PROJ-1", creds);
    expect(data).toBeNull();
    expect(error?.status).toBe(0);
    expect(error?.message).toContain("ECONNREFUSED");
  });

  it("rejects via SSRF guard before fetching", async () => {
    vi.mocked(assertSafeOutboundUrl).mockRejectedValueOnce(
      new UnsafeOutboundUrlError("private", "private-ip-resolved"),
    );
    const { data, error } = await fetchJiraIssue("PROJ-1", {
      ...creds,
      baseUrl: "https://10.0.0.5",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data).toBeNull();
    expect(error?.message).toMatch(/Blocked/);
  });

  it("sends Basic auth derived from email + token", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: "X-1", fields: {} }), { status: 200 }),
    );
    await fetchJiraIssue("X-1", creds);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)
      ?.headers as Record<string, string>;
    const auth = headers?.["Authorization"];
    expect(auth).toMatch(/^Basic /);
    const decoded = Buffer.from(auth!.slice(6), "base64").toString("utf8");
    expect(decoded).toBe("alice@example.com:TOKEN");
  });

  it("passes redirect: 'manual' so 30x to a private host can't bypass", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: "Y-1", fields: {} }), { status: 200 }),
    );
    await fetchJiraIssue("Y-1", creds);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe("manual");
  });
});

describe("validateJiraCreds", () => {
  it("returns ok: true when /myself returns 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const result = await validateJiraCreds(creds);
    expect(result).toEqual({ ok: true, error: null });
  });

  it("returns ok: false with the upstream status on a 401", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    const result = await validateJiraCreds(creds);
    expect(result.ok).toBe(false);
    expect(result.error?.status).toBe(401);
  });

  it("surfaces SSRF rejection before fetching", async () => {
    vi.mocked(assertSafeOutboundUrl).mockRejectedValueOnce(
      new UnsafeOutboundUrlError("private", "private-ip-resolved"),
    );
    const result = await validateJiraCreds({
      ...creds,
      baseUrl: "https://10.0.0.5",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/Blocked/);
  });

  it("returns network-error status: 0 on fetch throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ENETUNREACH"));
    const result = await validateJiraCreds(creds);
    expect(result.ok).toBe(false);
    expect(result.error?.status).toBe(0);
  });
});
