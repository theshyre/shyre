import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
let currentSearchParams = "view=table";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

// EntryTable indirectly imports the actions module; mock to silence
// the server-action import chain (mirrors entry-table.test.tsx).
vi.mock("./actions", () => ({
  updateTimeEntryAction: vi.fn(),
  deleteTimeEntryAction: vi.fn(),
  duplicateTimeEntryAction: vi.fn(),
  startTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  deleteTimeEntriesAction: vi.fn(),
  restoreTimeEntriesAction: vi.fn(),
  markBilledElsewhereEntriesAction: vi.fn(),
  unmarkBilledElsewhereEntriesAction: vi.fn(),
}));

import { TableView } from "./table-view";
import { ToastProvider } from "@/components/Toast";
import type { TimeEntry } from "./types";

function makeEntry(id: string, description: string): TimeEntry {
  const start = new Date(2026, 3, 13, 10);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id,
    team_id: "o1",
    user_id: "u1",
    project_id: "p1",
    description,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    duration_min: 60,
    billable: true,
    github_issue: null,
    linked_ticket_provider: null,
    linked_ticket_key: null,
    linked_ticket_url: null,
    linked_ticket_title: null,
    linked_ticket_refreshed_at: null,
    invoiced: false,
    invoice_id: null,
    invoice_number: null,
    category_id: null,
    projects: { id: "p1", name: "Alpha", github_repo: null },
    author: null,
  };
}

function renderTable(
  props?: Partial<React.ComponentProps<typeof TableView>>,
): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(
    <ToastProvider>
      <TableView
        entries={[makeEntry("a", "Programming"), makeEntry("b", "Meeting")]}
        fromStr="2026-04-01"
        toStr="2026-04-30"
        searchQuery={null}
        invoicedFilter="all"
        rowLimit={500}
        maxRangeDays={365}
        projects={[]}
        categories={[]}
        viewerUserId="u1"
        {...props}
      />
    </ToastProvider>,
  );
}

describe("TableView", () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearchParams = "view=table";
  });

  it("renders the filter region and the entries", () => {
    renderTable();
    expect(screen.getByLabelText(/filter time entries/i)).toBeInTheDocument();
    expect(screen.getByText("Programming")).toBeInTheDocument();
    expect(screen.getByText("Meeting")).toBeInTheDocument();
  });

  it("renders the invoice-status filter with the active state pressed", () => {
    renderTable({ invoicedFilter: "uninvoiced" });
    const button = screen.getByRole("button", { name: /^uninvoiced$/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /^all$/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an invoice-status chip writes ?invoiced=<value>", () => {
    renderTable();
    fireEvent.click(
      screen.getByRole("button", { name: /billed elsewhere/i }),
    );
    expect(pushMock.mock.calls[0]?.[0]).toMatch(/invoiced=billed_elsewhere/);
  });

  it("clicking the 'All' chip clears the invoiced URL param", () => {
    renderTable({ invoicedFilter: "uninvoiced" });
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(pushMock.mock.calls[0]?.[0]).not.toMatch(/invoiced=/);
  });

  it("debounces the description search and writes ?q= after 300ms", () => {
    vi.useFakeTimers();
    try {
      renderTable();
      const input = screen.getByLabelText(/search descriptions/i);
      fireEvent.change(input, { target: { value: "Programming" } });
      // Nothing yet — debounce hasn't fired.
      expect(pushMock).not.toHaveBeenCalled();
      // Advance past the 300ms debounce. Wrap in act() so the React
      // state updates triggered by the setTimeout callback flush
      // synchronously (the timer fires patchUrl which routes to
      // pushMock; React's render queue still needs to drain).
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(pushMock).toHaveBeenCalled();
      expect(pushMock.mock.calls[0]?.[0]).toMatch(/q=Programming/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Enter on the search input commits the value immediately", () => {
    renderTable();
    const input = screen.getByLabelText(/search descriptions/i);
    fireEvent.change(input, { target: { value: "Audit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The debounce timer is racing, but Enter commits synchronously.
    const call = pushMock.mock.calls.find((c) => /q=Audit/.test(c[0] as string));
    expect(call).toBeTruthy();
  });

  it("Escape on the search input clears local state and URL", () => {
    renderTable({ searchQuery: "Programming" });
    const input = screen.getByLabelText(
      /search descriptions/i,
    ) as HTMLInputElement;
    expect(input.value).toBe("Programming");
    fireEvent.keyDown(input, { key: "Escape" });
    // After Esc the URL clears...
    expect(pushMock.mock.calls[0]?.[0]).not.toMatch(/q=/);
    // ...and the local input value clears too so the inline clear (X)
    // doesn't appear over stale text.
    expect(input.value).toBe("");
  });

  it("renders the truncation notice when entries hit the row limit", () => {
    const lots = Array.from({ length: 500 }, (_, i) =>
      makeEntry(String(i), `entry ${i}`),
    );
    renderTable({ entries: lots, rowLimit: 500 });
    expect(screen.getByRole("status")).toHaveTextContent(/most recent 500/i);
  });

  it("does NOT render the truncation notice when below the cap", () => {
    renderTable();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Clear filters resets search input, URL, and is hidden when nothing is filtered", () => {
    // No filters → no Clear button visible.
    renderTable();
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).toBeNull();

    // Active filter → button appears.
    pushMock.mockClear();
    currentSearchParams = "view=table&invoiced=uninvoiced";
    renderTable({ invoicedFilter: "uninvoiced", searchQuery: "Audit" });
    const clearBtn = screen.getByRole("button", { name: /clear filters/i });
    fireEvent.click(clearBtn);
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/q=/);
    expect(call).not.toMatch(/invoiced=/);
    expect(call).not.toMatch(/from=/);
    expect(call).not.toMatch(/to=/);
  });

  it("shows the resolved date range in the range caption", () => {
    renderTable({ fromStr: "2026-01-01", toStr: "2026-03-31" });
    expect(screen.getByText(/2026-01-01.*2026-03-31/)).toBeInTheDocument();
  });

  it("entry count caption pluralizes correctly", () => {
    renderTable({ entries: [] });
    expect(screen.getByText(/no entries/i)).toBeInTheDocument();
    renderTable({ entries: [makeEntry("a", "Solo")] });
    expect(screen.getByText(/1 entry/)).toBeInTheDocument();
  });

  it("renders each row's date inline with the time-of-day", () => {
    // makeEntry locks start_time to 2026-04-13 10:00 local. The
    // table view passes showDate=true to EntryTable → EntryRow,
    // so the short date should appear in the time column. We don't
    // pin the exact formatted string (it's locale-dependent), but
    // SOMETHING with a "26" year shard should show up — that's the
    // user-visible regression target: "1:00 AM" by itself with no
    // date was the bug the screenshot exposed.
    renderTable();
    // 2026 → "26" in en-US's "M/d/yy" short format.
    const hits = screen.getAllByText((_, el) => {
      const text = el?.textContent ?? "";
      return /\b26\b/.test(text) && /4\b/.test(text);
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});
