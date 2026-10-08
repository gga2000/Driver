import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { SERVICES, type ServiceId } from './ServicesRow';

/** The soft chips' drawn height; `hitSlop` makes each a full tap target. */
const CHIP_H = 32;

/**
 * Home's ending (concept C, Ali 2026-10-08): one quiet line for what isn't open yet («جاي قريب»
 * and a soft chip per service, each opens its «خبرني لمن تنفتح» sheet), then a warm «بالعافية» in
 * the brand's voice and who it's from. The send-off shows only while kitchens are open.
 */
export function QuietEnd({ onSoon, bye }: { onSoon: (id: ServiceId) => void; bye: boolean }) {
  const theme = useTheme();
  const t = useT();
  const soon = SERVICES.filter((s) => s.soon);
  const slop = Math.max(0, (theme.hitTarget - CHIP_H) / 2);
  return (
    <View testID="home-soon" style={{ gap: theme.space[8], paddingTop: theme.space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[2], rowGap: theme.space[3] }}>
        <Icon name="bell" size={16} color="textMuted" />
        <Text variant="footnote" color="textMuted">
          {t('home.soon_line')}
        </Text>
        {soon.map((s) => (
          <Pressable
            key={s.id}
            testID={`service-${s.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('soon.a11y', { name: t(s.label) })}
            accessibilityHint={t('home.soon_notify')}
            hitSlop={{ top: slop, bottom: slop }}
            onPress={() => {
              theme.haptic('selection');
              onSoon(s.id);
            }}
            style={({ pressed }) => ({
              minHeight: CHIP_H,
              justifyContent: 'center',
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.pill,
              backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
            })}
          >
            <Text variant="footnote" weight={600} compact>
              {t(s.label)}
            </Text>
          </Pressable>
        ))}
      </View>
      {bye ? (
        <View testID="home-bye" style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="section" face="voice" color="accentText" align="center">
            {t('home.bye')}
          </Text>
          <Text variant="caption" color="textMuted" align="center">
            {t('home.bye_from')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
