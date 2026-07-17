"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Send, X, CircleAlert, Mail } from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonGhostClass,
  kbdClass,
} from "@/lib/form-styles";
import { assertActionResult } from "@/lib/action-result";
import { sendProposalAction } from "./actions";

/** Panel geometry — px per the layout-in-px rule so the confirm stays a
 *  constant width under the user's text-size preference. */
const PANEL_WIDTH = 320;
const PANEL_GAP = 8;
/** Only used to pick flip direction (open below vs. above); actual
 *  placement anchors to the trigger, so the estimate can be generous. */
const PANEL_EST_HEIGHT = 220;

interface Props {
  proposalId: string;
  /** Translated "what's still missing before this can go out" messages.
   *  Empty means the draft is ready to send; non-empty routes the panel
   *  to a readiness checklist instead of the confirm. */
  blockers: string[];
  /** The signer's email — restated in the confirm panel (visible line +
   *  the confirm button's accessible name) so a misfire can't email the
   *  wrong person, and never armed when null. */
  signerEmail: string | null;
}

/**
 * "Send for sign-off" — the confirm lives in an anchored popover, not
 * inline in the action bar. The trigger keeps a constant width so
 * Preview / PDF / Edit / Delete never reflow when the confirm opens
 * (the old inline confirm grew the row and shifted every button right).
 *
 * The panel is a `role="dialog"` restating the recipient + the freeze
 * consequence as visible text (not a tooltip — touch users must see it),
 * and it doubles as the home for the not-ready checklist so the trigger
 * never needs to be a natively-disabled button that can't explain itself.
 *
 * Portaled to `document.body` and `fixed`-positioned so the scrolling
 * `<main>`'s `overflow-y-auto` can't clip it — same idiom as
 * `ThemePickerPopover` / `entry-kebab-menu`. Escape / outside-click /
 * scroll / resize close it; Cmd/Ctrl+Enter confirms.
 */
