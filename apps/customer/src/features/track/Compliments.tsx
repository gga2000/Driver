import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { ComplimentKey } from '@driver/contracts';
import { Button, ChipGroup, Icon, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useComplimentOptions, useSendCompliment } from './queries';

/**
 * «شنو عجبك بـ حيدر؟» (joy l4): after a 4–5 rating, a few kind words for the courier or driver — the
 * order type's own chips (سريع، مؤدب، الأكل وصل حار…), as many as he likes, one send. They reach him
 * in the Partner app. Presets only; the server decides whether to ask. Once sent it thanks, and the
 * tip card (if any) follows below, unchanged.
 */
export function ComplimentCard({ orderId, name, enabled }: { orderId: string; name: string; enabled: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const offer = useComplimentOptions(orderId, enabled);
  const send = useSendCompliment(orderId);
  const [picked, setPicked] = useState<ComplimentKey[]>([]);
  const data = offer.data;
  if (!enabled || !data || !data.offered) return null;

  if (data.sent || send.data) {
    return (
      <Animated.View
        entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.fast)}
        testID="compliment-sent"
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}
      >
        <Icon name="heart" size={22} color="successText" filled fillColor="successText" />
        <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
          {t('compliment.sent', { name })}
        </Text>
      </Animated.View>
    );
  }

  const submit = () => {
    if (picked.length === 0) return;
    send.mutate({ orderId, keys: picked }, { onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }) });
  };
  return (
    <View testID="compliment-offer" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="title" align="center">
          {t('compliment.title', { name })}
        </Text>
        <Text variant="footnote" color="textMuted" align="center">
          {t('compliment.hint', { name })}
        </Text>
      </View>
      <ChipGroup
        accessibilityLabel={t('compliment.title', { name })}
        items={data.keys.map((k) => ({ id: k, label: t(`compliment.${k}`) }))}
        value={picked}
        onChange={(next) => setPicked(next as ComplimentKey[])}
        mode="multi"
        style={{ justifyContent: 'center' }}
      />
      <Button testID="compliment-send" icon="heart" label={t('compliment.send', { name })} fullWidth variant="secondary" disabled={picked.length === 0 || send.isPending} loading={send.isPending} onPress={submit} />
    </View>
  );
}
