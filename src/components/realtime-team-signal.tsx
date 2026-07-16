"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface RealtimeTeamSignalProps {
  /** The viewer's team ids — the private Broadcast topics to listen on.
   *  Server-resolved (getUserTeams) and passed down; the browser never
   *  resolves membership itself. */
  teamIds: string[];
}

/**
 * Shell-level subscriber for the live-freshness signal. Listens on each of
 * the viewer's `team:<id>` private Broadcast channels; a change on any
 * watched table (declared per-module via the registry, backed by the
 * `broadcast_team_change` DB trigger) surfaces a user-controlled
 * "N updates · Refresh" pill.
 *
 * Deliberately NOT an auto-refresh: the Broadcast is a payload-free "something
 * changed" ping, and applying it is the user's choice — so a teammate's edit
 * never reflows content or clobbers an in-progress inline edit under them. The
 * refresh, when clicked, re-fetches through the existing RLS-scoped server
 * path, so no row data ever rides the socket. See SAL-035.
 */
export function RealtimeTeamSignal({
  teamIds,
}: RealtimeTeamSignalProps): React.JSX.Element | null {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(0);
  // Coalesce a burst (e.g. a CSV import firing hundreds of row triggers) into
  // a single increment, so the count reflects change *episodes*, not rows, and
  // a bulk op can't inflate the pill into the thousands.
  const burstActive = useRef(false);

  const onSignal = useCallback(() => {
    if (burstActive.current) return;
    burstActive.current = true;
    setPending((n) => n + 1);
    setTimeout(() => {
      burstActive.current = false;
    }, 1500);
  }, []);

  // Stable across re-renders / router.refresh() as long as the membership set
  // is unchanged — so we don't tear down and re-open channels on every refresh.
  const teamKey = [...teamIds].sort().join(",");

  useEffect(() => {
    if (!teamKey) return;
    const ids = teamKey.split(",");
    const supabase = createClient();
    // Private channels require the socket to carry the user's JWT so RLS on
    // realtime.messages can scope delivery.
    void supabase.realtime.setAuth();

    const channels = ids.map((id) => {
      const channel = supabase.channel(`team:${id}`, {
        config: { private: true },
      });
      channel.on("broadcast", { event: "change" }, onSignal).subscribe();
      return channel;
    });

    // The access token is short-lived but the socket is long-lived: re-auth on
    // refresh so RLS keeps scoping correctly, and a signed-out socket can't
    // linger authed as the previous user (security C2 / SAL-035).
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        void supabase.realtime.setAuth();
      }
    });

    return () => {
      authSub.subscription.unsubscribe();
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
  }, [teamKey, onSignal]);

  const applyUpdates = useCallback(() => {
    setPending(0);
    burstActive.current = false;
    router.refresh();
  }, [router]);

  if (pending === 0) return null;

  const label = t("freshness.updatesAvailable", { count: pending });

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center"
    >
      <button
        type="button"
        onClick={applyUpdates}
        className={[
          "pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 shadow-lg",
          "border border-accent bg-surface-raised text-accent text-caption font-medium",
          "hover:bg-accent-soft transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2",
        ].join(" ")}
      >
        <RefreshCw size={14} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {/* Polite announcement so screen-reader users learn updates are
          available without content shifting under them (WCAG 4.1.3). */}
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
    </div>
  );
}
