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

  it("404 with HTML marketing body → account_mismatch (wrong Account ID, not a Shyre bug)", async () => {
    // Harvest's API gateway routes by Harvest-Account-Id BEFORE auth.
    // An unrecognized account ID gets the public 404 marketing page,
    // not a JSON error. This is the most common credential mismatch
    // in the wild — users paste their company subdomain instead of
    // the numeric Account ID.
    mockErrorOnce(
      404,
      '<!DOCTYPE html><html lang="en"><head><title>Harvest: Page not found (404)</title></head><body>...</body></html>',
    );
    await expect(fetchHarvestClients(opts)).rejects.toSatisfy((err) => {
      if (!(err instanceof HarvestApiError)) return false;
      return (
        err.kind === "account_mismatch" &&
        err.message.includes("Account ID") &&
        err.message.includes("id.getharvest.com/developers")
      );
    });
  });

  it("404 with JSON body → not_found with Shyre-bug attribution (the genuine endpoint-missing case)", async () => {
    mockErrorOnce(404, '{"message":"resource not found"}');
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
