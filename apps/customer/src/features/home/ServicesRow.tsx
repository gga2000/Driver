import { Pressable, View, type ViewStyle } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';

export type ServiceId = 'food' | 'taxi' | 'tuktuk' | 'rajaa' | LaunchService;

export interface ServiceDef {
  id: ServiceId;
  label: MessageKey;
  icon: IconName;
  /** Not open yet: listed in the quiet «جاي بالطريق» strip, opens the "خبرني" sheet (audit C-03). */
  soon?: boolean;
}

/** The live services, food first (spec §1: food-led), then the coming-soon ones. */
export const SERVICES: readonly ServiceDef[] = [
  { id: 'food', label: 'home.service_food', icon: 'food' },
  { id: 'taxi', label: 'home.service_taxi', icon: 'taxi' },
  { id: 'tuktuk', label: 'home.service_tuktuk', icon: 'tuktuk-fringe' },
  { id: 'rajaa', label: 'home.service_rajaa', icon: 'rajaa' },
  { id: 'grocery', label: 'home.service_grocery', icon: 'cart', soon: true },
  { id: 'khat', label: 'home.service_khat', icon: 'clock', soon: true },
  { id: 'parcel', label: 'home.service_parcel', icon: 'parcel', soon: true },
];

/** Height of one mobility tile; the أكل tile spans two of them and the gap. */
const TILE_H = 64;

/**
 * The one service grid on home (audit C-09) as the Istikan bento (joy b1, report 5 §5 A): أكل is the
 * tall tile on the start side in tea, its name in the hand-lettered voice — the food-led lead; تكسي,
 * تكتك and الرجعة sit beside it in kashi wash (kashi = what moves). Each service has exactly one way
 * in. The coming-soon ones are not here: `ComingSoonStrip` lists them at the end of home.
 */
export function ServicesRow({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  const [food, taxi, tuktuk, rajaa] = SERVICES;
  const press = (id: ServiceId) => {
    theme.haptic('selection');
    onPress(id);
  };
  const gap = theme.space[3];
  const tile = (s: ServiceDef, style: ViewStyle) => (
    <Pressable
      key={s.id}
      testID={`service-${s.id}`}
      accessibilityRole="button"
      accessibilityLabel={t(s.label)}
      onPress={() => press(s.id)}
      style={({ pressed }) => [
        {
          height: TILE_H,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.liveTint,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space[2],
          paddingHorizontal: theme.space[2],
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      <Icon name={s.icon} size={24} color="liveText" strokeWidth={1.9} />
      <Text variant="label" weight={600} color="liveText" numberOfLines={1} compact style={{ flexShrink: 1 }}>
        {t(s.label)}
      </Text>
    </Pressable>
  );
  return (
    <View testID="home-services" style={{ flexDirection: 'row', gap }}>
      <Pressable
        testID={`service-${food!.id}`}
        accessibilityRole="button"
        accessibilityLabel={t(food!.label)}
        onPress={() => press(food!.id)}
        style={({ pressed }) => ({
          flex: 1,
          height: TILE_H * 2 + gap,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.accent,
          padding: theme.space[3],
          justifyContent: 'space-between',
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <Icon name={food!.icon} size={32} color="onAccent" strokeWidth={1.9} />
        <Text variant="voice" face="voice" color="onAccent" numberOfLines={1}>
          {t(food!.label)}
        </Text>
      </Pressable>
      <View style={{ flex: 2, gap }}>
        <View style={{ flexDirection: 'row', gap }}>
          {tile(taxi!, { flex: 1 })}
          {tile(tuktuk!, { flex: 1 })}
        </View>
        {tile(rajaa!, {})}
      </View>
    </View>
  );
}

/**
 * «جاي بالطريق»: the services that aren't open yet (سوق، خطوط، طرود), quiet at the end of home
 * (discovery §6) rather than dead tiles in the grid. Each opens the "خبرني" sheet.
 */
export function ComingSoonStrip({ onPress }: { onPress: (id: ServiceId) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="home-soon" style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600} color="textMuted" accessibilityRole="header">
        {t('home.soon_coming')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {SERVICES.filter((s) => s.soon).map((s) => (
          <Pressable
            key={s.id}
            testID={`service-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('soon.a11y', { name: t(s.label) })}
            onPress={() => {
              theme.haptic('selection');
              onPress(s.id);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minHeight: theme.hitTarget,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
            })}
          >
            <Icon name={s.icon} size={16} color="textMuted" strokeWidth={2} />
            <Text variant="footnote" weight={600} color="textMuted" numberOfLines={1} compact>
              {t(s.label)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
