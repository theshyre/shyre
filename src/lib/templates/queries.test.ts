import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getMyTemplates is a thin Supabase query — order chain + optional
 * team_id filter. The point of testing is to lock the ordering
 * (last_used_at DESC NULLS LAST, sort_order ASC, name ASC) and the
 * team scope.
 */

interface OrderCall {
  col: string;
  ascending: boolean;
  nullsFirst?: boolean;
}
interface FilterCall {
  col: string;
  value: unknown;
}

const state: {
  orderCalls: OrderCall[];
  filterCalls: FilterCall[];
  data: unknown[];
} = { orderCalls: [], filterCalls: [], data: [] };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order(
          col: string,
          opts: { ascending: boolean; nullsFirst?: boolean },
        ) {
          state.orderCalls.push({
            col,
            ascending: opts.ascending,
            ...(opts.nullsFirst !== undefined
              ? { nullsFirst: opts.nullsFirst }
              : {}),
          });
          return chain;
        },
        eq(col: string, value: unknown) {
          state.filterCalls.push({ col, value });
          return chain;
        },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          resolve({ data: state.data, error: null });
        },
      };
      return chain;
    },
  }),
}));

import { getMyTemplates } from "./queries";

beforeEach(() => {
  state.orderCalls = [];
  state.filterCalls = [];
  state.data = [];
});

describe("getMyTemplates", () => {
  it("returns templates with the canonical ordering: last_used_at DESC NULLS LAST → sort_order ASC → name ASC", async () => {
    await getMyTemplates();
    expect(state.orderCalls).toEqual([
      { col: "last_used_at", ascending: false, nullsFirst: false },
      { col: "sort_order", ascending: true },
      { col: "name", ascending: true },
    ]);
  });

  it("does not filter by team when no team_id is provided", async () => {
    await getMyTemplates();
    expect(state.filterCalls).toEqual([]);
  });

  it("filters by team_id when provided", async () => {
    await getMyTemplates("t-1");
    expect(state.filterCalls).toEqual([{ col: "team_id", value: "t-1" }]);
  });

  it("returns an empty array on no data (instead of null)", async () => {
    state.data = [];
    const result = await getMyTemplates();
    expect(result).toEqual([]);
  });

  it("passes through the underlying data shape", async () => {
    const fixture = [{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }];
    state.data = fixture;
    const result = await getMyTemplates("t-1");
    expect(result).toEqual(fixture);
  });
});
