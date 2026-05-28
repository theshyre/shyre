import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl, testMessages } from "@/test/intl";
import type { ProjectExpenseRowAuthor } from "./project-expense-row";

// next-intl's server `getTranslations` would normally need a request
// context. The test substitutes a synchronous translator that walks
// the English message bundle the same way the runtime would.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    return (key: string, params?: Record<string, unknown>) => {
      const path = `${ns}.${key}`.split(".");
      let cur: unknown = testMessages;
      for (const seg of path) {
        if (cur && typeof cur === "object" && seg in (cur as object)) {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          return path.join(".");
        }
      }
      if (typeof cur === "string" && params) {
        return cur.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
      }
      return typeof cur === "string" ? cur : path.join(".");
    };
  },
}));

// Server-action chain — mocked so the row's import side-effect
// chain doesn't drag in actual server code.
vi.mock(
  "@/app/(dashboard)/business/[businessId]/expenses/actions",
  () => ({
    deleteExpenseAction: vi.fn(async () => ({ success: true })),
    restoreExpenseAction: vi.fn(async () => ({ success: true })),
    createExpenseAction: vi.fn(async () => ({ success: true })),
  }),
);

import { ExpensesSection } from "./expenses-section";
import { ToastProvider } from "@/components/Toast";

const author: ProjectExpenseRowAuthor = {
  userId: "u-1",
  displayName: "Alex Author",
  avatarUrl: null,
};

const baseProps = {
  projectId: "proj-1",
  teamId: "t1",
  teamName: "Acme",
  businessId: "biz-1",
  viewerUserId: "viewer-1",
  viewerIsTeamAdmin: true,
  showScopedHint: false,
};

describe("ExpensesSection", () => {
  it("renders the empty state when there are no expenses", async () => {
    const rendered = await ExpensesSection({
      ...baseProps,
      expenses: [],
      authorById: new Map(),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(
      screen.getByText(/No expenses logged for this project yet/i),
    ).toBeInTheDocument();
    // The form is still rendered above the empty state — the "no
    // expenses yet" copy must not hide the path forward.
    expect(
      screen.getByRole("button", { name: /Add expense/i }),
    ).toBeInTheDocument();
  });

  it("renders one row per expense", async () => {
    const rendered = await ExpensesSection({
      ...baseProps,
      expenses: [
        {
          id: "e1",
          user_id: "u-1",
          incurred_on: "2026-04-10",
          amount: 12.5,
          currency: "USD",
          vendor: "Linear",
          category: "software",
          billable: true,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
        },
        {
          id: "e2",
          user_id: "u-1",
          incurred_on: "2026-04-12",
          amount: 100,
          currency: "USD",
          vendor: "Adobe",
          category: "subscriptions",
          billable: false,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
        },
      ],
      authorById: new Map([[author.userId, author]]),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(screen.getByText("Linear")).toBeInTheDocument();
    expect(screen.getByText("Adobe")).toBeInTheDocument();
  });

  it("renders the scoped-visibility hint when showScopedHint is true AND there are rows", async () => {
    const rendered = await ExpensesSection({
      ...baseProps,
      showScopedHint: true,
      expenses: [
        {
          id: "e1",
          user_id: "u-1",
          incurred_on: "2026-04-10",
          amount: 12.5,
          currency: "USD",
          vendor: "Linear",
          category: "software",
          billable: true,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
        },
      ],
      authorById: new Map([[author.userId, author]]),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(
      screen.getByText(/Showing expenses you logged/i),
    ).toBeInTheDocument();
  });

  it("hides the scoped-visibility hint on an empty list even when showScopedHint is true", async () => {
    // The hint adds no signal when there's nothing to "be filtering
    // out of view" — leaving it on an empty list reads as if the
    // empty state is suspect. UX reviewer flagged this; the section
    // gates the hint on count > 0.
    const rendered = await ExpensesSection({
      ...baseProps,
      showScopedHint: true,
      expenses: [],
      authorById: new Map(),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(screen.queryByText(/Showing expenses you logged/i)).toBeNull();
  });

  it("omits the scoped-visibility hint when showScopedHint is false", async () => {
    const rendered = await ExpensesSection({
      ...baseProps,
      showScopedHint: false,
      expenses: [
        {
          id: "e1",
          user_id: "u-1",
          incurred_on: "2026-04-10",
          amount: 12.5,
          currency: "USD",
          vendor: "Linear",
          category: "software",
          billable: true,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
        },
      ],
      authorById: new Map([[author.userId, author]]),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(screen.queryByText(/Showing expenses you logged/i)).toBeNull();
  });

  it("falls back gracefully when an author profile is missing from the map", async () => {
    // user_profiles row could go missing if a user was deleted while
    // a still-undeleted expense referenced their id. Row must render
    // without crashing; author label switches to the localized
    // "Unknown user" string.
    const rendered = await ExpensesSection({
      ...baseProps,
      expenses: [
        {
          id: "orphan",
          user_id: "u-missing",
          incurred_on: "2026-04-10",
          amount: 7,
          currency: "USD",
          vendor: "Mystery",
          category: "other",
          billable: false,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
        },
      ],
      authorById: new Map(),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    expect(screen.getByText("Mystery")).toBeInTheDocument();
  });

  it("hides delete on teammates' rows when viewer is a non-admin (canEdit split)", async () => {
    // Mirrors the action-layer + RLS rule: members can mutate only
    // their own rows. A regression flipping the OR to AND on the
    // canEdit computation would silently expose unauthorized buttons
    // (the server would still refuse the write, but the UI promise
    // would be wrong).
    const viewerExpense = {
      id: "own",
      user_id: "viewer-1",
      incurred_on: "2026-04-10",
      amount: 10,
      currency: "USD",
      vendor: "Self",
      category: "software",
      billable: false,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
    };
    const teammateExpense = {
      id: "other",
      user_id: "teammate-2",
      incurred_on: "2026-04-11",
      amount: 20,
      currency: "USD",
      vendor: "Teammate",
      category: "software",
      billable: false,
          invoiced: false,
          invoiceId: null,
          invoiceNumber: null,
    };
    const rendered = await ExpensesSection({
      ...baseProps,
      viewerIsTeamAdmin: false,
      expenses: [viewerExpense, teammateExpense],
      authorById: new Map([
        ["viewer-1", { userId: "viewer-1", displayName: "Me", avatarUrl: null }],
        [
          "teammate-2",
          { userId: "teammate-2", displayName: "Them", avatarUrl: null },
        ],
      ]),
    });
    renderWithIntl(<ToastProvider>{rendered}</ToastProvider>);
    // The viewer's own row exposes a delete; the teammate's does not.
    expect(screen.getByLabelText(/Delete Self/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Delete Teammate/i)).toBeNull();
  });
});
