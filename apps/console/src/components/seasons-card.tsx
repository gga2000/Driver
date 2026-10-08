'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SHIA_MAGHRIB_OFFSET_MIN, SHIA_OFFSET_RANGE, type SeasonKind, type SeasonView, type Timetable } from '@driver/contracts';
import { formatClock, t } from '@driver/i18n';
import { useId, useState, type FormEvent } from 'react';
import { queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { baghdadInstant, baghdadToday, quietRange, seasonSwitchesOn } from '@/lib/quiet';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Checkbox, Chip, Field, Input, Segmented, Select, useToast, type ChipTone } from './ui';

const KINDS: SeasonKind[] = ['quiet', 'ramadan', 'eid', 'friday_special'];
const KIND_TONE: Record<SeasonKind, ChipTone> = { quiet: 'neutral', ramadan: 'live', eid: 'done', friday_special: 'neutral' };
const kindLabel = (k: SeasonKind) => t(`console.season_kind_${k}`);
const SWITCH_LABEL = {
  celebrations: 'console.season_sw_celebrations',
  sounds: 'console.season_sw_sounds',
  promos: 'console.season_sw_promos',
  accent: 'console.season_sw_accent',
  card: 'console.season_sw_card',
} as const;
const timetableLabel = (tt: Timetable) => t(tt === 'sunni' ? 'season.timetable_sunni' : 'season.timetable_shia');
/** "5:39 م" on the city clock for an HH:MM on a day. */
const clockOf = (day: string, hhmm: string) => formatClock(baghdadInstant(day, hhmm));

/**
 * Seasons (customer joy J6; grew from the J1a quiet-days card): mourning days switch every app's
 * celebrations, sounds and offers off; Ramadan and Eid show a calm home card; Ramadan carries iftar
 * and suhoor on both timetables, and ops can set any day's iftar to the local mosque's time. Admins
 * set and remove periods; everyone on the Console sees them.
 */
