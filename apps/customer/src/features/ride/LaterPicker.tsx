import { useState } from 'react';
import { baghdadDate } from '@driver/contracts';
import { Pressable, ScrollView, View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { formatClock, formatDay, formatWhen } from '@driver/i18n';
import { Button, Icon, ModalSheet, SegmentedControl, Text, useTheme, withAlpha } from '@driver/ui';
import { hourOptions, hoursByPart, minuteOptions, scheduleAt, SCHEDULE_DAYS, settleChoice, type HourPart, type ScheduleChoice, type ScheduleDay } from '@/features/ride-habits/logic';
import { useT } from '@/lib/i18n';

const PART_LABEL: Record<HourPart, MessageKey> = {
  morning: 'ride.later_part_morning',
  noon: 'ride.later_part_noon',
  evening: 'ride.later_part_evening',
  late: 'ride.later_part_late',
};

/**
 * «وكتها» on the choose screen (step 4, c10): «هسة / بعدين». «بعدين» opens a calm picker — the day
 * (اليوم · باچر · the weekdays after, as far as the server books; a day runs 5:00 to 4:59, so «بعد نص
 * الليل» closes it), the hour by part of the day in big tiles, then the quarter by the button — and the
 * chosen time stays in a summary row with «غيّر الوكت». Closing the
 * picker before choosing leaves the ride for now. The fare above is the server's quote for that time.
 */
export function WhenPicker({
  when,
  onWhen,
  choice,
  onChoice,
  now,
}: {
  when: 'now' | 'later';
  onWhen: (w: 'now' | 'later') => void;
  choice: ScheduleChoice;
  onChoice: (c: ScheduleChoice) => void;
  now: Date;
}) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  // Each opening starts a fresh draft from what the screen holds (the sheet remounts on its key).
  const [opened, setOpened] = useState(0);
  const show = () => {
    setOpened((n) => n + 1);
    setOpen(true);
  };
  const at = scheduleAt(now, choice);
  return (
    <View style={{ gap: theme.space[2] }} testID="ride-when">
      <Text variant="label" weight={600} color="textMuted">
        {t('ride.when')}
      </Text>
      <SegmentedControl
        accessibilityLabel={t('ride.when')}
        value={when}
        onChange={(w) => (w === 'later' ? show() : onWhen('now'))}
        options={[
          { value: 'now', label: t('ride.when_now') },
          { value: 'later', label: t('ride.when_later') },
        ]}
      />
      {when === 'later' ? (
        <View style={{ gap: theme.space[2] }}>
          <Pressable
            testID="ride-when-summary"
            accessibilityRole="button"
            accessibilityLabel={`${t('ride.later_summary_label')} ${formatWhen(at, now)}، ${t('ride.later_change')}`}
            onPress={show}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: 64,
              padding: theme.space[3],
              borderRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.accent,
              backgroundColor: pressed ? theme.colors.accentTint : withAlpha(theme.colors.accentTint, 0.55),
            })}
          >
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="clock" size={22} color="onAccent" strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="caption" color="textMuted">
                {t('ride.later_summary_label')}
              </Text>
              <Text variant="title" tabular testID="ride-when-at">
                {formatWhen(at, now)}
              </Text>
              <Text variant="caption" color="textMuted">
                {t('ride.later_quote_note')}
              </Text>
            </View>
            <Text variant="label" weight={600} color="accentText">
              {t('ride.later_change')}
            </Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Icon name="bell" size={15} color="liveText" strokeWidth={2} />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }} testID="ride-when-hint">
              {t('ride.later_hint')}
            </Text>
          </View>
        </View>
      ) : null}
      <LaterSheet
        key={opened}
        visible={open}
        now={now}
        initial={choice}
        onClose={() => setOpen(false)}
        onPick={(c) => {
          onChoice(c);
          onWhen('later');
          setOpen(false);
        }}
      />
    </View>
  );
}

