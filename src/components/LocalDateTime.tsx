"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@theshyre/ui";

interface LocalDateTimeProps {
  /** ISO timestamp string. Always pass a UTC value (TIMESTAMPTZ
   *  serializes to UTC by default) — the component formats it in the
   *  browser's local timezone. */
  value: string;
}

/**
 * Render a UTC timestamp formatted in the viewer's local timezone.
 *
 * Server components can't "know" the viewer's timezone — `toLocaleString`
 * on the server runs in the server's TZ (UTC on Vercel), so an event
 * stamped at `2026-04-15T16:26:00Z` would render as "Apr 15, 2026,
 * 4:26 PM" for everyone, not the wall-clock time the viewer
 * experienced. Mounting a client component lets the browser do the
 * conversion for free.
 *
 * SSR shows a placeholder (`—`) until hydration; that's a tradeoff
 * for not flashing a wrong-TZ value on first paint. The `<time>`
 * element keeps the machine-readable ISO available for screen
 * readers and copy-paste regardless of hydration state.
 */
export function LocalDateTime({ value }: LocalDateTimeProps): React.JSX.Element {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(formatDateTime(value));
  }, [value]);

  return <time dateTime={value}>{formatted ?? "—"}</time>;
}
