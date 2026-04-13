"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";

type MfaStep = "idle" | "enrolling" | "verifying" | "enabled";

export function MfaSetup(): React.JSX.Element {
  const [step, setStep] = useState<MfaStep>("idle");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const t = useTranslations("settings.mfa");
  const router = useRouter();
  const supabase = createClient();

  // Check current MFA status on mount
  const checkStatus = useCallback(async (): Promise<void> => {
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (!err && data) {
      const verified = data.totp.filter((f) => f.status === "verified");
      setMfaEnabled(verified.length > 0);
      if (verified.length > 0) {
        setFactorId(verified[0]?.id ?? null);
      }
    }
    setCheckingStatus(false);
  }, [supabase]);

  // Run check on mount
  useState(() => {
    checkStatus();
  });

  async function handleEnroll(): Promise<void> {
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Stint",
      issuer: "stint.malcom.io",
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (data) {
      setQrUri(data.totp.uri);
      setFactorId(data.id);
      setStep("verifying");
    }
    setLoading(false);
  }

  async function handleVerify(): Promise<void> {
    if (!factorId || code.length !== 6) return;

    setLoading(true);
    setError(null);

    const { data: challenge, error: challengeErr } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeErr) {
      setError(challengeErr.message);
      setLoading(false);
      return;
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyErr) {
      setError(verifyErr.message);
      setLoading(false);
      return;
    }

    setStep("enabled");
    setMfaEnabled(true);
    setLoading(false);
    router.refresh();
  }

  async function handleDisable(): Promise<void> {
    if (!factorId) return;
    if (!confirm("Disable MFA? This will remove the second factor from your account.")) {
      return;
    }

    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.mfa.unenroll({
      factorId,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    setMfaEnabled(false);
    setStep("idle");
    setFactorId(null);
    setQrUri(null);
    setCode("");
    setLoading(false);
    router.refresh();
  }

  if (checkingStatus) {
    return (
      <div className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 size={14} className="animate-spin" />
        Loading...
      </div>
    );
  }

  // MFA is already enabled
  if (mfaEnabled && step !== "enabled") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
            <CheckCircle size={12} />
            {t("enabled")}
          </span>
        </div>
        <button
          onClick={handleDisable}
          disabled={loading}
          className={buttonDangerClass}
        >
          <XCircle size={16} />
          {loading ? "..." : t("disable")}
        </button>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
      </div>
    );
  }

  // Just enabled — success message
  if (step === "enabled") {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
          <CheckCircle size={12} />
          {t("enabled")}
        </span>
        <span className="text-sm text-success">{t("verified")}</span>
      </div>
    );
  }

  // Verifying — show QR and code input
  if (step === "verifying" && qrUri) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-content">{t("setupTitle")}</h3>

        <div className="flex flex-col items-center gap-4 rounded-lg border border-edge bg-surface p-6">
          <p className="text-sm text-content-secondary text-center">
            {t("scanQR")}
          </p>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={qrUri} size={200} />
          </div>
        </div>

        <div>
          <label className={labelClass}>{t("enterCode")}</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder={t("codePlaceholder")}
            className={`${inputClass} max-w-[200px] text-center font-mono text-lg tracking-widest`}
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className={buttonPrimaryClass}
          >
            <Shield size={16} />
            {loading ? "..." : t("verify")}
          </button>
          <button
            onClick={() => {
              setStep("idle");
              setQrUri(null);
              setCode("");
              setError(null);
            }}
            className={buttonSecondaryClass}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Idle — show enable button
  return (
    <div>
      <p className="text-sm text-content-secondary mb-3">
        {t("description")}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {t("disabled")}
        </span>
      </div>
      <button
        onClick={handleEnroll}
        disabled={loading}
        className={buttonSecondaryClass}
      >
        <Shield size={16} />
        {loading ? "..." : t("enable")}
      </button>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
