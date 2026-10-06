import { View } from 'react-native';
import type { Timetable } from '@driver/contracts';
import { formatClock, formatMinutes } from '@driver/i18n';
import { Card, ChipGroup, Icon, Text, useNow, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { useSeason } from '@/lib/use-season';
import { seasonCard, type RamadanLine } from './ramadan';
import { useTimetable } from './use-timetable';

const TIMETABLES: Timetable[] = ['sunni', 'shia'];

/**
 * The calm season card on home (customer joy J6): in Ramadan the countdown to iftar (or until when
 * suhoor runs) on the timetable the person follows, and the two neutral choices until they pick one;
 * at Eid «عيدكم مبارك» without naming the day; on a special Friday ops' own line. Nothing festive on a
 * quiet day: the Ramadan card stays (it is service), plain, and Eid's hides (the server decides).
 * Renders nothing on an ordinary day, and before the first season read (an ordinary day).
 */
export function SeasonCard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const season = useSeason();
  const [pick, setPick] = useTimetable();
  const tick = useNow(season.homeCard !== null, 30_000);
  const model = seasonCard(season, pick, new Date(tick));
  if (!model) return null;

  const tone = model.accent ? 'tint' : 'surface';
  const label = (tt: Timetable) => t(tt === 'sunni' ? 'season.timetable_sunni' : 'season.timetable_shia');

  if (model.kind === 'ramadan') {
    const title = model.title ?? t('season.ramadan_title');
    const line = model.line;
    return (
      <Card testID="home-season" tone={tone} elevation={0} padding={4}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="title" face={model.title ? undefined : 'voice'} numberOfLines={2}>
            {title}
          </Text>
          {line === 'pick' ? (
            <View style={{ gap: theme.space[3] }} testID="home-season-pick">
              <Text variant="footnote" color="textMuted">
                {t('season.pick_prompt')}
              </Text>
              <ChipGroup
                items={TIMETABLES.map((tt) => ({ id: tt, label: label(tt) }))}
                value={[]}
                columns={2}
                onChange={(v) => {
                  const next = v[0];
                  if (next === 'sunni' || next === 'shia') setPick(next);
                }}
                accessibilityLabel={t('season.timetable_title')}
              />
            </View>
          ) : (
            <RamadanLineView line={line} timetable={pick === null ? null : label(pick)} locale={locale} />
          )}
        </View>
      </Card>
    );
  }

  if (model.kind === 'eid') {
    return (
      <Card testID="home-season" tone={tone} elevation={0} padding={4}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="title" face={model.title ? undefined : 'voice'} numberOfLines={2}>
            {model.title ?? t('season.eid_title')}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('season.eid_body')}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card testID="home-season" tone={tone} elevation={0} padding={4}>
      <Text variant="bodyStrong" numberOfLines={3}>
        {model.title}
      </Text>
    </Card>
  );
}

function RamadanLineView({ line, timetable, locale }: { line: RamadanLine; timetable: string | null; locale: ReturnType<typeof useLocale> }) {
  const theme = useTheme();
  const t = useT();
  if (line.kind === 'none') return null;
  const main = line.kind === 'iftar' ? t('season.iftar_in', { time: formatMinutes(line.minutes, { locale }) }) : t('season.suhoor_until', { time: formatClock(line.at, { locale }) });
  const meta = [line.kind === 'iftar' ? t('season.iftar_at', { time: formatClock(line.at, { locale }) }) : null, timetable ? t('season.by_timetable', { timetable }) : null].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: theme.space[1] }} testID={`home-season-${line.kind}`} accessible accessibilityLabel={`${main}، ${meta}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="clock" size={18} color="textMuted" />
        <Text variant="bodyStrong" tabular style={{ flex: 1 }}>
          {main}
        </Text>
      </View>
      <Text variant="caption" color="textMuted" tabular>
        {meta}
      </Text>
    </View>
  );
}
