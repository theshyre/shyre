import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

import { MapLineHelper } from "./map-line-helper";

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

describe("MapLineHelper", () => {
  it("renders the map line from the project's github_repo + id", () => {
    render(<MapLineHelper githubRepo="theshyre/shyre" projectId="abc-123" />);
    expect(
      screen.getByText('"theshyre/shyre": "abc-123"'),
    ).toBeInTheDocument();
  });

  it("falls back to a placeholder key + a hint when no github_repo is set", () => {
    render(<MapLineHelper githubRepo={null} projectId="abc-123" />);
    expect(
      screen.getByText('"your-org/your-repo": "abc-123"'),
    ).toBeInTheDocument();
    expect(screen.getByText(/owner\/repo key fills in/i)).toBeInTheDocument();
  });

  it("hides the hint when a repo IS set", () => {
    render(<MapLineHelper githubRepo="theshyre/shyre" projectId="abc-123" />);
    expect(
      screen.queryByText(/owner\/repo key fills in/i),
    ).not.toBeInTheDocument();
  });

  it("copies the exact map line to the clipboard", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MapLineHelper githubRepo="theshyre/shyre" projectId="abc-123" />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('"theshyre/shyre": "abc-123"');
  });
});
