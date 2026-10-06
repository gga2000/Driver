import { View } from 'react-native';
import type { Timetable } from '@driver/contracts';
import { Card, ChipGroup, Text, useTheme, useToast } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { useT } from '@/lib/i18n';
import { useTimetable } from './use-timetable';

const TIMETABLES: Timetable[] = ['sunni', 'shia'];

/**
 * «توقيت رمضان» (profile › notifications, J6): the timetable the person follows, picked once and
 * changed here any time. Two neutral choices, nothing preselected; kept on this phone.
 */
export function TimetablePicker() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const [pick, setPick] = useTimetable();
  return (
    <View style={{ gap: theme.space[3] }} testID="pref-ramadan-timetable">
      <SectionHeader title={t('season.timetable_title')} />
      <Card elevation={0} padding={4}>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="footnote" color="textMuted">
            {t('season.timetable_hint')}
            {pick === null ? ` · ${t('season.timetable_none')}` : ''}
          </Text>
          <ChipGroup
            items={TIMETABLES.map((tt) => ({ id: tt, label: t(tt === 'sunni' ? 'season.timetable_sunni' : 'season.timetable_shia') }))}
            value={pick ? [pick] : []}
            columns={2}
            onChange={(v) => {
              const next = v[0];
              if ((next === 'sunni' || next === 'shia') && next !== pick) {
                setPick(next);
                toast.show({ message: t('season.timetable_saved'), tone: 'success' });
              }
            }}
            accessibilityLabel={t('season.timetable_title')}
          />
        </View>
      </Card>
    </View>
  );
}
