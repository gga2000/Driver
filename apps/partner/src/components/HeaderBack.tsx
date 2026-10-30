import { router } from 'expo-router';
import { IconButton, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * The one back control on every screen with a header (check-up item 8, Ali 2026-10-09): the same round
 * outline chevron as the job screen's, at the reading start (the right in Arabic) and pointing that way
 * — the stack's own arrow sat on the right pointing left on the web.
 */
export function HeaderBack() {
  const theme = useTheme();
  const t = useT();
  return <IconButton testID="header-back" icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => router.back()} style={{ marginStart: theme.space[3] }} />;
}
