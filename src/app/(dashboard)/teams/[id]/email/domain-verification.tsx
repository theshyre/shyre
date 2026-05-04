"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Globe,
  Check,
  AlertCircle,
  Clock,
  Copy,
  RefreshCw,
} from "lucide-react";
import { AlertBanner } from "@theshyre/ui";
import {
  inputClass,
  labelClass,
  buttonSecondaryClass,
} from "@/lib/form-styles";
import { Tooltip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { assertActionResult } from "@/lib/action-result";
import { addEmailDomainAction, verifyEmailDomainAction } from "./actions";

interface DomainRow {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  dnsRecords: Array<{
    type: string;
    name: string;
    value: string;
    purpose: string;
    /** MX records require a priority. Resend returns 10 for its
     *  return-path MX. TXT / CNAME rows have it undefined. */
    priority?: number;
  }>;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  failureReason: string | null;
}

export function DomainVerification({
  teamId,
  domains,
  hasApiKey,
}: {
  teamId: string;
  domains: DomainRow[];
  hasApiKey: boolean;
}): React.JSX.Element {
  const t = useTranslations("messaging");
  const toast = useToast();
  const [domainInput, setDomainInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingVerifyId, setPendingVerifyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Persistent error banner. Toasts auto-dismiss; this stays put
  // until the user clears it or the next try succeeds — important
  // for cipher-decryption failures where the user has to go re-
  // paste their API key in another section of the page.
  const [actionError, setActionError] = useState<string | null>(null);

  async function onAdd(): Promise<void> {
    if (!hasApiKey) {
      toast.push({ kind: "error", message: t("domain.needsApiKey") });
      return;
    }
    if (!domainInput.trim()) return;
    setAdding(true);
    setActionError(null);
    try {
      const fd = new FormData();
      fd.set("team_id", teamId);
      fd.set("domain", domainInput.trim());
      await assertActionResult(addEmailDomainAction(fd));
      setDomainInput("");
      toast.push({ kind: "success", message: t("domain.added") });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("domain.addFailed");
      setActionError(message);
      toast.push({ kind: "error", message });
    } finally {
      setAdding(false);
    }
  }

  function onVerify(domainId: string): void {
    setPendingVerifyId(domainId);
    setActionError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("team_id", teamId);
        fd.set("domain_id", domainId);
        await assertActionResult(verifyEmailDomainAction(fd));
        toast.push({ kind: "success", message: t("domain.rechecked") });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("domain.recheckFailed");
        setActionError(message);
        toast.push({ kind: "error", message });
      } finally {
        setPendingVerifyId(null);
      }
    });
  }

  function copy(text: string): void {
    navigator.clipboard.writeText(text);
    toast.push({ kind: "success", message: t("domain.copied") });
  }

  return (
    <section className="rounded-lg border border-edge bg-surface-raised p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-accent" />
        <h2 className="text-label font-semibold uppercase tracking-wider text-content-muted">
          {t("domain.heading")}
        </h2>
      </div>
      <p className="text-caption text-content-muted">
        {t("domain.intro")}
      </p>
      <p className="text-caption text-content-muted italic">
        {t("domain.propagationNote")}
      </p>

      {actionError && (
        <AlertBanner tone="error">{actionError}</AlertBanner>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
        <div>
          <label className={labelClass} htmlFor="domain_input">
            {t("domain.addLabel")}
          </label>
          <input
            id="domain_input"
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="malcom.io"
            className={inputClass}
            disabled={!hasApiKey}
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !hasApiKey || !domainInput.trim()}
          className={buttonSecondaryClass}
        >
          {adding ? t("domain.adding") : t("domain.addButton")}
        </button>
      </div>

      {domains.length === 0 ? (
        <p className="text-caption text-content-muted italic">
          {t("domain.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <div
              key={d.id}
              className="rounded-md border border-edge bg-surface p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DomainStatusIcon status={d.status} />
                  <span className="text-body font-medium font-mono">
                    {d.domain}
                  </span>
                  <DomainStatusBadge status={d.status} />
                </div>
                {d.status !== "verified" && (
                  <button
                    type="button"
                    onClick={() => onVerify(d.id)}
                    disabled={pendingVerifyId === d.id}
                    className={buttonSecondaryClass}
                  >
                    <RefreshCw
                      size={12}
                      className={pendingVerifyId === d.id ? "animate-spin" : ""}
                    />
                    {pendingVerifyId === d.id
                      ? t("domain.rechecking")
                      : t("domain.recheck")}
                  </button>
                )}
              </div>

              {d.failureReason && (
                <p className="text-caption text-error">{d.failureReason}</p>
              )}

              {d.status !== "verified" && d.dnsRecords.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-caption text-content-muted">
                    {t("domain.recordsIntro")}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-caption">
                      <thead>
                        <tr className="text-content-muted">
                          <th className="text-left py-1 pr-3">
                            {t("domain.colType")}
                          </th>
                          <th className="text-left py-1 pr-3">
                            {t("domain.colName")}
                          </th>
                          <th className="text-left py-1 pr-3">
                            {t("domain.colPriority")}
                          </th>
                          <th className="text-left py-1 pr-3">
                            {t("domain.colValue")}
                          </th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {d.dnsRecords.map((r, i) => (
                          <tr key={i} className="align-top">
                            <td className="py-1 pr-3 font-mono">{r.type}</td>
                            <td className="py-1 pr-3 font-mono break-all">
                              {r.name}
                            </td>
                            <td className="py-1 pr-3 font-mono">
                              {r.priority != null ? (
                                r.priority
                              ) : (
                                <span className="text-content-muted">—</span>
                              )}
                            </td>
                            <td className="py-1 pr-3 font-mono break-all">
                              {r.value}
                            </td>
                            <td className="py-1">
                              <Tooltip label={t("domain.copy")}>
                                <button
                                  type="button"
                                  onClick={() => copy(r.value)}
                                  className="text-content-muted hover:text-content"
                                  aria-label={t("domain.copy")}
                                >
                                  <Copy size={12} />
                                </button>
                              </Tooltip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-caption text-content-muted italic">
                    {t("domain.priorityHint")}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DomainStatusIcon({
  status,
}: {
  status: "pending" | "verified" | "failed";
}): React.JSX.Element {
  if (status === "verified") return <Check size={14} className="text-success" />;
  if (status === "failed") return <AlertCircle size={14} className="text-error" />;
  return <Clock size={14} className="text-warning" />;
}

function DomainStatusBadge({
  status,
}: {
  status: "pending" | "verified" | "failed";
}): React.JSX.Element {
  const map = {
    verified: "bg-success-soft text-success",
    pending: "bg-warning-soft text-warning",
    failed: "bg-error-soft text-error",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium ${map[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
