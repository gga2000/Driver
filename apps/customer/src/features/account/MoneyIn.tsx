import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { ReduceMotion, ZoomIn } from 'react-native-reanimated';
import type { WalletLine } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { moneyIn } from './wallet-lines';

const SEEN_KEY = 'driver.customer.wallet.moneyInSeen';

/**
 * "Money in" (joy w7, audit W-07): cash handed to a stranger is an anxious moment, and the wallet is
 * where the relief lands. Once per top-up, on this device: «وصل 25,000 دينار لمحفظتك · الرقم T-4XQ6»
 * with a coin that drops in and a success buzz (no buzz on a quiet day; no motion under reduced
 * motion). The line itself opens the receipt.
 */
export function MoneyIn({ lines, onOpen }: { lines: readonly WalletLine[]; onOpen: (line: WalletLine) => void }) {
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
  const line = seen === undefined ? null : moneyIn(lines, seen, new Date());
  useEffect(() => {
    if (!line) return;
    if (today.celebrations) theme.haptic('success');
    // Remembered at once: the strip stays for this visit and never comes back for this top-up.
    void storage.setItem(SEEN_KEY, line.id).catch(() => undefined);
  }, [line, theme, today.celebrations]);
  if (!line) return null;
  return (
    <Pressable
      testID="wallet-money-in"
      accessibilityRole="button"
      accessibilityLiveRegion="polite"
      onPress={() => onOpen(line)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.successTint }}
    >
      <Animated.View entering={ZoomIn.springify().damping(9).reduceMotion(ReduceMotion.System)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deal }}>
        <Icon name="cash" size={24} color="onDeal" strokeWidth={2} />
      </Animated.View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700} color="successText">
          {t('wallet.money_in', { amount: amountParam(line.amount) })}
        </Text>
        {line.reference ? (
          <Text variant="caption" color="textMuted" tabular>
            {t('wallet.money_in_ref', { ref: line.reference })}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
