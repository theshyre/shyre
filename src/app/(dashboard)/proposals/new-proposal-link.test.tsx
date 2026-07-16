import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { NewProposalLink } from "./new-proposal-link";

beforeEach(() => pushMock.mockClear());

describe("NewProposalLink", () => {
  it("links to /proposals/new with the label and visible kbd hint", () => {
    render(<NewProposalLink label="New proposal" />);
    const link = screen.getByRole("link", { name: /New proposal/ });
    expect(link).toHaveAttribute("href", "/proposals/new");
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("navigates on the N shortcut when no input is focused", () => {
    render(<NewProposalLink label="New proposal" />);
    fireEvent.keyDown(window, { key: "n" });
    expect(pushMock).toHaveBeenCalledWith("/proposals/new");
  });

  it("does not fire while typing in an input", () => {
    render(
      <>
        <input data-testid="field" />
        <NewProposalLink label="New proposal" />
      </>,
    );
    const field = screen.getByTestId("field");
    field.focus();
    fireEvent.keyDown(field, { key: "n" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
