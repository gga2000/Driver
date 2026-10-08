import type { Usual } from '@driver/contracts';
import { formatClock } from '@driver/i18n';
import { itemsSummary } from '@/features/orders/reorder';
import { useT } from '@/lib/i18n';
import { usualReason, fridayTitleKey, type FridayAhead } from './habits';
import { SlotCard } from './SlotCard';

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
export function UsualCard({ usual, photo, busy, onOrder }: { usual: Usual; photo: number | string | null; busy: boolean; onOrder: () => void }) {
  const t = useT();
  const reason = useReason(usual);
  const summary = itemsSummary(usual.row.items, 2);
  return (
    <SlotCard
      testID="home-usual"
      kicker={t('usual.title')}
      row={usual.row}
      dishes={summary}
      meta={reason}
      metaTestID="home-usual-reason"
      photo={photo}
      action={t('home.again')}
      actionIcon="refresh"
      busy={busy}
      onPress={onOrder}
      accessibilityLabel={t('usual.a11y', { title: t('usual.title'), merchant: usual.row.merchantName ?? '', items: summary, reason })}
    />
  );
}

/**
 * «باچر الجمعة · تحجز غداكم؟» (joy s3 + delight E8): Thursday evening and Friday morning, only for a
 * Friday usual, with the slot the kitchen can take (after Friday prayer when the usual time falls in
 * it, and it says so). «احجزه» opens the express sheet set for that time.
 */
export function FridayCard({ ahead, photo, busy, onBook }: { ahead: FridayAhead; photo: number | string | null; busy: boolean; onBook: () => void }) {
  const t = useT();
  const { usual, day, slot } = ahead;
  const reason = useReason(usual);
  const summary = itemsSummary(usual.row.items, 2);
  const title = t(fridayTitleKey(day, usual.band));
  const when = t('friday.when', { day: day === 1 ? t('time.tomorrow') : t('time.today'), time: formatClock(slot.at) });
  const prayer = slot.movedForPrayer ? t('friday.prayer') : null;
  return (
    <SlotCard
      testID="home-friday"
      kicker={title}
      row={usual.row}
      dishes={summary}
      meta={when}
      metaIcon="clock"
      metaTestID="home-friday-when"
      note={prayer}
      noteTestID="home-friday-prayer"
      photo={photo}
      action={t('friday.book')}
      actionIcon="arrow-forward"
      actionTestID="home-friday-book"
      busy={busy}
      onPress={onBook}
      accessibilityLabel={[title, `${usual.row.merchantName ?? ''}: ${summary}`, reason, when, prayer].filter(Boolean).join('، ')}
    />
  );
}
