import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBanner } from '@driver/ui';
import { useApi } from '@/lib/api';

/** How often an open app re-reads the Console's status banner (public `system.banner`). */
export const BANNER_POLL_MS = 60_000;

/**
 * The launch status banner (Console → every open app, launch playbook §3), under the status bar on
 * top of every screen. Public read, so it shows on the sign-in screens too; a dismissed info /
 * warning banner stays hidden for this session, a critical one cannot be dismissed.
 */
export function SystemBanner() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const banner = useQuery(api.system.banner.queryOptions({ app: 'merchant', cityId: 'aziziyah' }, { refetchInterval: BANNER_POLL_MS, staleTime: BANNER_POLL_MS / 2, retry: false }));
  const b = banner.data;
  if (!b || b.id === dismissed) return null;
  return <StatusBanner severity={b.severity} message={b.message_ar} onDismiss={() => setDismissed(b.id)} style={{ paddingTop: insets.top + 8 }} />;
}
