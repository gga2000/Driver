import { Pressable, View } from 'react-native';
import { VEHICLE_COLOUR_HEX, type VehicleColour, type VehicleFeature } from '@driver/contracts';
import { Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { COLOUR_ORDER, colourKey, FEATURE_HINT_KEY, featureKey, type FeatureState } from './logic';

/**
 * The car's colour as a dot of real paint (`VEHICLE_COLOUR_HEX`, not a brand colour), ringed so a
 * white or silver car still shows on the cream background.
 */
export function ColourDot({ colour, size = 14 }: { colour: VehicleColour; size?: number }) {
  const theme = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: VEHICLE_COLOUR_HEX[colour], borderWidth: 1, borderColor: theme.colors.borderStrong }} />;
}

/** «اللون» on a new vehicle: every colour as a swatch with its Iraqi name; one tap picks it. */
export function ColourSwatches({ value, onChange, testID }: { value: VehicleColour | null; onChange: (c: VehicleColour) => void; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[1] }}>
      {COLOUR_ORDER.map((c) => {
        const on = value === c;
        return (
          <Pressable
            key={c}
            testID={`colour-${c}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(colourKey(c))}
            onPress={() => onChange(c)}
            style={{
              width: 64,
              minHeight: 68,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: theme.radius.lg,
              borderWidth: on ? 2 : 1,
              borderColor: on ? theme.colors.accent : 'transparent',
              backgroundColor: on ? theme.colors.accentTint : 'transparent',
            }}
          >
            <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <ColourDot colour={c} size={30} />
              {on ? (
                <View style={{ position: 'absolute', bottom: -3, end: -3, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.surface, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={11} color="onAccent" strokeWidth={3} />
                </View>
              ) : null}
            </View>
            <Text variant="caption" weight={on ? 600 : 400} color={on ? 'accentText' : 'textMuted'} numberOfLines={1}>
              {t(colourKey(c))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Where a saved feature stands, as a pill: riders see it, or it waits for the car check. */
export function FeatureStatePill({ state }: { state: FeatureState }) {
  const t = useT();
  if (state === 'off') return null;
  return state === 'confirmed' ? (
    <StatusPill size="sm" tone="success" icon="check" label={t('partner.features_confirmed')} />
  ) : (
    <StatusPill size="sm" tone="neutral" icon="clock" label={t('partner.features_pending')} />
  );
}

/**
 * One feature he can tick: its name and what it promises, a check box, and (once saved) whether
 * riders see it yet. Every ticked row looks the same — the app's one "ticked" style (check-up item 8,
 * Ali 2026-10-09): saffron edge, soft saffron fill, saffron box with the check.
 */
export function FeatureToggle({ feature, on, saved, onPress }: { feature: VehicleFeature; on: boolean; saved: FeatureState; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={`feature-${feature}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityHint={t(FEATURE_HINT_KEY[feature])}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[4],
        minHeight: 64,
        borderRadius: theme.radius.lg,
        borderWidth: on ? 2 : 1,
        borderColor: on ? theme.colors.selectedBorder : theme.colors.border,
        backgroundColor: on ? theme.colors.selectedSoft : theme.colors.surface,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}>
          <Text variant="bodyStrong" color={on ? 'onSelectedSoft' : 'text'}>
            {t(featureKey(feature))}
          </Text>
          {on ? <FeatureStatePill state={saved} /> : null}
        </View>
        <Text variant="footnote" color="textMuted">
          {t(FEATURE_HINT_KEY[feature])}
        </Text>
      </View>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          borderWidth: on ? 0 : 1.5,
          borderColor: theme.colors.borderStrong,
          backgroundColor: on ? theme.colors.selectedMark : theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? <Icon name="check" size={16} color="onSelectedMark" strokeWidth={2.5} /> : null}
      </View>
    </Pressable>
  );
}
