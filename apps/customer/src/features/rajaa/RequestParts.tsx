import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { RequestDetails } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, StatusPill, Text, usePulse, useTheme } from '@driver/ui';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { countKey } from '@/lib/plural';
import { compactRecord } from './driver-record';
import { clockLabel } from './logic';
import { RajaaDriver } from './RajaaDriver';
import { offerMismatches, type Mismatch, type OfferSort, type RequestOffer } from './request-offers';

/**
 * The private-car market's parts (Baghdad/Kut ideas y1, y4, y5, Ali 2026-10-07): what the rider asked
 * for as small pills, «N سواق شافوا طلبك» with a gentle radar while it is open, and one card per offer.
 */

const DAY_MS = 86_400_000;
const BAGHDAD_MS = 3 * 3_600_000;

/** Whole Baghdad days from the trip to the way back. */
export function returnDays(when: Date, returnAt: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + BAGHDAD_MS) / DAY_MS);
  return day(returnAt) - day(when);
}

/** y1 as the drivers and the rider read it back: trip kind (with the wait or the day back), bags, car, AC. */
export function detailPills(t: TFn, d: RequestDetails, when: Date): { key: string; label: string; icon: 'clock' | 'suitcase' | 'car' | 'rajaa' }[] {
  const out: ReturnType<typeof detailPills> = [];
  if (d.trip === 'wait_return' && d.waitHours !== null)
    out.push({ key: 'trip', icon: 'clock', label: `${t('rajaa.req_trip.wait_return')} · ${t('rajaa.req_sum.wait', { hours: t(countKey('rajaa.req_hours', d.waitHours), { n: d.waitHours }) })}` });
  if (d.trip === 'two_days' && d.returnAt) {
    const n = returnDays(when, d.returnAt);
    out.push({ key: 'trip', icon: 'rajaa', label: t('rajaa.req_sum.return', { days: t(countKey('rajaa.req_return_days', n), { n }), time: clockLabel(d.returnAt) }) });
  }
  if (d.bigBags > 0) out.push({ key: 'bags', icon: 'suitcase', label: t(countKey('rajaa.req_bags', d.bigBags), { n: d.bigBags }) });
  if (d.carKind) out.push({ key: 'car', icon: 'car', label: t(`rajaa.vehicle_${d.carKind}` as MessageKey) });
  if (d.ac) out.push({ key: 'ac', icon: 'car', label: t('rajaa.badge_ac') });
  return out;
}

export function DetailPills({ details, when, testID }: { details: RequestDetails; when: Date; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const pills = detailPills(t, details, when);
  if (pills.length === 0) return null;
  return (
    <View testID={testID} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {pills.map((p) => (
        <StatusPill key={p.key} size="sm" tone="neutral" icon={p.icon} label={p.label} />
      ))}
    </View>
  );
}

/** y4: how many drivers opened it and how many offered, a soft radar pulsing while it waits. */
export function SeenLine({ seenBy, offers }: { seenBy: number; offers: number }) {
  const theme = useTheme();
  const t = useT();
  const pulse = usePulse(true);
  const title = seenBy > 0 ? t(countKey('rajaa.req_seen', seenBy), { n: seenBy }) : t('rajaa.req_seen_none');
  const sub = offers > 0 ? t(countKey('rajaa.req_offered', offers), { n: offers }) : t('rajaa.req_waiting');
  return (
    <View testID="rajaa-req-seen" accessible accessibilityLiveRegion="polite" accessibilityLabel={`${title}، ${sub}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.accent }, pulse]} />
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="car" size={16} color="accentText" />
        </View>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted">
          {sub}
        </Text>
      </View>
    </View>
  );
}

function missLine(t: TFn, m: Mismatch, offer: RequestOffer): string {
  if (m === 'car_kind' && offer.driver?.vehicle) return t('rajaa.offer_miss.car_kind', { kind: t(`rajaa.vehicle_${offer.driver.vehicle.kind}` as MessageKey) });
  return t(`rajaa.offer_miss.${m}` as MessageKey);
}

/**
 * y5: one offer as a card. The winner labels on top (y6), the driver and his car, his record with
 * the private trips he has done, what the car has, anything it lacks of what was asked, the price.
 */
export function OfferCard({ offer, details, wins, action, children }: { offer: RequestOffer; details: RequestDetails; wins: readonly OfferSort[]; action: ReactNode; children?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const d = offer.driver;
  const record = d?.stats ? compactRecord(t, d.stats) : null;
  const facts = [record?.text, d && d.privateTrips > 0 ? t(countKey('rajaa.offer_private_trips', d.privateTrips), { n: d.privateTrips }) : null].filter((x): x is string => !!x);
  const has = d?.vehicle ? [d.vehicle.ac ? t('rajaa.badge_ac') : null, d.vehicle.bigBags ? t('rajaa.badge.big_bags') : null, d.vehicle.noSmoking ? t('rajaa.badge.no_smoking') : null].filter((x): x is string => !!x) : [];
  const misses = offerMismatches(details, d?.vehicle);
  const price = iqd(offer.priceIqd, { locale });
  return (
    <View
      testID={`offer-card-${offer.id}`}
      style={{
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.lg,
        borderWidth: wins.includes('best') ? 1.5 : 1,
        borderColor: wins.includes('best') ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface,
      }}
    >
      {wins.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {wins.map((w) => (
            <StatusPill key={w} testID={`offer-win-${w}`} size="sm" tone={w === 'best' ? 'accent' : 'neutral'} icon={w === 'top_rated' ? 'star' : w === 'cheapest' ? 'cash' : 'check'} label={t(`rajaa.req_sort.${w}` as MessageKey)} />
          ))}
        </View>
      ) : null}
      <RajaaDriver dep={{ vehicle: d?.vehicle ?? null }} card={d} testID={`offer-driver-${offer.id}`} />
      {facts.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }} testID={`offer-record-${offer.id}`}>
          {record?.rating ? (
            <>
              <Icon name="star" size={14} color="accent" filled fillColor="accent" />
              <Text variant="footnote" weight={700} tabular>
                {record.rating}
              </Text>
              <Text variant="footnote" color="textMuted">
                ·
              </Text>
            </>
          ) : null}
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {facts.join(' · ')}
          </Text>
        </View>
      ) : null}
      {has.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {has.map((h) => (
            <StatusPill key={h} size="sm" tone="success" icon="check" label={h} />
          ))}
        </View>
      ) : null}
      {misses.map((m) => (
        <View key={m} testID={`offer-miss-${m}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="x" size={14} color="warningText" strokeWidth={2.4} />
          <Text variant="caption" color="warningText" weight={600} style={{ flex: 1 }}>
            {missLine(t, m, offer)}
          </Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Text variant="heading" tabular style={{ flex: 1 }} testID={`offer-price-${offer.id}`} accessibilityLabel={t('rajaa.offer_a11y', { name: d?.firstName ?? t('rajaa.driver_unnamed'), price })}>
          {price}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}
