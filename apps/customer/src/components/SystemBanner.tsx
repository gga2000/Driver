import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getNetwork, OfflineBanner, StatusBanner, useConnectionBanner } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

/** How often an open app re-reads the Console's status banner (public `system.banner`). */
export const BANNER_POLL_MS = 60_000;

/**
 * The launch status banner (Console → every open app, launch playbook §3), under the status bar on
 * top of every screen. Public read, so it shows on the sign-in screens too; a dismissed info /
 * warning banner stays hidden for this session, a critical one cannot be dismissed.
 *
 * Under it, the shared connection strip (S-07): "النت مقطوع — نحاول نرجع…" within 3 s of losing the
 * network, "ما نگدر نوصل لدرايفر" when the API doesn't answer, and "رجع النت" for a moment after.
 */
export function SystemBanner() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const banner = useQuery(api.system.banner.queryOptions({ app: 'customer', cityId: 'aziziyah' }, { refetchInterval: BANNER_POLL_MS, staleTime: BANNER_POLL_MS / 2, retry: false }));
  const net = useConnectionBanner();
  const locale = useLocale();
  const b = banner.data;
  const system = b && b.id !== dismissed ? b : null;
  if (!system && !net.kind) return null;
  return (
    <View>
      {system ? <StatusBanner severity={system.severity} message={system.message_ar} onDismiss={() => setDismissed(system.id)} style={{ paddingTop: insets.top + 8 }} /> : null}
      <OfflineBanner kind={net.kind} locale={locale} onRetry={() => getNetwork().retryNow()} topInset={system ? 0 : insets.top} />
    </View>
  );
}
