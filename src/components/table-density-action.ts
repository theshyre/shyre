"use server";

import { runSafeAction } from "@/lib/safe-action";
import { assertSupabaseOk } from "@/lib/errors";

const ALLOWED_DENSITIES = new Set(["compact", "regular", "comfortable"]);

/**
 * Persist the user's table-density choice to user_settings.
 *
 * Mirrors the shape of the existing preferences-update path in
 * `(dashboard)/profile/actions.ts`, scoped to a single field so the
 * toggle's transition stays cheap. Local state in the provider has
 * already changed by the time this fires — failure here is logged
 * but doesn't roll the UI back, since the localStorage cache will
 * keep the chosen value across reloads regardless of DB state.
 */
export async function updateTableDensityAction(
  formData: FormData,
): Promise<void> {
  return runSafeAction(
    formData,
    async (fd, { supabase, userId }) => {
      const raw = fd.get("table_density");
      const density = typeof raw === "string" ? raw.trim() : "";
      if (!ALLOWED_DENSITIES.has(density)) {
        throw new Error(`Invalid table_density: ${density}`);
      }

      assertSupabaseOk(
        await supabase
          .from("user_settings")
          .upsert(
            { user_id: userId, table_density: density },
            { onConflict: "user_id" },
          ),
      );
    },
    "updateTableDensityAction",
  ) as unknown as void;
}
