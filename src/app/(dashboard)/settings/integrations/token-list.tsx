"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Ban, Clock, KeyRound } from "lucide-react";
import { LocalDateTime } from "@theshyre/ui";
import { useToast } from "@/components/Toast";
import { EntryAuthor } from "@/components/EntryAuthor";
import { buttonDangerClass, buttonSecondaryClass } from "@/lib/form-styles";
import {
  tableClass,
  tableHeaderRowClass,
  tableHeaderCellClass,
} from "@/lib/table-styles";
import { revokeIntegrationTokenAction } from "./actions";
import type {
  IntegrationTokenRow,
  TokenOwnerProfile,
} from "./token-constants";

interface Props {
  tokens: IntegrationTokenRow[];
  /** display_name / avatar_url per user_id (for the admin team view). */
  profiles: TokenOwnerProfile[];
  currentUserId: string;
  /** Epoch millis "now" for expiry checks — computed by the server
   *  page per request (render purity: no Date.now() during render). */
  now: number;
}

type TokenStatus = "active" | "revoked" | "expired";

function tokenStatus(token: IntegrationTokenRow, now: number): TokenStatus {
  if (token.revoked_at !== null) return "revoked";
  // Timestamptz comparison via epoch millis — never string-compare.
  if (new Date(token.expires_at).getTime() <= now) return "expired";
  return "active";
}

const STATUS_STYLE: Record<
  TokenStatus,
  { classes: string; icon: typeof BadgeCheck }
> = {
  active: { classes: "bg-success-soft text-success-text", icon: BadgeCheck },
  revoked: { classes: "bg-error-soft text-error-text", icon: Ban },
  expired: { classes: "bg-surface-inset text-content-muted", icon: Clock },
};

/** Shape a runSafeAction-wrapped action actually resolves to. */
type RevokeResult =
  | { success: true }
  | {
      success: false;
      error?: { message?: string; userMessageKey?: string };
    }
  | void;

/**
 * Token table, grouped by owner. The viewer's own tokens come first
 * under their avatar + a "Your tokens" label; a team owner/admin
 * additionally sees every other member's tokens (RLS permits) under
 * that member's avatar + display name (the authorship rule).
 *
 * Revocation is the safe direction — the tiered destructive-flow
 * pattern's inline [Confirm][Cancel] is sufficient, no undo. The
 * confirm block spells out that integrations using the token stop
 * immediately; focus moves onto the confirm button when it appears
 * (the trigger it replaces unmounts) and returns to the row's Revoke
 * button on cancel/Escape.
 */
