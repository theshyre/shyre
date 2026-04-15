import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { SaveStatus } from "./SaveStatus";

describe("SaveStatus", () => {
  it("renders nothing when idle and idleVisible=false", () => {
    const { container } = renderWithIntl(
      <SaveStatus status="idle" lastSavedAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'Saving…' during saving", () => {
    renderWithIntl(<SaveStatus status="saving" lastSavedAt={null} />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });

  it("renders 'Saved just now' immediately after saved", () => {
    renderWithIntl(<SaveStatus status="saved" lastSavedAt={Date.now()} />);
    expect(screen.getByText(/saved just now/i)).toBeInTheDocument();
  });

  it("renders 'Saved Nm ago' for older timestamps", () => {
    const twoMinAgo = Date.now() - 2 * 60 * 1000;
    renderWithIntl(<SaveStatus status="saved" lastSavedAt={twoMinAgo} />);
    expect(screen.getByText(/saved 2m ago/i)).toBeInTheDocument();
  });

  it("renders error state with retry button when onRetry provided", async () => {
    const onRetry = vi.fn();
    renderWithIntl(
      <SaveStatus
        status="error"
        lastSavedAt={null}
        lastError="Network down"
        onRetry={onRetry}
      />,
    );
    const btn = screen.getByRole("button", { name: /save failed — retry/i });
    expect(btn).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("error without onRetry is not clickable", () => {
    renderWithIntl(
      <SaveStatus status="error" lastSavedAt={null} lastError="x" />,
    );
    const btn = screen.getByRole("button", { name: /save failed/i });
    expect(btn).toBeDisabled();
  });
});
