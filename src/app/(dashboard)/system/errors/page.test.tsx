import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Server-component render harness for the admin error dashboard —
 * called out in the coverage plan because triage UI that breaks
 * silently means production errors go unseen.
 */

const mockRequireSystemAdmin = vi.fn();
vi.mock("@/lib/system-admin", () => ({
  requireSystemAdmin: () => mockRequireSystemAdmin(),
}));

vi.mock("./resolve-button", () => ({
  ResolveButton: ({ errorId }: { errorId: string }) => (
    <button type="button">resolve:{errorId}</button>
  ),
}));

vi.mock("@theshyre/ui", () => ({
  LocalDateTime: ({ value }: { value: string }) => <time>{value}</time>,
}));

interface Filter {
  op: string;
  col: string;
  value: unknown;
}

const state: {
  listResult: { data: Record<string, unknown>[] | null; count: number | null };
  unresolvedCount: number;
  listFilters: Filter[];
} = {
  listResult: { data: [], count: 0 },
  unresolvedCount: 0,
  listFilters: [],
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          return {
            is: () =>
              Promise.resolve({ count: state.unresolvedCount, error: null }),
          };
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
  state.listFilters = [];
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

  it("a resolved error shows the Resolved chip and hides the resolve button", async () => {
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
});