export function TokenList({
  tokens,
  profiles,
  currentUserId,
  now,
}: Props): React.JSX.Element {
  const t = useTranslations("integrations.tokens");
  const tc = useTranslations("common");
  // Root translator for server-provided i18n error keys.
  const tRoot = useTranslations();
  const toast = useToast();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const revokeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusIdRef = useRef<string | null>(null);

  const translate = useCallback(
    (keyOrMessage: string): string => {
      try {
        const translated = tRoot(keyOrMessage);
        if (translated && translated !== keyOrMessage) return translated;
      } catch {
        // Not a known key — fall through to the raw message.
      }
      return keyOrMessage;
    },
    [tRoot],
  );

  // Focus follows the confirm flow: the confirm button when the block
  // appears, back to the row's Revoke button after cancel/Escape.
  useEffect(() => {
    if (confirmingId !== null) {
      confirmButtonRef.current?.focus();
    } else if (restoreFocusIdRef.current !== null) {
      revokeButtonRefs.current.get(restoreFocusIdRef.current)?.focus();
      restoreFocusIdRef.current = null;
    }
  }, [confirmingId]);

  const cancelConfirm = useCallback((): void => {
    setConfirmingId((current) => {
      restoreFocusIdRef.current = current;
      return null;
    });
  }, []);

  // Window-level Escape fallback (overlay rule) for when focus sits
  // outside the confirm block. The block itself handles Escape first
  // and stops propagation, so an open create form elsewhere on the
  // page doesn't collapse from the same keypress.
  useEffect(() => {
    if (confirmingId === null || pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") cancelConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingId, pending, cancelConfirm]);

  if (tokens.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-edge bg-surface-raised p-4 text-body text-content-muted">
        <KeyRound size={16} aria-hidden="true" />
        {t("empty")}
      </p>
    );
  }

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const ownTokens = tokens.filter((tok) => tok.user_id === currentUserId);
  const otherOwnerIds = Array.from(
    new Set(
      tokens
        .filter((tok) => tok.user_id !== currentUserId)
        .map((tok) => tok.user_id),
    ),
  ).sort((a, b) => {
    const nameA = profileById.get(a)?.display_name ?? "";
    const nameB = profileById.get(b)?.display_name ?? "";
    return nameA.localeCompare(nameB);
  });

  const groups: { ownerId: string; own: boolean; rows: IntegrationTokenRow[] }[] =
    [];
  if (ownTokens.length > 0) {
    groups.push({ ownerId: currentUserId, own: true, rows: ownTokens });
  }
  for (const ownerId of otherOwnerIds) {
    groups.push({
      ownerId,
      own: false,
      rows: tokens.filter((tok) => tok.user_id === ownerId),
    });
  }

  const revoke = (token: IntegrationTokenRow): void => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("token_id", token.id);
      fd.set("team_id", token.team_id);
      const result = (await revokeIntegrationTokenAction(
        fd,
      )) as unknown as RevokeResult;
      if (
        result &&
        typeof result === "object" &&
        "success" in result &&
        !result.success
      ) {
        // Verbatim message for UNKNOWN/CONFLICT-coded errors; i18n key
        // translation for structured ones (never render a raw key).
        const err = result.error;
        setError(
          err?.message ??
            (err?.userMessageKey
              ? translate(err.userMessageKey)
              : t("revokeFailed")),
        );
        return;
      }
      setConfirmingId(null);
      toast.push({ kind: "success", message: t("revokedToast") });
    });
  };

  return (
    <div
      className="overflow-x-auto rounded-lg border border-edge bg-surface-raised"
      tabIndex={0}
      role="region"
      aria-label={t("heading")}
    >
      <table className={tableClass}>
        <thead>
          <tr className={tableHeaderRowClass}>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.token")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.scopes")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.entries")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.created")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.expires")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.lastUsed")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-left`}>
              {t("columns.status")}
            </th>
            <th scope="col" className={`${tableHeaderCellClass} text-right`}>
              {t("columns.actions")}
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.ownerId}>
            <tr className="border-b border-edge bg-surface-inset/50">
              <th
                colSpan={8}
                scope="colgroup"
                className="px-4 py-2 text-left font-normal"
              >
                <span className="inline-flex items-center gap-2">
                  <EntryAuthor
                    author={
                      profileById.get(group.ownerId) ?? {
                        user_id: group.ownerId,
                        display_name: null,
                        avatar_url: null,
                      }
                    }
                  />
                  {group.own && (
                    <span className="text-caption font-semibold text-content-secondary">
                      — {t("yourTokens")}
                    </span>
                  )}
                </span>
              </th>
            </tr>
            {group.rows.map((token) => {
              const status = tokenStatus(token, now);
              const { classes, icon: StatusIcon } = STATUS_STYLE[status];
              const confirming = confirmingId === token.id;
              return (
                <tr
                  key={token.id}
                  className="border-b border-edge last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-content">
                      {token.name}
                    </div>
                    <code className="font-mono text-caption text-content-muted">
                      {token.token_prefix}…
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {token.scopes.map((scope) => (
                        <code
                          key={scope}
                          className="rounded bg-surface-inset px-1.5 py-0.5 font-mono text-caption text-content-secondary"
                        >
                          {scope}
                        </code>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-caption text-content-secondary">
                    {token.default_billable
                      ? t("billable")
                      : t("nonBillable")}
                  </td>
                  <td className="px-4 py-3 text-caption text-content-secondary">
                    <LocalDateTime value={token.created_at} />
                  </td>
                  <td className="px-4 py-3 text-caption text-content-secondary">
                    <LocalDateTime value={token.expires_at} />
                  </td>
                  <td className="px-4 py-3 text-caption text-content-secondary">
                    {token.last_used_at === null ? (
                      t("neverUsed")
                    ) : (
                      <LocalDateTime value={token.last_used_at} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${classes}`}
                    >
                      <StatusIcon size={12} aria-hidden="true" />
                      {t(`status.${status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {status === "active" &&
                      (confirming ? (
                        <div
                          className="flex flex-col items-end gap-1.5"
                          onKeyDown={(e) => {
                            if (e.key !== "Escape" || pending) return;
                            e.stopPropagation();
                            cancelConfirm();
                          }}
                        >
                          <span
                            id={`revoke-confirm-copy-${token.id}`}
                            className="text-caption text-content-muted"
                          >
                            {t("revokeConfirmCopy")}
                          </span>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              ref={confirmButtonRef}
                              onClick={() => revoke(token)}
                              disabled={pending}
                              aria-describedby={`revoke-confirm-copy-${token.id}`}
                              className={buttonDangerClass}
                            >
                              <Ban size={14} aria-hidden="true" />
                              {pending
                                ? t("revokePending")
                                : t("revokeConfirm")}
                            </button>
                            <button
                              type="button"
                              onClick={cancelConfirm}
                              disabled={pending}
                              className={buttonSecondaryClass}
                            >
                              {tc("actions.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) {
                              revokeButtonRefs.current.set(token.id, el);
                            } else {
                              revokeButtonRefs.current.delete(token.id);
                            }
                          }}
                          onClick={() => {
                            setError(null);
                            setConfirmingId(token.id);
                          }}
                          className={buttonDangerClass}
                        >
                          <Ban size={14} aria-hidden="true" />
                          {t("revoke")}
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {error && (
        <p role="alert" className="px-4 py-2 text-caption text-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