export function SendProposalButton({
  proposalId,
  blockers,
  signerEmail,
}: Props): React.JSX.Element {
  const t = useTranslations("proposals.detail");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const headingId = useId();
  const descId = useId();

  const ready = blockers.length === 0;
  // Readiness already requires a signer, but never arm a send to nobody —
  // an empty recipient would email "—".
  const canSend = ready && !!signerEmail;

  const close = useCallback(() => {
    // Don't yank the panel out from under an in-flight request — the
    // email is already going out; keep the "Sending…" state visible.
    if (pending) return;
    setOpen(false);
    setPanelPos(null);
    // Return focus to the trigger so keyboard users keep their place.
    triggerRef.current?.focus();
  }, [pending]);

  const doSend = useCallback((): void => {
    if (!canSend || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", proposalId);
        await assertActionResult(sendProposalAction(fd));
        // Success: the proposal leaves `editable`, so this whole button
        // (and its portaled panel) is about to unmount on the server
        // re-render. Announce via the toast live-region and move focus
        // to the stable page shell so it doesn't fall to <body>.
        toast.push({
          kind: "success",
          message: t("sendSuccessToast", { email: signerEmail ?? "" }),
        });
        setOpen(false);
        setPanelPos(null);
        document.getElementById("main-content")?.focus();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("sendFailed"));
      }
    });
  }, [canSend, pending, proposalId, signerEmail, t, toast]);

  function computePanelPos(): { top: number; left: number } | null {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    // Right-edge align to the trigger; open below, flip above when it
    // would clip off the bottom of the viewport.
    const fitsBelow =
      rect.bottom + PANEL_GAP + PANEL_EST_HEIGHT < window.innerHeight - 8;
    const top = fitsBelow
      ? rect.bottom + PANEL_GAP
      : Math.max(8, rect.top - PANEL_GAP - PANEL_EST_HEIGHT);
    const left = Math.max(8, rect.right - PANEL_WIDTH);
    return { top, left };
  }

  function toggle(): void {
    if (open) {
      close();
      return;
    }
    setError(null);
    const pos = computePanelPos();
    if (pos) {
      setPanelPos(pos);
      setOpen(true);
    }
  }

  // Escape / outside-click / scroll / resize close; Cmd-Ctrl+Enter
  // confirms. Escape + outside are inert while pending (request already
  // dispatched) — `close()` guards that internally.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        close();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    }
    function onClick(e: MouseEvent): void {
      const target = e.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) close();
    }
    function onScrollOrResize(): void {
      close();
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close, doSend]);

  // On open, focus the heading — NOT the confirm button — so a reflexive
  // Enter right after opening can't fire an irreversible send, and the
  // screen reader announces the dialog name + description first.
  useEffect(() => {
    if (open && panelPos) headingRef.current?.focus();
  }, [open, panelPos]);

  const panel = open && panelPos && (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      aria-describedby={descId}
      style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH }}
      className="fixed z-50 rounded-lg border border-edge bg-surface-raised p-4 shadow-lg"
    >
      <h2
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="text-body-lg font-medium text-content focus:outline-none"
      >
        {canSend ? t("sendConfirmHeading") : t("sendChecklistIntro")}
      </h2>

      {canSend ? (
        <>
          <div id={descId} className="mt-3 flex flex-col gap-2">
            <p className="flex flex-wrap items-center gap-1.5 text-caption text-content-secondary">
              <Mail size={14} aria-hidden="true" className="shrink-0" />
              <span>{t("sendTo")}</span>
              <span className="font-mono text-body text-content break-all">
                {signerEmail}
              </span>
            </p>
            <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2">
              <CircleAlert
                size={14}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-warning"
              />
              <span className="text-caption text-content-secondary">
                {t("sendFreezeNote")}
              </span>
            </p>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className={`${buttonGhostClass}${pending ? " opacity-70" : ""}`}
              aria-disabled={pending}
              onClick={close}
            >
              <X size={16} aria-hidden="true" />
              {t("sendCancel")}
            </button>
            <button
              type="button"
              className={`${buttonPrimaryClass}${pending ? " opacity-70 cursor-wait" : ""}`}
              aria-busy={pending}
              aria-disabled={pending}
              // Recipient is in the accessible name at the moment of
              // action; the visible label stays short + stable. Label-in-
              // Name holds ("Send now" ⊆ "Send now to …").
              aria-label={
                pending ? undefined : t("sendConfirmAria", { email: signerEmail })
              }
              onClick={doSend}
            >
              <Send size={16} aria-hidden="true" />
              {pending ? t("sending") : t("sendConfirmCta")}
              <span className={kbdClass} aria-hidden="true">
                {t("sendKbd")}
              </span>
            </button>
          </div>
          {error && (
            <p
              role="alert"
              className="mt-2 flex items-center gap-1.5 text-caption text-error"
            >
              <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <ul id={descId} className="mt-3 flex flex-col gap-1.5">
            {blockers.map((b, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-caption text-content-secondary"
              >
                <CircleAlert
                  size={12}
                  aria-hidden="true"
                  className="shrink-0 text-warning"
                />
                {b}
              </li>
            ))}
            {ready && !signerEmail && (
              <li className="flex items-center gap-1.5 text-caption text-content-secondary">
                <CircleAlert
                  size={12}
                  aria-hidden="true"
                  className="shrink-0 text-warning"
                />
                {t("sendNeedsSigner")}
              </li>
            )}
          </ul>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" className={buttonGhostClass} onClick={close}>
              {t("sendClose")}
            </button>
            {/* Disabled preview of the real CTA so the "finish the list →
                this lights up" relationship is legible. The reason is the
                visible checklist right above it. */}
            <button type="button" className={buttonPrimaryClass} disabled>
              <Send size={16} aria-hidden="true" />
              {t("send")}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={canSend ? buttonPrimaryClass : buttonSecondaryClass}
      >
        {canSend ? (
          <Send size={16} aria-hidden="true" />
        ) : (
          <CircleAlert size={16} aria-hidden="true" className="text-warning" />
        )}
        {t("send")}
      </button>
      {typeof document !== "undefined" && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
