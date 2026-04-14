import { describe, it, expect, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { useFormAction } from "./use-form-action";
import type { SerializedAppError } from "@/lib/errors";

/**
 * Tiny host component that drives the hook and exposes its state in the DOM
 * so tests can assert on what users would actually see.
 */
function Host({
  action,
  onReady,
}: {
  action: (fd: FormData) => Promise<{ success: true } | { success: false; error: SerializedAppError } | void>;
  onReady: (submit: () => Promise<void>) => void;
}): React.JSX.Element {
  const { pending, success, serverError, handleSubmit } = useFormAction({ action });
  return (
    <div>
      <span data-testid="pending">{String(pending)}</span>
      <span data-testid="success">{String(success)}</span>
      <span data-testid="server-error">{serverError ?? ""}</span>
      <button
        type="button"
        onClick={() => onReady(() => handleSubmit(new FormData()))}
      >
        bind
      </button>
    </div>
  );
}

describe("useFormAction — server error translation", () => {
  it("translates a known i18n key to the user-facing message", async () => {
    const action = vi.fn(async () => ({
      success: false as const,
      error: {
        code: "AUTH_FORBIDDEN",
        userMessageKey: "errors.authForbidden",
      } as SerializedAppError,
    }));
    let submit = async (): Promise<void> => {};
    const { getByRole, getByTestId } = renderWithIntl(
      <Host action={action} onReady={(s) => (submit = s)} />,
    );
    act(() => {
      getByRole("button").click();
    });
    await act(async () => {
      await submit();
    });
    await waitFor(() => {
      // Must be the translated user-facing copy, NOT the key itself.
      expect(getByTestId("server-error").textContent).toBe(
        "You don't have permission to perform this action.",
      );
    });
  });

  it("falls back to the raw string if no translation exists", async () => {
    const action = vi.fn(async () => ({
      success: false as const,
      error: {
        code: "UNKNOWN",
        userMessageKey: "errors.definitelyNotAKey",
      } as SerializedAppError,
    }));
    let submit = async (): Promise<void> => {};
    const { getByRole, getByTestId } = renderWithIntl(
      <Host action={action} onReady={(s) => (submit = s)} />,
    );
    act(() => {
      getByRole("button").click();
    });
    await act(async () => {
      await submit();
    });
    await waitFor(() => {
      expect(getByTestId("server-error").textContent).toBe(
        "errors.definitelyNotAKey",
      );
    });
  });

  it("uses Error.message verbatim for legacy thrown actions", async () => {
    const action = vi.fn(async () => {
      throw new Error("Something broke");
    });
    let submit = async (): Promise<void> => {};
    const { getByRole, getByTestId } = renderWithIntl(
      <Host action={action} onReady={(s) => (submit = s)} />,
    );
    act(() => {
      getByRole("button").click();
    });
    await act(async () => {
      await submit();
    });
    await waitFor(() => {
      expect(getByTestId("server-error").textContent).toBe("Something broke");
    });
  });

  it("clears serverError on a successful submission", async () => {
    const action = vi.fn(async () => ({ success: true as const }));
    let submit = async (): Promise<void> => {};
    const { getByRole, getByTestId } = renderWithIntl(
      <Host action={action} onReady={(s) => (submit = s)} />,
    );
    act(() => {
      getByRole("button").click();
    });
    await act(async () => {
      await submit();
    });
    await waitFor(() => {
      expect(getByTestId("success").textContent).toBe("true");
      expect(getByTestId("server-error").textContent).toBe("");
    });
  });
});
