import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { loadSignGate, loadSignBundle } from "@/lib/proposals/sign-service";
import { viewSessionCookieName } from "@/lib/proposals/tokens";
import { SignExperience } from "./sign-experience";
import { SignGate } from "./sign-gate";

// Generic label — customer/business names stay out of browser history and
// OS window switchers (same posture as the sensitive dashboard surfaces).
export const metadata: Metadata = { title: "Proposal sign-off" };

// A sign link must always reflect live token state (OTP progress, consumed,
// expiry) — never a cached render.
export const dynamic = "force-dynamic";

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const t = await getTranslations("proposals.sign");

  // Identity gate (SAL-045): the proposal content is NOT loaded until the
  // browser proves a verified view session. The gate call validates the token
  // and returns only the sender's branding + masked recipient.
  const cookieStore = await cookies();
  const cookieValue =
    cookieStore.get(viewSessionCookieName(token))?.value ?? null;
  const gate = await loadSignGate(token, cookieValue);

  if (!gate.ok) {
    // Deliberately coarse: don't distinguish unknown / revoked / expired to
    // a probing caller beyond what the signer needs to self-serve.
    const message =
      gate.reason === "expired" ? t("linkExpired") : t("linkInvalid");
    return (
      <main className="mx-auto flex min-h-full max-w-[480px] flex-col items-center justify-center gap-3 px-[24px] text-center">
        <ShieldAlert size={32} aria-hidden="true" className="text-content-muted" />
        <h1 className="text-title font-semibold text-content">
          {t("linkProblemHeading")}
        </h1>
        <p className="text-body text-content-secondary">{message}</p>
        <p className="text-caption text-content-muted">{t("linkProblemHint")}</p>
      </main>
    );
  }

  // Not a verified browser → identity check only. No pricing/scope reaches the
  // client until they enter the emailed code.
  if (!gate.value.verified) {
    return <SignGate token={token} info={gate.value} />;
  }

  // Verified: now safe to load + render the full document.
  const result = await loadSignBundle(token);
  if (!result.ok) {
    const message =
      result.reason === "expired" ? t("linkExpired") : t("linkInvalid");
    return (
      <main className="mx-auto flex min-h-full max-w-[480px] flex-col items-center justify-center gap-3 px-[24px] text-center">
        <ShieldAlert size={32} aria-hidden="true" className="text-content-muted" />
        <h1 className="text-title font-semibold text-content">
          {t("linkProblemHeading")}
        </h1>
        <p className="text-body text-content-secondary">{message}</p>
        <p className="text-caption text-content-muted">{t("linkProblemHint")}</p>
      </main>
    );
  }

  return <SignExperience token={token} bundle={result.value} />;
}
