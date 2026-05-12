import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddressFields } from "./AddressFields";
import type { Address } from "@/lib/schemas/address";

function blank(): Address {
  return {
    street: "",
    street2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  };
}

describe("AddressFields", () => {
  it("renders all six field inputs with the prefix applied to each name", () => {
    const { container } = render(
      <AddressFields prefix="business_address" value={blank()} />,
    );
    expect(
      container.querySelector("input[name='business_address.street']"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[name='business_address.street2']"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[name='business_address.city']"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[name='business_address.state']"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[name='business_address.postalCode']"),
    ).not.toBeNull();
    expect(
      container.querySelector("select[name='business_address.country']"),
    ).not.toBeNull();
  });

  it("renders the legend + MapPin icon when label is provided", () => {
    const { container } = render(
      <AddressFields prefix="a" value={blank()} label="Business address" />,
    );
    expect(screen.getByText("Business address")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("omits the legend entirely when label is undefined", () => {
    const { container } = render(
      <AddressFields prefix="a" value={blank()} />,
    );
    expect(container.querySelector("legend")).toBeNull();
  });

  it("populates defaultValue from the value prop", () => {
    const { container } = render(
      <AddressFields
        prefix="a"
        value={{
          street: "1 Main St",
          street2: "Apt 5",
          city: "Springfield",
          state: "IL",
          postalCode: "62701",
          country: "US",
        }}
      />,
    );
    expect(
      (container.querySelector("input[name='a.street']") as HTMLInputElement)
        .value,
    ).toBe("1 Main St");
    expect(
      (container.querySelector("input[name='a.city']") as HTMLInputElement)
        .value,
    ).toBe("Springfield");
    expect(
      (container.querySelector("select[name='a.country']") as HTMLSelectElement)
        .value,
    ).toBe("US");
  });

  it("disables every field when disabled=true", () => {
    const { container } = render(
      <AddressFields prefix="a" value={blank()} disabled />,
    );
    const inputs = container.querySelectorAll("input, select");
    expect(inputs.length).toBeGreaterThan(0);
    for (const el of inputs) {
      expect((el as HTMLInputElement).disabled).toBe(true);
    }
  });

  it("renders FieldError under fields that have errors keyed by full path", () => {
    render(
      <AddressFields
        prefix="business_address"
        value={blank()}
        errors={{
          "business_address.street": "Street is required",
          "business_address.city": "City is required",
        }}
      />,
    );
    expect(screen.getByText("Street is required")).toBeInTheDocument();
    expect(screen.getByText("City is required")).toBeInTheDocument();
  });

  it("does not show FieldError for fields without errors", () => {
    render(
      <AddressFields
        prefix="a"
        value={blank()}
        errors={{ "a.state": "State is required" }}
      />,
    );
    expect(screen.getByText("State is required")).toBeInTheDocument();
    expect(screen.queryByText(/Street is required/)).toBeNull();
  });

  it("renders the country select with a blank '' first option + a sizeable list of countries", () => {
    const { container } = render(
      <AddressFields prefix="a" value={blank()} />,
    );
    const options = container.querySelectorAll("select option");
    // First option is the blank "Country" placeholder.
    expect(options[0]?.getAttribute("value")).toBe("");
    // Multiple countries are present (exact count varies; assert >= 20
    // as a loose lower bound that survives future list updates).
    expect(options.length).toBeGreaterThanOrEqual(20);
  });
});
