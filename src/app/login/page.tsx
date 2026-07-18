"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass, labelClass, buttonPrimaryClass } from "@/lib/form-styles";
import { LogIn, UserPlus, CircleAlert, MailCheck } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function LoginPage(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Success/info messaging ("check your email") gets its OWN channel — it
  // used to render through the error slot in red with role="alert", which
  // miscoded a success as a failure on every channel (color, icon-less,
  // assertive announcement).
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const t = useTranslations("auth");
  const tc = useTranslations("common");

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    const { error: authError } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (isSignUp) {
      setNotice(t("checkEmailConfirmation"));
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-[384px] space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={64} className="text-accent" />
          <h1 className="text-page-title font-bold tracking-tight text-content">
            {tc("appName")}
          </h1>
          <p className="text-content-secondary">{tc("appTagline")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className={labelClass}>
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder={t("emailPlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={t("passwordPlaceholder")}
            />
          </div>

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 text-body-lg text-error-text"
            >
              <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-body-lg text-success-text"
            >
              <MailCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`${buttonPrimaryClass} w-full justify-center`}
          >
            {isSignUp ? (
              <>
                <UserPlus size={16} />
                {loading ? t("creatingAccount") : t("signUp")}
              </>
            ) : (
              <>
                <LogIn size={16} />
                {loading ? t("signingIn") : t("signIn")}
              </>
            )}
          </button>
        </form>

        <p className="text-center text-body-lg text-content-secondary">
          {isSignUp ? t("alreadyHaveAccount") : t("dontHaveAccount")}{" "}
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setNotice(null);
            }}
            className="text-accent hover:underline"
          >
            {isSignUp ? t("signIn") : t("signUp")}
          </button>
        </p>
      </div>
    </div>
  );
}
