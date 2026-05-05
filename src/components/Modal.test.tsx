import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef, useState } from "react";
import { Modal } from "./Modal";

/** Test harness: a button that opens the modal, the modal contains
 *  three focusable controls + a heading. Mirrors the typical caller
 *  shape (PersonHistoryDialog, etc). */
function Harness({
  initialOpen = false,
  withTitle = true,
}: {
  initialOpen?: boolean;
  withTitle?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId={withTitle ? "test-modal-title" : undefined}
        ariaLabel={withTitle ? undefined : "Test modal"}
      >
        {withTitle && <h2 id="test-modal-title">Modal Heading</h2>}
        <input aria-label="first-input" />
        <button>Inside-1</button>
        <button onClick={() => setOpen(false)}>Inside-2 (close)</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wires aria-labelledby when titleId is provided", () => {
    render(<Harness initialOpen />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("test-modal-title");
    expect(dialog.getAttribute("aria-label")).toBeNull();
  });

  it("falls back to aria-label when titleId is omitted", () => {
    render(<Harness initialOpen withTitle={false} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Test modal");
    expect(dialog.getAttribute("aria-labelledby")).toBeNull();
  });

  it("backdrop click triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="X">
        <button>Inside</button>
      </Modal>,
    );
    const backdrop = document.querySelector(
      "[aria-hidden][class*='absolute']",
    );
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape key triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="X">
        <button>Inside</button>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses an inner control on open and traps focus on Tab from the last item", () => {
    render(<Harness initialOpen />);
    // Focus moves to the heading first when titleId is set; if the
    // heading isn't focusable, we fall back to first focusable.
    // The test heading has no tabIndex, so focus goes to the input.
    const input = screen.getByLabelText("first-input");
    expect(document.activeElement).toBe(input);

    const inside2 = screen.getByText("Inside-2 (close)");
    inside2.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    // Tab from the LAST focusable wraps back to the FIRST.
    expect(document.activeElement).toBe(input);
  });

  it("Shift+Tab from the first focusable wraps to the last", () => {
    render(<Harness initialOpen />);
    const input = screen.getByLabelText("first-input");
    input.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    const inside2 = screen.getByText("Inside-2 (close)");
    expect(document.activeElement).toBe(inside2);
  });

  it("returns focus to the previously focused element on close", () => {
    render(<Harness />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    fireEvent.click(trigger);
    // Modal now open. Click "Inside-2" which calls onClose.
    const inside2 = screen.getByText("Inside-2 (close)");
    fireEvent.click(inside2);
    expect(document.activeElement).toBe(trigger);
  });

  it("locks body scroll while open and restores on close", () => {
    document.body.style.overflow = "auto";
    const { rerender } = render(<Harness initialOpen />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Modal open={false} onClose={() => {}} ariaLabel="X">
        <button>Inside</button>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("auto");
  });
});
