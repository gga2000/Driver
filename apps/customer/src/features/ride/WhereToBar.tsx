import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import type { RideVertical } from './logic';
import { rideStore } from './store';
import { color as palette } from '@driver/design-tokens';

/** Opens the booking flow for a vehicle (home tile, the bar, its two shortcuts). */
export function startRide(vertical: RideVertical) {
  rideStore.start(vertical);
  router.push({ pathname: '/ride', params: { vertical } });
}

/**
 * "وين رايح؟" on home (customer spec §5): one tap into the ride flow, with the two vehicles as
 * shortcuts so the tuktuk has its own way in without crowding the services row.
 */
export function WhereToBar() {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="home-where-to"
      accessibilityRole="button"
      accessibilityLabel={`${t('ride.where_title')} ${t('ride.where_bar_sub')}`}
      onPress={() => {
        theme.haptic('selection');
        startRide('taxi');
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        paddingStart: theme.space[4],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.text,
        transform: [{ scale: pressed ? 0.985 : 1 }],
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.14,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" color="surface">
          {t('ride.where_title')}
        </Text>
        <Text variant="caption" color="surface" style={{ opacity: 0.72 }} numberOfLines={1}>
          {t('ride.where_bar_sub')}
        </Text>
      </View>
      <Shortcut testID="where-to-taxi" icon="car" label={t('ride.vehicle_taxi')} onPress={() => startRide('taxi')} />
      <Shortcut testID="where-to-tuktuk" icon="tuktuk" label={t('ride.vehicle_tuktuk')} onPress={() => startRide('tuktuk')} />
    </Pressable>
  );
}

function Shortcut({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        width: 60,
        height: 60,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.accent,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} size={24} color="onAccent" strokeWidth={2} />
      <Text variant="caption" weight={700} color="onAccent" style={{ lineHeight: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}
