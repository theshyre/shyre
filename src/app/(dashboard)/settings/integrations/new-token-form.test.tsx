import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider } from "@/components/Toast";

const createMock = vi.fn();
vi.mock("./actions", () => ({
  createIntegrationTokenAction: (fd: FormData) => createMock(fd),
}));

import { NewTokenForm } from "./new-token-form";

const SCOPES = [
  "context:read",
  "timer:read",
  "timer:write",
  "entries:write",
];

function render(ui: ReactElement): RenderResult {
  return renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  createMock.mockReset();
});

function openForm(): void {
  fireEvent.click(screen.getByRole("button", { name: /New token/ }));
}

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText(/Token name/), {
    target: { value: "Claude Code" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create token/ }));
}

describe("NewTokenForm", () => {
  it("starts closed with a visible N kbd hint", () => {
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    const button = screen.getByRole("button", { name: /New token/ });
    expect(button).toBeInTheDocument();
    expect(button.querySelector("kbd")).toHaveTextContent("N");
  });

  it("opens on the N keyboard shortcut", () => {
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByLabelText(/Token name/)).toBeInTheDocument();
  });

  it("autofocuses the name field and defaults to 90 days + billable", () => {
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    const name = screen.getByLabelText(/Token name/);
    expect(name).toHaveFocus();
    expect(screen.getByLabelText(/Expires after/)).toHaveValue("90");
    expect(
      screen.getByRole("radio", { name: /^Billable/ }),
    ).toBeChecked();
    // Scopes are displayed read-only.
    for (const scope of SCOPES) {
      expect(screen.getByText(scope)).toBeInTheDocument();
    }
  });

  it("closes on Escape without submitting", () => {
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText(/Token name/)).not.toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("first Escape only blurs a focused name field with typed text (no silent discard)", () => {
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    const name = screen.getByLabelText(/Token name/);
    fireEvent.change(name, { target: { value: "half-typed na" } });
    name.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    // Form stays open, typed text intact, field blurred.
    expect(screen.getByLabelText(/Token name/)).toHaveValue("half-typed na");
    expect(name).not.toHaveFocus();
    // Second Escape (field no longer focused) closes.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText(/Token name/)).not.toBeInTheDocument();
  });

  it("Escape never dismisses the show-once token box", async () => {
    createMock.mockResolvedValue({
      success: true,
      rawToken: "shyre_pat_raw-token-value",
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByText("shyre_pat_raw-token-value"),
      ).toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    // Still visible — only the explicit Done click drops the raw token.
    expect(
      screen.getByText("shyre_pat_raw-token-value"),
    ).toBeInTheDocument();
    // And the N shortcut is suppressed while the box is showing.
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.queryByLabelText(/Token name/)).not.toBeInTheDocument();
  });

  it("submits and shows the raw token exactly once with the show-once warning", async () => {
    createMock.mockResolvedValue({
      success: true,
      rawToken: "shyre_pat_raw-token-value",
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();

    await waitFor(() =>
      expect(
        screen.getByText("shyre_pat_raw-token-value"),
      ).toBeInTheDocument(),
    );
    const fd = createMock.mock.calls[0]![0] as FormData;
    expect(fd.get("team_id")).toBe("t-1");
    expect(fd.get("name")).toBe("Claude Code");
    expect(fd.get("ttl_days")).toBe("90");
    expect(fd.get("default_billable")).toBe("true");
    expect(
      screen.getByText(/You will not see this token again/),
    ).toBeInTheDocument();

    // Dismissing drops the raw token permanently.
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(
      screen.queryByText("shyre_pat_raw-token-value"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New token/ }),
    ).toBeInTheDocument();
  });

  it("copies the raw token to the clipboard", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    createMock.mockResolvedValue({
      success: true,
      rawToken: "shyre_pat_raw-token-value",
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Copy token/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy token/ }));
    expect(writeText).toHaveBeenCalledWith("shyre_pat_raw-token-value");
  });

  it("renders the friendly disabled error inline when RLS rejects", async () => {
    createMock.mockResolvedValue({
      success: false,
      error: { userMessageKey: "integrations.errors.disabled" },
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByText(/Integrations are disabled for this team/),
      ).toBeInTheDocument(),
    );
    // Form stays open for retry.
    expect(screen.getByLabelText(/Token name/)).toBeInTheDocument();
  });

  it("moves focus to the show-once heading, then back to the trigger on Done", async () => {
    createMock.mockResolvedValue({
      success: true,
      rawToken: "shyre_pat_raw-token-value",
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Copy your token now/ }),
      ).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(
      screen.getByRole("button", { name: /New token/ }),
    ).toHaveFocus();
  });

  it("renders field errors from the server under the name field", async () => {
    createMock.mockResolvedValue({
      success: false,
      error: {
        userMessageKey: "errors.validation",
        fieldErrors: { name: "integrations.create.nameRequired" },
      },
    });
    render(<NewTokenForm teamId="t-1" scopes={SCOPES} />);
    openForm();
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByText(/Give the token a name/),
      ).toBeInTheDocument(),
    );
  });
});
