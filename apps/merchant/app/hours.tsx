import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { HoursShift } from '@driver/contracts';
import { Button, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { useServerNow } from '@/features/board/queries';
import { HolidaySheet, HolidaysPanel, ShiftSheet, WeekPanel } from '@/features/hours/HoursParts';
import {
  addHoliday,
  addShift,
  copyToAll,
  draftFrom,
  draftProblems,
  problemText,
  removeHoliday,
  removeShift,
  sameDraft,
  setDayOpen,
  stateLine,
  updateShift,
  type HoursDraft,
} from '@/features/hours/logic';
import { useSaveHours, useStoreHours } from '@/features/hours/queries';
import { useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { BusySheet, CloseStoreSheet } from '@/features/store/StoreSheets';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useDates } from '@/lib/dates';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { clock12, minutesLeft } from '@/lib/time';

/** A local date ("2026-10-20") as an instant at noon Baghdad, for the date formatters. */
const noon = (date: string) => new Date(`${date}T12:00:00+03:00`);

/**
 * الدوام والزحمة — open/close the store now (with the early-close reason), busy mode, and the weekly
 * opening hours: split shifts per day (lunch and dinner), shifts past midnight, the Friday-prayer
 * pause, and dated holiday closures. Owners edit (`merchant.setHours`); staff see the same, read-only.
 * Customers' cards and `orders.place` follow what is saved here.
 */
export default function Hours() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const dates = useDates();
  const { store } = useCurrentStore();
  const status = useStoreStatus(store?.orgId ?? null);
  const hours = useStoreHours(store?.orgId ?? null);
  const save = useSaveHours();
  const { setOpen } = useStoreSwitches();
  const now = useServerNow(0, 15_000);
  const [sheet, setSheet] = useState<'close' | 'busy' | 'holiday' | null>(null);
  const [editing, setEditing] = useState<{ dow: number; index: number } | null>(null);
  const [draft, setDraft] = useState<HoursDraft | null>(null);
  const remembered = useRef(new Map<number, HoursShift[]>());
  const s = status.data;
  const h = hours.data;

  const base = h ? draftFrom(h) : null;
  const current = draft ?? base;
  const dirty = Boolean(draft && base && !sameDraft(draft, base));
  const problems = current && dirty ? draftProblems(current) : [];
  const editable = Boolean(h?.canEdit);
  const dayMonth = (date: string) => dates.dayMonth(noon(date));
  const monthTitle = (date: string) =>
    `${t(`merchant.date.month_${Number(date.slice(5, 7))}` as TKey)} ${date.slice(0, 4)}`;
  const change = (f: (d: HoursDraft) => HoursDraft) => current && setDraft(f(current));

  const reopen = async () => {
    if (!s) return;
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: true });
      toast.show({ message: t('merchant.status.opened'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  const onSave = async () => {
    if (!current || !store || problems.length > 0) return;
    try {
      await save.mutateAsync({
        merchantOrgId: store.orgId,
        days: current.days,
        holidays: current.holidays,
      });
      setDraft(null);
      theme.haptic('success');
      toast.show({ message: t('merchant.hours.saved'), tone: 'success' });
    } catch (err) {
      toast.show({
        message:
          apiErrorCode(err) === 'store_hours_invalid'
            ? t('merchant.hours.problem_none')
            : apiErrorMessage(err, t('merchant.common.error'), locale),
        tone: 'danger',
      });
    }
  };

  const toggleDay = (dow: number, open: boolean) =>
    change((d) => {
      if (!open) remembered.current.set(dow, d.days.find((x) => x.dow === dow)?.shifts ?? []);
      return setDayOpen(d, dow, open, remembered.current.get(dow));
    });
  const add = (dow: number) => {
    if (!current) return;
    const count = current.days.find((d) => d.dow === dow)?.shifts.length ?? 0;
    setDraft(addShift(current, dow));
    setEditing({ dow, index: count });
  };
  const editingShift =
    editing && current
      ? (current.days.find((d) => d.dow === editing.dow)?.shifts[editing.index] ?? null)
      : null;
  const editingCount =
    editing && current ? (current.days.find((d) => d.dow === editing.dow)?.shifts.length ?? 0) : 0;

  const saveButton = (
    <Button
      testID="hours-save"
      label={t('merchant.hours.save')}
      icon="check"
      size="md"
      loading={save.isPending}
      disabled={problems.length > 0}
      onPress={() => void onSave()}
    />
  );
  const stateTone = h
    ? h.state.open
      ? 'success'
      : h.state.reason === 'closed'
        ? 'danger'
        : 'warning'
    : s?.open
      ? 'success'
      : 'danger';

  return (
    <Page
      title={t('merchant.hours.title')}
      back
      testID="hours"
      maxWidth={720}
      aside={dirty && editable ? saveButton : undefined}
    >
      {!s || !h || !current ? (
        <Skeleton height={140} radius={20} />
      ) : (
        <>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.space[5],
              gap: theme.space[4],
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                flexWrap: 'wrap',
              }}
            >
              <Text variant="label" color="textMuted">
                {t('merchant.hours.now')}
              </Text>
              <View testID="hours-state">
                <StatusPill tone={stateTone} dot label={stateLine(t, h, dayMonth)} />
              </View>
            </View>
            {s.closed ? (
              <Text variant="bodyStrong" color="dangerText">{`${t(`merchant.close_reason.${s.closed.reason}` as TKey)} · ${clock12(s.closed.at)}`}</Text>
            ) : null}
            {s.open ? (
              <Button testID="hours-close" label={t('merchant.status.close_confirm')} variant="destructive" size="lg" icon="x" onPress={() => setSheet('close')} />
            ) : s.closed ? (
              <Button testID="hours-open" label={t('merchant.board.open_again')} size="lg" icon="check" loading={setOpen.isPending} onPress={() => void reopen()} />
            ) : null}
            <Text variant="footnote" color="textMuted">
              {t('merchant.hours.prep_default', { minutes: s.defaultPrepMinutes })}
            </Text>
          </View>
          <EntryTile
            testID="hours-busy"
            icon="flame"
            title={t('merchant.busy_mode')}
            hint={s.busy.on && s.busy.until ? `${t('merchant.busy.ends_at', { time: clock12(s.busy.until) })} · ${t('merchant.common.minutes', { minutes: minutesLeft(s.busy.until, now) })}` : t('merchant.busy.sheet_body')}
            onPress={() => setSheet('busy')}
            trailing={
              <StatusPill
                tone={s.busy.on ? 'warning' : 'neutral'}
                label={s.busy.on ? '⁦+10⁩' : t('merchant.busy.turn_on')}
              />
            }
          />

          <WeekPanel
            draft={current}
            editable={editable}
            todayDow={new Date(noon(h.today)).getUTCDay()}
            pauses={h.pauses}
            problems={problems}
            onToggleDay={toggleDay}
            onEditShift={(dow, index) => setEditing({ dow, index })}
            onAddShift={add}
          />
          {!editable ? (
            <Note icon="shield" text={t('merchant.hours.owner_only')} />
          ) : h.source === 'catalog' && !dirty ? (
            <Note icon="note" text={t('merchant.hours.source_seed')} />
          ) : h.updatedAt && !dirty ? (
            <Note
              icon="clock"
              text={t('merchant.hours.updated_at', { when: dates.when(h.updatedAt, now) })}
            />
          ) : null}

          <HolidaysPanel
            holidays={current.holidays}
            editable={editable}
            today={h.today}
            dayMonth={dayMonth}
            onAdd={() => setSheet('holiday')}
            onRemove={(i) => change((d) => removeHoliday(d, i))}
          />

          {dirty && editable ? (
            <View
              testID="hours-savebar"
              style={{
                gap: theme.space[3],
                padding: theme.space[4],
                borderRadius: theme.radius.xl,
                backgroundColor:
                  problems.length > 0 ? theme.colors.dangerTint : theme.colors.accentTint,
              }}
            >
              {problems.length > 0 ? (
                problems.map((p, i) => (
                  <View
                    key={i}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}
                  >
                    <MIcon name="x" size={16} color="dangerText" strokeWidth={2.4} />
                    <Text
                      variant="label"
                      color="dangerText"
                      style={{ flex: 1 }}
                      testID="hours-problem"
                    >
                      {problemText(t, p)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text variant="label" color="accentText">
                  {t('merchant.hours.unsaved')}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
                <View style={{ flex: 1 }}>{saveButton}</View>
                <Button
                  testID="hours-discard"
                  label={t('merchant.hours.discard')}
                  variant="ghost"
                  size="md"
                  onPress={() => setDraft(null)}
                />
              </View>
            </View>
          ) : null}

          <CloseStoreSheet status={s} visible={sheet === 'close'} onClose={() => setSheet(null)} />
          <BusySheet
            status={s}
            visible={sheet === 'busy'}
            onClose={() => setSheet(null)}
            now={now}
          />
          <ShiftSheet
            visible={editing !== null && editingShift !== null}
            title={
              editing
                ? t('merchant.hours.pick_title', {
                    day: t(`merchant.date.dow_${editing.dow}` as TKey),
                    n: editing.index + 1,
                  })
                : ''
            }
            shift={editingShift}
            canRemove={editingCount > 1}
            onChange={(next) =>
              editing && change((d) => updateShift(d, editing.dow, editing.index, next))
            }
            onRemove={() => {
              if (editing) change((d) => removeShift(d, editing.dow, editing.index));
              setEditing(null);
            }}
            onCopyAll={() => {
              if (!editing) return;
              change((d) => copyToAll(d, editing.dow));
              toast.show({
                message: t('merchant.hours.copied', {
                  day: t(`merchant.date.dow_${editing.dow}` as TKey),
                }),
                tone: 'neutral',
              });
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
          <HolidaySheet
            visible={sheet === 'holiday'}
            today={h.today}
            dayMonth={dayMonth}
            monthTitle={monthTitle}
            onAdd={(holiday) => {
              change((d) => addHoliday(d, holiday));
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        </>
      )}
    </Page>
  );
}

function Note({ icon, text }: { icon: 'shield' | 'note' | 'clock'; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[2],
        marginTop: -theme.space[2],
      }}
    >
      <MIcon name={icon} size={16} color="textMuted" strokeWidth={2} />
      <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
