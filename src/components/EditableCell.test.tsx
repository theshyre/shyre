import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditableCell } from "./EditableCell";

/**
 * EditableCell tests. The component is i18n-free (consumers pass
 * `ariaLabel` directly), so tests don't need NextIntlClientProvider.
 *
 * Mode transitions covered:
 *   idle → click → editing → blur (no change) → idle
 *   idle → click → editing → type + Enter → saving → idle (success)
 *   idle → click → editing → type + Enter → saving → error
 *   idle → click → editing → type + Escape → idle (revert)
 *   disabled → click is no-op
 */

describe("EditableCell — text variant", () => {
  it("renders the value as a button in idle state", () => {
    const { getByRole } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={async () => {}}
      />,
    );
    const trigger = getByRole("button", { name: "Edit vendor" });
    expect(trigger.textContent).toBe("Linode");
  });

  it("shows placeholder dash when value is empty in idle state", () => {
    const { getByRole } = render(
      <EditableCell
        variant="text"
        value=""
        placeholder="—"
        ariaLabel="Edit vendor"
        onCommit={async () => {}}
      />,
    );
    expect(getByRole("button").textContent).toBe("—");
  });

  it("switches to an input on click and pre-populates with value", () => {
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={async () => {}}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Linode");
  });

  it("commits on Enter and calls onCommit with the new value", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Akamai" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("Akamai");
    });
  });

  it("reverts on Escape and does not call onCommit", () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Akamai" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    // Idle button is back, with the original value.
    expect(getByRole("button").textContent).toBe("Linode");
  });

  it("commits on blur when value changed", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Akamai" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("Akamai");
    });
  });

  it("does not call onCommit when value did not change", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    // Brief wait — onCommit shouldn't fire even after the
    // microtask boundary.
    await new Promise((r) => setTimeout(r, 10));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not switch to edit mode when disabled", () => {
    const { getByRole, queryByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={async () => {}}
        disabled
      />,
    );
    // Disabled cells render a span, not a button — there's no
    // role=button to click. Just confirm no input ever appears.
    expect(() => getByRole("button")).toThrow();
    expect(queryByLabelText("Edit vendor")).toBeNull();
  });

  it("renders error state when onCommit rejects", async () => {
    const onCommit = vi.fn(async () => {
      throw new Error("Permission denied");
    });
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value="Linode"
        ariaLabel="Edit vendor"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Akamai" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => {
      // Error border applied — input remains visible with the
      // attempted value, not snapped back to "Linode".
      expect(input.value).toBe("Akamai");
      expect(input.className).toContain("border-error");
    });
  });
});

describe("EditableCell — select variant", () => {
  it("renders options and commits on change + blur", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="select"
        value="other"
        ariaLabel="Edit category"
        options={[
          { value: "other", label: "Other" },
          { value: "software", label: "Software" },
        ]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const select = getByLabelText("Edit category") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "software" } });
    fireEvent.blur(select);
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("software");
    });
  });
});

describe("EditableCell — number + date variants", () => {
  it("number input has type='number' with min/step", () => {
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="number"
        value="100"
        ariaLabel="Edit amount"
        onCommit={async () => {}}
        min={0}
        step={0.01}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit amount") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.min).toBe("0");
    expect(input.step).toBe("0.01");
  });

  it("date input has type='date'", () => {
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="date"
        value="2019-12-16"
        ariaLabel="Edit date"
        onCommit={async () => {}}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit date") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2019-12-16");
  });
});

describe("EditableCell — textarea variant", () => {
  it("plain Enter inserts newline and does NOT commit", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="textarea"
        value="hello"
        ariaLabel="Edit notes"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const textarea = getByLabelText("Edit notes") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Enter" });
    // Brief wait — onCommit must NOT fire on plain Enter.
    await new Promise((r) => setTimeout(r, 10));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Cmd+Enter / Ctrl+Enter commits", async () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="textarea"
        value="hello"
        ariaLabel="Edit notes"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const textarea = getByLabelText("Edit notes") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith("hello world");
    });
  });
});

describe("EditableCell — validation", () => {
  it("client-side validate failure prevents server call and shows the error", () => {
    const onCommit = vi.fn(async () => {});
    const { getByRole, getByLabelText } = render(
      <EditableCell
        variant="text"
        value=""
        ariaLabel="Edit vendor"
        validate={(v) => (v.trim() === "" ? "Required" : null)}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(getByRole("button"));
    const input = getByLabelText("Edit vendor") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain("border-error");
  });
});
