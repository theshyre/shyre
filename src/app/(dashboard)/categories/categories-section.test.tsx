import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  createCategorySetAction: vi.fn(),
  cloneCategorySetAction: vi.fn(),
  deleteCategorySetAction: vi.fn(),
  updateCategorySetAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
}));

import { CategoriesSection } from "./categories-section";
import type { CategorySetWithCategories } from "@/lib/categories/types";

const teams = [
  { id: "o1", name: "Org One", slug: "org-one", role: "owner" as const },
];

function makeSet(
  id: string,
  name: string,
  isSystem: boolean,
  teamId: string | null,
): CategorySetWithCategories {
  return {
    id,
    team_id: teamId,
    name,
    description: null,
    is_system: isSystem,
    created_by: null,
    created_at: new Date().toISOString(),
    categories: [
      {
        id: `${id}-c1`,
        category_set_id: id,
        name: "Cat A",
        color: "#3b82f6",
        sort_order: 10,
        created_at: new Date().toISOString(),
      },
    ],
  };
}

describe("CategoriesSection", () => {
  it("separates system sets from org sets", () => {
    const sets = [
      makeSet("s1", "Engineering", true, null),
      makeSet("s2", "My Custom", false, "o1"),
    ];
    renderWithIntl(<CategoriesSection teams={teams} sets={sets} />);
    expect(screen.getByText(/built-in sets/i)).toBeInTheDocument();
    expect(screen.getByText(/your sets/i)).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("My Custom")).toBeInTheDocument();
  });

  it("shows 'new set' button when no set is being created", () => {
    renderWithIntl(<CategoriesSection teams={teams} sets={[]} />);
    expect(screen.getByRole("button", { name: /new set/i })).toBeInTheDocument();
  });

  it("shows empty-state hint when there are no org sets", () => {
    const sets = [makeSet("s1", "Engineering", true, null)];
    renderWithIntl(<CategoriesSection teams={teams} sets={sets} />);
    expect(screen.getByText(/no custom category sets/i)).toBeInTheDocument();
  });

  it("shows clone controls on a system set row", () => {
    const sets = [makeSet("s1", "Engineering", true, null)];
    renderWithIntl(<CategoriesSection teams={teams} sets={sets} />);
    // The clone button appears on each system set
    const cloneButtons = screen.getAllByRole("button", { name: /clone/i });
    expect(cloneButtons.length).toBeGreaterThan(0);
  });

  it("renders category dots for each category", () => {
    const sets = [makeSet("s1", "Engineering", true, null)];
    const { container } = renderWithIntl(
      <CategoriesSection teams={teams} sets={sets} />,
    );
    // One colored dot per category
    const dots = container.querySelectorAll("span.rounded-full.h-2.w-2");
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });
});
