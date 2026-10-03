import { View } from 'react-native';
import type { DealView } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { Glyph, type GlyphName } from '@/features/menu/Glyph';
import { Panel, Pill, Toggle } from '@/features/menu/parts';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { DISPLAY_LABEL, DISPLAY_TONE, daysText, dealHeadline, hoursText, itemsText, rangeText } from './format';
import { budgetUse, canToggle, dayMonth, dealDisplay, type ApiDealType } from './logic';

/** The offer as a badge: "20%", "−1,000", a bike for free delivery, "1+1". */
export function DealBadge({ type, value, size = 64 }: { type: ApiDealType; value: number; size?: number }) {
  const theme = useTheme();
  const glyph: GlyphName | null = type === 'free_delivery' ? 'bike' : null;
  const label = type === 'percent' ? `${value}%` : type === 'fixed' ? `−${amountParam(value)}` : type === 'bogo' ? '1+1' : '';
  const long = label.length > 4;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] }}>
      {glyph ? (
        <Glyph name={glyph} size={size * 0.5} color="onAccent" strokeWidth={2} />
      ) : (
        <Text weight={700} color="onAccent" tabular style={{ fontSize: long ? size * 0.22 : size * 0.34, lineHeight: size * 0.5 }}>
          {label}
        </Text>
      )}
    </View>
  );
}

export interface DealCardProps {
  deal: DealView;
  now: number;
  names: ReadonlyMap<string, string>;
  owner: boolean;
  busy: boolean;
  onToggle: (deal: DealView, active: boolean) => void;
}

/**
 * One deal: the offer, its state (waiting for Driver, running, scheduled, paused…), what it covers and
 * when, and what it costs the store — projected by the server and spent so far against the cap.
 */
export function DealCard({ deal, now, names, owner, busy, onToggle }: DealCardProps) {
  const theme = useTheme();
  const t = useT();
  const display = dealDisplay(deal, now);
  const toggle = canToggle(display);
  const use = budgetUse(deal);
  const live = display === 'active';
  const faded = display === 'ended' || display === 'rejected';
  const lines: Array<{ glyph: GlyphName; text: string }> = [
    { glyph: 'utensils', text: itemsText(t, deal.itemIds, names) },
    { glyph: 'calendar', text: `${rangeText(t, deal.schedule.startsAt, deal.schedule.endsAt)} · ${daysText(t, deal.schedule.days)}` },
    { glyph: 'clock', text: hoursText(t, deal.schedule.hours) },
    ...(deal.minOrderIqd > 0 ? [{ glyph: 'bag' as const, text: t('merchant.deals.min_order', { amount: amountParam(deal.minOrderIqd) }) }] : []),
  ];
  return (
    <Panel testID={`deal-${deal.dealId}`} style={{ gap: theme.space[4], opacity: faded ? 0.72 : 1, borderColor: live ? theme.colors.success : theme.colors.border, borderWidth: live ? 1.5 : 1 }}>
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'flex-start' }}>
        <DealBadge type={deal.type} value={deal.value} />
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Pill size="sm" tone={DISPLAY_TONE[display]} dot label={display === 'scheduled' ? t('merchant.deals.state_scheduled_on', { date: dayMonth(deal.schedule.startsAt) }) : t(DISPLAY_LABEL[display])} />
          <Text variant="title" numberOfLines={2}>
            {deal.nameAr}
          </Text>
          <Text variant="footnote" color="textMuted">
            {dealHeadline(t, deal.type, deal.value)}
          </Text>
        </View>
        {owner && toggle ? (
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Toggle testID={`deal-toggle-${deal.dealId}`} label={toggle === 'pause' ? t('merchant.deals.pause') : t('merchant.deals.resume')} value={toggle === 'pause'} disabled={busy} onChange={(v) => onToggle(deal, v)} />
            <Text variant="caption" color="textMuted">
              {toggle === 'pause' ? t('merchant.deals.switch_on') : t('merchant.deals.switch_off')}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Glyph name={l.glyph} size={17} color="textMuted" />
            <Text variant="footnote" color="text" style={{ flex: 1 }} numberOfLines={1}>
              {l.text}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, padding: theme.space[3], gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.deals.projected_label')}
          </Text>
          <Text variant="bodyStrong" tabular>
            {t('merchant.deals.per_week', { amount: amountParam(deal.projected.weeklyCostIqd) })}
          </Text>
        </View>
        <Text variant="caption" color="textMuted" tabular>
          {t('merchant.deals.projected_detail', { orders: deal.projected.ordersPerWeek, perOrder: amountParam(deal.projected.costPerOrderIqd), total: amountParam(deal.projected.totalCostIqd) })}
        </Text>
        {use !== null ? (
          <View style={{ gap: 4 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(use * 100)}%`, height: 6, borderRadius: 3, backgroundColor: use >= 1 ? theme.colors.warning : theme.colors.accent }} />
            </View>
            <Text variant="caption" color="textMuted" tabular>
              {t('merchant.deals.spent', { spent: amountParam(deal.spentIqd), cap: amountParam(deal.budgetCapIqd ?? 0) })}
            </Text>
          </View>
        ) : null}
      </View>

      {display === 'pending' ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
          <Glyph name="hourglass" size={18} color="warningText" />
          <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
            {t('merchant.deals.pending_note')}
          </Text>
        </View>
      ) : display === 'rejected' ? (
        <Text variant="footnote" color="dangerText">
          {t('merchant.deals.rejected_note')}
        </Text>
      ) : null}
    </Panel>
  );
}
