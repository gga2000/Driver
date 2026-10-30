import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { pluralKey } from '@driver/i18n';
import { Button, Icon, Text, useTheme, type IconName } from '@driver/ui';
import { DASH_MAX_WIDTH } from '@/features/home/DashParts';
import type { AttentionKind, WorkHint } from '@/features/home/logic';
import { driversKey, inZone, waitingKey } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { shadow } from './LiveTop';

/** What needs him, most urgent first (the home's attention order). */
export interface LiveNotice {
  key: AttentionKind;
  node: ReactNode;
  /** One short line for the folded strip; null = always shown in full (a job, a locked switch). */
  short: string | null;
  icon: IconName;
}

/** The bottom's cards never cover more than this share of the screen; the rest scrolls. */
const MAX_SHARE = 0.38;

/**
 * The live home's bottom, as in the concept: ONE slim card that says where the work is («الشغل هسة
 * بشارع 30 · 3 مطاعم تطبخ قريبك» with «روح هناك»), and the slide. A job or a locked switch shows in
 * full; anything else that needs him (cash near the cap, papers, an invite) is one short line above
 * the card that opens into its full card. Mode tiles (garage, run, practice) keep their cards.
 */
export function LiveBottom({ notices, extras, hint, kitchens, onGo, slide, onLayout }: { notices: LiveNotice[]; extras: ReactNode; hint: WorkHint | null; kitchens: number; onGo: () => void; slide: ReactNode; onLayout: (h: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const full = notices.filter((n) => n.short === null);
  const folded = notices.filter((n) => n.short !== null);
  const first = folded[0];
  const title = hint ? t('partner.hint_title', { where: inZone(hint.zoneId, t) }) : kitchens > 0 ? t('partner.live_kitchens_title') : null;
  const kitchensLine = kitchens > 0 ? t(pluralKey('partner.live_kitchens', kitchens), { n: kitchens }) : null;
  const sub = hint ? (hint.here ? t('partner.hint_here') : [kitchensLine ?? t(waitingKey(hint.waiting), { n: hint.waiting }), t(driversKey(hint.drivers), { n: hint.drivers })].join(' · ')) : kitchensLine;
  return (
    <View testID="live-sheet" pointerEvents="box-none" onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={{ position: 'absolute', bottom: 0, start: 0, end: 0, paddingHorizontal: theme.space[3], paddingBottom: theme.space[3] }}>
      <View pointerEvents="box-none" style={{ width: '100%', maxWidth: DASH_MAX_WIDTH, alignSelf: 'center', gap: theme.space[2] }}>
        <ScrollView style={{ maxHeight: Math.round(height * MAX_SHARE), flexGrow: 0 }} contentContainerStyle={{ gap: theme.space[2] }} showsVerticalScrollIndicator={false}>
          {full.map((n) => (
            <View key={n.key} style={{ borderRadius: 22, ...shadow }}>
              {n.node}
            </View>
          ))}
          {first ? (
            open ? (
              <View style={{ gap: theme.space[2] }}>
                {folded.map((n) => (
                  <View key={n.key} style={{ borderRadius: 22, ...shadow }}>
                    {n.node}
                  </View>
                ))}
              </View>
            ) : (
              <Pressable
                testID="live-notice"
                accessibilityRole="button"
                accessibilityLabel={`${first.short ?? ''}. ${t('partner.live_notice_open_a11y')}`}
                onPress={() => setOpen(true)}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[2],
                  paddingHorizontal: theme.space[4],
                  borderRadius: 999,
                  backgroundColor: theme.colors.warningTint,
                  opacity: pressed ? 0.9 : 1,
                  ...shadow,
                })}
              >
                <Icon name={first.icon} size={18} color="warningText" strokeWidth={2.2} />
                <Text variant="label" weight={700} color="warningText" numberOfLines={1} style={{ flex: 1 }}>
                  {first.short}
                </Text>
                {folded.length > 1 ? (
                  <Text variant="caption" weight={700} color="warningText" tabular>
                    {`+${folded.length - 1}`}
                  </Text>
                ) : null}
                <Icon name="chevron-down" size={18} color="warningText" />
              </Pressable>
            )
          ) : null}
          {extras}
          {title ? (
            <View testID="demand-row" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: 22, backgroundColor: theme.colors.surface, ...shadow }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="flame" size={22} color="accentText" strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" weight={700} numberOfLines={1}>
                  {title}
                </Text>
                {sub ? (
                  <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
                    {sub}
                  </Text>
                ) : null}
              </View>
              {hint && !hint.here ? <Button testID="hint-go" label={t('partner.hint_go')} icon="location-arrow" size="md" onPress={onGo} style={{ minHeight: 44, borderRadius: 999 }} /> : null}
            </View>
          ) : null}
        </ScrollView>
        {slide}
      </View>
    </View>
  );
}

/** A slim row over the map for a door into another part of the app (practice, the garage, the run, booked rides). */
export function LiveRow({ testID, icon, title, cta, onPress }: { testID: string; icon: IconName; title: string; cta: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${cta}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingStart: 6,
        paddingEnd: theme.space[4],
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        opacity: pressed ? 0.9 : 1,
        ...shadow,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={19} color="onInverseCaution" strokeWidth={2} />
      </View>
      <Text variant="label" weight={700} numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
      <Text variant="label" weight={700} color="accentText">
        {cta}
      </Text>
      <Icon name="chevron-forward" size={16} color="accentText" />
    </Pressable>
  );
}
