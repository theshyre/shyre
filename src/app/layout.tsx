import type { Metadata } from "next";
// Geist is self-hosted via the official `geist` npm package rather
// than `next/font/google`. The Google variant requires a build-time
// fetch from fonts.googleapis.com which fails closed in sandboxed
// CI/runtime environments and adds a third-party dependency to the
// build. `geist` ships the same font files locally and exposes
// matching `--font-geist-sans` / `--font-geist-mono` CSS variables.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { buildAntiFlashScript } from "@theshyre/theme";
import { ThemeProvider } from "@/components/theme-provider";
import { TextSizeProvider } from "@/components/text-size-provider";
import { TopProgressBar } from "@/components/TopProgressBar";
import "./globals.css";

export const metadata: Metadata = {
  // Per-route metadata exports return a bare page label (e.g. "Invoices",
  // "INV-2026-001"); Next composes that into "<page> · Shyre" via the
  // template. Routes that omit metadata fall back to `default`.
  // Sensitive surfaces (Identity, Period locks, People, /admin/*) set
  // their own generic label to avoid leaking customer / business
  // names into browser history + OS window switchers.
  title: {
    default: "Shyre",
    template: "%s · Shyre",
  },
  description:
    "Shyre — platform for running a consulting business. Time tracking, customers, invoicing.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): Promise<React.JSX.Element> {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: buildAntiFlashScript({
              themeKey: "stint-theme",
              textSizeKey: "stint-text-size",
            }),
          }}
        />
      </head>
      <body className="h-full bg-surface text-content">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <TextSizeProvider>
              <TopProgressBar />
              {children}
            </TextSizeProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
