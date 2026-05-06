import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/intl";
import { ProjectPicker, type ProjectPickerOption } from "./ProjectPicker";

const ENGAGEMENT: ProjectPickerOption = {
  id: "p-engagement",
  name: "AVDR eClinical",
  parent_project_id: null,
  customer_name: "EyeReg Consulting, Inc.",
  is_internal: false,
};
const PHASE_1: ProjectPickerOption = {
  id: "p-phase-1",
  name: "AVDR Amplify Gen 2 Spike",
  parent_project_id: "p-engagement",
  customer_name: "EyeReg Consulting, Inc.",
  is_internal: false,
};
const PIERCE_INFRA: ProjectPickerOption = {
  id: "p-infra",
  name: "Infrastructure & Systems Management (IT Ops)",
  parent_project_id: null,
  customer_name: "Pierce Clark & Associates",
  is_internal: false,
};
const SHYRE_INTERNAL: ProjectPickerOption = {
  id: "p-shyre",
  name: "Shyre",
  parent_project_id: null,
  customer_name: null,
  is_internal: true,
};

const ALL = [ENGAGEMENT, PHASE_1, PIERCE_INFRA, SHYRE_INTERNAL];

function open(): void {
  // Trigger button is the first <button> in the component.
  fireEvent.click(screen.getByRole("button"));
}

describe("ProjectPicker", () => {
  it("renders with placeholder when no value is selected", () => {
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    // The trigger button shows the placeholder.
    expect(
      screen.getByRole("button", { name: /Select a project/i }),
    ).toBeInTheDocument();
  });

  it("trigger renders the selected project's name when value is set", () => {
    renderWithIntl(
      <ProjectPicker
        projects={ALL}
        value="p-engagement"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("AVDR eClinical")).toBeInTheDocument();
  });

  it("opens a listbox with customer-grouped sections + indented sub-projects", () => {
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    open();
    // Customer header rows
    expect(screen.getByText("EyeReg Consulting, Inc.")).toBeInTheDocument();
    expect(screen.getByText("Pierce Clark & Associates")).toBeInTheDocument();
    // Internal section
    expect(screen.getByText("Internal")).toBeInTheDocument();
    // Both parent AND child render as options
    expect(
      screen.getByRole("option", { name: /AVDR eClinical/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /AVDR Amplify Gen 2 Spike/ }),
    ).toBeInTheDocument();
  });

  it("includes parent projects in the listbox (no leaf-only filter — bug 2026-05-06)", () => {
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    open();
    // The parent (AVDR eClinical) MUST be selectable, not hidden.
    const parentOption = screen.getByRole("option", {
      name: /AVDR eClinical/,
    });
    expect(parentOption).not.toBeDisabled();
  });

  it("renders the Recent section at the top when recentIds are passed", () => {
    renderWithIntl(
      <ProjectPicker
        projects={ALL}
        value=""
        onChange={() => {}}
        recentIds={["p-infra", "p-shyre"]}
      />,
    );
    open();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    // Recent rows have the "recent:" key prefix; the same project
    // appears once in Recent and once in its customer group.
    const infraOptions = screen.getAllByRole("option", {
      name: /Infrastructure & Systems Management/,
    });
    expect(infraOptions.length).toBe(2);
  });

  it("hides the Recent section when recentIds is empty", () => {
    renderWithIntl(
      <ProjectPicker
        projects={ALL}
        value=""
        onChange={() => {}}
        recentIds={[]}
      />,
    );
    open();
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("type-to-filter narrows the option list to matching projects", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    open();
    const search = screen.getByPlaceholderText(/Search projects/i);
    await user.type(search, "amplify");
    expect(
      screen.getByRole("option", { name: /AVDR Amplify Gen 2 Spike/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Infrastructure/ }),
    ).not.toBeInTheDocument();
  });

  it("search matches against customer name too", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    open();
    const search = screen.getByPlaceholderText(/Search projects/i);
    await user.type(search, "Pierce");
    expect(
      screen.getByRole("option", { name: /Infrastructure/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /AVDR/ }),
    ).not.toBeInTheDocument();
  });

  it("clicking a project fires onChange with its id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={onChange} />,
    );
    open();
    await user.click(screen.getByRole("option", { name: /AVDR eClinical/ }));
    expect(onChange).toHaveBeenCalledWith("p-engagement");
  });

  it("renders a hidden input with the selected id when `name` is provided (drop-in for native select)", () => {
    const { container } = renderWithIntl(
      <ProjectPicker
        projects={ALL}
        value="p-engagement"
        onChange={() => {}}
        name="project_id"
      />,
    );
    const hidden = container.querySelector(
      'input[type="hidden"][name="project_id"]',
    ) as HTMLInputElement | null;
    expect(hidden).not.toBeNull();
    expect(hidden!.value).toBe("p-engagement");
  });

  it("does NOT render a hidden input when `name` is omitted", () => {
    const { container } = renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    expect(container.querySelector('input[type="hidden"]')).toBeNull();
  });

  it("FormData picks up the selected id when wrapped in a form", () => {
    const { container } = renderWithIntl(
      <form>
        <ProjectPicker
          projects={ALL}
          value="p-phase-1"
          onChange={() => {}}
          name="project_id"
        />
      </form>,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const fd = new FormData(form);
    expect(fd.get("project_id")).toBe("p-phase-1");
  });

  it("sub-projects render with the ↳ glyph indented under their parent", () => {
    renderWithIntl(
      <ProjectPicker projects={ALL} value="" onChange={() => {}} />,
    );
    open();
    // The ↳ glyph appears next to child rows (it's aria-hidden but
    // visible in the DOM). Find the child option.
    const childOption = screen.getByRole("option", {
      name: /AVDR Amplify Gen 2 Spike/,
    });
    expect(childOption.textContent ?? "").toContain("↳");
  });
});
