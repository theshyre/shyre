import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import IntegrationsSettingsLoading from "./loading";

describe("IntegrationsSettingsLoading", () => {
  it("renders an accessible loading status", () => {
    render(<IntegrationsSettingsLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Loading integrations/)).toBeInTheDocument();
  });
});
