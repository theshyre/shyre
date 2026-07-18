/**
 * Unwrap a PostgREST embedded relation to a single row.
 *
 * Supabase returns an embedded (joined) relation either as a single object or
 * as an array depending on how the FK relationship is inferred — so call sites
 * were sprinkled with `Array.isArray(...) ? v[0] : v` casts. This helper is
 * the one canonical unwrap: first row of an array, the object itself, or null
 * when the embed is absent/empty.
 */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }
  return value;
}
