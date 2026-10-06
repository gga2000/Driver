import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { appNow } from '@/lib/dev-clock';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { monthCardDue, monthLabel } from './month';
import { useMonth } from './queries';

const SEEN_KEY = 'driver.customer.month.cardSeen';

/**
 * The month-start card (joy w6): on the 1st to 3rd, «خلص أيلول، شهرك جاهز», once per device per
 * month, only when last month had something to show and never on a quiet day. Closing it, or opening
 * the month, remembers it. No push here: that one is the server's, for people with marketing on.
 */
export function MonthCard({ testID = 'month-card' }: { testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const today = useSeason();
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    storage
      .getItem(SEEN_KEY)
      .then((v) => live && setSeen(v ?? null))
      .catch(() => live && setSeen(null));
    return () => {
      live = false;
    };
  }, []);
  const due = seen === undefined ? null : monthCardDue(appNow(), seen, today.quiet);
  const month = useMonth(due ?? undefined, { enabled: due !== null });
  if (!due || !month.data || month.data.month !== due || !month.data.hasActivity) return null;

  const remember = () => {
    setSeen(due);
    void storage.setItem(SEEN_KEY, due).catch(() => undefined);
  };
  const name = t(monthLabel(due).nameKey);

  return (
    <Card padding={4} tone="tint" testID={testID}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('month.card_title', { month: name })}</Text>
            <Text variant="footnote" color="textMuted">
              {t('month.card_body')}
            </Text>
          </View>
          <IconButton testID={`${testID}-close`} icon="x" accessibilityLabel={t('month.card_close')} onPress={remember} />
        </View>
        <Button
          testID={`${testID}-open`}
          icon="star"
          label={t('month.card_cta')}
          onPress={() => {
            remember();
            router.push({ pathname: '/month', params: { month: due } });
          }}
        />
      </View>
    </Card>
  );
}