export function SeasonsCard({ signedIn, canEdit }: { signedIn: boolean; canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { from: useId(), to: useId(), label: useId(), card: useId(), offset: useId() };
  const today = baghdadToday();
  const [kind, setKind] = useState<SeasonKind>('quiet');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [label, setLabel] = useState('');
  const [switches, setSwitches] = useState({ celebrations: true, sounds: true, promos: true, accent: true, homeCard: true });
  const [cardText, setCardText] = useState('');
  const [offset, setOffset] = useState('');
  const list = useQuery(trpc.system.seasons.queryOptions(undefined, { enabled: signedIn, refetchInterval: 60_000, retry: queryRetry }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.system.seasons.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.system.quietDays.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
  };
  const set = useMutation(
    trpc.system.setSeason.mutationOptions({
      onSuccess: () => {
        setLabel('');
        setCardText('');
        refresh();
        toast({ title: t('console.season_saved'), tone: 'ok' });
      },
    }),
  );
  const clear = useMutation(
    trpc.system.clearSeason.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: t('console.season_cleared_toast'), tone: 'ok' });
      },
    }),
  );

  const quiet = kind === 'quiet';
  const trimmed = label.trim();
  const text = cardText.trim();
  const offsetNum = offset.trim() === '' ? null : Number(offset);
  const offsetOk = offsetNum === null || (Number.isInteger(offsetNum) && offsetNum >= SHIA_OFFSET_RANGE.min && offsetNum <= SHIA_OFFSET_RANGE.max);
  const cardOk = quiet || text.length === 0 || text.length >= 3;
  const fridayOk = kind !== 'friday_special' || !switches.homeCard || text.length >= 3;
  const valid = trimmed.length >= 3 && startsOn >= today && endsOn >= startsOn && offsetOk && cardOk && fridayOk;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    set.mutate({
      cityId: null,
      kind,
      startsOn,
      endsOn,
      label_ar: trimmed,
      ...(quiet ? {} : { ...switches, homeCardAr: text || null }),
      ...(kind === 'ramadan' ? { shiaOffsetMin: offsetNum } : {}),
    });
  };
  const rows = (list.data ?? []).filter((q) => !q.clearedAt && q.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const toggle = (k: keyof typeof switches) => (v: boolean) => setSwitches((s) => ({ ...s, [k]: v }));

  return (
    <Card title={t('console.season_title')} hint={t('console.season_hint')} actions={!canEdit ? <Chip>{t('console.banner_admin_only')}</Chip> : undefined}>
      {rows.length > 0 ? (
        <ul className="mb-5 space-y-2">
          {rows.map((q) => (
            <SeasonRow key={q.id} season={q} canEdit={canEdit} clearing={clear.isPending && clear.variables?.seasonId === q.id} onClear={() => clear.mutate({ seasonId: q.id })} onSaved={refresh} />
          ))}
        </ul>
      ) : list.data ? (
        <p className="mb-4 text-sm text-muted">{t('console.season_empty')}</p>
      ) : null}
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-60">
          <Segmented label={t('console.season_kind')} options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} value={kind} onChange={setKind} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('console.quiet_from')} htmlFor={ids.from} className="w-40">
              <Input
                id={ids.from}
                type="date"
                min={today}
                value={startsOn}
                onChange={(e) => {
                  setStartsOn(e.target.value);
                  if (endsOn < e.target.value) setEndsOn(e.target.value);
                }}
              />
            </Field>
            <Field label={t('console.quiet_to')} htmlFor={ids.to} className="w-40">
              <Input id={ids.to} type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
            <Field label={t('console.quiet_label')} htmlFor={ids.label} className="min-w-[14rem] flex-1">
              <Input id={ids.label} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={quiet ? t('console.quiet_placeholder') : t('console.season_label_placeholder')} />
            </Field>
          </div>
          {!quiet && (
            <div className="space-y-3 rounded-md border border-line bg-surface-2 px-3 py-3">
              <p className="text-dense font-medium">{t('console.season_switches')}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Checkbox label={t('console.season_sw_celebrations')} checked={switches.celebrations} onChange={toggle('celebrations')} />
                <Checkbox label={t('console.season_sw_sounds')} checked={switches.sounds} onChange={toggle('sounds')} />
                <Checkbox label={t('console.season_sw_promos')} checked={switches.promos} onChange={toggle('promos')} />
                <Checkbox label={t('console.season_sw_accent')} checked={switches.accent} onChange={toggle('accent')} />
                <Checkbox label={t('console.season_sw_card')} checked={switches.homeCard} onChange={toggle('homeCard')} />
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <Field label={t('console.season_card_text')} hint={t('console.season_card_text_hint')} htmlFor={ids.card} className="min-w-[14rem] flex-1">
                  <Input id={ids.card} maxLength={80} value={cardText} onChange={(e) => setCardText(e.target.value)} placeholder={kind === 'eid' ? t('season.eid_title') : kind === 'ramadan' ? t('season.ramadan_title') : ''} />
                </Field>
                {kind === 'ramadan' && (
                  <Field label={t('console.season_shia_offset')} hint={t('console.season_shia_offset_hint', { n: DEFAULT_SHIA_MAGHRIB_OFFSET_MIN })} htmlFor={ids.offset} className="w-56">
                    <Input id={ids.offset} type="number" inputMode="numeric" min={SHIA_OFFSET_RANGE.min} max={SHIA_OFFSET_RANGE.max} value={offset} onChange={(e) => setOffset(e.target.value)} placeholder={String(DEFAULT_SHIA_MAGHRIB_OFFSET_MIN)} />
                  </Field>
                )}
              </div>
            </div>
          )}
          <Button type="submit" variant="primary" needsNet disabled={!valid} loading={set.isPending}>
            {t('console.season_save')}
          </Button>
        </fieldset>
        {set.error && <p className="mt-2 text-sm text-bad">{errorText(set.error)}</p>}
      </form>
    </Card>
  );
}

