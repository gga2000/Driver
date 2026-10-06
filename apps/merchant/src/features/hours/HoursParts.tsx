import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  addLocalDays,
  type HolidayClosure,
  type HoursProblem,
  type HoursShift,
  type StorePauseView,
} from '@driver/contracts';
import { Button, ModalSheet, Text, TextField, useTheme, withAlpha } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Panel, Tag } from '@/components/Panel';
import { Glyph } from '@/features/menu/Glyph';
import { Toggle } from '@/features/menu/parts';
import { useT, type TKey } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import {
  daysForm,
  flagged,
  holidayDays,
  shiftLabel,
  timeChoices,
  timeLabel,
  WEEK_ORDER,
  type HoursDraft,
} from './logic';

// ───────────────────────── the week ─────────────────────────

/**
 * Seven days, Saturday first: each day open or closed (a switch for the owner), its shifts as pills
 * (tap to change the times; up to three — lunch and dinner), the Friday-prayer pause under Friday.
 * Rows with a problem (overlap, too short) turn red before the save is tried.
 */
export function WeekPanel({
  draft,
  editable,
  todayDow,
  pauses,
  problems,
  onToggleDay,
  onEditShift,
  onAddShift,
}: {
  draft: HoursDraft;
  editable: boolean;
  todayDow: number;
  pauses: readonly StorePauseView[];
  problems: readonly HoursProblem[];
  onToggleDay: (dow: number, open: boolean) => void;
  onEditShift: (dow: number, index: number) => void;
  onAddShift: (dow: number) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  return (
    <Panel
      title={t('merchant.hours.weekly_title')}
      caption={t('merchant.hours.weekly_caption')}
      icon="store"
      flush
      testID="hours-week"
    >
      {WEEK_ORDER.map((dow, i) => {
        const day = draft.days.find((d) => d.dow === dow) ?? { dow, shifts: [] };
        const open = day.shifts.length > 0;
        const bad = flagged(problems, dow);
        const dayPauses = pauses.filter((p) => p.dow === dow);
        return (
          <View
            key={dow}
            testID={`hours-day-${dow}`}
            style={{
              gap: theme.space[2],
              paddingHorizontal: theme.space[5],
              paddingVertical: theme.space[3],
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
              backgroundColor: bad
                ? theme.colors.dangerTint
                : dow === todayDow
                  ? withAlpha(theme.colors.accent, 0.06)
                  : 'transparent',
            }}
          >
            {(() => {
              const name = (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[2],
                    width: wide ? 150 : undefined,
                    flex: wide ? undefined : 1,
                  }}
                >
                  <Text variant="bodyStrong">{t(`merchant.date.dow_${dow}` as TKey)}</Text>
                  {dow === todayDow ? (
                    <Tag label={t('merchant.hours.today')} tone="accent" />
                  ) : null}
                </View>
              );
              const toggle = editable ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                  <Text variant="caption" color={open ? 'successText' : 'textMuted'} weight={600}>
                    {open ? t('merchant.hours.open_switch') : t('merchant.hours.day_closed')}
                  </Text>
                  <Toggle
                    testID={`hours-day-toggle-${dow}`}
                    label={t('merchant.hours.closed_switch')}
                    value={open}
                    onChange={(v) => onToggleDay(dow, v)}
                  />
                </View>
              ) : null;
              const pills = (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: theme.space[2],
                    flex: wide ? 1 : undefined,
                  }}
                >
                  {open ? (
                    day.shifts.map((s, index) => (
                      <ShiftPill
                        key={`${s.start}-${index}`}
                        shift={s}
                        bad={flagged(problems, dow, index) && bad}
                        editable={editable}
                        onPress={() => onEditShift(dow, index)}
                        testID={`hours-shift-${dow}-${index}`}
                      />
                    ))
                  ) : (
                    <Text variant="label" color="textMuted" testID={`hours-closed-${dow}`}>
                      {t('merchant.hours.day_closed')}
                    </Text>
                  )}
                  {editable && open && day.shifts.length < 3 ? (
                    <Pressable
                      testID={`hours-add-${dow}`}
                      accessibilityRole="button"
                      onPress={() => onAddShift(dow)}
                      hitSlop={4}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        height: 40,
                        paddingHorizontal: theme.space[3],
                        borderRadius: theme.radius.pill,
                        borderWidth: 1.5,
                        borderStyle: 'dashed',
                        borderColor: theme.colors.borderStrong,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <MIcon name="plus" size={16} color="textMuted" strokeWidth={2.2} />
                      <Text variant="label" color="textMuted" weight={600}>
                        {t('merchant.hours.add_shift')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
              return wide ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[3],
                    minHeight: 44,
                  }}
                >
                  {name}
                  {pills}
                  {toggle}
                </View>
              ) : (
                <>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.space[2],
                      minHeight: 32,
                    }}
                  >
                    {name}
                    {toggle}
                  </View>
                  {pills}
                </>
              );
            })()}
            {dayPauses.map((p) => (
              <View
                key={`${p.start}-${p.end}`}
                testID={`hours-pause-${dow}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[2],
                  paddingStart: wide ? 150 + theme.space[3] : 0,
                }}
              >
                <MIcon name="hourglass" size={16} color="warningText" strokeWidth={2} />
                <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
                  {`${p.reason ?? t('merchant.hours.prayer_title')}: ${t('merchant.hours.shift', { start: timeLabel(t, p.start), end: timeLabel(t, p.end) })}`}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </Panel>
  );
}

function ShiftPill({
  shift,
  bad,
  editable,
  onPress,
  testID,
}: {
  shift: HoursShift;
  bad: boolean;
  editable: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={editable ? 'button' : 'text'}
      disabled={!editable}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        height: 40,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        backgroundColor: bad ? theme.colors.surface : theme.colors.successTint,
        borderWidth: bad ? 1.5 : 0,
        borderColor: theme.colors.danger,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <MIcon name="clock" size={16} color={bad ? 'dangerText' : 'successText'} strokeWidth={2.2} />
      <Text variant="label" weight={600} color={bad ? 'dangerText' : 'successText'}>
        {shiftLabel(t, shift)}
      </Text>
      {editable ? (
        <Glyph name="pencil" size={14} color={bad ? 'dangerText' : 'successText'} strokeWidth={2} />
      ) : null}
    </Pressable>
  );
}

// ───────────────────────── one shift's times ─────────────────────────

const MINUTES = ['00', '15', '30', '45'] as const;

/**
 * Pick a shift's start and end: the hours in the order a kitchen's day runs (6 الصبح … 5 الصبح) and
 * the minutes. Applies as you tap; remove the shift, or copy this day's shifts to the whole week.
 */
export function ShiftSheet({
  visible,
  title,
  shift,
  canRemove,
  onChange,
  onRemove,
  onCopyAll,
  onClose,
}: {
  visible: boolean;
  title: string;
  shift: HoursShift | null;
  canRemove: boolean;
  onChange: (s: HoursShift) => void;
  onRemove: () => void;
  onCopyAll: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [side, setSide] = useState<'start' | 'end'>('start');
  useEffect(() => {
    if (visible) setSide('start');
  }, [visible]);
  const hours = useMemo(() => timeChoices(60), []);
  if (!visible || !shift) return null;
  const value = shift[side];
  const [hh, mm] = value.split(':') as [string, string];
  const set = (next: string) => onChange({ ...shift, [side]: next });
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="shift-sheet"
      title={title}
      subtitle={shiftLabel(t, shift)}
      size="lg"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="shift-done"
            label={t('merchant.hours.pick_done')}
            size="lg"
            fullWidth
            onPress={onClose}
          />
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button
              testID="shift-copy-all"
              label={t('merchant.hours.copy_all')}
              variant="secondary"
              size="md"
              style={{ flex: 1 }}
              onPress={onCopyAll}
            />
            {canRemove ? (
              <Button
                testID="shift-remove"
                label={t('merchant.hours.remove_shift')}
                variant="ghost"
                size="md"
                style={{ flex: 1 }}
                onPress={onRemove}
              />
            ) : null}
          </View>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="tablist">
        {(['start', 'end'] as const).map((k) => {
          const selected = side === k;
          return (
            <Pressable
              key={k}
              testID={`shift-side-${k}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setSide(k)}
              style={{
                flex: 1,
                paddingVertical: theme.space[2],
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.accent : theme.colors.border,
                backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
                gap: 2,
              }}
            >
              <Text variant="caption" color={selected ? 'accentText' : 'textMuted'} weight={600}>
                {k === 'start' ? t('merchant.hours.pick_start') : t('merchant.hours.pick_end')}
              </Text>
              <Text variant="title" tabular>
                {timeLabel(t, shift[k])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('merchant.hours.minutes_label')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2], direction: 'ltr' }}>
          {MINUTES.map((m) => {
            const selected = m === mm;
            return (
              <Pressable
                key={m}
                testID={`shift-min-${m}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => set(`${hh}:${m}`)}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? theme.colors.text : theme.colors.border,
                  backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface,
                }}
              >
                <Text variant="label" weight={selected ? 700 : 500} tabular>
                  {m}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
        testID={`shift-hours-${side}`}
      >
        {hours.map((h) => {
          const hour = h.slice(0, 2);
          const selected = hour === hh;
          return (
            <Pressable
              key={h}
              testID={`shift-hour-${hour}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                theme.haptic('selection');
                set(`${hour}:${mm}`);
              }}
              style={({ pressed }) => ({
                width: '15%',
                minWidth: 84,
                flexGrow: 1,
                height: 44,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.text : theme.colors.border,
                backgroundColor: selected
                  ? theme.colors.surfaceSunken
                  : pressed
                    ? theme.colors.surfaceSunken
                    : theme.colors.surface,
              })}
            >
              <Text variant="label" weight={selected ? 700 : 500}>
                {timeLabel(t, `${hour}:00`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ModalSheet>
  );
}

// ───────────────────────── holidays ─────────────────────────

export function daysCount(
  t: (k: TKey, p?: Record<string, string | number>) => string,
  n: number,
): string {
  const form = daysForm(n);
  return form === 'one'
    ? t('merchant.hours.holiday_days_one')
    : form === 'few'
      ? t('merchant.hours.holiday_days_few', { n })
      : t('merchant.hours.holiday_days_many', { n });
}

/** Upcoming closures: the dates, how many days, the reason; the owner adds and removes them. */
export function HolidaysPanel({
  holidays,
  editable,
  today,
  dayMonth,
  onAdd,
  onRemove,
}: {
  holidays: readonly HolidayClosure[];
  editable: boolean;
  today: string;
  dayMonth: (date: string) => string;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <Panel
      title={t('merchant.hours.holidays_title')}
      caption={t('merchant.hours.holidays_caption')}
      icon="power"
      flush
      testID="hours-holidays"
      aside={
        editable ? (
          <Button
            testID="holiday-add"
            label={t('merchant.hours.holiday_add')}
            icon="plus"
            size="sm"
            variant="secondary"
            onPress={onAdd}
          />
        ) : undefined
      }
    >
      {holidays.length === 0 ? (
        <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[5] }}>
          {t('merchant.hours.holidays_empty')}
        </Text>
      ) : (
        holidays.map((h, i) => {
          const now = h.from <= today && today <= h.to;
          return (
            <View
              key={`${h.from}-${h.to}`}
              testID={`holiday-${i}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                paddingHorizontal: theme.space[5],
                paddingVertical: theme.space[3],
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: now ? theme.colors.dangerTint : theme.colors.warningTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Glyph
                  name="calendar"
                  size={20}
                  color={now ? 'dangerText' : 'warningText'}
                  strokeWidth={2}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" tabular>
                  {h.from === h.to
                    ? dayMonth(h.from)
                    : t('merchant.hours.holiday_range', {
                        from: dayMonth(h.from),
                        to: dayMonth(h.to),
                      })}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {[daysCount(t, holidayDays(h)), h.note].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {now ? <Tag label={t('merchant.hours.today')} tone="danger" /> : null}
              {editable ? (
                <Pressable
                  testID={`holiday-remove-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('merchant.hours.holiday_remove')}
                  hitSlop={8}
                  onPress={() => onRemove(i)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Glyph name="trash" size={20} color="textMuted" strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
    </Panel>
  );
}

/** Two months from today, Sunday first; tap the first day, then the last (or the same day again). */
export function HolidaySheet({
  visible,
  today,
  dayMonth,
  monthTitle,
  onAdd,
  onClose,
}: {
  visible: boolean;
  today: string;
  dayMonth: (date: string) => string;
  monthTitle: (date: string) => string;
  onAdd: (h: HolidayClosure) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (visible) {
      setFrom(null);
      setTo(null);
      setNote('');
      setPage(0);
    }
  }, [visible]);
  if (!visible) return null;
  const firstOfMonth = monthStart(today, page);
  const pick = (date: string) => {
    theme.haptic('selection');
    if (!from || (from && to)) {
      setFrom(date);
      setTo(null);
    } else if (date < from) {
      setTo(from);
      setFrom(date);
    } else setTo(date);
  };
  const range = from ? { from, to: to ?? from } : null;
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="holiday-sheet"
      title={t('merchant.hours.holiday_sheet_title')}
      subtitle={
        range
          ? range.from === range.to
            ? dayMonth(range.from)
            : t('merchant.hours.holiday_range', {
                from: dayMonth(range.from),
                to: dayMonth(range.to),
              })
          : t('merchant.hours.holiday_sheet_body')
      }
      size="lg"
      footer={
        <Button
          testID="holiday-confirm"
          label={t('merchant.hours.holiday_confirm')}
          size="lg"
          fullWidth
          disabled={!range}
          onPress={() =>
            range && onAdd({ from: range.from, to: range.to, note: note.trim() || null })
          }
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Pressable
          testID="holiday-prev"
          accessibilityRole="button"
          accessibilityLabel="‹"
          disabled={page === 0}
          onPress={() => setPage((p) => Math.max(0, p - 1))}
          hitSlop={6}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: page === 0 ? 0.3 : 1,
          }}
        >
          <MIcon name="chevron-forward" size={20} color="text" />
        </Pressable>
        <Text variant="title" align="center" style={{ flex: 1 }}>
          {monthTitle(firstOfMonth)}
        </Text>
        <Pressable
          testID="holiday-next"
          accessibilityRole="button"
          accessibilityLabel="›"
          disabled={page >= 2}
          onPress={() => setPage((p) => Math.min(2, p + 1))}
          hitSlop={6}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: page >= 2 ? 0.3 : 1,
          }}
        >
          <MIcon name="chevron-back" size={20} color="text" />
        </Pressable>
      </View>
      <MonthGrid first={firstOfMonth} today={today} range={range} onPick={pick} />
      {from && to ? null : (
        <Text variant="footnote" color="textMuted" align="center">
          {from ? t('merchant.hours.holiday_pick_to') : t('merchant.hours.holiday_pick_from')}
        </Text>
      )}
      <TextField
        testID="holiday-note"
        label={t('merchant.hours.holiday_note')}
        placeholder={t('merchant.hours.holiday_note_ph')}
        value={note}
        onChangeText={setNote}
        maxLength={80}
      />
    </ModalSheet>
  );
}

/** `YYYY-MM-01` of the month `offset` months after the one `today` is in. */
function monthStart(today: string, offset: number): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

function MonthGrid({
  first,
  today,
  range,
  onPick,
}: {
  first: string;
  today: string;
  range: { from: string; to: string } | null;
  onPick: (date: string) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const startDow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const [y, m] = first.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: days }, (_, i) => addLocalDays(first, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <View style={{ gap: 4 }} testID="holiday-month">
      <View style={{ flexDirection: 'row' }}>
        {Array.from({ length: 7 }, (_, d) => (
          <Text key={d} variant="caption" color="textMuted" align="center" style={{ flex: 1 }}>
            {t(`merchant.hours.dow_short_${d}` as TKey)}
          </Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={w} style={{ flexDirection: 'row' }}>
          {week.map((date, i) => {
            if (!date) return <View key={i} style={{ flex: 1, height: 44 }} />;
            const past = date < today;
            const inRange = range !== null && range.from <= date && date <= range.to;
            const edge = range !== null && (date === range.from || date === range.to);
            return (
              <Pressable
                key={date}
                testID={`holiday-day-${date}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: past, selected: inRange }}
                disabled={past}
                onPress={() => onPick(date)}
                style={{
                  flex: 1,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: inRange && !edge ? theme.colors.warningTint : 'transparent',
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: edge ? theme.colors.text : 'transparent',
                    borderWidth: date === today && !edge ? 1.5 : 0,
                    borderColor: theme.colors.accent,
                  }}
                >
                  <Text
                    variant="label"
                    weight={edge ? 700 : 500}
                    tabular
                    color={edge ? 'surface' : past ? 'textMuted' : 'text'}
                    style={past ? { opacity: 0.45 } : undefined}
                  >
                    {String(Number(date.slice(8, 10)))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
