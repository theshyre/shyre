import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => mockRevalidatePath(p),
}));

import { revalidateProjectsForExpense } from "./revalidate";

describe("revalidateProjectsForExpense", () => {
  beforeEach(() => {
    mockRevalidatePath.mockReset();
  });

  it("revalidates each distinct project detail path once", () => {
    revalidateProjectsForExpense(["p1", "p2", "p1"]);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p2");
  });

  it("filters out null / undefined / empty ids (unlinked expenses)", () => {
    revalidateProjectsForExpense([null, undefined, "", "p1"]);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/projects/p1");
  });

  it("is a no-op for an empty list", () => {
    revalidateProjectsForExpense([]);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
