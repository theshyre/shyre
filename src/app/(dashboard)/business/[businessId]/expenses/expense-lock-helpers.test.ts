import { describe, it, expect, vi } from "vitest";
import { filterUninvoicedExpenseIds } from "./expense-lock-helpers";

// Tiny supabase fake — only the chain the helper actually uses.
// Captures the .in() arg list so the "filter actually queried these
// ids" assertion is possible.
function fakeSupabase(rows: Array<{ id: string; invoiced: boolean | null }>) {
  const inSpy = vi.fn((_col: string, _ids: string[]) =>
    Promise.resolve({ data: rows, error: null }),
  );
  const client = {
    from: () => ({
      select: () => ({
        in: inSpy,
      }),
    }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  return { client, inSpy };
}

describe("filterUninvoicedExpenseIds", () => {
  it("returns only ids whose invoiced flag is not true", async () => {
    const { client } = fakeSupabase([
      { id: "a", invoiced: false },
      { id: "b", invoiced: true },
      { id: "c", invoiced: false },
      { id: "d", invoiced: true },
    ]);
    const result = await filterUninvoicedExpenseIds(client, [
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(result.sort()).toEqual(["a", "c"]);
  });

  it("treats null/undefined invoiced as un-invoiced (legacy rows)", async () => {
    // Pre-phase-2 rows didn't carry invoiced. Even though the column
    // now has DEFAULT FALSE, an in-flight migration or a backfill
    // gap could leave rows with NULL — those must NOT be locked.
    const { client } = fakeSupabase([
      { id: "a", invoiced: null },
      { id: "b", invoiced: false },
      { id: "c", invoiced: true },
    ]);
    const result = await filterUninvoicedExpenseIds(client, ["a", "b", "c"]);
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("short-circuits on empty input without hitting Supabase", async () => {
    const inSpy = vi.fn();
    const client = {
      from: () => {
        throw new Error("should not query Supabase on empty input");
      },
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const result = await filterUninvoicedExpenseIds(client, []);
    expect(result).toEqual([]);
    expect(inSpy).not.toHaveBeenCalled();
  });

  it("returns [] when every row is invoiced (forces caller to surface the lock message)", async () => {
    const { client } = fakeSupabase([
      { id: "a", invoiced: true },
      { id: "b", invoiced: true },
    ]);
    const result = await filterUninvoicedExpenseIds(client, ["a", "b"]);
    expect(result).toEqual([]);
  });

  it("forwards the id list to supabase's .in() so the query scope matches", async () => {
    // The action passes already-authorized ids; the helper must
    // filter by those exact ids, not e.g. an empty list or a
    // hard-coded value. Regression catch: a refactor that dropped
    // the ids arg would return the whole table.
    const { client, inSpy } = fakeSupabase([
      { id: "x", invoiced: false },
    ]);
    await filterUninvoicedExpenseIds(client, ["x", "y", "z"]);
    expect(inSpy).toHaveBeenCalledWith("id", ["x", "y", "z"]);
  });
});