/** The day, the hour and the quarter — big targets, only what the server will take. */
function LaterSheet({ visible, now, initial, onClose, onPick }: { visible: boolean; now: Date; initial: ScheduleChoice; onClose: () => void; onPick: (c: ScheduleChoice) => void }) {
  const theme = useTheme();
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const c = settleChoice(now, draft);
  const at = scheduleAt(now, c);
  const days = SCHEDULE_DAYS.filter((d) => hourOptions(now, d).length > 0);
  const minutes = minuteOptions(now, c.day, c.hour);
  const set = (next: Partial<ScheduleChoice>) => setDraft(settleChoice(now, { ...c, ...next }));
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={t('ride.later_title')}
      sheetMaxWidth={560}
      testID="ride-later-sheet"
      footer={
        // The quarter stays by the button, so the hour list can be as long as the day.
        <View style={{ gap: theme.space[3] }}>
          {minutes.length > 0 ? (
            <SegmentedControl
              accessibilityLabel={t('ride.when_minute')}
              value={String(c.minute) as '0' | '15' | '30' | '45'}
              onChange={(v) => set({ minute: Number(v) })}
              options={minutes.map((m) => ({ value: String(m) as '0' | '15' | '30' | '45', label: formatClock(scheduleAt(now, { ...c, minute: m }), { period: false }) }))}
            />
          ) : null}
          <Button testID="ride-later-pick" size="lg" fullWidth label={t('ride.later_pick', { when: formatWhen(at, now) })} onPress={() => onPick(c)} />
        </View>
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" weight={600} color="textMuted">
            {t('ride.later_day')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} accessibilityRole="radiogroup" testID="ride-later-days">
            {days.map((d) => (
              <DayTile key={d} day={d} now={now} selected={c.day === d} onPress={() => set({ day: d })} />
            ))}
          </ScrollView>
        </View>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="label" weight={600} color="textMuted">
            {t('ride.later_hour')}
          </Text>
          {hoursByPart(hourOptions(now, c.day)).map((g) => (
            <View key={g.part} style={{ gap: theme.space[2] }} testID={`ride-later-part-${g.part}`}>
              <Text variant="caption" weight={600} color="textMuted">
                {t(PART_LABEL[g.part])}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} accessibilityRole="radiogroup">
                {g.hours.map((h) => (
                  <Tile key={h} label={formatClock(scheduleAt(now, { day: c.day, hour: h, minute: 0 }), { period: false })} selected={c.hour === h} onPress={() => set({ hour: h })} testID={`ride-later-hour-${h}`} />
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>
    </ModalSheet>
  );
}

function DayTile({ day, now, selected, onPress }: { day: ScheduleDay; now: Date; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const noon = scheduleAt(now, { day, hour: 12, minute: 0 });
  // Between midnight and 5:00 the first day is the night the rider is in: «الليلة», today's date.
  const tonight = baghdadDate(noon) < baghdadDate(now);
  const [, month, dom] = baghdadDate(tonight ? now : noon).split('-').map(Number);
  const date = t('time.date', { day: dom!, month: month! });
  const name = tonight ? t('ride.later_tonight') : formatDay(noon, now);
  return (
    <Pressable
      testID={`ride-later-day-${day}`}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${name} ${date}`}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minWidth: 76,
        minHeight: 64,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? withAlpha(theme.colors.accentTint, 0.55) : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <Text variant="label" weight={selected ? 700 : 600}>
        {name}
      </Text>
      <Text variant="caption" color="textMuted" tabular>
        {date}
      </Text>
    </Pressable>
  );
}

function Tile({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        // Four to a row, filling it (at least 72 × 52 on a phone).
        width: '23%',
        minWidth: 64,
        height: 52,
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accent : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <Text variant="title" tabular color={selected ? 'onAccent' : 'text'} style={{ fontSize: 18 }}>
        {label}
      </Text>
    </Pressable>
  );
}
