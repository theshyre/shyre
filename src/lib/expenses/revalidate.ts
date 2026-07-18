import { revalidatePath } from "next/cache";

/**
 * Revalidate the project detail page(s) for the affected expense
 * rows. Project pages render their own expenses section sourced from
 * the same table, so a mutation on the main /business/[id]/expenses
 * surface would leave the project page stale without this. Pass the
 * full list of project_ids that may have been touched (old + new for
 * field updates that move an expense between projects); duplicates
 * and nulls are filtered.
 *
 * Lives outside the `"use server"` action modules because those may
 * only export async server actions — this is a plain synchronous
 * helper shared by the row-level actions (`@/lib/expenses/actions`)
 * and the Business module's bulk actions.
 */
export function revalidateProjectsForExpense(
  projectIds: ReadonlyArray<string | null | undefined>,
): void {
  const distinct = new Set<string>();
  for (const id of projectIds) {
    if (id) distinct.add(id);
  }
  for (const id of distinct) {
    revalidatePath(`/projects/${id}`);
  }
}
