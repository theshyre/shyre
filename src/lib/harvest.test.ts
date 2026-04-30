import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildInitialPageUrl,
  fetchHarvestClients,
  fetchHarvestProjects,
  fetchHarvestTimeEntries,
  fetchHarvestUsers,
  fetchHarvestCompany,
  HarvestApiError,
} from "./harvest";

/**
 * Regression tests for the URL construction bug that shipped and
 * immediately failed on a real import:
 *
 *   Harvest API error 400: {"message":"Invalid from date provided:
 *   \"2026-04-01?per_page=100\""}
 *
 * Root cause: fetchHarvestTimeEntries manually appended
 * `?from=2026-04-01` to the path, then fetchAllPages separately
 * appended `?per_page=100`, producing a URL with two `?` characters.
 * Harvest parsed everything after the first `?` as the `from` value.
 *
 * The fix is to merge all query params through one URLSearchParams
 * instance. These tests lock that behavior in.
 */

describe("buildInitialPageUrl", () => {
  it("adds per_page=100 with no extra params", () => {
    expect(buildInitialPageUrl("/users")).toBe("/users?per_page=100");
  });

  it("merges extra params into a single query string", () => {
    const url = buildInitialPageUrl("/time_entries", {
      from: "2026-04-01",
      to: "2026-04-23",
    });
    // URLSearchParams orders keys in insertion order, so the order
    // depends on spread order — assert via parsing instead.
    const [path, search] = url.split("?");
    expect(path).toBe("/time_entries");
    const params = new URLSearchParams(search);
    expect(params.get("per_page")).toBe("100");
    expect(params.get("from")).toBe("2026-04-01");
    expect(params.get("to")).toBe("2026-04-23");
  });

  it("produces exactly one `?` character (the regression guard)", () => {
    const url = buildInitialPageUrl("/time_entries", {
      from: "2026-04-01",
      to: "2026-04-23",
    });
    const questionMarks = (url.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(1);
  });

  it("URL-encodes values containing reserved characters", () => {
    const url = buildInitialPageUrl("/anything", { q: "a&b=c" });
    const search = url.split("?")[1]!;
    const params = new URLSearchParams(search);
    expect(params.get("q")).toBe("a&b=c");
  });

  it("handles empty extraParams object the same as no param", () => {
    expect(buildInitialPageUrl("/users", {})).toBe("/users?per_page=100");
  });
});

/**
 * Endpoint-name regression tests. When Shyre renamed its internal
 * `clients` → `customers` concept, an over-broad search-and-replace
 * changed the Harvest API URL from `/clients` (correct, Harvest's
 * contract) to `/customers` (non-existent, 404). Function name
 * (fetchHarvestClients) and interface name (HarvestClient) stayed
 * correct, which should have been a signal — but nothing tested
 * the actual URL hit.
 *
 * These tests mock `fetch` and assert each fetcher calls the
 * Harvest-documented endpoint. Add new fetchers here when adding
 * support for more Harvest resources.
 */

const opts = { token: "test-token", accountId: "123456" };

function mockFetchOnce(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Headers(),
    })),
  );
}

function lastFetchedUrl(): string {
  const fn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const calls = fn.mock.calls;
  const firstCall = calls[0];
  if (!firstCall) throw new Error("fetch was not called");
  return firstCall[0] as string;
}

