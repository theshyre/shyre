import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const createMock = vi.fn(async (..._a: unknown[]) => ({ success: true as const }));
const updateMock = vi.fn(async (..._a: unknown[]) => ({ success: true as const }));
vi.mock("./actions", () => ({
  createSignoffAction: (...a: unknown[]) => createMock(...a),
  updateSignoffDraftAction: (...a: unknown[]) => updateMock(...a),
}));

import { SignoffForm } from "./signoff-form";

const TEAM = { id: "t1", name: "Malcom IO" };

beforeEach(() => {
  createMock.mockClear();
  updateMock.mockClear();
});

function payloadOf(mock: typeof createMock): Record<string, unknown> {
  const fd = mock.mock.calls[0]![0] as FormData;
  return JSON.parse(fd.get("payload") as string);
}

describe("SignoffForm", () => {
  it("hides the team picker with a single admin team and posts a structured payload", async () => {
    renderWithIntl(<SignoffForm teams={[TEAM]} customers={[]} />);
    expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Release Notes v2.0.2" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Bret Andre" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "bandre@fdapproval.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const p = payloadOf(createMock);
    expect(p.team_id).toBe("t1");
    expect(p.title).toBe("Release Notes v2.0.2");
    expect(p.document_type).toBe("release_notes");
    expect(p.signers).toEqual([
      { name: "Bret Andre", email: "bandre@fdapproval.com", roleLabel: null, orgLabel: null },
    ]);
  });

  it("adds and removes signer rows", () => {
    renderWithIntl(<SignoffForm teams={[TEAM]} customers={[]} />);
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Add signatory/ }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove$/ })[0]!);
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
  });

  it("in edit mode targets the update action and includes document_id", async () => {
    renderWithIntl(
      <SignoffForm
        teams={[TEAM]}
        customers={[]}
        initial={{
          documentId: "s9",
          teamId: "t1",
          customerId: null,
          title: "Existing",
          versionLabel: "v1",
          bodyMarkdown: "# Body",
          externalRef: "",
          signingMode: "all",
          signTheme: "light",
          signers: [{ name: "A", email: "a@x.com", roleLabel: "", orgLabel: "" }],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const fd = updateMock.mock.calls[0]![0] as FormData;
    expect(fd.get("document_id")).toBe("s9");
  });
});
