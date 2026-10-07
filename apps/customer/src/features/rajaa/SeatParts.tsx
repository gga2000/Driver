import { Image, Platform, Pressable, Switch, View } from 'react-native';
import type { BoardSeat, MeetingPointView } from '@driver/contracts';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { publicPlaceName } from './logic';

/**
 * The seat screen's smaller parts (Baghdad/Kut ideas c3, c5, c7, Ali 2026-10-07): why a seat is
 * closed in one line under the car, where you get in as one row of three, and the big-bag switch.
 */

/** c3: one line under the car, not a box: «المقعد النص بين راكبين غرباء، فسدّيناه إلك». */
export function BlockedLine({ reason }: { reason: NonNullable<BoardSeat['blocked']> }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="rajaa-blocked-note" accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Icon name="shield" size={16} color="accentText" strokeWidth={2} />
      <Text variant="footnote" color="text" weight={600} style={{ flex: 1 }}>
        {reason === 'family_only' ? t('rajaa.blocked_line_family') : t('rajaa.blocked_line_adjacency')}
      </Text>
    </View>
  );
}

export type PickupKind = 'garage' | 'way' | 'door';

export type PickupTile = {
  kind: PickupKind;
  /** The price line under the name: «بلا زيادة», «من +1,000 دينار», «+2,000 دينار», or why it is closed. */
  detail: string;
  disabled: boolean;
};

const PICKUP_ICON: Record<PickupKind, IconName> = { garage: 'garage', way: 'map-pin', door: 'home' };
const PICKUP_KEY = { garage: 'rajaa.pickup_short_garage', way: 'rajaa.pickup_short_way', door: 'rajaa.pickup_short_door' } as const;

/** c5: «الكراج · على الطريق · من البيت» side by side, the price under each. */
export function PickupTiles({ tiles, value, onChange }: { tiles: readonly PickupTile[]; value: PickupKind; onChange: (k: PickupKind) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.pickup_title')}>
      {tiles.map(({ kind, detail, disabled }) => {
        const on = kind === value && !disabled;
        const title = t(PICKUP_KEY[kind]);
        return (
          <Pressable
            key={kind}
            testID={`pickup-tile-${kind}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={t('rajaa.pickup_tile_a11y', { title, detail })}
            disabled={disabled}
            onPress={() => {
              theme.haptic('selection');
              onChange(kind);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 88,
              paddingVertical: theme.space[3],
              paddingHorizontal: theme.space[2],
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.space[1],
              borderRadius: theme.radius.lg,
              borderWidth: on ? 2 : 1,
              borderColor: on ? theme.colors.accent : theme.colors.border,
              backgroundColor: on ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
              opacity: disabled ? 0.5 : 1,
            })}
          >
            <Icon name={PICKUP_ICON[kind]} size={20} color={on ? 'accentText' : 'textMuted'} strokeWidth={2} />
            <Text variant="label" weight={on ? 700 : 600} numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" color={on ? 'text' : 'textMuted'} numberOfLines={1} tabular>
              {detail}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One stop on the way, with its photo when ops has taken one (c5: «a meeting point opens with its photo»). */
export function WayPointRow({ point, selected, onPress, draftLabel }: { point: MeetingPointView; selected: boolean; onPress: () => void; draftLabel: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const name = publicPlaceName(point.nameAr);
  const fee = iqd(point.feeIqd, { locale, sign: true });
  return (
    <Pressable
      testID={`pickup-${point.id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={t('rajaa.pickup_tile_a11y', { title: name, detail: point.draft ? `${fee} · ${draftLabel}` : fee })}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        overflow: 'hidden',
      })}
    >
      {selected && point.photoUrl ? (
        <Image source={{ uri: point.photoUrl }} accessibilityLabel={t('rajaa.mp_photo_a11y', { place: name })} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.colors.surfaceSunken }} resizeMode="cover" />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[4], paddingVertical: theme.space[2] }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.accent }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600} numberOfLines={1}>
            {name}
          </Text>
          {point.draft ? (
            <Text variant="caption" color="textMuted">
              {draftLabel}
            </Text>
          ) : null}
        </View>
        <Text variant="label" weight={600} tabular color={selected ? 'accentText' : 'textMuted'}>
          {fee}
        </Text>
      </View>
    </Pressable>
  );
}

/** A row that is one switch: an icon in a circle, the label and a hint, the switch drawn at the end. */
export function SwitchRow({ icon, label, hint, value, onChange, testID }: { icon: IconName; label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      {...(hint ? { accessibilityHint: hint } : {})}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingVertical: theme.space[2] }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: value ? theme.colors.accentTint : theme.colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={20} color={value ? 'accentText' : 'textMuted'} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {/* The row carries the switch role; the switch itself is only the look. */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch
          value={value}
          trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
        />
      </View>
    </Pressable>
  );
}

/** c7: «عندي جنطة كبيرة» as a switch with the bag, so the driver keeps room in the boot. */
export function BagSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return <SwitchRow testID="rajaa-large-bags" icon="bag" label={t('rajaa.large_bags')} hint={t('rajaa.large_bags_hint')} value={value} onChange={onChange} />;
}
