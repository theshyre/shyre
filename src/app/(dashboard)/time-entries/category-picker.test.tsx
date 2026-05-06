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

  it("appends the entry's current category as a (retired) option when its set is no longer linked to the project", () => {
    // Project's currently-linked set is s1 (Feature, Bug fix).
    // The entry's category c3 belongs to s2 — orphaned. The picker
    // should still surface c3 with a (retired) marker so editing
    // doesn't silently drop the original classification.
    renderWithIntl(
      <CategoryPicker
        categories={categories}
        categorySetIds={["s1"]}
        currentCategoryId="c3"
        defaultValue="c3"
      />,
    );
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option"));
    // Placeholder + Feature + Bug fix + Other-set (retired)
    expect(options).toHaveLength(4);
    expect(options[3]?.textContent).toBe("Other-set (retired)");
    expect(options[3]?.getAttribute("value")).toBe("c3");
  });

  it("does NOT mark the current category as (retired) when it's still in a linked set (no false alarm on a normal edit)", () => {
    renderWithIntl(
      <CategoryPicker
        categories={categories}
        categorySetIds={["s1"]}
        currentCategoryId="c1"
        defaultValue="c1"
      />,
    );
    const select = screen.getByRole("combobox");
    const optionTexts = Array.from(select.querySelectorAll("option")).map(
      (o) => o.textContent ?? "",
    );
    expect(optionTexts).not.toContain("Feature (retired)");
    expect(optionTexts).toContain("Feature");
  });

  it("renders the picker (with just the retired option) when the project has no active set but the entry has an orphaned category — preserves the user's chance to keep their original classification", () => {
    renderWithIntl(
      <CategoryPicker
        categories={categories}
        categorySetIds={[]}
        currentCategoryId="c3"
        defaultValue="c3"
      />,
    );
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option"));
    // Placeholder + the orphan
    expect(options).toHaveLength(2);
    expect(options[1]?.textContent).toBe("Other-set (retired)");
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
