import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { SignoffsTable, type SignoffRow } from "./signoffs-table";

const rows: SignoffRow[] = [
  {
    id: "s1",
    title: "Release Notes v2.0.2",
    versionLabel: "v2.0.2",
    status: "draft",
    customerName: "EyeReg Consulting, Inc.",
    signerCount: 3,
    createdAt: "2026-07-23T00:00:00Z",
  },
];

describe("SignoffsTable", () => {
  it("renders a row linking to the detail page, with status + signer count", () => {
    renderWithIntl(<SignoffsTable rows={rows} />);
    const link = screen.getByRole("link", { name: /Release Notes v2.0.2/ });
    expect(link).toHaveAttribute("href", "/signoffs/s1");
    expect(screen.getByText("EyeReg Consulting, Inc.")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("v2.0.2")).toBeInTheDocument();
  });

  it("shows the empty state when there are no sign-offs", () => {
    renderWithIntl(<SignoffsTable rows={[]} />);
    expect(screen.getByText(/No sign-offs yet/i)).toBeInTheDocument();
  });

  it("renders an em-dash when a row has no customer", () => {
    renderWithIntl(
      <SignoffsTable rows={[{ ...rows[0]!, customerName: null }]} />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
