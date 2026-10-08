import { View } from 'react-native';
import type { Usual } from '@driver/contracts';
import { formatClock } from '@driver/i18n';
import { Button, Card, Icon, Text, useTheme } from '@driver/ui';
import { OrderArt } from '@/features/orders/OrderRow';
import { itemsSummary } from '@/features/orders/reorder';
import { useT } from '@/lib/i18n';
import { usualReason, fridayTitleKey, type FridayAhead } from './habits';

/** The reason line, said the server's way: «طلبته 3 مرات يوم الجمعة». */
function useReason(u: Usual): string {
  const t = useT();
  const r = usualReason(u);
  return t(r.key, { times: t(r.times, { n: u.times }), when: t(r.when) });
}

/**
 * «طلبك المعتاد؟» (joy s3): the order this person keeps coming back to at this hour, with why the app
 * thinks so. One tap opens the express sheet (today's prices, swaps, the server total); the second
 * places it. Never placed by itself.
 */
export function UsualCard({ usual, busy, onOrder }: { usual: Usual; busy: boolean; onOrder: () => void }) {
  const theme = useTheme();
  const t = useT();
  const reason = useReason(usual);
  const summary = itemsSummary(usual.row.items, 2);
  return (
    <Card testID="home-usual" padding={3} onPress={busy ? undefined : onOrder} accessibilityLabel={t('usual.a11y', { title: t('usual.title'), merchant: usual.row.merchantName ?? '', items: summary, reason })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <OrderArt row={usual.row} size={52} />
        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('usual.title')}
          </Text>
          <Text variant="bodyStrong" numberOfLines={1}>
            {usual.row.merchantName}
          </Text>
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {summary}
          </Text>
          <Text variant="caption" color="textMuted" tabular numberOfLines={1} testID="home-usual-reason">
            {reason}
          </Text>
        </View>
        <GoMark busy={busy} testID="home-usual-go" />
      </View>
    </Card>
  );
}

/**
 * «باچر الجمعة · تحجز غداكم؟» (joy s3 + delight E8): Thursday evening and Friday morning, only for a
 * Friday usual, with the slot the kitchen can take (after Friday prayer when the usual time falls in
 * it, and it says so). «احجزه» opens the express sheet set for that time.
 */
export function FridayCard({ ahead, busy, onBook }: { ahead: FridayAhead; busy: boolean; onBook: () => void }) {
  const theme = useTheme();
  const t = useT();
  const { usual, day, slot } = ahead;
  const reason = useReason(usual);
  const summary = itemsSummary(usual.row.items, 2);
  const when = t('friday.when', { day: day === 1 ? t('time.tomorrow') : t('time.today'), time: formatClock(slot.at) });
  return (
    <Card testID="home-friday" padding={4} elevation={1}>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="title" accessibilityRole="header">
          {t(fridayTitleKey(day, usual.band))}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <OrderArt row={usual.row} size={52} />
          <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {usual.row.merchantName}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {summary}
            </Text>
            <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
              {reason}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="clock" size={18} color="text" />
          <Text variant="label" weight={600} tabular style={{ flex: 1 }} testID="home-friday-when">
            {when}
          </Text>
        </View>
        {slot.movedForPrayer ? (
          <Text variant="footnote" color="textMuted" testID="home-friday-prayer">
            {t('friday.prayer')}
          </Text>
        ) : null}
        <Button testID="home-friday-book" fullWidth label={t('friday.book')} loading={busy} onPress={onBook} />
      </View>
    </Card>
  );
}

/**
 * The round «again» mark at the end of the usual and reorder cards. Only a picture: the whole card is
 * the one button (a button inside a button can't be pressed on its own, and the web refuses it).
 */
export function GoMark({ busy, testID }: { busy: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} aria-hidden accessible={false} style={{ width: theme.hitTarget, height: theme.hitTarget, borderRadius: theme.hitTarget / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken, opacity: busy ? 0.5 : 1 }}>
      <Icon name="refresh" size={20} color="text" />
    </View>
  );
}
