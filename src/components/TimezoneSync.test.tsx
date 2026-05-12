import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/time/tz", () => ({
  TZ_COOKIE_NAME: "shyre-tz-offset",
}));

import { TimezoneSync } from "./TimezoneSync";

function clearCookie(name: string): void {
  // Set with epoch expiry to delete.
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

beforeEach(() => {
  clearCookie("shyre-tz-offset");
  refreshMock.mockReset();
});

describe("TimezoneSync", () => {
  it("writes the browser's getTimezoneOffset() into the cookie on mount", () => {
    const offset = new Date().getTimezoneOffset();
    render(<TimezoneSync />);
    const match = document.cookie.match(/shyre-tz-offset=([^;]+)/);
    expect(match?.[1]).toBe(String(offset));
  });

  it("calls router.refresh() when the cookie value changed", () => {
    render(<TimezoneSync />);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh when the cookie already matches the current offset", () => {
    const offset = new Date().getTimezoneOffset();
    document.cookie = `shyre-tz-offset=${offset}; path=/`;
    render(<TimezoneSync />);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("returns null (renders nothing visible)", () => {
    const { container } = render(<TimezoneSync />);
    expect(container.firstChild).toBeNull();
  });
});
