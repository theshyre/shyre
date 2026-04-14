import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

vi.mock("./actions", () => ({
  createTemplateAction: vi.fn(),
  updateTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
  startFromTemplateAction: vi.fn(),
}));

import { TemplatesSection } from "./templates-section";
import type { TimeTemplate } from "@/lib/templates/types";

const orgs = [
  { id: "o1", name: "Org One", slug: "org-one", role: "owner" as const },
];

const projects = [
  { id: "p1", name: "Alpha", organization_id: "o1", category_set_id: "s1" },
];

const categories = [
  { id: "c1", category_set_id: "s1", name: "Feature", color: "#3b82f6", sort_order: 10 },
];

function makeTpl(id: string, name: string): TimeTemplate {
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    category_id: "c1",
    name,
    description: "desc",
    billable: true,
    sort_order: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
  };
}

describe("TemplatesSection", () => {
  it("renders empty state + create button when no templates", () => {
    renderWithIntl(
      <TemplatesSection
        orgs={orgs}
        templates={[]}
        projects={projects}
        categories={categories}
      />,
    );
    expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new template/i })).toBeInTheDocument();
  });

  it("renders existing templates with project + category", () => {
    renderWithIntl(
      <TemplatesSection
        orgs={orgs}
        templates={[makeTpl("t1", "Daily standup")]}
        projects={projects}
        categories={categories}
      />,
    );
    expect(screen.getByText("Daily standup")).toBeInTheDocument();
    expect(screen.getByText(/alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/feature/i)).toBeInTheDocument();
  });

  it("opens the new-template form when the button is clicked", () => {
    renderWithIntl(
      <TemplatesSection
        orgs={orgs}
        templates={[]}
        projects={projects}
        categories={categories}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    expect(screen.getByRole("button", { name: /^create$/i })).toBeInTheDocument();
  });

  it("requires two clicks to delete a template", () => {
    renderWithIntl(
      <TemplatesSection
        orgs={orgs}
        templates={[makeTpl("t1", "X")]}
        projects={projects}
        categories={categories}
      />,
    );
    // First "Delete" opens confirm
    const deleteBtns = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteBtns[0]!);
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();
  });
});
