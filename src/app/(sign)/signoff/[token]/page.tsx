import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";

import {
  loadSignGate,
  loadSignBundle,
} from "@/lib/sign/signoff-sign-service";
import { viewSessionCookieName } from "@/lib/sign/tokens";
import { SignoffSignExperience } from "./sign-experience";
import { SignoffSignGate } from "./sign-gate";

// Generic label — document/customer names stay out of browser history + OS
// window switchers (same posture as the proposals sign page).
export const metadata: Metadata = { title: "Document sign-off" };

// A sign link must reflect live token state (OTP progress, consumed, expiry).
export const dynamic = "force-dynamic";

type SignTheme = "light" | "dark" | "warm";

function ThemedShell({ theme, children }: { theme: SignTheme; children: ReactNode }): React.JSX.Element {
  return (
    <div data-theme={theme} data-sign-surface className="min-h-screen bg-surface text-content">
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

export default async function SignoffSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const t = await getTranslations("signoff.sign");

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(viewSessionCookieName(token))?.value ?? null;
  const gate = await loadSignGate(token, cookieValue);

  if (!gate.ok) {
    return (
      <ThemedShell theme="light">
        <LinkProblem
          heading={t("linkProblemHeading")}
          message={gate.reason === "expired" ? t("linkExpired") : t("linkInvalid")}
          hint={t("linkProblemHint")}
        />
      </ThemedShell>
    );
  }

  const theme = gate.value.signTheme;

  if (!gate.value.verified) {
    return (
      <ThemedShell theme={theme}>
        <SignoffSignGate token={token} info={gate.value} />
      </ThemedShell>
    );
  }

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
      <SignoffSignExperience token={token} bundle={result.value} />
    </ThemedShell>
  );
}
