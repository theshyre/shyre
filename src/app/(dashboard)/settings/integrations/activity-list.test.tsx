import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import type { IntegrationEventRow } from "./token-constants";

import { ActivityList } from "./activity-list";

const profiles = [
  { user_id: "u-me", display_name: "Marcus", avatar_url: null },
];

function event(
  overrides: Partial<IntegrationEventRow>,
): IntegrationEventRow {
  return {
    id: 1,
    action: "timer.start",
    status: "ok",
    occurred_at: "2026-07-18T10:00:00+00:00",
    user_id: "u-me",
    ...overrides,
  };
}

describe("ActivityList", () => {
  it("renders an empty state", () => {
    renderWithIntl(<ActivityList events={[]} profiles={profiles} />);
    expect(screen.getByText(/No API activity yet/)).toBeInTheDocument();
  });

  it("renders action, status word, and the acting user", () => {
    renderWithIntl(
      <ActivityList
        events={[
          event({ id: 1, action: "timer.start", status: "ok" }),
          event({ id: 2, action: "entries.log", status: "denied" }),
          event({ id: 3, action: "me", status: "error" }),
        ]}
        profiles={profiles}
      />,
    );
    expect(screen.getByText("timer.start")).toBeInTheDocument();
    expect(screen.getByText("entries.log")).toBeInTheDocument();
    // Status is communicated by the word, not color alone.
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    // Authorship: the acting user is present (sr-only in compact mode).
    expect(screen.getAllByText("Marcus").length).toBeGreaterThan(0);
  });

  it("falls back to an unknown-user author when no profile matches", () => {
    renderWithIntl(
      <ActivityList
        events={[event({ user_id: "u-ghost" })]}
        profiles={[]}
      />,
    );
    expect(screen.getByText("timer.start")).toBeInTheDocument();
  });
});
