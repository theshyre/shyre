import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockSet {
  id: string;
  team_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
}

interface MockCat {
  id: string;
  category_set_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

let setRows: MockSet[];
let catRows: MockCat[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "category_sets") return setsQuery();
      if (table === "categories") return catsQuery();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function setsQuery() {
  let filterOr: string | null = null;
  const api = {
    select: () => api,
    order: () => api,
    or: (expr: string) => {
      filterOr = expr;
      return api;
    },
    // thenable to act as final query
    then: (resolve: (v: { data: MockSet[] }) => void) => {
      let data = setRows;
      if (filterOr) {
        // parse "is_system.eq.true,team_id.eq.X"
        const teamIdMatch = filterOr.match(/team_id\.eq\.([^,]+)/);
        const teamId = teamIdMatch?.[1];
        data = setRows.filter(
          (s) => s.is_system === true || s.team_id === teamId,
        );
      }
      resolve({ data });
    },
  };
  return api;
}

function catsQuery() {
  let ids: string[] = [];
  const api = {
    select: () => api,
    in: (_col: string, vals: string[]) => {
      ids = vals;
      return api;
    },
    eq: (_col: string, val: string) => {
      ids = [val];
      return api;
    },
    order: () => api,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve: (v: { data: MockCat[] }) => void) => {
      const data = catRows.filter((c) => ids.includes(c.category_set_id));
      resolve({ data });
    },
  };
  return api;
}

import { getVisibleCategorySets } from "./queries";

describe("getVisibleCategorySets", () => {
  beforeEach(() => {
    setRows = [
      {
        id: "sys1",
        team_id: null,
        name: "System Set",
        description: null,
        is_system: true,
        created_by: null,
        created_at: "2026-01-01",
      },
      {
        id: "org1",
        team_id: "o1",
        name: "Org Set",
        description: null,
        is_system: false,
        created_by: "u1",
        created_at: "2026-01-02",
      },
      {
        id: "org2",
        team_id: "o2",
        name: "Other Org Set",
        description: null,
        is_system: false,
        created_by: "u2",
        created_at: "2026-01-03",
      },
    ];
    catRows = [
      {
        id: "c1",
        category_set_id: "sys1",
        name: "Feature",
        color: "#3b82f6",
        sort_order: 10,
        created_at: "2026-01-01",
      },
      {
        id: "c2",
        category_set_id: "org1",
        name: "Custom",
        color: "#ef4444",
        sort_order: 10,
        created_at: "2026-01-01",
      },
    ];
  });

  it("returns sets with their categories attached", async () => {
    const result = await getVisibleCategorySets();
    expect(result.map((s) => s.id).sort()).toEqual(
      ["sys1", "org1", "org2"].sort(),
    );
    const sys = result.find((s) => s.id === "sys1")!;
    expect(sys.categories).toHaveLength(1);
    expect(sys.categories[0]?.name).toBe("Feature");
  });

  it("filters to system + one org when teamId provided", async () => {
    const result = await getVisibleCategorySets("o1");
    const ids = result.map((s) => s.id).sort();
    expect(ids).toEqual(["org1", "sys1"]);
  });

  it("returns sets with empty category arrays when a set has no categories", async () => {
    const result = await getVisibleCategorySets("o2");
    const teamSet = result.find((s) => s.id === "org2");
    expect(teamSet?.categories).toEqual([]);
  });

  it("returns empty array when there are no sets", async () => {
    setRows = [];
    const result = await getVisibleCategorySets();
    expect(result).toEqual([]);
  });
});
