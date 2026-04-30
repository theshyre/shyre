import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { LocalDateTime } from "./LocalDateTime";

describe("LocalDateTime", () => {
  it("emits a <time> element with the ISO value as dateTime", () => {
    const { container } = render(
      <LocalDateTime value="2026-04-24T16:26:00Z" />,
    );
    const el = container.querySelector("time");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("dateTime")).toBe("2026-04-24T16:26:00Z");
  });

  it("formats the value after the effect runs (browser-local TZ)", async () => {
    // Server-side this would show the placeholder em-dash. After the
    // useEffect hook fires, the formatted local-TZ string takes its
    // place. Exact wall-clock depends on the test machine's TZ; we
    // just check the year is present, which any reasonable
    // toLocaleString format will include.
    const { container } = render(
      <LocalDateTime value="2026-04-24T16:26:00Z" />,
    );
    await waitFor(() => {
      const text = container.querySelector("time")?.textContent ?? "";
      expect(text).not.toBe("—");
      expect(text).toMatch(/2026/);
    });
  });
});
