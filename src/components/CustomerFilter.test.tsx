import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const pushMock = vi.fn();
let currentSearchParams = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/time-entries",
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

import { CustomerFilter } from "./CustomerFilter";

const customers = [
  { id: "c-acme", name: "Acme Co" },
  { id: "c-eyereg", name: "EyeReg Consulting" },
  { id: "c-pierce", name: "Pierce Clark & Assoc" },
];

describe("CustomerFilter", () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearchParams = "";
  });

  it("renders nothing when no customers are provided (degenerate state)", () => {
    const { container } = renderWithIntl(
      <CustomerFilter customers={[]} selectedId={null} />,
    );
    // Component returns null — no chip rendered.
    expect(container.firstChild).toBeNull();
  });

  it("shows the 'All customers' label when nothing is selected", () => {
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId={null} />,
    );
    expect(
      screen.getByRole("button", { name: /all customers/i }),
    ).toBeInTheDocument();
  });

  it("shows the selected customer's name as the chip label", () => {
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId="c-eyereg" />,
    );
    expect(screen.getByRole("button")).toHaveTextContent(/EyeReg Consulting/);
  });

  it("clicking a customer in the listbox writes ?customer=<id>", () => {
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId={null} />,
    );
    // Open the dropdown.
    fireEvent.click(screen.getByRole("button"));
    // Pick EyeReg.
    fireEvent.click(
      screen.getByRole("option", { name: /eyereg/i }),
    );
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/customer=c-eyereg/);
  });

  it("clicking 'All customers' clears the ?customer param", () => {
    currentSearchParams = "customer=c-eyereg";
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId="c-eyereg" />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(
      screen.getByRole("option", { name: /all customers/i }),
    );
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).not.toMatch(/customer=/);
  });

  it("preserves unrelated URL params when picking", () => {
    currentSearchParams = "org=t-1&view=table&billable=1";
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId={null} />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(
      screen.getByRole("option", { name: /acme/i }),
    );
    const call = pushMock.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/org=t-1/);
    expect(call).toMatch(/view=table/);
    expect(call).toMatch(/billable=1/);
    expect(call).toMatch(/customer=c-acme/);
  });

  it("marks the active option with aria-selected=true", () => {
    renderWithIntl(
      <CustomerFilter customers={customers} selectedId="c-pierce" />,
    );
    fireEvent.click(screen.getByRole("button"));
    const pierce = screen.getByRole("option", { name: /pierce/i });
    expect(pierce).toHaveAttribute("aria-selected", "true");
    const acme = screen.getByRole("option", { name: /acme/i });
    expect(acme).toHaveAttribute("aria-selected", "false");
  });
});
