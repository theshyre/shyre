import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectFilterOption } from "./ProjectFilter";

const mockPush = vi.fn();
const mockPathname = "/time-entries";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (_ns: string) => (key: string, vars?: Record<string, unknown>) => {
      switch (key) {
        case "all":
          return "All projects";
        case "listboxLabel":
          return "Filter by project";
        case "internal":
          return "Internal";
        case "includesSub":
          return `(+${vars?.count} sub-projects)`;
        default:
          return key;
      }
    },
}));

import { ProjectFilter } from "./ProjectFilter";

const ENGAGEMENT: ProjectFilterOption = {
  id: "p-engagement",
  name: "Engagement",
  parent_project_id: null,
  customer_name: "Acme",
  is_internal: false,
};
const PHASE_1: ProjectFilterOption = {
  id: "p-phase-1",
  name: "Phase 1",
  parent_project_id: "p-engagement",
  customer_name: "Acme",
  is_internal: false,
};
const PHASE_2: ProjectFilterOption = {
  id: "p-phase-2",
  name: "Phase 2",
  parent_project_id: "p-engagement",
  customer_name: "Acme",
  is_internal: false,
};
const SOLO: ProjectFilterOption = {
  id: "p-solo",
  name: "Solo project",
  parent_project_id: null,
  customer_name: "Beta Corp",
  is_internal: false,
};
const INTERNAL: ProjectFilterOption = {
  id: "p-internal",
  name: "Internal admin",
  parent_project_id: null,
  customer_name: null,
  is_internal: true,
};

const ALL_PROJECTS = [ENGAGEMENT, PHASE_1, PHASE_2, SOLO, INTERNAL];

function lastPushedUrl(): string {
  const calls = mockPush.mock.calls;
  if (calls.length === 0) return "";
  return calls[calls.length - 1]![0] as string;
}

describe("ProjectFilter", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("renders nothing when given no projects (no filter to choose from)", () => {
    const { container } = render(
      <ProjectFilter projects={[]} selectedId={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("default chip label reads 'All projects' when nothing is selected", () => {
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    expect(
      screen.getByRole("button", { name: /All projects/ }),
    ).toBeInTheDocument();
  });

  it("chip label shows the selected leaf project's name", () => {
    render(
      <ProjectFilter projects={ALL_PROJECTS} selectedId="p-phase-1" />,
    );
    expect(
      screen.getByRole("button", { name: /Phase 1/ }),
    ).toBeInTheDocument();
  });

  it("chip surfaces the sub-project count when a parent is selected (rollup is active)", () => {
    render(
      <ProjectFilter projects={ALL_PROJECTS} selectedId="p-engagement" />,
    );
    expect(
      screen.getByRole("button", { name: /Engagement.*\+2 sub-projects/ }),
    ).toBeInTheDocument();
  });

  it("clicking the chip opens a listbox with All / parents / children", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // All-clear option
    expect(
      screen.getByRole("option", { name: /All projects/ }),
    ).toBeInTheDocument();
    // Parent + children + solo + internal each appear as options
    expect(
      screen.getByRole("option", { name: /Engagement/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Phase 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Phase 2/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Solo project/ }),
    ).toBeInTheDocument();
  });

  it("picking a project pushes ?project=<id> to the URL", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    await user.click(screen.getByRole("option", { name: /Phase 1/ }));
    expect(lastPushedUrl()).toContain("project=p-phase-1");
  });

  it("picking a parent pushes ?project=<parentId> — server expands to children", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    await user.click(screen.getByRole("option", { name: /Engagement/ }));
    expect(lastPushedUrl()).toContain("project=p-engagement");
  });

  it("picking 'All projects' DELETES the project param from the URL", async () => {
    mockSearchParams = new URLSearchParams("project=p-phase-1&from=2026-01-01");
    const user = userEvent.setup();
    render(
      <ProjectFilter projects={ALL_PROJECTS} selectedId="p-phase-1" />,
    );
    await user.click(screen.getByRole("button", { name: /Phase 1/ }));
    await user.click(screen.getByRole("option", { name: /All projects/ }));
    const url = lastPushedUrl();
    expect(url).not.toContain("project=");
    // unrelated params are preserved
    expect(url).toContain("from=2026-01-01");
  });

  it("preserves other query params when selecting a project", async () => {
    mockSearchParams = new URLSearchParams("view=week&billable=1");
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    await user.click(screen.getByRole("option", { name: /Solo project/ }));
    const url = lastPushedUrl();
    expect(url).toContain("project=p-solo");
    expect(url).toContain("view=week");
    expect(url).toContain("billable=1");
  });

  it("renders the parent option WITH its sub-project count next to the name", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    expect(
      screen.getByRole("option", { name: /Engagement.*\+2 sub-projects/ }),
    ).toBeInTheDocument();
  });

  it("does NOT render a sub-project count on solo (childless) projects in the list", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    const soloOption = screen.getByRole("option", { name: /Solo project/ });
    expect(soloOption.textContent ?? "").not.toMatch(/sub-project/i);
  });

  it("labels internal projects as Internal in the dropdown row", async () => {
    const user = userEvent.setup();
    render(<ProjectFilter projects={ALL_PROJECTS} selectedId={null} />);
    await user.click(screen.getByRole("button", { name: /All projects/ }));
    const internalOption = screen.getByRole("option", {
      name: /Internal admin/,
    });
    expect(internalOption.textContent ?? "").toMatch(/Internal/);
  });
});
