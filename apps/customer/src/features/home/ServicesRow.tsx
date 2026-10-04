import { Pressable, View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';

export type ServiceId = 'food' | 'taxi' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: the tile is muted, badged "قريباً", and opens the "خبرني" sheet (audit C-03). */
  soon?: boolean;
}

/** Live services first (food leads), then the coming-soon ones. */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'food', label: 'home.service_food', icon: 'bag' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'car' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'garage' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart', soon: true },
  { id: 'khat', label: 'home.service_khat', icon: 'clock', soon: true },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel', soon: true },
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
          accessibilityLabel={s.soon ? t('soon.a11y', { name: t(s.label) }) : t(s.label)}
          onPress={() => {
            theme.haptic('selection');
            onPress(s.id);
          }}
          style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          <View style={{ width: '100%', maxWidth: 58, aspectRatio: 1 }}>
            <View
              style={{
                flex: 1,
                borderRadius: theme.radius.lg,
                backgroundColor: i === 0 ? theme.colors.accent : s.soon ? theme.colors.surfaceSunken : theme.colors.surface,
                borderWidth: i === 0 || s.soon ? 0 : 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={s.icon} size={26} color={i === 0 ? 'onAccent' : s.soon ? 'textMuted' : 'accentText'} strokeWidth={1.8} />
            </View>
            {s.soon ? (
              <View
                style={{
                  position: 'absolute',
                  bottom: -7,
                  alignSelf: 'center',
                  paddingHorizontal: 6,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text variant="caption" weight={600} color="textMuted" style={{ fontSize: 12, lineHeight: 16 }}>
                  {t('soon.badge')}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" weight={600} color={s.soon ? 'textMuted' : 'text'} numberOfLines={1} style={{ marginTop: 4 }}>
            {t(s.label)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
