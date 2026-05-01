/**
 * Shared payment-terms helpers.
 *
 * The "Payment terms" surface is the days-until-due selector that
 * appears on customer settings, team settings, and the new-invoice
 * form. Three things need to agree:
 *
 *   1. The set of presets shown as chips (0 / 15 / 30 / 45 / 60 / 90).
 *   2. The cascade: customer override → team default → null.
 *   3. The label ("Net 30" / "Due on receipt") rendered on the
 *      invoice and PDF, denormalized at create-time.
 *
 * Centralizing here keeps the form, action, and PDF in lockstep —
 * the bookkeeper review flagged that the preview total must match
 * the posted total to the cent, and the same applies to the
 * payment-terms label: what the user sees in the chip row must be
 * what's stamped on the PDF the customer receives.
 */

export const PAYMENT_TERMS_PRESETS = [
  0,
  15,
  30,
  45,
  60,
  90,
] as const;

export type PaymentTermsPreset = (typeof PAYMENT_TERMS_PRESETS)[number];

/** True when `n` is one of the canonical preset values. Used by
 *  the chip row to decide between a chip selection vs the
 *  Custom-input fallback. */
export function isPresetTermsDays(n: number | null | undefined): boolean {
  if (n == null) return false;
  return (PAYMENT_TERMS_PRESETS as readonly number[]).includes(n);
}

/** Render the human-readable terms label. 0 → "Due on receipt"; any
 *  positive integer → "Net N". Mirrored in i18n for the visible
 *  surfaces; the bare label is also stored on the invoice row so
 *  the PDF renderer can stay locale-agnostic. */
export function paymentTermsLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days === 0) return "Due on receipt";
  return `Net ${days}`;
}

/** Resolve the cascade. Customer override wins, else team default,
 *  else null (no default — user picks a date manually). */
export function resolvePaymentTermsDays(input: {
  customerTermsDays: number | null | undefined;
  teamDefaultDays: number | null | undefined;
}): number | null {
  if (input.customerTermsDays != null) return input.customerTermsDays;
  if (input.teamDefaultDays != null) return input.teamDefaultDays;
  return null;
}

/** Where the resolved value came from. Drives the inline source
 *  indicator on the new-invoice form ("Net 30 (default for Acme)").
 *  Three states by design: none, team, customer. */
export type PaymentTermsSource = "customer" | "team" | "none";

export function resolvePaymentTermsSource(input: {
  customerTermsDays: number | null | undefined;
  teamDefaultDays: number | null | undefined;
}): PaymentTermsSource {
  if (input.customerTermsDays != null) return "customer";
  if (input.teamDefaultDays != null) return "team";
  return "none";
}

/** Compute the due date as YYYY-MM-DD given an issue date and term
 *  days. Date-arithmetic stays in UTC to avoid the
 *  "issued at 11pm local, due rolled by a day" gotcha. */
export function computeDueDate(
  issuedYmd: string,
  termsDays: number,
): string {
  const d = new Date(`${issuedYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + termsDays);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
