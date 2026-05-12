import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AVATAR_PRESETS } from "@theshyre/ui";
import { CustomerChip, customerInitials } from "./CustomerChip";

describe("customerInitials", () => {
  it("uses the first letter of the first two words", () => {
    expect(customerInitials("EyeReg Consulting, Inc.")).toBe("EC");
    expect(customerInitials("Pierce Clark & Associates")).toBe("PC");
    expect(customerInitials("Atlas Corp")).toBe("AC");
  });

  it("falls back to the first two letters on a single-word name", () => {
    expect(customerInitials("Acme")).toBe("AC");
    expect(customerInitials("Shyre")).toBe("SH");
  });

  it("strips surrounding punctuation from tokens", () => {
    expect(customerInitials("(Inc.) Corp.")).toBe("IC");
    expect(customerInitials("'foo' 'bar'")).toBe("FB");
  });

  it("returns ? for empty / null / whitespace input", () => {
    expect(customerInitials(null)).toBe("?");
    expect(customerInitials(undefined)).toBe("?");
    expect(customerInitials("")).toBe("?");
    expect(customerInitials("   ")).toBe("?");
  });

  it("handles Unicode names (non-ASCII letters)", () => {
    expect(customerInitials("Ångström Labs")).toBe("ÅL");
    expect(customerInitials("Université Paris")).toBe("UP");
  });

  it("uppercases the result", () => {
    expect(customerInitials("acme labs")).toBe("AL");
  });
});

describe("CustomerChip", () => {
  it("is aria-hidden — adjacent text is the accessible name", () => {
    const { container } = render(
      <CustomerChip customerId="cust-1" customerName="Acme Corp" />,
    );
    const chip = container.querySelector("span[aria-hidden='true']");
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe("AC");
  });

  it("hashes the customer id deterministically — same id renders the same background", () => {
    const { container: c1 } = render(
      <CustomerChip customerId="cust-stable" customerName="Acme" />,
    );
    const { container: c2 } = render(
      <CustomerChip customerId="cust-stable" customerName="Different name same id" />,
    );
    const bg1 = (c1.querySelector("span") as HTMLElement).style.backgroundColor;
    const bg2 = (c2.querySelector("span") as HTMLElement).style.backgroundColor;
    expect(bg1).toBe(bg2);
    expect(bg1).not.toBe("");
  });

  it("uses a color from the shared AVATAR_PRESETS palette (not free-form HSL)", () => {
    const { container } = render(
      <CustomerChip customerId="cust-1" customerName="Acme" />,
    );
    const bg = (
      container.querySelector("span") as HTMLElement
    ).style.backgroundColor;
    // jsdom returns rgb(...) for hex inputs; normalize by checking the
    // palette's hex against an rgb conversion. Walk the presets and
    // confirm at least one matches.
    const matches: readonly string[] = AVATAR_PRESETS.map((p) => p.bg);
    // Bg may be either the hex (in rare DOMs) or rgb(); accept either.
    const ok =
      matches.includes(bg) ||
      matches.some((hex) => hexToRgbString(hex) === bg);
    expect(ok).toBe(true);
  });

  it("renders ? when both id and name are missing — chip still appears", () => {
    const { container } = render(
      <CustomerChip customerId={null} customerName={null} />,
    );
    const chip = container.querySelector("span[aria-hidden='true']");
    expect(chip?.textContent).toBe("?");
  });

  it("two distinct ids can map to the same slot (collision allowed); shape stays consistent", () => {
    // Smoke check: this isn't a guarantee about specific ids, just
    // that the chip renders consistently regardless of palette slot.
    const { container: a } = render(
      <CustomerChip customerId="cust-a" customerName="Atlas Corp" />,
    );
    const { container: b } = render(
      <CustomerChip customerId="cust-b" customerName="Acme Co" />,
    );
    // Both render initials "AC" (collision is expected with this naming).
    expect(a.querySelector("span[aria-hidden='true']")?.textContent).toBe("AC");
    expect(b.querySelector("span[aria-hidden='true']")?.textContent).toBe("AC");
    // Color is the disambiguator. We don't assert they DIFFER (FNV-1a
    // could map both to the same slot for some inputs) — only that the
    // chips render the same shape so the consuming row treats them
    // uniformly.
    const aCls = (a.querySelector("span") as HTMLElement).className;
    const bCls = (b.querySelector("span") as HTMLElement).className;
    expect(aCls).toBe(bCls);
  });
});

/** Convert "#3b82f6" to "rgb(59, 130, 246)" for jsdom comparisons. */
function hexToRgbString(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [, r, g, b] = m;
  return `rgb(${parseInt(r!, 16)}, ${parseInt(g!, 16)}, ${parseInt(b!, 16)})`;
}
