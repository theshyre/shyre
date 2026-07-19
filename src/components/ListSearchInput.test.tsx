import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import { ListSearchInput } from "./ListSearchInput";

function renderInput(
  value = "",
): { onCommit: ReturnType<typeof vi.fn>; input: HTMLInputElement } {
  const onCommit = vi.fn();
  render(
    <ListSearchInput
      value={value}
      onCommit={onCommit}
      placeholder="Search projects"
      ariaLabel="Search projects by name"
    />,
  );
  const input = screen.getByRole("searchbox", {
    name: "Search projects by name",
  }) as HTMLInputElement;
  return { onCommit, input };
}

describe("ListSearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the trimmed query after 300ms of idle (debounced instant-apply)", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "  acme  " } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("acme");
  });

  it("restarts the debounce window on every keystroke", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "ac" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(input, { target: { value: "acme" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("acme");
  });

  it("Enter commits immediately without waiting for the debounce", () => {
    const { onCommit, input } = renderInput();
    fireEvent.change(input, { target: { value: "acme" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("acme");
  });

  it("Escape clears the input and commits the empty query", () => {
    const { onCommit, input } = renderInput("acme");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(onCommit).toHaveBeenCalledWith("");
  });

  it("Escape on an already-empty input does nothing (lets page-level Escape handlers run)", () => {
    const { onCommit, input } = renderInput("");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape-clear is consumed — it never reaches page-level keydown listeners; empty-field Escape falls through", () => {
    const { input } = renderInput("acme");
    const pageHandler = vi.fn();
    document.addEventListener("keydown", pageHandler);
    fireEvent.keyDown(input, { key: "Escape" });
    // The clear consumed the keypress — a page-level "clear selection"
    // handler must not also fire.
    expect(pageHandler).not.toHaveBeenCalled();
    // Input is now empty: Escape falls through to the page.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(pageHandler).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", pageHandler);
  });

  it("'/' focuses the input and renders a visible kbd hint", () => {
    const { input } = renderInput();
    expect(screen.getByText("/")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(input);
  });

  it("'/' is ignored while another text input is focused or a modifier is held", () => {
    const onCommit = vi.fn();
    render(
      <div>
        <input aria-label="other" />
        <ListSearchInput
          value=""
          onCommit={onCommit}
          placeholder="Search projects"
          ariaLabel="Search projects by name"
        />
      </div>,
    );
    const other = screen.getByLabelText("other");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.blur();
    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(document.activeElement).not.toBe(
      screen.getByRole("searchbox", { name: "Search projects by name" }),
    );
  });

  it("adopts an external committed-value change (e.g. Clear-all) when not mid-edit", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <ListSearchInput
        value="acme"
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    rerender(
      <ListSearchInput
        value=""
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    expect(
      (screen.getByRole("searchbox", { name: "search" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("keeps in-progress typing (incl. trailing space) when its own commit echoes back", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <ListSearchInput
        value=""
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    const input = screen.getByRole("searchbox", {
      name: "search",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme " } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenCalledWith("acme");
    // URL round-trip: committed value comes back as the prop.
    rerender(
      <ListSearchInput
        value="acme"
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    // The trailing space the user typed is still there — no yank.
    expect(input.value).toBe("acme ");
  });

  it("replaces a stale draft when an external change conflicts with it", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <ListSearchInput
        value=""
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    const input = screen.getByRole("searchbox", {
      name: "search",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme" } });
    // Before the debounce fires, something external rewrites the URL.
    rerender(
      <ListSearchInput
        value="globex"
        onCommit={onCommit}
        placeholder="p"
        ariaLabel="search"
      />,
    );
    expect(input.value).toBe("globex");
  });
});
