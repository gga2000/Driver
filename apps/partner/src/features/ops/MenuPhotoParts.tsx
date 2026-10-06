import { View } from 'react-native';
import type { MenuPhotoRequestView } from '@driver/contracts';
import { Card, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { baghdadClock, baghdadDate, dishesKey, visitDay, zoneOptions } from './logic';

/** "اليوم 4:00 م" / "باچر 10:00 ص" / "9/10/2026 4:00 م": when the visit is. */
export function useVisitLabel(): (at: Date) => string {
  const t = useT();
  const locale = useLocale();
  return (at) => {
    const day = visitDay(at, new Date());
    const dayText = day === 'today' ? t('partner.ops_mp_today') : day === 'tomorrow' ? t('partner.ops_mp_tomorrow') : baghdadDate(at);
    return t('partner.ops_mp_visit_at', { day: dayText, time: baghdadClock(at, locale) });
  };
}

/** The store's zone name (Western digits), or null when the store has no place on file. */
export function useZoneName(): (zoneKey: string | null) => string | null {
  const locale = useLocale();
  const zones = zoneOptions(locale);
  return (zoneKey) => (zoneKey ? (zones.find((z) => z.id === zoneKey)?.name ?? null) : null);
}

/**
 * One restaurant's request on the list and at the top of the shoot screen: store and area, how many
 * dishes, the merchant's note, and who has the visit when.
 */
export function RequestCard({ view, onPress, testID }: { view: MenuPhotoRequestView; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const visit = useVisitLabel();
  const zoneName = useZoneName()(view.zoneKey);
  const taken = view.photographerName !== null && !view.assignedToMe;
  return (
    <Card elevation={1} {...(onPress ? { onPress } : {})} {...(testID ? { testID } : {})} accessibilityLabel={view.storeName}>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" numberOfLines={1}>
              {view.storeName}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {[zoneName, view.wholeMenu ? t('partner.ops_mp_whole_menu', { n: view.counts.dishes }) : t(dishesKey(view.counts.dishes), { n: view.counts.dishes })].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {onPress ? <Icon name="chevron-forward" size={18} color="textMuted" /> : null}
        </View>
        {view.note ? (
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2] }}>
            <Text variant="footnote">{t('partner.ops_mp_note', { note: view.note })}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {view.assignedToMe ? <StatusPill size="sm" tone="accent" label={t('partner.ops_mp_yours')} /> : null}
          {taken ? <StatusPill size="sm" tone="neutral" label={t('partner.ops_mp_taken_by', { name: view.photographerName ?? '' })} /> : null}
          {view.state === 'requested' ? <StatusPill size="sm" tone="warning" label={t('partner.ops_mp_no_visit')} /> : null}
          {view.scheduledFor && view.state === 'scheduled' ? <StatusPill size="sm" tone="neutral" icon="clock" label={visit(view.scheduledFor)} /> : null}
          {view.state === 'shot' || view.state === 'done' ? <StatusPill size="sm" tone="success" icon="check" label={t('partner.ops_mp_handed_over')} /> : null}
        </View>
      </View>
    </Card>
  );
}
