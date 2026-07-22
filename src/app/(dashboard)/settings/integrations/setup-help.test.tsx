import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

import { SetupHelp } from "./setup-help";

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

describe("SetupHelp", () => {
  it("links to the quick-start guide and the hooks kit (the real onboarding flow)", () => {
    render(<SetupHelp />);
    const quick = screen.getByRole("link", { name: /Quick guide/ });
    expect(quick).toHaveAttribute(
      "href",
      "/docs/guides/features/integrations-quickstart",
    );
    const hooks = screen.getByRole("link", { name: /hooks kit/i });
    expect(hooks).toHaveAttribute(
      "href",
      "/docs/guides/features/claude-code-hooks-kit",
    );
  });

  it("shows the claude mcp add one-liner with a placeholder bearer token", () => {
    render(<SetupHelp />);
    const command = screen.getByText(/claude mcp add shyre/);
    expect(command.textContent).toContain("--transport http");
    expect(command.textContent).toContain(
      'Authorization: Bearer shyre_pat_...',
    );
    // jsdom origin (http://localhost:3000 by default) lands after mount.
    expect(command.textContent).toContain("/api/mcp");
  });

  it("copies the command to the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SetupHelp />);
    fireEvent.click(screen.getByRole("button", { name: /Copy command/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("claude mcp add shyre");
  });
});
