import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
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
  title: "Shyre",
  description: "Shyre — platform for running a consulting business. Time tracking, customers, invoicing.",
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
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('stint-theme') || 'system';
                  var resolved = theme;
                  if (theme === 'system') {
                    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  document.documentElement.setAttribute('data-theme', resolved);
                  var size = localStorage.getItem('stint-text-size');
                  if (size === 'compact' || size === 'regular' || size === 'large') {
                    var sizes = { compact: '14px', regular: '16px', large: '18px' };
                    document.documentElement.style.fontSize = sizes[size];
                    document.documentElement.setAttribute('data-text-size', size);
                  }
                } catch (e) {}
              })();
            `,
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
