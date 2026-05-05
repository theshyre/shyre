"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import {
  Shield,
  CheckCircle,
  XCircle,
  Download,
  Copy,
  KeyRound,
} from "lucide-react";
import { Spinner } from "@theshyre/ui";
import {
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
} from "@/lib/form-styles";
import {
  generateBackupCodes,
  formatCodesForDownload,
} from "@/lib/backup-codes";
import { rewriteTotpUri } from "@/lib/mfa/totp-uri";

type MfaStep = "idle" | "verifying" | "show-backup-codes" | "enabled";

export function MfaSetup(): React.JSX.Element {
  const [step, setStep] = useState<MfaStep>("idle");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const t = useTranslations("settings.mfa");
  const router = useRouter();
  const supabase = createClient();

  const checkStatus = useCallback(async (): Promise<void> => {
    const { data, error: err } = await supabase.auth.mfa.listFactors();
    if (!err && data) {
      const verified = data.totp;
      const unverified = data.all.filter((f) => f.status === "unverified");

      for (const factor of unverified) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      setMfaEnabled(verified.length > 0);
      if (verified.length > 0) {
        setFactorId(verified[0]?.id ?? null);
      }
    }

    // Check remaining backup codes
    const { data: codes } = await supabase
      .from("mfa_backup_codes")
      .select("id")
      .is("used_at", null);
    setBackupCodesRemaining(codes?.length ?? 0);

    setCheckingStatus(false);
  }, [supabase]);

  useState(() => {
    checkStatus();
  });

  async function handleEnroll(): Promise<void> {
    setLoading(true);
    setError(null);

    const { data: existing } = await supabase.auth.mfa.listFactors();
    if (existing) {
      for (const factor of existing.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }

    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Shyre",
      issuer: "malcom.io",
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    if (data) {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email ?? "user";
      const rewrittenUri = rewriteTotpUri(data.totp.uri, {
        email,
        issuer: "malcom.io",
      });
      setQrUri(rewrittenUri);
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

    // MFA verified — generate backup codes
    const { plainCodes, hashedCodes } = await generateBackupCodes();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // Delete any existing backup codes
      await supabase
        .from("mfa_backup_codes")
        .delete()
        .eq("user_id", user.id);

      // Store hashed codes
      const rows = hashedCodes.map((hash) => ({
        user_id: user.id,
        code_hash: hash,
      }));
      await supabase.from("mfa_backup_codes").insert(rows);
    }

    setBackupCodes(plainCodes);
    setBackupCodesRemaining(plainCodes.length);
    setStep("show-backup-codes");
    setMfaEnabled(true);
    setLoading(false);
  }

  async function handleDisable(): Promise<void> {
    if (!factorId) return;
    if (
      !confirm(
        "Disable MFA? This will remove the second factor and all backup codes."
      )
    ) {
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

    // Delete backup codes
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("mfa_backup_codes")
        .delete()
        .eq("user_id", user.id);
    }

    setMfaEnabled(false);
    setStep("idle");
    setFactorId(null);
    setQrUri(null);
    setCode("");
    setBackupCodes([]);
    setBackupCodesRemaining(0);
    setLoading(false);
    router.refresh();
  }

  async function handleRegenerateBackupCodes(): Promise<void> {
    if (
      !confirm(
        "Regenerate backup codes? This will invalidate all existing codes."
      )
    ) {
      return;
    }

    setLoading(true);
    const { plainCodes, hashedCodes } = await generateBackupCodes();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("mfa_backup_codes")
        .delete()
        .eq("user_id", user.id);

      const rows = hashedCodes.map((hash) => ({
        user_id: user.id,
        code_hash: hash,
      }));
      await supabase.from("mfa_backup_codes").insert(rows);
    }

    setBackupCodes(plainCodes);
    setBackupCodesRemaining(plainCodes.length);
    setStep("show-backup-codes");
    setLoading(false);
  }

  function handleDownloadCodes(): void {
    const text = formatCodesForDownload(backupCodes, "Shyre");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shyre-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyCodes(): Promise<void> {
    const text = backupCodes.join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (checkingStatus) {
    return (
      <div className="flex items-center gap-2 text-body-lg text-content-muted">
        <Spinner size="h-3.5 w-3.5" />
        Loading...
      </div>
    );
  }

  // Show backup codes after enrollment or regeneration
  if (step === "show-backup-codes" && backupCodes.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-caption font-medium text-success">
            <CheckCircle size={12} />
            {t("enabled")}
          </span>
        </div>

        <div className="rounded-lg border border-warning/30 bg-warning-soft p-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound size={16} className="text-warning" />
            <h3 className="text-body-lg font-semibold text-warning">
              Save your backup codes
            </h3>
          </div>
          <p className="text-body-lg text-content-secondary mb-3">
            Store these codes somewhere safe. Each code can only be used once.
            If you lose access to your authenticator app, use a backup code to
            sign in.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-edge bg-surface p-3 font-mono text-body-lg">
            {backupCodes.map((c, i) => (
              <div key={i} className="text-content">
                {c}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleDownloadCodes}
              className={buttonPrimaryClass}
            >
              <Download size={16} />
              Download
            </button>
            <button
              onClick={handleCopyCodes}
              className={buttonSecondaryClass}
            >
              <Copy size={16} />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => {
                setStep("enabled");
                setBackupCodes([]);
              }}
              className={buttonSecondaryClass}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MFA is enabled
  if (mfaEnabled && (step === "idle" || step === "enabled")) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-caption font-medium text-success">
            <CheckCircle size={12} />
            {t("enabled")}
          </span>
          {backupCodesRemaining > 0 && (
            <span className="text-caption text-content-muted">
              {backupCodesRemaining} backup codes remaining
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRegenerateBackupCodes}
            disabled={loading}
            className={buttonSecondaryClass}
          >
            <KeyRound size={16} />
            {loading ? "..." : "Regenerate Backup Codes"}
          </button>
          <button
            onClick={handleDisable}
            disabled={loading}
            className={buttonDangerClass}
          >
            <XCircle size={16} />
            {loading ? "..." : t("disable")}
          </button>
        </div>
        {error && <p className="mt-2 text-body-lg text-error">{error}</p>}
      </div>
    );
  }

  // Verifying — show QR and code input
  if (step === "verifying" && qrUri) {
    return (
      <div className="space-y-4">
        <h3 className="text-body-lg font-medium text-content">{t("setupTitle")}</h3>

        <div className="flex flex-col items-center gap-4 rounded-lg border border-edge bg-surface p-6">
          <p className="text-body-lg text-content-secondary text-center">
            {t("scanQR")}
          </p>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={qrUri} size={200} />
          </div>
        </div>

        <div>
          <label htmlFor="components-MfaSetup-enterCode" className={labelClass}>{t("enterCode")}</label>
          <input id="components-MfaSetup-enterCode"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder={t("codePlaceholder")}
            className={`${inputClass} max-w-[200px] text-center font-mono text-title tracking-widest`}
            autoFocus
          />
        </div>

        {error && <p className="text-body-lg text-error">{error}</p>}

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
            onClick={async () => {
              if (factorId) {
                await supabase.auth.mfa.unenroll({ factorId });
              }
              setStep("idle");
              setFactorId(null);
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
      <p className="text-body-lg text-content-secondary mb-3">
        {t("description")}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-0.5 text-caption font-medium text-warning">
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
      {error && <p className="mt-2 text-body-lg text-error">{error}</p>}
    </div>
  );
}
