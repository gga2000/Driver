import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

const SHADOW = '0 2px 8px rgba(40,24,8,0.25)';

/** Half the school dot: the web lifts the pin by this so the dot's centre sits on the school. */
export const SCHOOL_DOT_R = 7;

/** «بيتكم»: a dark pill with the house, its tip on the child's own stop; the house alone when the bus is at the door. */
export function HomePin({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ alignItems: 'center' }} testID="khat-pin-home" accessibilityLabel={t('khat_bus.pin_home')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: compact ? 6 : theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.inverse, borderWidth: 1.5, borderColor: theme.colors.surface, boxShadow: SHADOW, direction: 'rtl' }}>
        <Icon name="home" size={16} color="onInverseAccent" strokeWidth={2.2} />
        {compact ? null : (
          <Text variant="footnote" weight={700} color="onInverse" compact>
            {t('khat_bus.pin_home')}
          </Text>
        )}
      </View>
      <Tip color={theme.colors.inverse} />
    </View>
  );
}

/** «المدرسة» (or the school's landmark): a white pill over a dark dot on the school; the dot alone when the bus is there. */
export function SchoolPin({ landmark, compact = false }: { landmark: string | null; compact?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ alignItems: 'center' }} testID="khat-pin-school" accessibilityLabel={landmark ?? t('khat_bus.pin_school')}>
      {compact ? null : (
        <View style={{ marginBottom: 4, paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: SHADOW, maxWidth: 180 }}>
          <Text variant="footnote" weight={700} numberOfLines={1} compact style={{ direction: 'rtl' }}>
            {landmark ?? t('khat_bus.pin_school')}
          </Text>
        </View>
      )}
      <View style={{ width: SCHOOL_DOT_R * 2, height: SCHOOL_DOT_R * 2, borderRadius: SCHOOL_DOT_R, backgroundColor: theme.colors.inverse, borderWidth: 2, borderColor: theme.colors.surface }} />
    </View>
  );
}

/** «الباص»: a saffron pill with the minibus, centred on the bus. */
export function BusPin() {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="khat-pin-bus" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.surface, boxShadow: SHADOW, direction: 'rtl' }}>
      <Icon name="rajaa" size={18} color="onAccent" strokeWidth={2.2} />
      <Text variant="footnote" weight={700} color="onAccent" compact>
        {t('khat_bus.pin_bus')}
      </Text>
    </View>
  );
}

/** The small pointer under a pill. */
function Tip({ color }: { color: string }) {
  return <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />;
}
