import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { t } from '@driver/i18n';
import { Providers } from '@/lib/providers';
import './globals.css';

export const metadata: Metadata = {
  title: `${t('app.console')} · Driver Console`,
  description: 'لوحة التحكم — الإرسال والدعم والمالية',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar-IQ" dir="rtl">
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
