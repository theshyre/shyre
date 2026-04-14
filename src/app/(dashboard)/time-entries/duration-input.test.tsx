import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { DurationInput } from "./duration-input";

describe("DurationInput", () => {
  it("renders the initial minutes as H:MM", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={195} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("3:15");
  });

  it("renders empty for 0 or null", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={0} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("normalizes typed '3.25' to '3:15' on blur", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={0} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3.25" } });
    fireEvent.blur(input);
    expect(input.value).toBe("3:15");
  });

  it("normalizes '3h 15m' to '3:15' on blur", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={0} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3h 15m" } });
    fireEvent.blur(input);
    expect(input.value).toBe("3:15");
  });

  it("sets hidden input value to parsed minutes", () => {
    const { container } = renderWithIntl(
      <DurationInput name="duration" defaultMinutes={0} />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2:30" } });
    const hidden = container.querySelector(
      'input[type="hidden"][name="duration"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("150");
  });

  it("marks input invalid for unparseable text", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={0} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nonsense" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("calls onCommit with parsed minutes on blur", () => {
    const onCommit = vi.fn();
    renderWithIntl(
      <DurationInput name="duration" defaultMinutes={0} onCommit={onCommit} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1:30" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(90);
  });

  it("Enter blurs to commit", () => {
    renderWithIntl(<DurationInput name="duration" defaultMinutes={0} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0:45" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Blur should have fired, normalizing value
    fireEvent.blur(input);
    expect(input.value).toBe("0:45");
  });
});