describe("Harvest endpoint names", () => {
  beforeEach(() => {
    // Reset between tests so each assertion sees its own first call.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchHarvestClients hits /v2/clients (not /customers)", async () => {
    mockFetchOnce({ clients: [], links: { next: null } });
    await fetchHarvestClients(opts);
    const url = lastFetchedUrl();
    expect(url).toContain("/v2/clients");
    expect(url).not.toContain("/customers");
  });

  it("fetchHarvestProjects hits /v2/projects", async () => {
    mockFetchOnce({ projects: [], links: { next: null } });
    await fetchHarvestProjects(opts);
    expect(lastFetchedUrl()).toContain("/v2/projects");
  });

  it("fetchHarvestTimeEntries hits /v2/time_entries", async () => {
    mockFetchOnce({ time_entries: [], links: { next: null } });
    await fetchHarvestTimeEntries(opts);
    expect(lastFetchedUrl()).toContain("/v2/time_entries");
  });

  it("fetchHarvestTimeEntries merges from/to into a single query string", async () => {
    mockFetchOnce({ time_entries: [], links: { next: null } });
    await fetchHarvestTimeEntries(opts, {
      from: "2026-04-01",
      to: "2026-04-23",
    });
    const url = lastFetchedUrl();
    const questionMarks = (url.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(1);
    expect(url).toContain("from=2026-04-01");
    expect(url).toContain("to=2026-04-23");
    expect(url).toContain("per_page=100");
  });

  it("fetchHarvestUsers hits /v2/users", async () => {
    mockFetchOnce({ users: [], links: { next: null } });
    await fetchHarvestUsers(opts);
    expect(lastFetchedUrl()).toContain("/v2/users");
  });

  it("fetchHarvestCompany hits /v2/company (singleton, not paginated)", async () => {
    mockFetchOnce({ name: "Acme", time_zone: "UTC", week_start_day: "Mon" });
    await fetchHarvestCompany(opts);
    expect(lastFetchedUrl()).toContain("/v2/company");
  });

  /**
   * Pagination regression: when the first page's response includes a
   * `links.next` URL (Harvest returns absolute URLs like
   * "https://api.harvestapp.com/v2/time_entries?cursor=..."), the
   * fetcher must NOT double the "/v2" prefix when building the next
   * page request. Earlier code took `pathname + search` raw, which
   * concatenated with HARVEST_API's trailing "/v2" produced
   * "/v2/v2/time_entries?cursor=..." and Harvest's gateway dropped
   * to its marketing 404 — which classified as `not_found` and read
   * to the user as "this is a Shyre bug" while looking like a
   * credential issue under the hood.
   *
   * The fix strips a leading "/v2" from `nextUrl.pathname` before
   * passing back into harvestFetch.
   */
  it("paginates without double-prefixing /v2 when links.next is an absolute URL", async () => {
    interface FakeRes {
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
      text: () => Promise<string>;
      headers: Headers;
    }
    const page1: FakeRes = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          time_entries: [{ id: 1 }],
          links: {
            next: "https://api.harvestapp.com/v2/time_entries?cursor=abc&per_page=100",
          },
        }),
      text: () => Promise.resolve(""),
      headers: new Headers(),
    };
    const page2: FakeRes = {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          time_entries: [{ id: 2 }],
          links: { next: null },
        }),
      text: () => Promise.resolve(""),
      headers: new Headers(),
    };
    const calls: string[] = [];
    let callIdx = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string): Promise<FakeRes> => {
        calls.push(url);
        return callIdx++ === 0 ? page1 : page2;
      }),
    );
    const result = await fetchHarvestTimeEntries(opts);
    expect(result).toHaveLength(2);
    expect(calls).toHaveLength(2);
    // Critical: no double "/v2/v2/" anywhere in either URL.
    for (const url of calls) {
      expect(url).not.toMatch(/\/v2\/v2\//);
      expect(url).toMatch(/^https:\/\/api\.harvestapp\.com\/v2\/time_entries(\?|$)/);
    }
    // The cursor from the first page's links.next made it onto the
    // second request.
    expect(calls[1]).toContain("cursor=abc");
  });
});

describe("HarvestApiError classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockErrorOnce(status: number, body: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({}),
        text: async () => body,
        headers: new Headers(),
      })),
    );
  }

  it("401 → unauthorized with credentials message", async () => {
    mockErrorOnce(401, '{"error":"invalid token"}');
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      if (!(err instanceof HarvestApiError)) return false;
      return (
        err.kind === "unauthorized" &&
        err.status === 401 &&
        err.message.includes("credentials")
      );
    });
  });

  it("403 → forbidden with scope hint", async () => {
    mockErrorOnce(403, "forbidden");
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      if (!(err instanceof HarvestApiError)) return false;
      return err.kind === "forbidden" && err.message.includes("scope");
    });
  });

  it("404 → not_found with Shyre-bug attribution", async () => {
    mockErrorOnce(404, "<html>not found</html>");
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      if (!(err instanceof HarvestApiError)) return false;
      return (
        err.kind === "not_found" && err.message.includes("Shyre bug")
      );
    });
  });

  it("400 → bad_request", async () => {
    mockErrorOnce(400, '{"message":"Invalid from date"}');
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      return err instanceof HarvestApiError && err.kind === "bad_request";
    });
  });

  it("500 → server_error", async () => {
    mockErrorOnce(500, "internal");
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      return err instanceof HarvestApiError && err.kind === "server_error";
    });
  });

  it("caps raw body at 2000 chars with a truncation marker", async () => {
    const huge = "x".repeat(5000);
    mockErrorOnce(400, huge);
    try {
      await fetchHarvestClients(opts);
      throw new Error("should have thrown");
    } catch (err) {
      if (!(err instanceof HarvestApiError)) throw err;
      expect(err.rawBody.length).toBeLessThan(2100);
      expect(err.rawBody).toContain("truncated");
    }
  });

  it("stashes the endpoint path (without query string)", async () => {
    mockErrorOnce(404, "<html></html>");
    try {
      await fetchHarvestTimeEntries(opts, { from: "2026-04-01" });
      throw new Error("should have thrown");
    } catch (err) {
      if (!(err instanceof HarvestApiError)) throw err;
      expect(err.endpoint).toBe("/time_entries");
    }
  });
});
