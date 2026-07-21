import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { BusinessSwitcher } from "./business-switcher";

const CURRENT = { id: "biz-1", label: "Malcom IO LLC" };
const TWO = [
  { id: "biz-1", label: "Malcom IO LLC" },
  { id: "biz-2", label: "Second Co" },
];

describe("BusinessSwitcher", () => {
  it("renders a plain, non-interactive title when there is one business", () => {
    renderWithIntl(
      <BusinessSwitcher current={CURRENT} businesses={[CURRENT]} />,
    );
    expect(
      screen.getByRole("heading", { name: "Malcom IO LLC" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a collapsed switcher button when there are 2+ businesses", () => {
    renderWithIntl(<BusinessSwitcher current={CURRENT} businesses={TWO} />);
    const trigger = screen.getByRole("button", { name: "Switch business" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Panel links are not rendered until opened.
    expect(
      screen.queryByRole("link", { name: /Second Co/ }),
    ).not.toBeInTheDocument();
  });

  it("opens a nav of businesses with the current one marked", () => {
    renderWithIntl(<BusinessSwitcher current={CURRENT} businesses={TWO} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch business" }));

    expect(
      screen.getByRole("button", { name: "Switch business" }),
    ).toHaveAttribute("aria-expanded", "true");

    const currentLink = screen.getByRole("link", { name: /Malcom IO LLC/ });
    expect(currentLink).toHaveAttribute("href", "/business/biz-1");
    expect(currentLink).toHaveAttribute("aria-current", "true");

    const otherLink = screen.getByRole("link", { name: /Second Co/ });
    expect(otherLink).toHaveAttribute("href", "/business/biz-2");
    expect(otherLink).not.toHaveAttribute("aria-current");

    expect(
      screen.getByRole("link", { name: /All businesses/ }),
    ).toHaveAttribute("href", "/business");
  });

  it("closes on Escape", () => {
    renderWithIntl(<BusinessSwitcher current={CURRENT} businesses={TWO} />);
    const trigger = screen.getByRole("button", { name: "Switch business" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
