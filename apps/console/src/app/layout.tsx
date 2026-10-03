import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { t } from '@driver/i18n';
import { Providers } from '@/lib/providers';
import { Shell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.console')} · Driver Console`,
  description: 'لوحة التحكم — الإرسال والدعم والمالية',
};

export const viewport: Viewport = { themeColor: '#1A1917' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar-IQ" dir="rtl">
      <body className="min-h-screen font-sans">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
