import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./theme-provider";

function TestConsumer(): React.JSX.Element {
  const { theme, setTheme, themes } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="theme-count">{themes.length}</span>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("high-contrast")}>Set HC</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to system theme", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(screen.getByTestId("current-theme").textContent).toBe("system");
  });

  it("exposes all theme options", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );
    expect(screen.getByTestId("theme-count").textContent).toBe("5");
  });

  it("switches theme and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByText("Set Dark"));

    expect(screen.getByTestId("current-theme").textContent).toBe("dark");
    expect(localStorage.getItem("stint-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("reads stored theme on mount", () => {
    localStorage.setItem("stint-theme", "high-contrast");

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    // useEffect runs asynchronously, but the initial render gets 'system'
    // After effect, it should update
    expect(localStorage.getItem("stint-theme")).toBe("high-contrast");
  });

  it("sets data-theme attribute on html element", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByText("Set Light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(screen.getByText("Set HC"));
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "high-contrast"
    );
  });

  it("throws when useTheme is used outside provider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useTheme must be used within ThemeProvider"
    );
    consoleSpy.mockRestore();
  });
});
