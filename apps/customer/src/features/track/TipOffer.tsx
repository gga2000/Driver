import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button, ChipGroup, Icon, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useTipOptions, useTipOrder } from './queries';
import { tipCard } from './rating-logic';

/**
 * «تحب تكرم عباس؟» (Ali, 2026-10-06): after a 4–5 rating, an optional tip from the wallet — the chips
 * the server says his balance covers (500 / 1,000 / 2,000 دينار), one to pick, then «كرّمه بـ 1,000
 * دينار»; «لا شكراً» closes it. With too little in the wallet there are no chips, only a gentle line
 * that cash can be handed over. Once given it says so. Amounts, eligibility and the money are the
 * server's; this only asks.
 */
export function TipOffer({ orderId, name, enabled }: { orderId: string; name: string; enabled: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const offer = useTipOptions(orderId, enabled);
  const send = useTipOrder(orderId);
  const [picked, setPicked] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const card = enabled ? tipCard(offer.data, dismissed) : 'hidden';
  if (card === 'hidden') return null;

  if (card === 'thanks') {
    const amount = offer.data?.tip?.amountIqd ?? 0;
    return (
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(220)} testID="tip-thanks" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
        <Icon name="gift" size={22} color="successText" />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600} color="successText">
            {t('tip.done', { name })}
          </Text>
          <Text variant="caption" color="text" tabular>
            {t('tip.done_amount', { amount: amountParam(amount) })}
          </Text>
        </View>
      </Animated.View>
    );
  }

  if (card === 'cash_note') {
    return (
      <View testID="tip-cash-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <Icon name="cash" size={22} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('tip.cash_note', { name })}
        </Text>
      </View>
    );
  }

  const amounts = offer.data?.amountsIqd ?? [];
  const submit = () => {
    if (picked === null) return;
    send.mutate({ orderId, amountIqd: picked }, { onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }) });
  };
  return (
    <View testID="tip-offer" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="heading" align="center">
          {t('tip.ask', { name })}
        </Text>
        <Text variant="footnote" color="textMuted" align="center">
          {t('tip.ask_sub')}
        </Text>
      </View>
      <ChipGroup
        accessibilityLabel={t('tip.ask', { name })}
        items={amounts.map((a) => ({ id: String(a), label: t('tip.chip', { amount: amountParam(a) }) }))}
        value={picked === null ? [] : [String(picked)]}
        onChange={(next) => setPicked(next[0] ? Number(next[0]) : null)}
        mode="single"
        columns={amounts.length}
      />
      <Button testID="tip-send" icon="gift" label={picked === null ? t('tip.ask', { name }) : t('tip.pay', { amount: amountParam(picked) })} fullWidth disabled={picked === null || send.isPending} loading={send.isPending} onPress={submit} />
      <Button testID="tip-no-thanks" variant="ghost" label={t('tip.no_thanks')} fullWidth disabled={send.isPending} onPress={() => setDismissed(true)} />
    </View>
  );
}
