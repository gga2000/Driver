'use client';

import { usePathname, useRouter } from 'next/navigation';
import { t } from '@driver/i18n';
import { useState, type ReactNode } from 'react';
import { useHotkeys } from '@/lib/hotkeys';
import { NAV } from '@/lib/nav';
import { SafetyBanner } from './safety/banner';
import { CommandPalette } from './shell/command-palette';
import { ShortcutsSheet } from './shell/shortcuts';
import { Sidebar } from './shell/sidebar';
import { TopBar } from './shell/topbar';
import { cx, NetworkBanner, ToastProvider } from './ui';

/**
 * The Console shell: the RTL sidebar on the start edge, a slim top bar with search and status, and
 * the page. Full-bleed pages (the support desk) fill the height and scroll inside their panes.
 * Global keys: ⌘K / Ctrl+K or "/" search, "?" shortcuts, "g" + letter jumps to a page.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const bare = pathname === '/login';
  // Full-bleed pages fill the height and scroll inside their panes (the desk; the map and dispatch
  // fill it with the live map). They show the network banner themselves.
  const fullBleed =
    pathname === '/support' ||
    pathname.startsWith('/support/') ||
    pathname === '/dispatch' ||
    pathname === '/map' ||
    pathname === '/zones' ||
    pathname === '/safety' ||
    pathname.startsWith('/safety/');

  const jumps = Object.fromEntries(
    NAV.filter((i) => i.jump).map((i) => [`g ${i.jump}`, () => router.push(i.href)]),
  );
  useHotkeys(
    {
      'mod+k': () => setPalette((p) => !p),
      '/': () => setPalette(true),
      '?': () => setKeys(true),
      ...jumps,
    },
    { enabled: !bare && !palette },
  );

  if (bare) {
    return (
      <ToastProvider>
        <main id="main" className="min-h-screen">
          {children}
        </main>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        {t('console.skip_to_content')}
      </a>
      <div className="flex min-h-screen">
        <Sidebar onShortcuts={() => setKeys(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* SOS (scoring & safety §3): red, on every page, while any alert is open. */}
          <SafetyBanner />
          <TopBar onSearch={() => setPalette(true)} />
          <main
            id="main"
            className={cx(
              'min-w-0',
              fullBleed
                ? 'h-[calc(100vh-106px-var(--sos-h,0px))] flex-none overflow-hidden lg:h-[calc(100vh-57px-var(--sos-h,0px))]'
                : 'flex-1 px-4 py-6 lg:px-8 lg:py-7',
            )}
          >
            {fullBleed ? null : <NetworkBanner />}
            {children}
          </main>
        </div>
      </div>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        onShortcuts={() => setKeys(true)}
      />
      <ShortcutsSheet open={keys} onClose={() => setKeys(false)} />
    </ToastProvider>
  );
}
