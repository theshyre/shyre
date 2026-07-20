import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Server-component render harness for the admin error dashboard —
 * called out in the coverage plan because triage UI that breaks
 * silently means production errors go unseen. Extended for the
 * duplicate-grouping + resolve-all upgrade: identical errors collapse
 * into one card with an occurrence count, and the header carries a
 * filter-scoped Resolve all.
 */

const mockRequireSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  requireSystemAdmin: () => mockRequireSystemAdmin(),
}));

vi.mock("./resolve-button", () => ({
  ResolveButton: ({ errorIds }: { errorIds: string[] }) => (
    <button type="button">resolve:{errorIds.join("|")}</button>
  ),
}));

vi.mock("./resolve-all-button", () => ({
  ResolveAllButton: ({
    severity,
    count,
  }: {
    severity: string | null;
    count: number;
  }) => (
    <button type="button">
      resolve-all:{severity ?? "all"}:{count}
    </button>
  ),
}));

vi.mock("@theshyre/ui", () => ({
  LocalDateTime: ({ value }: { value: string }) => <time>{value}</time>,
  // Minimal passthrough so the truncated-message tooltip added to this
  // page still renders its trigger (and carries the label as an
  // aria-label, matching labelMode="label") without pulling in the
  // real Tooltip's portal/timer machinery.
  Tooltip: ({
    children,
    label,
  }: {
    children: React.ReactElement<{ "aria-label"?: string }>;
    label: string;
  }) => (
    <span aria-label={label} data-testid="tooltip-mock">
      {children}
    </span>
  ),
}));

// Server-side translator backed by the real en catalog so assertions
// exercise the shipped strings. The page only uses simple {var}
// interpolation (plural ICU lives in the mocked client buttons).
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const admin = (await import("@/lib/i18n/locales/en/admin.json"))
      .default as Record<string, unknown>;
    return (key: string, vars?: Record<string, unknown>): string => {
      const path = [...namespace.split(".").slice(1), ...key.split(".")];
      let cur: unknown = admin;
      for (const part of path) {
        cur = (cur as Record<string, unknown>)[part];
      }
      return String(cur).replace(/\{(\w+)\}/g, (_m, name: string) =>
        String(vars?.[name] ?? ""),
      );
    };
  },
}));

interface Filter {
  op: string;
  col: string;
  value: unknown;
}

const state: {
  listResult: { data: Record<string, unknown>[] | null; count: number | null };
  unresolvedCount: number;
  scopedUnresolvedCount: number;
  listFilters: Filter[];
  headFilters: Filter[][];
} = {
  listResult: { data: [], count: 0 },
  unresolvedCount: 0,
  scopedUnresolvedCount: 0,
  listFilters: [],
  headFilters: [],
};

function makeListChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    order: () => chain,
    range: (from: number, to: number) => {
      state.listFilters.push({ op: "range", col: "", value: [from, to] });
      return chain;
    },
    eq: (col: string, value: unknown) => {
      state.listFilters.push({ op: "eq", col, value });
      return chain;
    },
    not: (col: string, op: string, value: unknown) => {
      state.listFilters.push({ op: `not.${op}`, col, value });
      return chain;
    },
    is: (col: string, value: unknown) => {
      state.listFilters.push({ op: "is", col, value });
      return chain;
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> =>
      Promise.resolve({ ...state.listResult, error: null }).then(onF, onR),
  };
  return chain;
}

function makeHeadChain(): Record<string, unknown> {
  const filters: Filter[] = [];
  state.headFilters.push(filters);
  const chain: Record<string, unknown> = {
    is: (col: string, value: unknown) => {
      filters.push({ op: "is", col, value });
      return chain;
    },
    eq: (col: string, value: unknown) => {
      filters.push({ op: "eq", col, value });
      return chain;
    },
    then: (
      onF: (v: unknown) => unknown,
      onR?: (e: unknown) => unknown,
    ): Promise<unknown> => {
      const scoped = filters.some((f) => f.col === "severity");
      const count = scoped
        ? state.scopedUnresolvedCount
        : state.unresolvedCount;
      return Promise.resolve({ count, error: null }).then(onF, onR);
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          return makeHeadChain();
        }
        return makeListChain();
      },
    }),
  }),
}));

import ErrorDashboardPage from "./page";

function errRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "e-1",
    error_code: "DATABASE_ERROR",
    severity: "error",
    message: "connection refused",
    action: "createCustomerAction",
    user_id: "u-1",
    team_id: "t-1",
    url: "/customers",
    details: {},
    stack_trace: null,
    resolved_at: null,
    created_at: "2026-07-01T10:00:00+00:00",
    ...overrides,
  };
}

