import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { TextSize } from "@/components/text-size-provider";
import type { TableDensity } from "@/components/table-density-provider";

export type PreferredTheme =
  | "system"
  | "light"
  | "dark"
  | "high-contrast"
  | "warm";

export interface UserSettings {
  preferredTheme: PreferredTheme | null;
  preferredTextSize: TextSize | null;
  preferredDensity: TableDensity | null;
  timezone: string | null;
}

const NULL_SETTINGS: UserSettings = {
  preferredTheme: null,
  preferredTextSize: null,
  preferredDensity: null,
  timezone: null,
};

/**
 * Fetch the current user's persisted display + locale settings in a
 * single round-trip. Pre-2026-05-04 the layout fetched theme + text
 * size + table density and the time-entries page fetched timezone
 * separately — two round-trips for what is one row.
 *
 * Wrapped in React `cache()` so layout + page + any nested server
 * component share one fetch. RLS scopes the row to the current user
 * (auth.uid() = user_id), so the query needs neither an explicit
 * eq() filter nor a prior auth.getUser call.
 */
export const getUserSettings = cache(async (): Promise<UserSettings> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("preferred_theme, text_size, table_density, timezone")
    .maybeSingle();

  if (!data) return NULL_SETTINGS;

  return {
    preferredTheme: (data.preferred_theme as PreferredTheme | null) ?? null,
    preferredTextSize: (data.text_size as TextSize | null) ?? null,
    preferredDensity: (data.table_density as TableDensity | null) ?? null,
    timezone: (data.timezone as string | null) ?? null,
  };
});