function SeasonRow({ season: q, canEdit, clearing, onClear, onSaved }: { season: SeasonView; canEdit: boolean; clearing: boolean; onClear: () => void; onSaved: () => void }) {
  const on = seasonSwitchesOn(q);
  return (
    <li className="rounded-md border border-line bg-surface-2 px-3 py-2.5" data-testid={`season-${q.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Chip tone={q.active ? 'warn' : 'neutral'} dot size="sm">
              {q.active ? t('console.quiet_now') : t('console.quiet_coming')}
            </Chip>
            <Chip tone={KIND_TONE[q.kind]} size="sm">
              {kindLabel(q.kind)}
            </Chip>
            <span className="min-w-0">{q.label_ar}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {quietRange(q.startsOn, q.endsOn)} · {on.length === 0 ? t('console.season_all_off') : t('console.season_on_list', { list: on.map((s) => t(SWITCH_LABEL[s])).join(t('console.list_sep')) })}
            {q.homeCardAr ? ` · «${q.homeCardAr}»` : ''} · {q.setByName ?? t('console.someone')}
          </p>
        </div>
        {canEdit && (
          <Button variant="danger-soft" size="sm" needsNet loading={clearing} onClick={onClear}>
            {t('console.quiet_clear')}
          </Button>
        )}
      </div>
      {q.kind === 'ramadan' && q.days.length > 0 && <RamadanTimes season={q} canEdit={canEdit} onSaved={onSaved} />}
    </li>
  );
}

/** Both timetables for every day of the period, with one-day fixes to the local mosque's time. */
function RamadanTimes({ season: q, canEdit, onSaved }: { season: SeasonView; canEdit: boolean; onSaved: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const ids = { day: useId(), tt: useId(), time: useId() };
  const [day, setDay] = useState(q.days[0]?.day ?? q.startsOn);
  const [timetable, setTimetable] = useState<Timetable>('shia');
  const [time, setTime] = useState('');
  const fix = useMutation(
    trpc.system.setIftarTime.mutationOptions({
      onSuccess: () => {
        setTime('');
        onSaved();
        toast({ title: t('console.season_fix_saved'), tone: 'ok' });
      },
    }),
  );
  const cell = (d: SeasonView['days'][number], tt: Timetable) => (
    <td className="px-2 py-1 tabular-nums">
      {clockOf(d.day, d[tt].iftar)}
      {d[tt].overridden ? (
        <Chip tone="warn" size="sm" className="ms-1">
          {t('console.season_overridden')}
        </Chip>
      ) : null}
      <span className="block text-xs text-muted">
        {t('console.season_suhoor')} {clockOf(d.day, d[tt].suhoor)}
      </span>
    </td>
  );
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm font-medium text-accent-text">{t('console.season_times')}</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-start text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-2 py-1 text-start font-medium">{t('console.season_col_day')}</th>
              <th className="px-2 py-1 text-start font-medium">
                {t('console.season_iftar')} · {timetableLabel('sunni')}
              </th>
              <th className="px-2 py-1 text-start font-medium">
                {t('console.season_iftar')} · {timetableLabel('shia')}
              </th>
            </tr>
          </thead>
          <tbody>
            {q.days.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="px-2 py-1 tabular-nums">{quietRange(d.day, d.day)}</td>
                {cell(d, 'sunni')}
                {cell(d, 'shia')}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (time) fix.mutate({ seasonId: q.id, day, timetable, time });
          }}
        >
          <p className="w-full text-dense font-medium">{t('console.season_fix')}</p>
          <Field label={t('console.season_fix_day')} htmlFor={ids.day} className="w-32">
            <Select id={ids.day} value={day} onChange={(e) => setDay(e.target.value)}>
              {q.days.map((d) => (
                <option key={d.day} value={d.day}>
                  {quietRange(d.day, d.day)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('console.season_fix_timetable')} htmlFor={ids.tt} className="w-44">
            <Select id={ids.tt} value={timetable} onChange={(e) => setTimetable(e.target.value === 'sunni' ? 'sunni' : 'shia')}>
              <option value="sunni">{timetableLabel('sunni')}</option>
              <option value="shia">{timetableLabel('shia')}</option>
            </Select>
          </Field>
          <Field label={t('console.season_fix_time')} htmlFor={ids.time} className="w-32">
            <Input id={ids.time} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" size="sm" disabled={!time} loading={fix.isPending && fix.variables?.time !== null}>
            {t('console.season_fix_save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" loading={fix.isPending && fix.variables?.time === null} onClick={() => fix.mutate({ seasonId: q.id, day, timetable, time: null })}>
            {t('console.season_fix_reset')}
          </Button>
          {fix.error && <p className="w-full text-sm text-bad">{errorText(fix.error)}</p>}
        </form>
      )}
    </details>
  );
}
