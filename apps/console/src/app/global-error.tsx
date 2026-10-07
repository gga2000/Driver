'use client';

import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import { CrashPanel } from '@/components/crash-panel';
import { themeCss } from '@/theme/palette';
import './globals.css';

/** The root layout itself broke: this replaces it, so it brings its own <html>, theme and fonts. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar-IQ" dir="rtl" data-theme="light">
      <head>
        <style id="driver-theme" dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body className="min-h-screen bg-bg font-sans">
        <CrashPanel error={error} reset={reset} />
      </body>
    </html>
  );
}
