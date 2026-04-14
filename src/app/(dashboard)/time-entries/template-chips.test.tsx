import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";

const { startFromTemplateMock } = vi.hoisted(() => ({
  startFromTemplateMock: vi.fn(async (_fd: FormData) => {}),
}));

vi.mock("../templates/actions", () => ({
  startFromTemplateAction: startFromTemplateMock,
}));

import { TemplateChips } from "./template-chips";
import type { TimeTemplate } from "@/lib/templates/types";

function makeTemplate(id: string, name: string): TimeTemplate {
  return {
    id,
    organization_id: "o1",
    user_id: "u1",
    project_id: "p1",
    category_id: null,
    name,
    description: null,
    billable: true,
    sort_order: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
  };
}

describe("TemplateChips", () => {
  beforeEach(() => startFromTemplateMock.mockClear());

  it("renders nothing when templates list is empty", () => {
    const { container } = renderWithIntl(<TemplateChips templates={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip per template", () => {
    renderWithIntl(
      <TemplateChips
        templates={[makeTemplate("a", "Daily standup"), makeTemplate("b", "Code review")]}
      />,
    );
    expect(screen.getByRole("button", { name: /daily standup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /code review/i })).toBeInTheDocument();
  });

  it("submits the start action with the template id on click", async () => {
    renderWithIntl(<TemplateChips templates={[makeTemplate("a", "Daily standup")]} />);
    fireEvent.click(screen.getByRole("button", { name: /daily standup/i }));
    await waitFor(() => expect(startFromTemplateMock).toHaveBeenCalled());
    const fd = startFromTemplateMock.mock.calls[0]?.[0];
    expect(fd?.get("template_id")).toBe("a");
  });
});
