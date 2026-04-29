import { describe, it, expect, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { BulkCategoryPicker, BulkProjectPicker } from "./bulk-pickers";

describe("BulkCategoryPicker", () => {
  it("renders a closed trigger by default", () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole, queryByRole } = renderWithIntl(
      <BulkCategoryPicker onSelect={onSelect} />,
    );
    const trigger = getByRole("button", { name: /Set category/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // No menu rendered yet.
    expect(queryByRole("menu")).toBeNull();
  });

  it("opens the menu on trigger click", () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole } = renderWithIntl(
      <BulkCategoryPicker onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Set category/i }));
    expect(getByRole("menu")).toBeInTheDocument();
  });

  it("invokes onSelect with the chosen category and closes", async () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole, queryByRole } = renderWithIntl(
      <BulkCategoryPicker onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Set category/i }));
    const softwareItem = getByRole("menuitem", { name: /Software/ });
    fireEvent.click(softwareItem);
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("software");
    });
    // Menu should close after selection.
    await waitFor(() => {
      expect(queryByRole("menu")).toBeNull();
    });
  });
});

describe("BulkProjectPicker", () => {
  const projects = [
    { id: "p1", name: "Acme redesign", team_id: "t1" },
    { id: "p2", name: "Internal tooling", team_id: "t1" },
  ];

  it("disables the trigger when there are no projects", () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole } = renderWithIntl(
      <BulkProjectPicker projects={[]} onSelect={onSelect} />,
    );
    const trigger = getByRole("button", { name: /Set project/i });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the No project clear option first", () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole, getAllByRole } = renderWithIntl(
      <BulkProjectPicker projects={projects} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Set project/i }));
    const items = getAllByRole("menuitem");
    // First item is the "no project" clear-link option.
    expect(items[0]?.textContent ?? "").toMatch(/No project/i);
  });

  it("invokes onSelect with the project id and closes", async () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole, queryByRole } = renderWithIntl(
      <BulkProjectPicker projects={projects} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Set project/i }));
    fireEvent.click(getByRole("menuitem", { name: /Acme redesign/ }));
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("p1");
    });
    await waitFor(() => {
      expect(queryByRole("menu")).toBeNull();
    });
  });

  it("invokes onSelect with empty string when 'No project' is chosen", async () => {
    const onSelect = vi.fn(async () => {});
    const { getByRole } = renderWithIntl(
      <BulkProjectPicker projects={projects} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Set project/i }));
    fireEvent.click(getByRole("menuitem", { name: /No project/i }));
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("");
    });
  });
});
