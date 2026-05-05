import { describe, it, expect } from "vitest";
import { rewriteTotpUri } from "./totp-uri";

const SUPABASE_URI =
  "otpauth://totp/SupabaseProject:user-uuid?secret=ABCDEF234&issuer=SupabaseProject&period=30&digits=6&algorithm=SHA1";

describe("rewriteTotpUri", () => {
  it("replaces issuer + email in both label and ?issuer= param", () => {
    const out = rewriteTotpUri(SUPABASE_URI, {
      email: "marcus@example.com",
      issuer: "malcom.io",
    });
    expect(out).toBe(
      "otpauth://totp/malcom.io:marcus%40example.com?secret=ABCDEF234&issuer=malcom.io&period=30&digits=6&algorithm=SHA1",
    );
  });

  it("preserves the original secret verbatim", () => {
    const out = rewriteTotpUri(SUPABASE_URI, {
      email: "u@example.com",
      issuer: "malcom.io",
    });
    expect(new URL(out).searchParams.get("secret")).toBe("ABCDEF234");
  });

  it("preserves the original period / digits / algorithm", () => {
    const original =
      "otpauth://totp/X:y?secret=AAA&issuer=X&period=60&digits=8&algorithm=SHA256";
    const out = rewriteTotpUri(original, {
      email: "u@example.com",
      issuer: "malcom.io",
    });
    const params = new URL(out).searchParams;
    expect(params.get("period")).toBe("60");
    expect(params.get("digits")).toBe("8");
    expect(params.get("algorithm")).toBe("SHA256");
  });

  it("URL-encodes a special-character issuer", () => {
    const out = rewriteTotpUri(SUPABASE_URI, {
      email: "u@example.com",
      issuer: "Acme Co.",
    });
    expect(out).toContain("/Acme%20Co.:");
    expect(out).toContain("issuer=Acme%20Co.");
  });

  it("URL-encodes emails with + (plus addressing)", () => {
    const out = rewriteTotpUri(SUPABASE_URI, {
      email: "marcus+work@example.com",
      issuer: "malcom.io",
    });
    expect(out).toContain("marcus%2Bwork%40example.com");
  });

  it("falls back to safe defaults when crypto params are missing", () => {
    const partial = "otpauth://totp/X:y?secret=Z&issuer=X";
    const out = rewriteTotpUri(partial, {
      email: "u@example.com",
      issuer: "malcom.io",
    });
    const params = new URL(out).searchParams;
    expect(params.get("secret")).toBe("Z");
    expect(params.get("period")).toBe("30");
    expect(params.get("digits")).toBe("6");
    expect(params.get("algorithm")).toBe("SHA1");
  });

  it("emits an empty secret when the input has none (no exception thrown)", () => {
    const noSecret = "otpauth://totp/X:y?issuer=X";
    const out = rewriteTotpUri(noSecret, {
      email: "u@example.com",
      issuer: "malcom.io",
    });
    expect(new URL(out).searchParams.get("secret")).toBe("");
  });

  it("rewrites a URI whose original label was just an account (no issuer prefix)", () => {
    const original =
      "otpauth://totp/just-account?secret=AAA&issuer=ProjectX&period=30&digits=6&algorithm=SHA1";
    const out = rewriteTotpUri(original, {
      email: "u@example.com",
      issuer: "malcom.io",
    });
    expect(out.startsWith("otpauth://totp/malcom.io:u%40example.com?")).toBe(true);
  });
});
