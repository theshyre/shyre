"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TZ_COOKIE_NAME } from "@/lib/time/tz";

/**
 * Syncs the browser's timezone offset (minutes west of UTC, per JS convention)
 * to a cookie so server components can render dates in the user's timezone.
 *
 * Expires in 365 days, refreshed on every visit.
 */
export function TimezoneSync(): null {
  const router = useRouter();

  useEffect(() => {
    const offset = new Date().getTimezoneOffset();
    const currentCookie = getCookie(TZ_COOKIE_NAME);
    if (currentCookie === String(offset)) return;

    setCookie(TZ_COOKIE_NAME, String(offset), 365);
    // Refresh the current route so server components re-render with the
    // correct TZ. Only needed when the cookie value actually changed.
    router.refresh();
  }, [router]);

  return null;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

function setCookie(name: string, value: string, days: number): void {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}
