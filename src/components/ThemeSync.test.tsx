import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const applyMock = vi.fn();
let currentTheme: "system" | "light" | "dark" | "high-contrast" | "warm" =
  "system";

vi.mock("./theme-provider", () => ({
  useTheme: () => ({
    theme: currentTheme,
    applyExternalTheme: applyMock,
  }),
}));

import { ThemeSync } from "./ThemeSync";

beforeEach(() => {
  applyMock.mockReset();
  currentTheme = "system";
});

describe("ThemeSync (DB → provider one-way sync)", () => {
  it("applies the server-read preference when it differs from current", () => {
    render(<ThemeSync preferredTheme="dark" />);
    expect(applyMock).toHaveBeenCalledWith("dark");
  });

  it("does not apply when preferredTheme is null (user hasn't picked)", () => {
    render(<ThemeSync preferredTheme={null} />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("does not apply when preferredTheme matches the current provider state", () => {
    currentTheme = "dark";
    render(<ThemeSync preferredTheme="dark" />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("syncs only once per mount (ref-guard, no re-snap on parent re-renders)", () => {
    const { rerender } = render(<ThemeSync preferredTheme="dark" />);
    rerender(<ThemeSync preferredTheme="dark" />);
    rerender(<ThemeSync preferredTheme="light" />);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (no visible render)", () => {
    const { container } = render(<ThemeSync preferredTheme="dark" />);
    expect(container.firstChild).toBeNull();
  });
});
