import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
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

  it("compact mode puts the name on title for hover discoverability", () => {
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
    const wrapper = container.querySelector("[title]");
    expect(wrapper?.getAttribute("title")).toBe("Riley Kim");
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
