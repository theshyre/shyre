import { z } from "zod";

/**
 * A trailing ISO 8601 timezone offset written WITHOUT the colon (`-0700`,
 * `+0530`) — the form `date +%z` and many shell snippets emit. Captured as
 * `(±HH)(MM)` so we can splice in the colon.
 */
const BARE_OFFSET = /([+-]\d{2})(\d{2})$/;

/**
 * ISO 8601 datetime that REQUIRES a timezone offset — accepting both the
 * RFC-3339 colon form (`2026-07-24T07:01:00-07:00`, `…Z`) AND the bare
 * ISO 8601 offset (`2026-07-24T07:01:00-0700`).
 *
 * Why the leniency: Zod's `z.iso.datetime({ offset: true })` follows RFC 3339,
 * which mandates the colon in the offset, so it rejects `-0700` even though
 * ISO 8601 permits it. `-0700` is exactly what `date +%z` produces, so agents
 * hand-rolling a time-log request (`start_time`/`end_time`) kept tripping a
 * `VALIDATION_ERROR: Invalid ISO datetime` (SAL noise, 2026-07-24). We
 * normalize a bare trailing `±HHMM` to `±HH:MM` before validating — nothing
 * else is loosened: no-offset strings, garbage, and non-strings still fail.
 *
 * Use this for the public integration API (`/api/v1/entries`) instead of a
 * raw `z.iso.datetime`. `.parse()` returns the normalized (colon) form, so
 * downstream consumers always see a canonical value.
 */
export const isoDatetimeOffset = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.replace(BARE_OFFSET, "$1:$2");
}, z.iso.datetime({ offset: true }));
