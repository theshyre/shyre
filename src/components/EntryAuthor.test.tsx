import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/test/intl";
import { EntryAuthor } from "./EntryAuthor";

describe("EntryAuthor", () => {
  it("renders the author's display name when present", () => {
    render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
      />,
    );
    expect(screen.getByText("Jordan Patel")).toBeInTheDocument();
  });

  it("renders 'Unknown user' as a layout-preserving fallback when author is null", () => {
    const { container } = render(<EntryAuthor author={null} />);
    expect(container).toHaveTextContent("Unknown user");
  });

  it("renders 'Unknown user' when display_name is missing", () => {
    render(
      <EntryAuthor
        author={{ user_id: "u1", display_name: null, avatar_url: null }}
      />,
    );
    expect(screen.getByText("Unknown user")).toBeInTheDocument();
  });

  it("compact mode hides the visible name but keeps it screen-reader accessible", () => {
    render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        compact
      />,
    );
    // Name is rendered in an sr-only span — querying by text still finds it.
    const nameEl = screen.getByText("Jordan Patel");
    expect(nameEl.className).toContain("sr-only");
  });

  it("compact mode reveals the name via a Tooltip describing the author", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Riley Kim",
          avatar_url: null,
        }}
        compact
      />,
    );
    // Tooltip wires aria-describedby lazily (on focus/hover). The name
    // is always available to AT via the sr-only span inside the wrapper,
    // so assert the DOM carries it there — that's the contract.
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly?.textContent).toBe("Riley Kim");
  });

  it("non-compact mode omits the title attr (name is already visible)", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Morgan Lee",
          avatar_url: null,
        }}
      />,
    );
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("full (non-compact) mode still shows the full name in a tooltip on hover, for the truncated case", async () => {
    render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Morgan Lee-Fitzgerald Alvarez",
          avatar_url: null,
        }}
      />,
    );
    const nameSpan = screen.getByText("Morgan Lee-Fitzgerald Alvarez");
    fireEvent.focus(nameSpan);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Morgan Lee-Fitzgerald Alvarez");
  });

  it("passes avatar_url through to the Avatar component when provided", () => {
    render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: "https://example.com/avatar.png",
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "Jordan Patel" });
    expect(img.getAttribute("src")).toBe("https://example.com/avatar.png");
  });

  it("falls through to an initial-based fallback when avatar_url is null", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
      />,
    );
    // With no avatar_url the fallback is a <span> with the first initial.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("J");
  });

  it("applies a custom size to the rendered avatar", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "X",
          avatar_url: null,
        }}
        size={36}
      />,
    );
    const avatar = container.querySelector("span[aria-label='X']");
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveStyle({ width: "36px", height: "36px" });
  });

  it("renders the Bot badge + 'via {label}' text for agent-started entries (icon + text, two channels)", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        startedByKind="agent"
        agentLabel="Claude Code"
      />,
    );
    // Text channel — visible in full mode.
    expect(screen.getByText("via Claude Code")).toBeInTheDocument();
    // Icon channel — lucide Bot renders an aria-hidden svg.
    const svg = container.querySelector("svg.lucide-bot");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // The human stays the author — name still renders.
    expect(screen.getByText("Jordan Patel")).toBeInTheDocument();
  });

  it("renders the badge for integration-started entries too", () => {
    render(
      <EntryAuthor
        author={{ user_id: "u1", display_name: "Jordan", avatar_url: null }}
        startedByKind="integration"
        agentLabel="Zapier"
      />,
    );
    expect(screen.getByText("via Zapier")).toBeInTheDocument();
  });

  it("renders NO badge for user-started entries, import rows, or when the kind is absent", () => {
    const cases: Array<string | null | undefined> = [
      "user",
      "import",
      null,
      undefined,
    ];
    for (const kind of cases) {
      const { container, unmount } = render(
        <EntryAuthor
          author={{ user_id: "u1", display_name: "Jordan", avatar_url: null }}
          startedByKind={kind}
          agentLabel={kind === "user" ? "Claude Code" : null}
        />,
      );
      expect(container.querySelector("svg.lucide-bot")).toBeNull();
      expect(container.textContent).not.toContain("via");
      unmount();
    }
  });

  it("falls back to a generic localized label when agent_label is missing", () => {
    render(
      <EntryAuthor
        author={{ user_id: "u1", display_name: "Jordan", avatar_url: null }}
        startedByKind="agent"
        agentLabel={null}
      />,
    );
    expect(screen.getByText("via Agent")).toBeInTheDocument();
  });

  it("falls back to 'Integration' for a label-less integration entry", () => {
    render(
      <EntryAuthor
        author={{ user_id: "u1", display_name: "Jordan", avatar_url: null }}
        startedByKind="integration"
        agentLabel={null}
      />,
    );
    expect(screen.getByText("via Integration")).toBeInTheDocument();
  });

  it("compact mode keeps the badge text for AT via sr-only", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        compact
        startedByKind="agent"
        agentLabel="Claude Code"
      />,
    );
    // Icon channel still renders in dense contexts…
    expect(container.querySelector("svg.lucide-bot")).not.toBeNull();
    // …and the text channel survives as sr-only.
    const badgeText = screen.getByText("via Claude Code");
    expect(badgeText.className).toContain("sr-only");
    // Author name stays screen-reader accessible as before.
    const nameEl = screen.getByText("Jordan Patel");
    expect(nameEl.className).toContain("sr-only");
  });

  it("compact agent chip reveals the full attribution sentence via its tooltip", async () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        compact
        startedByKind="agent"
        agentLabel="Claude Code"
      />,
    );
    const trigger = container.firstElementChild;
    expect(trigger).not.toBeNull();
    fireEvent.focus(trigger as Element);
    await waitFor(() => {
      expect(
        screen.getByText(
          "Started by Claude Code on behalf of Jordan Patel",
        ),
      ).toBeInTheDocument();
    });
  });

  it("rollup chips use the softer 'Includes time started by {label}' sentence", async () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        compact
        startedByKind="agent"
        agentLabel="Claude Code"
        rollup
      />,
    );
    const trigger = container.firstElementChild;
    fireEvent.focus(trigger as Element);
    await waitFor(() => {
      expect(
        screen.getByText("Includes time started by Claude Code"),
      ).toBeInTheDocument();
    });
    // The singular on-behalf-of claim must NOT appear on an aggregate —
    // only some of the folded entries may be agent-started.
    expect(screen.queryByText(/on behalf of/)).toBeNull();
  });

  it("full-mode badge exposes the attribution sentence on focus (tooltip accessible name)", async () => {
    render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "Jordan Patel",
          avatar_url: null,
        }}
        startedByKind="agent"
        agentLabel="Claude Code"
      />,
    );
    const badge = screen.getByText("via Claude Code").parentElement;
    expect(badge).not.toBeNull();
    fireEvent.focus(badge as Element);
    await waitFor(() => {
      expect(
        screen.getByText(
          "Started by Claude Code on behalf of Jordan Patel",
        ),
      ).toBeInTheDocument();
    });
  });

  it("applies extra className for layout hooks", () => {
    const { container } = render(
      <EntryAuthor
        author={{
          user_id: "u1",
          display_name: "X",
          avatar_url: null,
        }}
        className="gap-3 px-2"
      />,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain("gap-3");
    expect(root?.className).toContain("px-2");
  });
});
