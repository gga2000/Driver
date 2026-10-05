'use client';

import { t, type MessageKey } from '@driver/i18n';
import { useId, useMemo } from 'react';
import { recentDays, type Period, type PeriodPreset } from '@/lib/periods';
import { cx, Segmented, Select } from './ui';

/**
 * A period on the city's clock: presets (اليوم · أمس · آخر 7 أيام …) in a segmented track, and for
 * "أيام معيّنة" two day pickers that name the days ("أمس"، "الأحد 4 تشرين الأول"), never "4/10".
 * Used by /orders and the driver ledger.
 */
export function PeriodPicker({
  value,
  onChange,
  now,
  presets,
  disabled,
  className,
}: {
  value: Period;
  onChange: (p: Period) => void;
  now: Date;
  presets: readonly PeriodPreset[];
  disabled?: boolean;
  className?: string;
}) {
  const days = useMemo(() => recentDays(now, 60), [now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = { from: useId(), to: useId() };
  return (
    <div
      className={cx('flex flex-wrap items-center gap-2', disabled && 'pointer-events-none opacity-50', className)}
      aria-disabled={disabled || undefined}
    >
      {value.preset === 'custom' && (
        <span className="inline-flex items-center gap-1.5 text-dense text-muted">
          <label htmlFor={ids.from} className="sr-only">
            {t('console.period_from')}
          </label>
          <Select id={ids.from} className="h-8 w-44 text-dense" value={value.fromDay ?? days[1]!.key} onChange={(e) => onChange({ ...value, fromDay: e.target.value })}>
            {days.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
          <span>{t('console.period_to_word')}</span>
          <label htmlFor={ids.to} className="sr-only">
            {t('console.period_to')}
          </label>
          <Select id={ids.to} className="h-8 w-44 text-dense" value={value.toDay ?? days[0]!.key} onChange={(e) => onChange({ ...value, toDay: e.target.value })}>
            {days.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </span>
      )}
      <Segmented
        size="sm"
        label={t('console.period_label')}
        value={value.preset}
        onChange={(preset) => onChange(preset === 'custom' ? { preset, fromDay: value.fromDay ?? days[1]!.key, toDay: value.toDay ?? days[0]!.key } : { preset })}
        options={presets.map((p) => ({ value: p, label: t(`console.period_${p}` as MessageKey) }))}
      />
    </div>
  );
}
