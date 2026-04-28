import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { buildAntiFlashScript } from "@theshyre/theme";
import { ThemeProvider } from "@/components/theme-provider";
import { TextSizeProvider } from "@/components/text-size-provider";
import { TopProgressBar } from "@/components/TopProgressBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
