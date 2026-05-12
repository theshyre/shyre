import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { useRunningEntry } from "./use-running-entry";

/**
 * use-running-entry fetches the current running time-entry and
 * sums its (project, category, user, today) baseline minutes.
 * Re-fetches on:
 *   - mount
 *   - window focus
 *   - TIMER_CHANGED_EVENT
 */

interface RowFixture {
  id: string;
  project_id: string;
  category_id: string | null;
  user_id: string;
  description: string | null;
  start_time: string;
  projects:
    | { name?: string; customers?: { name?: string } | null }
    | null;
}

const state: {
  runningRow: RowFixture | null;
  baselineRows: Array<{ duration_min: number | null }>;
  /** Records each "first" query (the running-entry fetch). */
  runningFetchCount: number;
  /** Records each "second" query (the baseline sum). */
  baselineFetchCount: number;
} = {
  runningRow: null,
  baselineRows: [],
  runningFetchCount: 0,
  baselineFetchCount: 0,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "time_entries") {
        throw new Error(`unexpected table ${table}`);
      }
      const op: { filters: string[]; cols?: string } = { filters: [] };
      const chain: Record<string, unknown> = {
        select(cols: string) {
          // First fetch selects projects + customers; second fetch
          // selects duration_min. Pick the correct response by
          // looking at the selected cols string.
          op.filters = []; // reset per chain
          op.cols = cols;
          return chain;
        },
        is(col: string, _val: unknown) {
          op.filters.push(`is:${col}`);
          return chain;
        },
        eq(col: string, _val: unknown) {
          op.filters.push(`eq:${col}`);
          return chain;
        },
        not(col: string, _op: string, _val: unknown) {
          op.filters.push(`not:${col}`);
          return chain;
        },
        gte(col: string, _val: unknown) {
          op.filters.push(`gte:${col}`);
          return chain;
        },
        lt(col: string, _val: unknown) {
          op.filters.push(`lt:${col}`);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve: (v: { data: unknown[] | null; error: null }) => void) {
          const cols = op.cols ?? "";
          if (cols.includes("projects(name")) {
            state.runningFetchCount += 1;
            const data = state.runningRow ? [state.runningRow] : [];
            resolve({ data, error: null });
            return;
          }
          if (cols.includes("duration_min")) {
            state.baselineFetchCount += 1;
            resolve({ data: state.baselineRows, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  }),
}));

function Probe({
  onRunning,
}: {
  onRunning: (r: unknown) => void;
}): null {
  const { running } = useRunningEntry();
  React.useEffect(() => {
    onRunning(running);
  }, [running, onRunning]);
  return null;
}

import React from "react";

beforeEach(() => {
  state.runningRow = null;
  state.baselineRows = [];
  state.runningFetchCount = 0;
  state.baselineFetchCount = 0;
});

describe("useRunningEntry", () => {
  it("returns null on mount when nothing is running", async () => {
    let captured: unknown = "initial";
    render(<Probe onRunning={(r) => (captured = r)} />);
    await waitFor(() => {
      expect(state.runningFetchCount).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(captured).toBeNull();
    });
  });

  it("hydrates from the fetched running row + computes today's baseline", async () => {
    state.runningRow = {
      id: "e-1",
      project_id: "p-1",
      category_id: "cat-1",
      user_id: "u-1",
      description: "x",
      start_time: new Date(2026, 4, 15, 14, 0, 0).toISOString(),
      projects: {
        name: "Acme API",
        customers: { name: "Acme Corp" },
      },
    };
    state.baselineRows = [
      { duration_min: 30 },
      { duration_min: 45 },
      { duration_min: null },
    ];
    type Captured = { project_name?: string; today_baseline_min?: number };
    const captured: { value: Captured | null } = { value: null };
    render(
      <Probe
        onRunning={(r) => {
          captured.value = r as Captured;
        }}
      />,
    );
    await waitFor(() => {
      expect(captured.value).not.toBeNull();
    });
    expect(captured.value?.project_name).toBe("Acme API");
    expect(captured.value?.today_baseline_min).toBe(75);
  });

  it("re-fetches when window dispatches TIMER_CHANGED_EVENT", async () => {
    render(<Probe onRunning={() => {}} />);
    await waitFor(() => {
      expect(state.runningFetchCount).toBe(1);
    });
    await act(async () => {
      window.dispatchEvent(new Event("shyre:timer:changed"));
    });
    await waitFor(() => {
      expect(state.runningFetchCount).toBeGreaterThanOrEqual(2);
    });
  });

  it("re-fetches on window focus event", async () => {
    render(<Probe onRunning={() => {}} />);
    await waitFor(() => {
      expect(state.runningFetchCount).toBe(1);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(state.runningFetchCount).toBeGreaterThanOrEqual(2);
    });
  });

  it("baseline=0 when there are no completed entries for today's bucket", async () => {
    state.runningRow = {
      id: "e-1",
      project_id: "p-1",
      category_id: null,
      user_id: "u-1",
      description: null,
      start_time: new Date(2026, 4, 15, 9, 0).toISOString(),
      projects: { name: "X", customers: null },
    };
    state.baselineRows = [];
    type Captured = { today_baseline_min?: number };
    const captured: { value: Captured | null } = { value: null };
    render(
      <Probe
        onRunning={(r) => {
          captured.value = r as Captured;
        }}
      />,
    );
    await waitFor(() => {
      expect(captured.value).not.toBeNull();
    });
    expect(captured.value?.today_baseline_min).toBe(0);
  });
});
