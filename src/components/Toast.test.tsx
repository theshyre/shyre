import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { ToastProvider, useToast } from "./Toast";

function Trigger({
  pushArgs,
}: {
  pushArgs: Parameters<ReturnType<typeof useToast>["push"]>[0];
}): React.JSX.Element {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.push(pushArgs)}>
      fire
    </button>
  );
}

describe("Toast", () => {
  it("renders message after push()", async () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger pushArgs={{ message: "Hello toast", durationMs: 5000 }} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("fire"));
    expect(await screen.findByText("Hello toast")).toBeInTheDocument();
  });

  it("auto-dismisses after durationMs", async () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger pushArgs={{ message: "bye", durationMs: 80 }} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("fire"));
    expect(await screen.findByText("bye")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryByText("bye")).not.toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it("renders action button and invokes onAction, then dismisses", async () => {
    const onAction = vi.fn();
    renderWithIntl(
      <ToastProvider>
        <Trigger
          pushArgs={{
            message: "undo me",
            actionLabel: "Undo",
            onAction,
            durationMs: 5000,
          }}
        />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("fire"));
    await user.click(await screen.findByRole("button", { name: /undo/i }));
    expect(onAction).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText("undo me")).not.toBeInTheDocument();
    });
  });

  it("Escape dismisses the most recent toast", async () => {
    renderWithIntl(
      <ToastProvider>
        <Trigger pushArgs={{ message: "dismiss-me", durationMs: 5000 }} />
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("fire"));
    expect(await screen.findByText("dismiss-me")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByText("dismiss-me")).not.toBeInTheDocument();
    });
  });

  it("throws a useful error if useToast is used outside the provider", () => {
    function Bad(): React.JSX.Element {
      useToast();
      return <div />;
    }
    // Silence React's error-boundary noise for this intentional throw
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderWithIntl(<Bad />)).toThrow(/ToastProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
