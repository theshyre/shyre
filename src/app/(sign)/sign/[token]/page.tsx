import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { loadSignGate, loadSignBundle } from "@/lib/proposals/sign-service";
import { viewSessionCookieName } from "@/lib/proposals/tokens";
import {
  DEFAULT_SIGN_THEME,
  type SignTheme,
} from "@/lib/proposals/allow-lists";
import { SignExperience } from "./sign-experience";
import { SignGate } from "./sign-gate";

// Generic label — customer/business names stay out of browser history and
// OS window switchers (same posture as the sensitive dashboard surfaces).
export const metadata: Metadata = { title: "Proposal sign-off" };

// A sign link must always reflect live token state (OTP progress, consumed,
// expiry) — never a cached render.
export const dynamic = "force-dynamic";

/**
 * Pins the whole /sign surface to the proposal's author-chosen theme by setting
 * `data-theme` on a full-viewport wrapper. The theme tokens are `[data-theme]`
 * attribute selectors, so this overrides the visitor's OS light/dark preference
 * for this subtree — server-rendered, so there's no flash — and `bg-surface`
 * on the min-h-screen wrapper paints the whole viewport in the pinned theme
 * (covering the root `<body>` background behind it). A client-facing document
 * should look consistent, not drift with each recipient's device.
 */
function ThemedShell({
  theme,
  children,
}: {
  theme: SignTheme;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      data-theme={theme}
      // Hook for the prefers-contrast: more override in globals.css — a
      // visitor's OS contrast preference beats the author's pinned theme.
      data-sign-surface
      className="min-h-screen bg-surface text-content"
    >
      {children}
    </div>
  );
}

function LinkProblem({
  heading,
  message,
  hint,
}: {
  heading: string;
  message: string;
  hint: string;
}): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center gap-3 px-[24px] text-center">
      <ShieldAlert size={32} aria-hidden="true" className="text-content-muted" />
      <h1 className="text-title font-semibold text-content">{heading}</h1>
      <p className="text-body text-content-secondary">{message}</p>
      <p className="text-caption text-content-muted">{hint}</p>
    </main>
  );
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const t = await getTranslations("proposals.sign");

  // Identity gate (SAL-045): the proposal content is NOT loaded until the
  // browser proves a verified view session. The gate call validates the token
  // and returns only the sender's branding + masked recipient (+ pinned theme).
  const cookieStore = await cookies();
  const cookieValue =
    cookieStore.get(viewSessionCookieName(token))?.value ?? null;
  const gate = await loadSignGate(token, cookieValue);

  if (!gate.ok) {
    // Deliberately coarse: don't distinguish unknown / revoked / expired to
    // a probing caller beyond what the signer needs to self-serve. No proposal
    // loaded → the default look.
    return (
      <ThemedShell theme={DEFAULT_SIGN_THEME}>
        <LinkProblem
          heading={t("linkProblemHeading")}
          message={gate.reason === "expired" ? t("linkExpired") : t("linkInvalid")}
          hint={t("linkProblemHint")}
        />
      </ThemedShell>
    );
  }

  const theme = gate.value.signTheme;

  // Not a verified browser → identity check only. No pricing/scope reaches the
  // client until they enter the emailed code.
  if (!gate.value.verified) {
    return (
      <ThemedShell theme={theme}>
        <SignGate token={token} info={gate.value} />
      </ThemedShell>
    );
  }

  // Verified: now safe to load + render the full document.
  const result = await loadSignBundle(token);
  if (!result.ok) {
    return (
      <ThemedShell theme={theme}>
        <LinkProblem
          heading={t("linkProblemHeading")}
          message={result.reason === "expired" ? t("linkExpired") : t("linkInvalid")}
          hint={t("linkProblemHint")}
        />
      </ThemedShell>
    );
  }

  return (
    <ThemedShell theme={result.value.signTheme}>
      <SignExperience token={token} bundle={result.value} />
    </ThemedShell>
  );
}
