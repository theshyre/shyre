import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { ItemPrice } from "./ItemPrice";

describe("ItemPrice", () => {
  it("fixed_bid → a firm amount", () => {
    renderWithIntl(
      <ItemPrice pricingType="fixed_bid" fixedPrice={4000} currency="USD" />,
    );
    expect(screen.getByText("$4,000.00")).toBeInTheDocument();
  });

  it("estimate_nte → 'Up to' the cap", () => {
    renderWithIntl(
      <ItemPrice
        pricingType="estimate_nte"
        fixedPrice={10000}
        currency="USD"
      />,
    );
    expect(screen.getByText("Up to $10,000.00")).toBeInTheDocument();
  });

  it("estimate_range → low – high band", () => {
    renderWithIntl(
      <ItemPrice
        pricingType="estimate_range"
        fixedPrice={5000}
        estimateLow={3000}
        estimateHigh={5000}
        currency="USD"
      />,
    );
    expect(screen.getByText("$3,000.00 – $5,000.00")).toBeInTheDocument();
  });

  it("estimate_tm → rate per hour", () => {
    renderWithIntl(
      <ItemPrice
        pricingType="estimate_tm"
        fixedPrice={0}
        hourlyRate={200}
        currency="USD"
      />,
    );
    expect(screen.getByText("$200.00/hr")).toBeInTheDocument();
  });

  it("estimate_tm with no rate → em dash (never a bare $0)", () => {
    renderWithIntl(
      <ItemPrice pricingType="estimate_tm" fixedPrice={0} currency="USD" />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
