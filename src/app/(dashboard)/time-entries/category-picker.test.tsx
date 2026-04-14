import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { CategoryPicker, CategoryBadge } from "./category-picker";
import type { CategoryOption } from "./types";

const categories: CategoryOption[] = [
  { id: "c1", category_set_id: "s1", name: "Feature", color: "#3b82f6", sort_order: 10 },
  { id: "c2", category_set_id: "s1", name: "Bug fix", color: "#ef4444", sort_order: 20 },
  { id: "c3", category_set_id: "s2", name: "Other-set", color: "#10b981", sort_order: 10 },
];

describe("CategoryPicker", () => {
  it("renders nothing when project has no set (hideWhenEmpty)", () => {
    const { container } = renderWithIntl(
      <CategoryPicker categories={categories} categorySetId={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 'not configured' notice when hideWhenEmpty=false", () => {
    renderWithIntl(
      <CategoryPicker
        categories={categories}
        categorySetId={null}
        hideWhenEmpty={false}
      />,
    );
    expect(screen.getByText(/no category set/i)).toBeInTheDocument();
  });

  it("filters categories to the project's set", () => {
    renderWithIntl(
      <CategoryPicker categories={categories} categorySetId="s1" />,
    );
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option"));
    // Placeholder + Feature + Bug fix (Other-set excluded)
    expect(options).toHaveLength(3);
    expect(options[1]?.textContent).toBe("Feature");
    expect(options[2]?.textContent).toBe("Bug fix");
  });

  it("fires onChange when a category is selected", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <CategoryPicker
        categories={categories}
        categorySetId="s1"
        value=""
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "c2" } });
    expect(onChange).toHaveBeenCalledWith("c2");
  });

  it("renders nothing when set has no categories (hideWhenEmpty=true)", () => {
    const { container } = renderWithIntl(
      <CategoryPicker
        categories={[]}
        categorySetId="set-with-nothing"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("CategoryBadge", () => {
  it("renders color dot and name", () => {
    const { container } = renderWithIntl(
      <CategoryBadge category={categories[0]!} />,
    );
    expect(screen.getByText("Feature")).toBeInTheDocument();
    const dot = container.querySelector("span > span") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(59, 130, 246)");
  });
});
