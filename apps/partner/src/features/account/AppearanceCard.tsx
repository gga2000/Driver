import { View } from 'react-native';
import { formatClock, type MessageKey } from '@driver/i18n';
import { Card, ListRow, SegmentedControl, Text, useTheme, type TextScale } from '@driver/ui';
import { APPEARANCE_PREFS, saveAppearancePref, useAppearance, type AppearancePref } from '@/lib/appearance';
import { useT } from '@/lib/i18n';
import { saveTextSize, TEXT_SIZES, useTextSize } from '@/lib/text-size';

const LABEL: Record<AppearancePref, MessageKey> = { auto: 'partner.look_auto', day: 'partner.look_day', night: 'partner.look_night' };
const SIZE_LABEL: Record<TextScale, MessageKey> = { normal: 'partner.text_size_normal', large: 'partner.text_size_large', largest: 'partner.text_size_largest' };

/**
 * «شكل الشاشة» (n2): auto (dark from sunset in Aziziyah), always light, always dark; then «حجم الخط»
 * (n6): three text sizes on top of the phone's own. Both change the whole app at once, this card included.
 */
export function AppearanceCard() {
  const theme = useTheme();
  const t = useT();
  const look = useAppearance();
  const size = useTextSize();
  const time = formatClock(look.nextChange, { offsetMin: 180 });
  const hint =
    look.pref === 'auto'
      ? t(look.dark ? 'partner.look_hint_auto_night' : 'partner.look_hint_auto_day', { time })
      : t(look.pref === 'night' ? 'partner.look_hint_night' : 'partner.look_hint_day');
  return (
    <Card elevation={0} padding={0} testID="appearance">
      <ListRow testID="appearance-row" leading={look.night ? 'moon' : 'bulb'} title={t('partner.look_title')} subtitle={hint} chevron={false} />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <SegmentedControl accessibilityLabel={t('partner.look_title')} value={look.pref} onChange={(p) => void saveAppearancePref(p)} options={APPEARANCE_PREFS.map((p) => ({ value: p, label: t(LABEL[p]) }))} />
      </View>
      <ListRow
        testID="text-size-row"
        leading={
          <View style={{ width: 40, height: 40, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Text fixed variant="bodyStrong" weight={700} style={{ fontSize: 20, lineHeight: 26 }}>
              {t('partner.text_size_glyph')}
            </Text>
          </View>
        }
        title={t('partner.text_size_title')}
        subtitle={t('partner.text_size_hint')}
        chevron={false}
      />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
        <SegmentedControl testIDPrefix="text-size" accessibilityLabel={t('partner.text_size_title')} value={size} onChange={(v) => void saveTextSize(v)} options={TEXT_SIZES.map((v) => ({ value: v, label: t(SIZE_LABEL[v]) }))} />
      </View>
    </Card>
  );
}
