/**
 * `@driver/ui/lost-item`: s7 «انحلّت», the strip that closes a reopened lost-item chat early, for the
 * customer and partner chats (`ChatThread`'s `pinned`). A subpath of its own because Metro bundles
 * everything an import reaches: the merchant app imports `@driver/ui` and never shows it.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from './components/Button';
import type { ChatT } from './components/ChatThread';
import { Text } from './components/Text';
import { useToast } from './components/Toast';
import { useTheme } from './theme/ThemeProvider';

/** One button, then «نسكّر المحادثة؟» with yes / no, so a stray tap does not close it. */
export function LostItemResolve({ t, resolve, errorMessage }: { t: ChatT; resolve: () => Promise<unknown>; errorMessage: (err: unknown, fallback: string) => string }) {
  const theme = useTheme();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <Button label={t('chat.lost_item_resolve')} variant="secondary" icon="check" fullWidth onPress={() => setAsking(true)} testID="chat-lost-item-resolve" />;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={700} style={{ textAlign: 'center' }}>
        {t('chat.lost_item_resolve_confirm')}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Button label={t('chat.lost_item_resolve_no')} variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => setAsking(false)} testID="chat-lost-item-keep" />
        <Button
          label={t('chat.lost_item_resolve_yes')}
          variant="ink"
          style={{ flex: 1 }}
          loading={busy}
          onPress={() => {
            setBusy(true);
            resolve()
              .then(() => toast.show({ message: t('chat.lost_item_resolved_toast'), tone: 'success', icon: 'check' }))
              .catch((err: unknown) => toast.show({ message: errorMessage(err, t('error.network')), tone: 'warning' }))
              .finally(() => {
                setBusy(false);
                setAsking(false);
              });
          }}
          testID="chat-lost-item-confirm"
        />
      </View>
    </View>
  );
}
