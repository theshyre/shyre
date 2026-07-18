import { describe, it, expect, expectTypeOf } from "vitest";
import type { ProjectOption } from "./types";

describe("ProjectOption", () => {
  it("pins the shape shared pickers rely on (id / name / team_id)", () => {
    // Compile-time contract: every picker (create form, inline row
    // cell, bulk picker) scopes by team_id — removing or renaming a
    // field here must fail this test's type-check.
    expectTypeOf<ProjectOption>().toEqualTypeOf<{
      id: string;
      name: string;
      team_id: string;
    }>();

    const option: ProjectOption = {
      id: "p1",
      name: "Redesign",
      team_id: "t1",
    };
    expect(option.team_id).toBe("t1");
  });
});
