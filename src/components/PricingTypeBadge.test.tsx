import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { PricingTypeBadge } from "./PricingTypeBadge";

describe("PricingTypeBadge", () => {
  it("labels each pricing type with its word (color is never the only channel)", () => {
    renderWithIntl(<PricingTypeBadge type="fixed_bid" />);
    expect(screen.getByText("Fixed price")).toBeInTheDocument();
  });

  it("renders the not-to-exceed label", () => {
    renderWithIntl(<PricingTypeBadge type="estimate_nte" />);
    expect(screen.getByText("Not to exceed")).toBeInTheDocument();
  });

  it("renders the range label", () => {
    renderWithIntl(<PricingTypeBadge type="estimate_range" />);
    expect(screen.getByText("Estimate (range)")).toBeInTheDocument();
  });

  it("renders the time & materials label", () => {
    renderWithIntl(<PricingTypeBadge type="estimate_tm" />);
    expect(screen.getByText("Time & materials")).toBeInTheDocument();
  });
});
