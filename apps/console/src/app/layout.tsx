import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <style id="driver-theme" dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