async function renderPage(
  params: Record<string, string> = {},
): Promise<void> {
  const jsx = await ErrorDashboardPage({
    searchParams: Promise.resolve(params),
  });
  render(jsx);
}

beforeEach(() => {
  state.listResult = { data: [], count: 0 };
  state.unresolvedCount = 0;
  state.scopedUnresolvedCount = 0;
  state.listFilters = [];
  state.headFilters = [];
  mockRequireSystemAdmin.mockReset();
  mockRequireSystemAdmin.mockResolvedValue({ userId: "u-admin" });
});

describe("ErrorDashboardPage", () => {
  it("gates on requireSystemAdmin — a denial propagates before any query", async () => {
    mockRequireSystemAdmin.mockRejectedValue(new Error("forbidden"));
    await expect(renderPage()).rejects.toThrow(/forbidden/);
    expect(state.listFilters).toHaveLength(0);
  });

  it("renders the empty state when no errors match", async () => {
    await renderPage();
    expect(screen.getByText("No errors found.")).toBeInTheDocument();
    expect(screen.queryByText(/unresolved/)).not.toBeInTheDocument();
  });

  it("defaults to unresolved-only (resolved_at IS NULL) with page-1 range", async () => {
    await renderPage();
    expect(state.listFilters).toContainEqual({
      op: "is",
      col: "resolved_at",
      value: null,
    });
    expect(state.listFilters).toContainEqual({
      op: "range",
      col: "",
      value: [0, 24],
    });
  });

  it("severity + resolved=true filters translate to eq/not-is-null queries", async () => {
    await renderPage({ severity: "warning", resolved: "true" });
    expect(state.listFilters).toContainEqual({
      op: "eq",
      col: "severity",
      value: "warning",
    });
    expect(state.listFilters).toContainEqual({
      op: "not.is",
      col: "resolved_at",
      value: null,
    });
  });

  it("resolved=all drops the resolved filter entirely", async () => {
    await renderPage({ resolved: "all" });
    const resolvedFilters = state.listFilters.filter(
      (f) => f.col === "resolved_at",
    );
    expect(resolvedFilters).toHaveLength(0);
  });

  it("renders an unresolved error with its code, message, badge count and resolve button (≥2 channels)", async () => {
    state.listResult = {
      data: [errRow({ details: { pgCode: "42501" } })],
      count: 1,
    };
    state.unresolvedCount = 3;
    await renderPage();
    expect(screen.getByText("3 unresolved")).toBeInTheDocument();
    // Code + message both render (icon+text encoding, not color alone).
    expect(screen.getAllByText("DATABASE_ERROR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("connection refused").length).toBeGreaterThan(0);
    expect(screen.getByText("createCustomerAction")).toBeInTheDocument();
    expect(screen.getByText(/"pgCode": "42501"/)).toBeInTheDocument();
    expect(screen.getByText("resolve:e-1")).toBeInTheDocument();
  });

  it("collapses identical errors into ONE card with the ×N badge, first/last seen and all occurrence timestamps", async () => {
    state.listResult = {
      data: [
        errRow({ id: "a", created_at: "2026-07-03T10:00:00+00:00" }),
        errRow({
          id: "b",
          created_at: "2026-07-02T10:00:00+00:00",
          stack_trace: "at newestWithStack()",
        }),
        errRow({ id: "c", created_at: "2026-07-01T10:00:00+00:00" }),
      ],
      count: 3,
    };
    state.unresolvedCount = 3;
    await renderPage();

    // One card, not three: the message renders twice (summary + detail)
    // for a single group.
    expect(screen.getAllByText("connection refused")).toHaveLength(2);
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText(/First seen/)).toBeInTheDocument();
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
    // Newest available stack trace shown in the detail.
    expect(screen.getByText("at newestWithStack()")).toBeInTheDocument();
    // Occurrence list: every individual timestamp appears (newest also
    // shows in the summary, so ≥1 render each).
    expect(screen.getByText(/Occurrences \(3\)/)).toBeInTheDocument();
    expect(
      screen.getAllByText("2026-07-03T10:00:00+00:00").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("2026-07-02T10:00:00+00:00").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("2026-07-01T10:00:00+00:00").length,
    ).toBeGreaterThan(0);
    // Group-level resolve targets all three ids.
    expect(screen.getByText("resolve:a|b|c")).toBeInTheDocument();
  });

  it("does NOT merge errors that differ only by url — two separate cards", async () => {
    state.listResult = {
      data: [
        errRow({ id: "a", url: "/customers" }),
        errRow({ id: "b", url: "/projects" }),
      ],
      count: 2,
    };
    state.unresolvedCount = 2;
    await renderPage();
    expect(screen.getByText("resolve:a")).toBeInTheDocument();
    expect(screen.getByText("resolve:b")).toBeInTheDocument();
    expect(screen.queryByText("×2")).not.toBeInTheDocument();
  });

  it("shows the filter-scoped Resolve all in the header (severity scope + scoped count)", async () => {
    state.unresolvedCount = 9;
    state.scopedUnresolvedCount = 4;
    await renderPage({ severity: "warning" });
    expect(screen.getByText("resolve-all:warning:4")).toBeInTheDocument();
  });

  it("Resolve all on the default view sweeps all unresolved (unscoped count)", async () => {
    state.unresolvedCount = 9;
    await renderPage();
    expect(screen.getByText("resolve-all:all:9")).toBeInTheDocument();
  });

  it("hides Resolve all on the resolved view and when nothing is unresolved", async () => {
    state.unresolvedCount = 9;
    await renderPage({ resolved: "true" });
    expect(screen.queryByText(/resolve-all:/)).not.toBeInTheDocument();
  });

  it("hides Resolve all when the unresolved count is zero", async () => {
    state.unresolvedCount = 0;
    await renderPage();
    expect(screen.queryByText(/resolve-all:/)).not.toBeInTheDocument();
  });

  it("a fully-resolved group shows the Resolved chip and hides the resolve button", async () => {
    state.listResult = {
      data: [
        errRow({
          resolved_at: "2026-07-02T10:00:00+00:00",
          stack_trace: "at boom()",
        }),
      ],
      count: 1,
    };
    await renderPage({ resolved: "true" });
    // "Resolved" appears once as the filter link and once as the chip.
    expect(screen.getAllByText("Resolved").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("resolve:e-1")).not.toBeInTheDocument();
    // Stack trace section renders when present.
    expect(screen.getByText("at boom()")).toBeInTheDocument();
  });

  it("filter pills carry aria-current on the active view", async () => {
    await renderPage({ severity: "error" });
    const active = screen.getByRole("link", { name: /Errors/ });
    expect(active).toHaveAttribute("aria-current", "page");
    const inactive = screen.getByRole("link", { name: /Warnings/ });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("paginates: page=2 requests rows 25-49 and renders page links preserving filters", async () => {
    state.listResult = { data: [errRow({})], count: 60 };
    await renderPage({ page: "2", severity: "error" });
    expect(state.listFilters).toContainEqual({
      op: "range",
      col: "",
      value: [25, 49],
    });
    const link = screen.getByRole("link", { name: "3" });
    expect(link).toHaveAttribute(
      "href",
      "/system/errors?page=3&severity=error",
    );
  });

  it("null user/team ids render an em-dash placeholder instead of blank", async () => {
    state.listResult = {
      data: [errRow({ user_id: null, team_id: null, url: null })],
      count: 1,
    };
    await renderPage();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  describe("FilterLink hrefs preserve the other dimension's params", () => {
    it("switching severity while viewing Resolved keeps resolved=true", async () => {
      await renderPage({ resolved: "true" });
      expect(
        screen.getByRole("link", { name: /Errors/ }),
      ).toHaveAttribute("href", "/system/errors?severity=error&resolved=true");
      expect(
        screen.getByRole("link", { name: /Warnings/ }),
      ).toHaveAttribute(
        "href",
        "/system/errors?severity=warning&resolved=true",
      );
    });

    it("switching to 'All' while filtered to a severity keeps that severity", async () => {
      await renderPage({ severity: "warning" });
      expect(
        screen.getByRole("link", { name: /^All$/ }),
      ).toHaveAttribute("href", "/system/errors?severity=warning&resolved=all");
      expect(
        screen.getByRole("link", { name: /Resolved/ }),
      ).toHaveAttribute(
        "href",
        "/system/errors?severity=warning&resolved=true",
      );
    });

    it("'Unresolved' clears the resolved param but keeps the active severity", async () => {
      await renderPage({ severity: "error", resolved: "all" });
      expect(
        screen.getByRole("link", { name: /Unresolved/ }),
      ).toHaveAttribute("href", "/system/errors?severity=error");
    });

    it("clicking a filter with no other dimension active links to the bare path", async () => {
      await renderPage();
      expect(
        screen.getByRole("link", { name: /Unresolved/ }),
      ).toHaveAttribute("href", "/system/errors");
    });
  });

  it("generateMetadata resolves the translated title", async () => {
    const { generateMetadata } = await import("./page");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Error Log");
  });
});
