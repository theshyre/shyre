import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { AutoTextarea } from "./AutoTextarea";

// jsdom does no layout, so scrollHeight is always 0. Stub it to a value that
// tracks the content length so the grow/shrink behavior is observable.
let scrollHeightSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  scrollHeightSpy = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      const len = (this as HTMLTextAreaElement).value?.length ?? 0;
      return 40 + len * 2; // taller as content grows
    });
});
afterEach(() => scrollHeightSpy?.mockRestore());

function Controlled(): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <AutoTextarea
      aria-label="notes"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

describe("AutoTextarea", () => {
  it("sizes to content height on mount and grows as the value changes", () => {
    render(<Controlled />);
    const el = screen.getByLabelText("notes") as HTMLTextAreaElement;
    expect(el.style.height).toBe("40px"); // empty → base height

    fireEvent.change(el, { target: { value: "a".repeat(30) } });
    expect(el.style.height).toBe("100px"); // 40 + 30*2

    // Shrinks back when text is removed (collapse-then-measure).
    fireEvent.change(el, { target: { value: "x" } });
    expect(el.style.height).toBe("42px");
  });

  it("suppresses the scrollbar + manual resize grip (auto-grow owns height)", () => {
    render(<AutoTextarea aria-label="n" value="hi" onChange={() => {}} />);
    const el = screen.getByLabelText("n");
    expect(el.style.overflow).toBe("hidden");
    expect(el.style.resize).toBe("none");
  });

  it("forwards props (className, placeholder, minRows→rows, id)", () => {
    render(
      <AutoTextarea
        aria-label="n"
        id="my-ta"
        className="foo"
        placeholder="type…"
        minRows={4}
        value=""
        onChange={() => {}}
      />,
    );
    const el = screen.getByLabelText("n") as HTMLTextAreaElement;
    expect(el.id).toBe("my-ta");
    expect(el.className).toContain("foo");
    expect(el.placeholder).toBe("type…");
    expect(el.rows).toBe(4);
  });

  it("grows an UNCONTROLLED field (defaultValue) on mount and on input", () => {
    render(<AutoTextarea aria-label="u" defaultValue="hi" />);
    const el = screen.getByLabelText("u") as HTMLTextAreaElement;
    expect(el.style.height).toBe("44px"); // 40 + 2*2 ("hi")

    fireEvent.input(el, { target: { value: "a".repeat(20) } });
    expect(el.style.height).toBe("80px"); // 40 + 20*2
  });

  it("forwards a ref to the underlying textarea", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<AutoTextarea aria-label="r" ref={ref} defaultValue="" />);
    expect(ref.current).toBe(screen.getByLabelText("r"));
  });
});
