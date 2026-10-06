import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { Glyph } from '@/features/menu/Glyph';
import { useT } from '@/lib/i18n';
import { usePot } from './queries';

/**
 * The «قدر اليوم» row on top of the menu (joy h2): today's dish when one is set, otherwise the nudge
 * to post one — last week's same day when there was one, so the usual answer is one more tap away.
 * Hidden until the pot is read (and when the read fails: the menu below still works).
 */
export function PotEntry({ merchantOrgId }: { merchantOrgId: string | null }) {
  const theme = useTheme();
  const t = useT();
  const pot = usePot(merchantOrgId);
  if (!pot.data) return null;
  const v = pot.data;
  const line = v.today ? v.today.name : v.lastWeek ? t('merchant.pot.entry_last_week', { dish: v.lastWeek.name }) : t('merchant.pot.entry_none');
  return (
    <Pressable
      testID="menu-pot"
      accessibilityRole="button"
      accessibilityLabel={`${t('merchant.pot.title')}: ${line}`}
      onPress={() => router.push('/pot')}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, padding: theme.space[3], borderRadius: theme.radius.xl, borderWidth: 1, borderColor: v.today ? theme.colors.accent : theme.colors.border, backgroundColor: v.today ? theme.colors.accentTint : theme.colors.surface, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: v.today ? theme.colors.surface : theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name="flame" size={19} color="accentText" strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="caption" weight={600} color="accentText">
          {t('merchant.pot.title')}
        </Text>
        <Text variant="bodyStrong" numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Glyph name="chevron-forward" size={20} color="textMuted" />
    </Pressable>
  );
}
