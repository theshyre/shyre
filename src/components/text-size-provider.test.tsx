import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TextSizeProvider,
  useTextSize,
  type TextSize,
} from "./text-size-provider";

function Consumer(): React.JSX.Element {
  const { textSize, setTextSize, sizes } = useTextSize();
  return (
    <div>
      <span data-testid="current">{textSize}</span>
      <span data-testid="count">{sizes.length}</span>
      {(["compact", "regular", "large"] satisfies TextSize[]).map((s) => (
        <button key={s} onClick={() => setTextSize(s)}>{`set-${s}`}</button>
      ))}
    </div>
  );
}

describe("TextSizeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("defaults to regular when nothing stored", () => {
    render(
      <TextSizeProvider>
        <Consumer />
      </TextSizeProvider>,
    );
    expect(screen.getByTestId("current").textContent).toBe("regular");
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("switching size writes localStorage + data-text-size attribute", async () => {
    const user = userEvent.setup();
    render(
      <TextSizeProvider>
        <Consumer />
      </TextSizeProvider>,
    );
    await user.click(screen.getByText("set-large"));
    expect(screen.getByTestId("current").textContent).toBe("large");
    expect(localStorage.getItem("stint-text-size")).toBe("large");
    // CSS in globals.css drives the actual font-size off the attribute —
    // no inline style.fontSize is set (it gets reconciled away by React).
    expect(document.documentElement.getAttribute("data-text-size")).toBe(
      "large",
    );
  });

  it("reads stored size on mount", async () => {
    localStorage.setItem("stint-text-size", "compact");
    render(
      <TextSizeProvider>
        <Consumer />
      </TextSizeProvider>,
    );
    expect(screen.getByTestId("current").textContent).toBe("compact");
  });

  it("ignores an invalid stored value and falls back to regular", () => {
    localStorage.setItem("stint-text-size", "huge");
    render(
      <TextSizeProvider>
        <Consumer />
      </TextSizeProvider>,
    );
    expect(screen.getByTestId("current").textContent).toBe("regular");
  });

  it("throws if useTextSize is used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/TextSizeProvider/);
    spy.mockRestore();
  });
});
