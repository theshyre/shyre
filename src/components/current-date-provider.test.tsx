import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

// Translations are exercised elsewhere; here we only need a stable, inspectable
// string so the announcement assertions don't depend on locale files.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals?.date ? `${key}|${String(vals.date)}` : key,
}));

import { CurrentDateProvider, useCurrentDate } from "./current-date-provider";

function Probe(): React.JSX.Element {
  const today = useCurrentDate();
  return <div data-testid="today">{today}</div>;
}

function ProbeWithInput(): React.JSX.Element {
  const today = useCurrentDate();
  return (
    <div>
      <div data-testid="today">{today}</div>
      <input data-testid="field" />
    </div>
  );
}

/** Render the provider pinned to UTC so date math is deterministic. */
function renderProvider(
  initialToday: string,
  ui: React.ReactElement = <Probe />,
): ReturnType<typeof render> {
  return render(
    <CurrentDateProvider initialToday={initialToday} timezone="UTC">
      {ui}
    </CurrentDateProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CurrentDateProvider / useCurrentDate", () => {
  it("seeds the context with the server-provided initial date", () => {
    vi.setSystemTime(new Date("2026-07-16T10:00:00Z"));
    renderProvider("2026-07-16");
    expect(screen.getByTestId("today").textContent).toBe("2026-07-16");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does NOT refresh on a tick within the same day", () => {
    vi.setSystemTime(new Date("2026-07-16T10:00:00Z"));
    renderProvider("2026-07-16");
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("today").textContent).toBe("2026-07-16");
  });

  it("advances the marker and refreshes exactly once on rollover", () => {
    vi.setSystemTime(new Date("2026-07-16T23:59:30Z"));
    renderProvider("2026-07-16");
    act(() => {
      // Clock crosses UTC midnight; the 60s poll fires past the boundary.
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("today").textContent).toBe("2026-07-17");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("announces the rollover in a polite live region", () => {
    vi.setSystemTime(new Date("2026-07-16T23:59:30Z"));
    renderProvider("2026-07-16");
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toContain("freshness.dayChanged");
  });

  it("catches up immediately on visibilitychange after a rollover", () => {
    vi.setSystemTime(new Date("2026-07-16T23:59:30Z"));
    renderProvider("2026-07-16");
    // Move the clock past midnight WITHOUT firing the interval.
    vi.setSystemTime(new Date("2026-07-17T00:05:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("today").textContent).toBe("2026-07-17");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh after unmount (interval + listeners cleaned up)", () => {
    vi.setSystemTime(new Date("2026-07-16T23:59:30Z"));
    const { unmount } = renderProvider("2026-07-16");
    unmount();
    act(() => {
      vi.advanceTimersByTime(120_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("moves the marker but DEFERS the refresh while an input is focused, then flushes on blur", () => {
    vi.setSystemTime(new Date("2026-07-16T23:59:30Z"));
    renderProvider("2026-07-16", <ProbeWithInput />);
    const field = screen.getByTestId("field") as HTMLInputElement;
    act(() => {
      field.focus();
    });
    expect(document.activeElement).toBe(field);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // Decoration moves immediately...
    expect(screen.getByTestId("today").textContent).toBe("2026-07-17");
    // ...but the server refresh is parked while the caret is in the field.
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      field.blur();
      document.dispatchEvent(new Event("focusout"));
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("tracks the browser offset when no IANA timezone is set", () => {
    // Default production path (no explicit timezone setting): "today" is
    // derived from the browser's live offset via getTimezoneOffset(). Seed a
    // clearly-stale date so the first poll detects a change regardless of the
    // test runner's zone, exercising the non-IANA branch deterministically.
    vi.setSystemTime(new Date("2026-07-16T10:00:00Z"));
    render(
      <CurrentDateProvider initialToday="1970-01-01" timezone={null}>
        <Probe />
      </CurrentDateProvider>,
    );
    expect(screen.getByTestId("today").textContent).toBe("1970-01-01");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("today").textContent).not.toBe("1970-01-01");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("throws when used without a provider", () => {
    // Suppress React's error boundary console noise for the expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/CurrentDateProvider/);
    spy.mockRestore();
  });
});
