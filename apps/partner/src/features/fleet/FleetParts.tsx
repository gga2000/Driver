import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { CapTier, FleetDay, FleetDriver, FleetDriverState, VehicleClass } from '@driver/contracts';
import { Avatar, Icon, StatusPill, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { capShare, VEHICLE_ICON } from '../work/logic';
import { baghdadDate } from '../ops/logic';
import {
  cashTone,
  DOW_KEY,
  DOW_SHORT_KEY,
  maskedPhone,
  phoneHintText,
  STATE_KEY,
  STATE_TONE,
  weekBars,
} from './logic';

/** Section label over a card, with an optional action at the end side. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[1], minHeight: 28 }}>
      <Text variant="label" color="textMuted" accessibilityRole="header">
        {title}
      </Text>
      {action ?? null}
    </View>
  );
}

/**
 * The fleet's earnings hero: today's amount, the week's total and a seven-bar chart, Sunday first
 * (in RTL that reads right to left like the week). One series, one hue: past days in a quiet tint,
 * today in the accent, days still to come as dashed stubs. Tapping a bar names that day's amount.
 */
export function EarningsHero({ todayIqd, weekIqd, days, today }: { todayIqd: number; weekIqd: number; days: readonly FleetDay[]; today: string }) {
  const theme = useTheme();
  const t = useT();
  const bars = weekBars(days, today);
  const [picked, setPicked] = useState<string | null>(null);
  const focus = bars.find((b) => b.date === picked) ?? null;
  const ink = theme.colors.text;
  const cream = theme.colors.bg;
  const CHART_H = 104;

  return (
    <View testID="fleet-hero" style={{ backgroundColor: ink, borderRadius: theme.radius['2xl'], padding: theme.space[5], gap: theme.space[4], overflow: 'hidden' }}>
      <View style={{ gap: 2 }}>
        <Text variant="label" style={{ color: withAlpha(cream, 0.72) }}>
          {t('partner.fleet_today_title')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text variant="display" tabular style={{ color: cream }}>
            {amountParam(todayIqd)}
          </Text>
          <Text variant="title" style={{ color: withAlpha(cream, 0.72) }}>
            دينار
          </Text>
        </View>
        <Text variant="label" tabular testID="fleet-hero-caption" style={{ color: focus ? theme.colors.accent : withAlpha(cream, 0.72) }}>
          {focus ? t('partner.fleet_chart_day', { day: t(DOW_KEY[focus.dow]!), amount: amountParam(focus.earningsIqd) }) : t('partner.fleet_week_total', { amount: amountParam(weekIqd) })}
        </Text>
      </View>

      <View accessibilityLabel={t('partner.fleet_chart_label')} style={{ gap: theme.space[2] }}>
        <View style={{ height: CHART_H, flexDirection: 'row', alignItems: 'flex-end', gap: 6, borderBottomWidth: 1, borderBottomColor: withAlpha(cream, 0.16) }}>
          {bars.map((b) => {
            const isToday = b.state === 'today';
            const selected = picked === b.date;
            const h = b.state === 'future' ? 10 : Math.max(b.share * (CHART_H - 8), b.earningsIqd > 0 ? 6 : 3);
            const fill = isToday ? theme.colors.accent : selected ? withAlpha(cream, 0.7) : withAlpha(cream, 0.26);
            return (
              <Pressable
                key={b.date}
                testID={`fleet-bar-${b.dow}`}
                accessibilityRole="button"
                accessibilityLabel={`${t(DOW_KEY[b.dow]!)} ${amountParam(b.earningsIqd)}`}
                onPress={() => setPicked(selected ? null : b.date)}
                style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
              >
                <View
                  style={{
                    width: '72%',
                    maxWidth: 30,
                    height: h,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: b.state === 'future' ? 'transparent' : fill,
                    borderWidth: b.state === 'future' ? 1 : 0,
                    borderStyle: 'dashed',
                    borderBottomWidth: 0,
                    borderColor: withAlpha(cream, 0.3),
                  }}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {bars.map((b) => (
            <Text
              key={b.date}
              variant="caption"
              align="center"
              weight={b.state === 'today' ? 600 : 400}
              style={{ flex: 1, color: b.state === 'today' ? theme.colors.accent : withAlpha(cream, b.state === 'future' ? 0.4 : 0.66) }}
            >
              {b.state === 'today' ? t('partner.fleet_chart_today') : t(DOW_SHORT_KEY[b.dow]!)}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** One number with its label (vehicles · online now · owed). */
export function StatTile({ icon, value, label, tone = 'text', testID }: { icon: IconName; value: string; label: string; tone?: 'text' | 'successText' | 'warningText'; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[3], gap: theme.space[1] }}>
      <Icon name={icon} size={18} color="textMuted" strokeWidth={2} />
      <Text variant="title" weight={700} tabular color={tone} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Iraqi-plate-like badge: white plate, thin frame, digits LTR. */
export function PlateBadge({ plate, size = 'sm' }: { plate: string; size?: 'sm' | 'md' }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1.5,
        borderColor: theme.colors.text,
        borderRadius: 6,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: size === 'md' ? 10 : 7,
        paddingVertical: size === 'md' ? 2 : 0,
      }}
    >
      <Text variant={size === 'md' ? 'label' : 'caption'} weight={700} tabular>
        {`⁨${plate}⁩`}
      </Text>
    </View>
  );
}

/** The vehicle's class glyph in a soft square. */
export function VehicleGlyph({ vehicleClass, size = 44, active = true }: { vehicleClass: VehicleClass; size?: number; active?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: active ? theme.colors.accentTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={VEHICLE_ICON[vehicleClass]} size={size * 0.5} color={active ? 'accentText' : 'textMuted'} strokeWidth={2} />
    </View>
  );
}

const DOT: Record<FleetDriverState, 'success' | 'info' | 'danger' | 'borderStrong'> = { online: 'success', on_job: 'info', over_cap: 'danger', offline: 'borderStrong' };

/** Avatar with the live-state dot on its corner. */
export function DriverAvatar({ name, state, size = 48 }: { name: string | null; state: FleetDriverState; size?: number }) {
  const theme = useTheme();
  const dot = size * 0.3;
  return (
    <View style={{ width: size, height: size }}>
      <Avatar name={name ?? undefined} {...(name ? {} : { icon: 'user' as const })} size={size} />
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          end: 0,
          width: dot,
          height: dot,
          borderRadius: dot / 2,
          backgroundColor: theme.colors[DOT[state]],
          borderWidth: 2.5,
          borderColor: theme.colors.surface,
        }}
      />
    </View>
  );
}

/** Thin cash-vs-cap bar with "كاش 45,000 من 75,000". */
export function CashMini({ heldIqd, capIqd, overCap }: { heldIqd: number; capIqd: number; overCap: boolean }) {
  const theme = useTheme();
  const t = useT();
  const share = capShare(heldIqd, capIqd);
  const tone = cashTone(heldIqd, capIqd, overCap);
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text variant="caption" color={tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'textMuted'} tabular numberOfLines={1}>
        {t('partner.fleet_cash_short', { held: amountParam(heldIqd), cap: amountParam(capIqd) })}
      </Text>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
        {share > 0 ? <View style={{ height: 4, borderRadius: 2, width: `${Math.max(share * 100, 4)}%`, backgroundColor: theme.colors[tone] }} /> : null}
      </View>
    </View>
  );
}

export function TierPill({ tier }: { tier: CapTier }) {
  const t = useT();
  return <StatusPill size="sm" icon="star" label={t(`partner.tier_${tier}`)} tone={tier === 'gold' ? 'accent' : tier === 'silver' ? 'info' : 'neutral'} />;
}

/** A driver in the overview list: who, which vehicle, today's money, cash vs cap, tier. */
export function DriverRow({ driver, vehicle, onPress, divider }: { driver: FleetDriver; vehicle: { plate: string; vehicleClass: VehicleClass } | null; onPress: () => void; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={`fleet-driver-${driver.driverId}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: theme.space[4],
        paddingVertical: theme.space[3],
        gap: theme.space[3],
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <DriverAvatar name={driver.name} state={driver.state} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {driver.name ?? maskedPhone(driver.phoneMasked)}
            </Text>
            <StatusPill size="sm" dot label={t(STATE_KEY[driver.state])} tone={STATE_TONE[driver.state] === 'accent' ? 'neutral' : STATE_TONE[driver.state]} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {vehicle ? (
              <>
                <Icon name={VEHICLE_ICON[vehicle.vehicleClass]} size={15} color="textMuted" strokeWidth={2} />
                <PlateBadge plate={vehicle.plate} />
              </>
            ) : (
              <Text variant="caption" color="textMuted">
                {t('partner.fleet_no_vehicle')}
              </Text>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="bodyStrong" weight={700} tabular>
            {amountParam(driver.todayEarningsIqd)}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('partner.fleet_today_short')}
          </Text>
        </View>
        <Icon name="chevron-forward" size={16} color="textMuted" />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingStart: 48 + theme.space[3] }}>
        <CashMini heldIqd={driver.cashHeldIqd} capIqd={driver.capIqd} overCap={driver.state === 'over_cap'} />
        <TierPill tier={driver.tier} />
      </View>
    </Pressable>
  );
}

/**
 * An invite still waiting for the driver's yes: "دعوة مرسلة إلى 0770 ••• 4567" and when it went out.
 * No name, money or live state (he hasn't agreed to share them), so the row doesn't open.
 */
export function PendingDriverRow({ driver, divider }: { driver: FleetDriver; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const phone = phoneHintText(driver.phoneHint);
  return (
    <View
      testID={`fleet-pending-${driver.driverId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        paddingVertical: theme.space[3],
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: theme.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="user" size={22} color="textMuted" strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600} tabular>
          {phone
            ? t('partner.fleet_pending_row', { phone })
            : t('partner.fleet_pending_row_unknown')}
        </Text>
        {driver.invitedAt ? (
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.fleet_invite_sent_on', { date: baghdadDate(driver.invitedAt) })}
          </Text>
        ) : null}
      </View>
      <View
        accessibilityLabel={t('partner.fleet_pending_badge')}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: theme.colors.warningTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="clock" size={16} color="warningText" strokeWidth={2.2} />
      </View>
    </View>
  );
}
