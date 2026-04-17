import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MemberOption } from "./member-filter";

// Mock next/navigation before importing the component.
const mockPush = vi.fn();
const mockPathname = "/time-entries";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

// Minimal i18n shim — the component calls useTranslations("time.memberFilter").
vi.mock("next-intl", () => ({
  useTranslations: (_ns: string) => (key: string, vars?: Record<string, unknown>) => {
    switch (key) {
      case "justYou":
        return "You";
      case "allTeam":
        return `All team (${vars?.count})`;
      case "nMembers":
        return `${vars?.count} members`;
      case "youPlus":
        return `You + ${vars?.count}`;
      case "none":
        return "No one";
      case "unknownMember":
        return "Unknown";
      case "youSuffix":
        return "you";
      default:
        return key;
    }
  },
}));

import { MemberFilter } from "./member-filter";

const MEMBERS: MemberOption[] = [
  { user_id: "u-self", display_name: "You (Owner)", avatar_url: null, isSelf: true },
  { user_id: "u-jordan", display_name: "Jordan Patel", avatar_url: null, isSelf: false },
  { user_id: "u-riley", display_name: "Riley Kim", avatar_url: null, isSelf: false },
];

function lastPushedParams(): string {
  const calls = mockPush.mock.calls;
  if (calls.length === 0) return "";
  const url = calls[calls.length - 1]![0] as string;
  const q = url.split("?")[1] ?? "";
  return q;
}

describe("MemberFilter", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders null when there's one or fewer members (solo scenario)", () => {
    const { container: a } = render(
      <MemberFilter members={[]} selection="me" />,
    );
    expect(a).toBeEmptyDOMElement();

    const { container: b } = render(
      <MemberFilter members={[MEMBERS[0]!]} selection="me" />,
    );
    expect(b).toBeEmptyDOMElement();
  });

  it("default (selection='me') label is 'You'", () => {
    render(<MemberFilter members={MEMBERS} selection="me" />);
    expect(screen.getByRole("button", { name: /You/ })).toBeInTheDocument();
  });

  it("label shows all-team with the count when selection='all'", () => {
    render(<MemberFilter members={MEMBERS} selection="all" />);
    expect(
      screen.getByRole("button", { name: /All team \(3\)/ }),
    ).toBeInTheDocument();
  });

  it("label is 'You + N' when selection includes self + N others", () => {
    render(
      <MemberFilter
        members={MEMBERS}
        selection={["u-self", "u-jordan"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /You \+ 1/ }),
    ).toBeInTheDocument();
  });

  it("label is 'N members' when selection excludes self", () => {
    render(
      <MemberFilter
        members={MEMBERS}
        selection={["u-jordan", "u-riley"]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /2 members/ }),
    ).toBeInTheDocument();
  });

  it("label is the single member name when selection is that one non-self user", () => {
    render(
      <MemberFilter members={MEMBERS} selection={["u-jordan"]} />,
    );
    expect(
      screen.getByRole("button", { name: /Jordan Patel/ }),
    ).toBeInTheDocument();
  });

  it("label is 'You' when selection is a single-element list containing just self", () => {
    render(<MemberFilter members={MEMBERS} selection={["u-self"]} />);
    expect(screen.getByRole("button", { name: /^You/ })).toBeInTheDocument();
  });

  it("label is 'No one' when selection is an empty list", () => {
    render(<MemberFilter members={MEMBERS} selection={[]} />);
    expect(
      screen.getByRole("button", { name: /No one/ }),
    ).toBeInTheDocument();
  });

  it("opens a dropdown with 'You' + 'All team' + each member", async () => {
    const user = userEvent.setup();
    render(<MemberFilter members={MEMBERS} selection="me" />);
    await user.click(screen.getByRole("button", { name: /You/ }));
    // The dropdown has two quick-picks + three member rows = 5 buttons after the trigger.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText(/Jordan Patel/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Riley Kim/).length).toBeGreaterThan(0);
  });

  it("clicking 'All team' pushes ?members=all", async () => {
    const user = userEvent.setup();
    render(<MemberFilter members={MEMBERS} selection="me" />);
    await user.click(screen.getByRole("button", { name: /You/ }));
    await user.click(screen.getByRole("button", { name: /All team/ }));
    expect(lastPushedParams()).toContain("members=all");
  });

  it("toggling an individual member from 'me' pushes a comma-separated list", async () => {
    const user = userEvent.setup();
    render(<MemberFilter members={MEMBERS} selection="me" />);
    await user.click(screen.getByRole("button", { name: /^You$/ }));
    // Click Jordan's row — should add Jordan to the selection.
    await user.click(screen.getByRole("button", { name: /Jordan Patel/ }));
    const params = lastPushedParams();
    expect(params).toContain("members=");
    expect(params).toContain("u-self"); // self retained
    expect(params).toContain("u-jordan"); // jordan added
  });

  it("toggling all members individually collapses to 'all'", async () => {
    const user = userEvent.setup();
    render(
      <MemberFilter
        members={MEMBERS}
        selection={["u-self", "u-jordan"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /You \+ 1/ }));
    // Add Riley — now all 3 selected → should collapse to "all".
    await user.click(screen.getByRole("button", { name: /Riley Kim/ }));
    expect(lastPushedParams()).toContain("members=all");
  });

  it("removing all non-self members collapses to 'me'", async () => {
    const user = userEvent.setup();
    render(
      <MemberFilter
        members={MEMBERS}
        selection={["u-self", "u-jordan"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /You \+ 1/ }));
    // Uncheck Jordan → leaves [u-self] → collapses to 'me'.
    await user.click(screen.getByRole("button", { name: /Jordan Patel/ }));
    expect(lastPushedParams()).not.toContain("members=");
  });

  it("deselecting the last member leaves 'none'", async () => {
    const user = userEvent.setup();
    render(
      <MemberFilter members={MEMBERS} selection={["u-jordan"]} />,
    );
    await user.click(screen.getByRole("button", { name: /Jordan Patel/ }));
    // The button with Jordan is both the label and the row — find the dropdown row
    // (there will be multiple buttons with the name).
    const rows = screen.getAllByRole("button", { name: /Jordan Patel/ });
    // Click the last matching — the dropdown row, not the trigger.
    await user.click(rows[rows.length - 1]!);
    expect(lastPushedParams()).toContain("members=none");
  });
});
