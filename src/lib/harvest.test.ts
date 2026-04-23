import { describe, it, expect } from "vitest";
import { buildInitialPageUrl } from "./harvest";

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
