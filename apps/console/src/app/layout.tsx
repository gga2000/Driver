import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { themes } from '@driver/design-tokens';
import { t } from '@driver/i18n';
// IBM Plex Sans Arabic, the same files the apps' web builds use (S-19): Arabic + Latin subsets per weight.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import { Providers } from '@/lib/providers';
import { PREPAINT_SCRIPT } from '@/lib/prefs-keys';
import { CrashReporting } from '@/components/crash-panel';
import { Shell } from '@/components/shell';
import { themeCss } from '@/theme/palette';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.console')} · Driver Console`,
  description: 'لوحة التحكم — الإرسال والدعم والمالية',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: themes.light.bg },
    { media: '(prefers-color-scheme: dark)', color: themes.dark.bg },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The CSP nonce from src/middleware.ts (CON-06): the pre-paint script must carry it to run. Browsers
  // hide a nonce from the DOM once read, so React would report it as a mismatch: the two tags opt out.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="ar-IQ"
      dir="rtl"
      data-theme="light"
      data-density="comfortable"
      suppressHydrationWarning
    >
      <head>
        {/* Theme variables generated from @driver/design-tokens at build time (src/theme/palette.ts). */}
        <style id="driver-theme" nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>
          {/* Crash reports: a no-op until NEXT_PUBLIC_SENTRY_DSN is set (src/lib/crash.ts). */}
          <CrashReporting />
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
