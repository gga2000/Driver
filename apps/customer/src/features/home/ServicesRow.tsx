import { Pressable, View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';

export type ServiceId = 'food' | 'grocery' | 'taxi' | 'rajaa' | 'khat' | 'parcel';

export const SERVICES: readonly { id: ServiceId; label: MessageKey; icon: IconName }[] = [
  { id: 'food', label: 'home.service_food', icon: 'bag' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'car' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'garage' },
  { id: 'khat', label: 'home.service_khat', icon: 'clock' },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel' },
];

/** Compact "all services" row near the top of home (spec §1): six equal tiles, food first. */
export function ServicesRow({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
      {SERVICES.map((s, i) => (
        <Pressable
          key={s.id}
          testID={`service-${s.id}`}
          accessibilityRole="button"
          accessibilityLabel={t(s.label)}
          onPress={() => {
            theme.haptic('selection');
            onPress(s.id);
          }}
          style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 58,
              aspectRatio: 1,
              borderRadius: theme.radius.lg,
              backgroundColor: i === 0 ? theme.colors.accent : theme.colors.surface,
              borderWidth: i === 0 ? 0 : 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={s.icon} size={26} color={i === 0 ? 'onAccent' : 'accentText'} strokeWidth={1.8} />
          </View>
          <Text variant="caption" weight={600} numberOfLines={1}>
            {t(s.label)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
