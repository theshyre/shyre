import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { updateSetMock, createCatMock, updateCatMock, deleteCatMock } =
  vi.hoisted(() => ({
    updateSetMock: vi.fn(async (_fd: FormData) => {}),
    createCatMock: vi.fn(async (_fd: FormData) => {}),
    updateCatMock: vi.fn(async (_fd: FormData) => {}),
    deleteCatMock: vi.fn(async (_fd: FormData) => {}),
  }));

vi.mock("./actions", () => ({
  updateCategorySetAction: updateSetMock,
  createCategoryAction: createCatMock,
  updateCategoryAction: updateCatMock,
  deleteCategoryAction: deleteCatMock,
  deleteCategorySetAction: vi.fn(),
  createCategorySetAction: vi.fn(),
  cloneCategorySetAction: vi.fn(),
}));

import { CategorySetEditor } from "./category-set-editor";
import type { CategorySetWithCategories } from "@/lib/categories/types";

const set: CategorySetWithCategories = {
  id: "s1",
  organization_id: "o1",
  name: "My Set",
  description: "my desc",
  is_system: false,
  created_by: "u1",
  created_at: new Date().toISOString(),
  categories: [
    {
      id: "c1",
      category_set_id: "s1",
      name: "Feature",
      color: "#3b82f6",
      sort_order: 10,
      created_at: new Date().toISOString(),
    },
    {
      id: "c2",
      category_set_id: "s1",
      name: "Bug",
      color: "#ef4444",
      sort_order: 20,
      created_at: new Date().toISOString(),
    },
  ],
};

describe("CategorySetEditor", () => {
  it("populates set fields", () => {
    renderWithIntl(<CategorySetEditor set={set} onDone={() => {}} />);
    expect((screen.getByDisplayValue("My Set") as HTMLInputElement).value).toBe(
      "My Set",
    );
    expect(screen.getByDisplayValue("my desc")).toBeInTheDocument();
  });

  it("renders existing categories", () => {
    renderWithIntl(<CategorySetEditor set={set} onDone={() => {}} />);
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("Done button calls onDone", async () => {
    const onDone = vi.fn();
    renderWithIntl(<CategorySetEditor set={set} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onDone).toHaveBeenCalled();
  });

  it("submits the set update form", async () => {
    renderWithIntl(<CategorySetEditor set={set} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateSetMock).toHaveBeenCalled());
  });

  it("submits the new-category form", async () => {
    const { container } = renderWithIntl(
      <CategorySetEditor set={set} onDone={() => {}} />,
    );
    const nameInput = container.querySelector(
      'input[name="name"][placeholder]',
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Refactor" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(createCatMock).toHaveBeenCalled());
    const fd = createCatMock.mock.calls[0]?.[0];
    expect(fd?.get("name")).toBe("Refactor");
    expect(fd?.get("category_set_id")).toBe("s1");
  });
});
