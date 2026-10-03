import { Pressable, View } from 'react-native';
import type { CityPricingConfig, Quote, QuoteComponent } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Icon, PriceBreakdown, Skeleton, Text, useTheme, withAlpha, type IconName, type PriceItem } from '@driver/ui';
import { BottomPanel } from '@/features/track/Panels';
import { useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { fareLines, hour12, ruleHours, type RideVertical, type Spot, type Surcharge } from './logic';

export const VEHICLE: Record<RideVertical, { name: MessageKey; hint: MessageKey; icon: IconName }> = {
  taxi: { name: 'ride.vehicle_taxi', hint: 'ride.vehicle_taxi_hint', icon: 'car' },
  tuktuk: { name: 'ride.vehicle_tuktuk', hint: 'ride.vehicle_tuktuk_hint', icon: 'tuktuk' },
};

// ───────────────────────── route summary ─────────────────────────

/** "● من … / ■ إلى …" with a change link: the trip the quotes are for. */
export function RouteSummary({ pickup, dropoff, onEdit }: { pickup: Spot; dropoff: Spot; onEdit: () => void }) {
  const theme = useTheme();
  const t = useT();
  const line = (kind: 'pickup' | 'dropoff', s: Spot) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 30 }}>
      <View style={{ width: 16, alignItems: 'center' }}>
        {kind === 'pickup' ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.success, borderWidth: 2, borderColor: theme.colors.successTint }} />
        ) : (
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.text }} />
        )}
      </View>
      <Text variant="body" weight={kind === 'dropoff' ? 600 : 500} numberOfLines={1} style={{ flex: 1 }}>
        {s.title}
        {s.subtitle && s.kind !== 'zone' ? (
          <Text variant="footnote" color="textMuted">
            {`  ${s.subtitle}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
  return (
    <View testID="ride-route" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <View style={{ flex: 1 }}>
        {line('pickup', pickup)}
        <View style={{ width: 16, alignItems: 'center' }}>
          <View style={{ width: 2, height: 8, borderRadius: 1, backgroundColor: theme.colors.border }} />
        </View>
        {line('dropoff', dropoff)}
      </View>
      <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={8} testID="ride-edit-route" style={({ pressed }) => ({ paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: 999, backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken })}>
        <Text variant="label" weight={600} color="accentText">
          {t('ride.edit')}
        </Text>
      </Pressable>
    </View>
  );
}

// ───────────────────────── surcharge banner ─────────────────────────

export function SurchargeBanner({ s, city, vertical }: { s: Surcharge; city: CityPricingConfig | undefined; vertical: RideVertical }) {
  const theme = useTheme();
  const t = useT();
  const hours = ruleHours(city, vertical, s.key);
  const text =
    s.key === 'night'
      ? t('ride.night_banner', { amount: amountParam(s.amount), from: hour12(hours?.[0] ?? 23), to: hour12(hours?.[1] ?? 5) })
      : s.key === 'peak'
        ? t('ride.peak_banner', { amount: amountParam(s.amount) })
        : t('ride.weather_banner', { amount: amountParam(s.amount) });
  return (
    <View
      testID={`ride-surcharge-${s.key}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.infoTint }}
    >
      <Icon name={s.key === 'night' ? 'clock' : 'bell'} size={16} color="infoText" strokeWidth={2.2} />
      <Text variant="footnote" weight={600} color="infoText" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

// ───────────────────────── vehicle card ─────────────────────────

export function VehicleCard({
  vertical,
  quote,
  loading,
  selected,
  disabledReason,
  minutes,
  cheaperBy,
  onPress,
  onDetails,
  onTryAnyway,
}: {
  vertical: RideVertical;
  quote: Quote | undefined;
  loading: boolean;
  selected: boolean;
  /** Tuktuk to an edge zone: why it is off, with "try anyway". */
  disabledReason: string | null;
  minutes: number | null;
  cheaperBy: number | null;
  onPress: () => void;
  onDetails: () => void;
  onTryAnyway?: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const v = VEHICLE[vertical];
  const off = Boolean(disabledReason);
  return (
    <Pressable
      testID={`ride-vehicle-${vertical}`}
      accessibilityRole="radio"
      aria-checked={selected}
      aria-disabled={off}
      accessibilityLabel={`${t(v.name)} ${quote ? `${amountParam(quote.total)} ${t('quote.currency')}` : ''}`}
      disabled={off}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        borderRadius: theme.radius.xl,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? withAlpha(theme.colors.accentTint, 0.55) : theme.colors.surface,
        padding: selected ? theme.space[3] - 1 : theme.space[3],
        gap: theme.space[2],
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: off ? 0.5 : 1 }}>
        <View style={{ width: 56, height: 56, borderRadius: theme.radius.lg, backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={v.icon} size={30} color={selected ? 'onAccent' : 'text'} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="title">{t(v.name)}</Text>
            {cheaperBy && cheaperBy > 0 && !off ? (
              <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: theme.colors.successTint }}>
                <Text variant="caption" weight={600} color="successText" style={{ lineHeight: 18 }}>
                  {t('ride.cheaper_by', { amount: amountParam(cheaperBy) })}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {t(v.hint)}
          </Text>
          {minutes ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={13} color="textMuted" strokeWidth={2.2} />
              <Text variant="caption" weight={600} color="textMuted" tabular testID={`ride-minutes-${vertical}`}>
                {t('ride.trip_minutes', { minutes })}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {quote ? (
            <>
              <Text variant="title" tabular testID={`ride-price-${vertical}`} style={{ fontSize: 20 }}>
                {amountParam(quote.total)}
              </Text>
              <Text variant="caption" color="textMuted" style={{ lineHeight: 16 }}>
                {t('quote.currency')}
              </Text>
            </>
          ) : loading ? (
            <Skeleton width={64} height={24} />
          ) : (
            <Text variant="caption" color="dangerText">
              {t('ride.quote_failed')}
            </Text>
          )}
        </View>
      </View>
      {off ? (
        <View style={{ gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Icon name="map-pin" size={15} color="warningText" strokeWidth={2.2} />
            <Text variant="footnote" color="warningText" style={{ flex: 1 }} testID="ride-tuktuk-edge">
              {disabledReason}
            </Text>
          </View>
          {onTryAnyway ? (
            <Pressable accessibilityRole="button" onPress={onTryAnyway} hitSlop={6} testID="ride-tuktuk-try" style={{ alignSelf: 'flex-start', paddingStart: 23 }}>
              <Text variant="label" weight={600} color="accentText">
                {t('ride.tuktuk_edge_try')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : selected && quote ? (
        <Pressable accessibilityRole="button" onPress={onDetails} hitSlop={6} testID={`ride-details-${vertical}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingStart: 68 }}>
          <Icon name="receipt" size={14} color="accentText" strokeWidth={2.2} />
          <Text variant="label" weight={600} color="accentText">
            {t('ride.price_details')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// ───────────────────────── payment ─────────────────────────

export function PayOption({ icon, title, subtitle, selected, disabled, onPress, testID }: { icon: IconName; title: string; subtitle: string; selected: boolean; disabled?: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        padding: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? withAlpha(theme.colors.accentTint, 0.55) : theme.colors.surface,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={icon} size={20} color={selected ? 'accentText' : 'text'} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={600}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={2} style={{ lineHeight: 17 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

// ───────────────────────── fare breakdown ─────────────────────────

const LINE: Partial<Record<QuoteComponent['key'], { label: MessageKey; reason?: MessageKey }>> = {
  base: { label: 'quote.base', reason: 'ride.reason_base' },
  door_pickup: { label: 'quote.door_pickup', reason: 'ride.reason_door' },
  street_pickup: { label: 'quote.street_pickup', reason: 'quote.reason.street_pickup' },
  night: { label: 'quote.night', reason: 'ride.reason_night' },
  peak: { label: 'quote.peak', reason: 'quote.reason.peak' },
  weather: { label: 'quote.rain', reason: 'quote.reason.rain' },
  wait: { label: 'quote.wait' },
  promo: { label: 'quote.promo' },
};

/** Every component of the quote with its one-line reason (voice guide §2.5). */
export function fareItems(q: Quote, t: TFn, locale: 'ar-IQ' | 'en', city: CityPricingConfig | undefined, vertical: RideVertical): PriceItem[] {
  const night = ruleHours(city, vertical, 'night');
  return fareLines(q).map((c, i) => {
    const name = LINE[c.key];
    const reason = name?.reason ? t(name.reason, { from: hour12(night?.[0] ?? 23), to: hour12(night?.[1] ?? 5) }) : undefined;
    return { key: `${c.key}${c.leg ?? i}`, label: name ? t(name.label) : locale === 'en' ? c.label_en : c.label_ar, amount: c.amount, ...(reason ? { reason } : {}) };
  });
}

export function FarePanel({ vertical, quote, city, locale, onClose }: { vertical: RideVertical; quote: Quote; city: CityPricingConfig | undefined; locale: 'ar-IQ' | 'en'; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <BottomPanel onClose={onClose} testID="ride-fare-panel">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={VEHICLE[vertical].icon} size={24} color="accentText" strokeWidth={1.9} />
        </View>
        <Text variant="heading" style={{ flex: 1 }}>
          {t('ride.breakdown_title', { vehicle: t(VEHICLE[vertical].name) })}
        </Text>
      </View>
      <PriceBreakdown items={fareItems(quote, t, locale, city, vertical)} total={quote.total} note={t('quote.quote_locked')} testID="ride-fare" />
      <Button label={t('action.ok')} variant="secondary" fullWidth onPress={onClose} testID="ride-fare-close" />
    </BottomPanel>
  );
}
