import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SortableTableHeader } from "./SortableTableHeader";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("SortableTableHeader", () => {
  function buildHref({
    sort,
    dir,
  }: {
    sort: string;
    dir: "asc" | "desc";
  }): string {
    return `/projects?sort=${sort}&dir=${dir}`;
  }

  it("renders the label", () => {
    render(
      <table>
        <thead>
          <tr>
            <SortableTableHeader
              label="Name"
              sortKey="name"
              currentSort={null}
              currentDir="asc"
              href={buildHref}
            />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText("Name")).toBeDefined();
  });

  it("marks the active column with aria-sort=ascending and links to desc next", () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <SortableTableHeader
              label="Name"
              sortKey="name"
              currentSort="name"
              currentDir="asc"
              href={buildHref}
            />
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/projects?sort=name&dir=desc");
  });

  it("marks the active column with aria-sort=descending and links to asc next", () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <SortableTableHeader
              label="Name"
              sortKey="name"
              currentSort="name"
              currentDir="desc"
              href={buildHref}
            />
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector("th");
    expect(th?.getAttribute("aria-sort")).toBe("descending");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/projects?sort=name&dir=asc");
  });

  it("inactive column has aria-sort=none and links to asc on first click", () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <SortableTableHeader
              label="Rate"
              sortKey="hourly_rate"
              currentSort="name"
              currentDir="asc"
              href={buildHref}
            />
          </tr>
        </thead>
      </table>,
    );
    const th = container.querySelector("th");
    expect(th?.getAttribute("aria-sort")).toBe("none");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "/projects?sort=hourly_rate&dir=asc",
    );
  });
});
