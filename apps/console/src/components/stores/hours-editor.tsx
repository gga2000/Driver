'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { STORE_HOURS_RULES, storeHoursProblems, type DayHours, type HolidayClosure, type StoreHoursView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { queryRetry } from '@/lib/live';
import { useConsoleNetwork } from '@/lib/network';
import { canAddShift, everyDay, readClock, sameAsDayBefore, sundayFirst } from '@/lib/store-setup';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, cx, IconButton, IconClose, IconPlus, Input, QueryError, Skeleton } from '../ui';
import { WhyField } from './store-shop';
import { useStoreWrite } from './store-write';

const DAY_KEY = ['console.stores.dow_0', 'console.stores.dow_1', 'console.stores.dow_2', 'console.stores.dow_3', 'console.stores.dow_4', 'console.stores.dow_5', 'console.stores.dow_6'] as const;
const PRESETS: ReadonlyArray<[string, string]> = [
  ['12:00', '00:00'],
  ['08:00', '23:00'],
  ['16:00', '01:00'],
];

/** A shift as typed (its text kept until it reads as a time). */
type Draft = { dow: number; shifts: Array<{ start: string; end: string }> };

/**
 * «الدوام»: the owner's weekly hours, typed (no hour grid), with one-tap starts («كل يوم 12 الظهر لـ 12
 * بالليل»), «مثل اليوم اللي قبله», up to three shifts a day for a split day, and holiday closures. The
 * same checks as the owner's screen run before saving, and the server checks them again.
 */
