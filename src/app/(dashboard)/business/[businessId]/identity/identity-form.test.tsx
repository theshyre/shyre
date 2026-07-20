import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

/**
 * Audit batch D: identity-form.tsx gained the unsaved-changes guard
 * (CLAUDE.md "Unsaved changes guard" rule). The form's DateField
 * (date_incorporated) is controlled and doesn't bubble a native
 * change event through the form's onChange the way the uncontrolled
 * text inputs do — this file specifically covers both paths so a
 * regression on the DateField's explicit setFormDirty(true) call
 * doesn't silently stop arming the guard.
 */

const updateMock = vi.fn();
vi.mock("../../actions", () => ({
  updateBusinessIdentityAction: (fd: FormData) => updateMock(fd),
}));

import { IdentityForm } from "./identity-form";

const baseProps = {
  businessId: "b-1",
  legalName: "Acme LLC",
  entityType: "llc",
  taxId: "",
  dateIncorporated: "",
  fiscalYearStart: "",
  dunsNumber: "",
  canEditPrivate: true,
};

describe("IdentityForm — unsaved-changes guard", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    updateMock.mockReset();
    addSpy = vi.spyOn(window, "addEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
  });

  it("does not arm the guard on initial render", () => {
    renderWithIntl(<IdentityForm {...baseProps} />);
    expect(addSpy).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
  });

  it("arms the guard when an uncontrolled text field changes", () => {
    renderWithIntl(<IdentityForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/Legal name/i), {
      target: { value: "Acme Consulting LLC" },
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("arms the guard when the controlled DateField (date_incorporated) changes", () => {
    renderWithIntl(<IdentityForm {...baseProps} />);
    const dateInput = screen.getByLabelText(/Date of incorporation/i);
    fireEvent.change(dateInput, { target: { value: "01/15/2020" } });
    fireEvent.blur(dateInput);
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("disarms the guard after a successful save", async () => {
    updateMock.mockResolvedValue({ success: true });
    const removeSpy = vi.spyOn(window, "removeEventListener");
    renderWithIntl(<IdentityForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/Legal name/i), {
      target: { value: "Acme Consulting LLC" },
    });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      ),
    );
    removeSpy.mockRestore();
  });
});
