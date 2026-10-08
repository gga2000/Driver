import { View } from 'react-native';
import { formatClock, type MessageKey } from '@driver/i18n';
import { Card, ListRow, SegmentedControl, useTheme } from '@driver/ui';
import { APPEARANCE_PREFS, saveAppearancePref, useAppearance, type AppearancePref } from '@/lib/appearance';
import { useT } from '@/lib/i18n';

const LABEL: Record<AppearancePref, MessageKey> = { auto: 'partner.look_auto', day: 'partner.look_day', night: 'partner.look_night' };

/** «شكل الشاشة» (n2): auto (dark from sunset in Aziziyah), always light, always dark. */
export function AppearanceCard() {
  const theme = useTheme();
  const t = useT();
  const look = useAppearance();
  const time = formatClock(look.nextChange, { offsetMin: 180 });
  const hint =
    look.pref === 'auto'
      ? t(look.dark ? 'partner.look_hint_auto_night' : 'partner.look_hint_auto_day', { time })
      : t(look.pref === 'night' ? 'partner.look_hint_night' : 'partner.look_hint_day');
  return (
    <Card elevation={0} padding={0} testID="appearance">
      <ListRow testID="appearance-row" leading={look.night ? 'moon' : 'bulb'} title={t('partner.look_title')} subtitle={hint} chevron={false} />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
        <SegmentedControl accessibilityLabel={t('partner.look_title')} value={look.pref} onChange={(p) => void saveAppearancePref(p)} options={APPEARANCE_PREFS.map((p) => ({ value: p, label: t(LABEL[p]) }))} />
      </View>
    </Card>
  );
}
