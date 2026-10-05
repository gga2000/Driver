import { Pressable, View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';

export type ServiceId = 'food' | 'taxi' | 'tuktuk' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: listed in the quiet "قريباً" strip, opens the "خبرني" sheet (audit C-03). */
  soon?: boolean;
}

/** The live services, food first (spec §1: food-led), then the coming-soon ones. */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'food', label: 'home.service_food', icon: 'bag' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'car' },
  { id: 'tuktuk', label: 'home.service_tuktuk', icon: 'tuktuk' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'garage' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart', soon: true },
  { id: 'khat', label: 'home.service_khat', icon: 'clock', soon: true },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel', soon: true },
];

/**
 * The one service grid on home (audit C-09): four live doors of equal weight — أكل (the lead, in
 * accent), تكسي, تكتك, الرجعة — so each service has exactly one way in (no second taxi bar), and the
 * coming-soon ones in a quiet strip under it rather than as dead tiles in the grid.
 */
export function ServicesRow({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  const live = SERVICES.filter((s) => !s.soon);
  const soon = SERVICES.filter((s) => s.soon);
  const press = (id: ServiceId) => {
    theme.haptic('selection');
    onPress(id);
  };
  return (
    <View style={{ gap: theme.space[3] }}>
      <View testID="home-services" style={{ flexDirection: 'row', gap: theme.space[3] }}>
        {live.map((s, i) => {
          const lead = i === 0;
          return (
            <Pressable
              key={s.id}
              testID={`service-${s.id}`}
              accessibilityRole="button"
              accessibilityLabel={t(s.label)}
              onPress={() => press(s.id)}
              style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.95 : 1 }] })}
            >
              <View
                style={{
                  width: '100%',
                  height: 60,
                  borderRadius: theme.radius.lg,
                  backgroundColor: lead ? theme.colors.accent : theme.colors.surface,
                  borderWidth: lead ? 0 : 1,
                  borderColor: theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={s.icon} size={28} color={lead ? 'onAccent' : 'accentText'} strokeWidth={1.8} />
              </View>
              <Text variant="label" weight={600} numberOfLines={1}>
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View testID="home-soon" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="caption" weight={600} color="textMuted">
          {t('home.soon_strip')}
        </Text>
        {soon.map((s) => (
          <Pressable
            key={s.id}
            testID={`service-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('soon.a11y', { name: t(s.label) })}
            onPress={() => press(s.id)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              height: 32,
              paddingHorizontal: theme.space[2] + 2,
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
            })}
          >
            <Icon name={s.icon} size={15} color="textMuted" strokeWidth={2} />
            <Text variant="caption" weight={600} color="textMuted" numberOfLines={1}>
              {t(s.label)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
