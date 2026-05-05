import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/intl";
import { TicketField, ticketFieldVisible } from "./TicketField";

vi.mock("@/components/TicketChip", () => ({
  TicketChip: ({ ticketKey }: { ticketKey: string }) => (
    <span data-testid="chip">{ticketKey}</span>
  ),
}));

describe("ticketFieldVisible", () => {
  it("hidden when both null", () => {
    expect(ticketFieldVisible(null, null)).toBe(false);
  });
  it("visible when only GitHub set", () => {
    expect(ticketFieldVisible("o/r", null)).toBe(true);
  });
  it("visible when only Jira set", () => {
    expect(ticketFieldVisible(null, "AE")).toBe(true);
  });
});

describe("TicketField", () => {
  it("renders nothing when neither provider configured", () => {
    const { container } = renderWithIntl(
      <TicketField idPrefix="x" githubRepo={null} jiraProjectKey={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Jira-only project: input is empty, label uses Jira variant, placeholder shows the project key", () => {
    renderWithIntl(
      <TicketField idPrefix="ie-1" githubRepo={null} jiraProjectKey="AE" />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.name).toBe("ticket_ref");
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("AE-640");
  });

  it("GitHub-only project: placeholder shows the # short form", () => {
    renderWithIntl(
      <TicketField
        idPrefix="ie-1"
        githubRepo="octokit/rest.js"
        jiraProjectKey={null}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toContain("#42");
  });

  it("seeds the input with the short form when a Jira ticket is attached and matches the project key", () => {
    renderWithIntl(
      <TicketField
        idPrefix="ie-1"
        githubRepo={null}
        jiraProjectKey="AE"
        attached={{
          provider: "jira",
          key: "AE-640",
          url: null,
          title: "Fix login",
        }}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("640");
    expect(screen.getByTestId("chip")).toHaveTextContent("AE-640");
  });

  it("seeds the input with the full key when the Jira project key differs", () => {
    renderWithIntl(
      <TicketField
        idPrefix="ie-1"
        githubRepo={null}
        jiraProjectKey="AE"
        attached={{
          provider: "jira",
          key: "FOO-1",
          url: null,
          title: null,
        }}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("FOO-1");
  });

  it("seeds with `#NN` for GitHub matching repo", () => {
    renderWithIntl(
      <TicketField
        idPrefix="ie-1"
        githubRepo="octokit/rest.js"
        jiraProjectKey={null}
        attached={{
          provider: "github",
          key: "octokit/rest.js#42",
          url: null,
          title: null,
        }}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("#42");
  });

  it("disables the input when locked", () => {
    renderWithIntl(
      <TicketField
        idPrefix="ie-1"
        githubRepo={null}
        jiraProjectKey="AE"
        disabled
      />,
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
