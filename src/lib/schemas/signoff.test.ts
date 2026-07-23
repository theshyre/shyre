import { describe, it, expect } from "vitest";
import { signoffDraftSchema } from "./signoff";

const TEAM = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("signoffDraftSchema", () => {
  it("accepts a minimal draft (title/body lenient) and defaults", () => {
    const r = signoffDraftSchema.safeParse({ team_id: TEAM });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.document_type).toBe("release_notes");
      expect(r.data.signing_mode).toBe("all");
      expect(r.data.sign_theme).toBe("light");
      expect(r.data.title).toBe("");
      expect(r.data.signers).toEqual([]);
    }
  });

  it("accepts a full draft with signers", () => {
    const r = signoffDraftSchema.safeParse({
      team_id: TEAM,
      title: "Release Notes v2.0.2",
      version_label: "v2.0.2",
      body_markdown: "# Notes",
      signing_mode: "first",
      signers: [
        { name: "Bret Andre", email: "bandre@fdapproval.com", roleLabel: "Principal Consultant", orgLabel: "EyeReg" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a bad team id, a bad signer email, and an unknown signing mode", () => {
    expect(signoffDraftSchema.safeParse({ team_id: "nope" }).success).toBe(false);
    expect(
      signoffDraftSchema.safeParse({
        team_id: TEAM,
        signers: [{ name: "X", email: "not-an-email" }],
      }).success,
    ).toBe(false);
    expect(
      signoffDraftSchema.safeParse({ team_id: TEAM, signing_mode: "sometimes" }).success,
    ).toBe(false);
  });
});