export function HoursEditor({ storeId, canEdit }: { storeId: string; canEdit: boolean }) {
  const trpc = useTRPC();
  const hours = useQuery(trpc.ops.stores.hours.queryOptions({ merchantOrgId: storeId }, { retry: queryRetry }));
  if (hours.error) return <QueryError error={hours.error} onRetry={() => void hours.refetch()} />;
  if (!hours.data) {
    return (
      <Card>
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }
  return <HoursForm key={String(hours.dataUpdatedAt)} view={hours.data} storeId={storeId} canEdit={canEdit} />;
}

function HoursForm({ view, storeId, canEdit }: { view: StoreHoursView; storeId: string; canEdit: boolean }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const net = useConsoleNetwork();
  const [days, setDays] = useState<Draft[]>(() => sundayFirst(view.days));
  const [holidays, setHolidays] = useState<HolidayClosure[]>(view.holidays);
  const [why, setWhy] = useState('');
  const save = useMutation(trpc.ops.stores.setHours.mutationOptions(write.handlers(t('console.stores.hours_saved'))));

  const read: DayHours[] | null = days.every((d) => d.shifts.every((s) => readClock(s.start) && readClock(s.end)))
    ? days.map((d) => ({ dow: d.dow, shifts: d.shifts.map((s) => ({ start: readClock(s.start)!, end: readClock(s.end)! })) }))
    : null;
  const problems = read ? storeHoursProblems(read, holidays) : [];
  const dayProblem = (dow: number) => problems.find((p) => 'dow' in p && p.dow === dow);
  const off = !canEdit || net.state === 'offline';
  const setDay = (dow: number, shifts: Draft['shifts']) => setDays((ds) => ds.map((d) => (d.dow === dow ? { dow, shifts } : d)));

  return (
    <Card title={t('console.stores.hours_title')} hint={view.source === 'none' ? t('console.stores.hours_none') : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-dense text-muted">{t('console.stores.hours_quick')}</span>
        {PRESETS.map(([a, b]) => (
          <Button key={a + b} size="sm" disabled={off} onClick={() => setDays(everyDay(a, b))}>
            <bdi dir="ltr" className="num">{`${a}–${b}`}</bdi>
          </Button>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-line/70">
        {days.map((d) => {
          const p = dayProblem(d.dow);
          return (
            <li key={d.dow} className="flex flex-wrap items-start gap-3 py-3" data-testid={`day-${d.dow}`}>
              <span className="w-20 pt-2.5 text-sm font-medium text-text">{t(DAY_KEY[d.dow]!)}</span>
              <div className="min-w-0 flex-1 space-y-2">
                {d.shifts.length === 0 ? <p className="pt-2.5 text-sm text-muted">{t('console.stores.day_closed')}</p> : null}
                {d.shifts.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <ClockInput label={t('console.stores.shift_from')} value={s.start} disabled={off} onChange={(v) => setDay(d.dow, d.shifts.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                    <span className="text-muted">{t('console.stores.shift_to')}</span>
                    <ClockInput label={t('console.stores.shift_until')} value={s.end} disabled={off} onChange={(v) => setDay(d.dow, d.shifts.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                    <IconButton label={t('console.stores.shift_remove')} disabled={off} onClick={() => setDay(d.dow, d.shifts.filter((_, j) => j !== i))}>
                      <IconClose size={16} />
                    </IconButton>
                  </div>
                ))}
                {p ? (
                  <p role="alert" className="text-xs text-bad">
                    {t(p.code === 'shift_overlap' ? 'console.stores.hours_overlap' : 'console.stores.hours_short')}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {canAddShift(d) ? (
                  <Button size="sm" variant="ghost" disabled={off} icon={<IconPlus size={14} />} onClick={() => setDay(d.dow, [...d.shifts, d.shifts.length === 0 ? { start: '12:00', end: '00:00' } : { start: '', end: '' }])}>
                    {d.shifts.length === 0 ? t('console.stores.day_open') : t('console.stores.shift_add')}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={off} onClick={() => setDays((ds) => sameAsDayBefore(ds as DayHours[], d.dow))}>
                  {t('console.stores.same_as_before')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <section className="mt-4 border-t border-line pt-4" aria-labelledby="holidays">
        <h3 id="holidays" className="text-sm font-semibold text-text">
          {t('console.stores.holidays')}
        </h3>
        <p className="text-xs text-muted">{t('console.stores.holidays_hint')}</p>
        <ul className="mt-2 space-y-2">
          {holidays.map((h, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input type="date" aria-label={t('console.stores.holiday_from')} value={h.from} disabled={off} onChange={(e) => setHolidays((hs) => hs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} className="h-11 !w-44" />
              <span className="text-muted">{t('console.stores.shift_to')}</span>
              <Input type="date" aria-label={t('console.stores.holiday_to')} value={h.to} disabled={off} onChange={(e) => setHolidays((hs) => hs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className="h-11 !w-44" />
              <Input aria-label={t('console.stores.holiday_note')} placeholder={t('console.stores.holiday_note')} value={h.note ?? ''} maxLength={80} disabled={off} onChange={(e) => setHolidays((hs) => hs.map((x, j) => (j === i ? { ...x, note: e.target.value || null } : x)))} className="h-11 !w-48" />
              <IconButton label={t('console.stores.holiday_remove')} disabled={off} onClick={() => setHolidays((hs) => hs.filter((_, j) => j !== i))}>
                <IconClose size={16} />
              </IconButton>
              {problems.some((p) => !('dow' in p) && 'index' in p && p.index === i) ? <span className="text-xs text-bad">{t('console.stores.holiday_bad')}</span> : null}
            </li>
          ))}
        </ul>
        {holidays.length < STORE_HOURS_RULES.maxHolidays ? (
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            disabled={off}
            icon={<IconPlus size={14} />}
            onClick={() => {
              const today = view.today;
              setHolidays((hs) => [...hs, { from: today, to: today, note: null }]);
            }}
          >
            {t('console.stores.holiday_add')}
          </Button>
        ) : null}
      </section>

      <div className="mt-4 space-y-3 border-t border-line pt-4">
        <WhyField value={why} onChange={setWhy} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cx('max-w-[52ch] text-xs', problems.some((p) => p.code === 'no_open_day') ? 'text-bad' : 'text-muted')}>
            {!read ? t('console.stores.hours_typo') : problems.some((p) => p.code === 'no_open_day') ? t('console.stores.hours_no_day') : t('console.stores.hours_audited')}
          </p>
          <Button
            size="lg"
            variant="primary"
            disabled={off || !read || problems.length > 0}
            loading={save.isPending}
            onClick={() => read && save.mutate({ merchantOrgId: storeId, days: read, holidays, ...(why.trim() ? { why: why.trim() } : {}) })}
          >
            {t('console.stores.hours_save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ClockInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const bad = value.trim() !== '' && readClock(value) === null;
  return (
    <Input
      aria-label={label}
      dir="ltr"
      inputMode="numeric"
      placeholder="12:00"
      value={value}
      disabled={disabled}
      maxLength={5}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const v = readClock(value);
        if (v) onChange(v);
      }}
      className={cx('num h-11 !w-24 text-center', bad && 'border-bad')}
    />
  );
}
