'use client';

import { useQuery } from '@tanstack/react-query';
import type { PriceRequestInput, QuoteComponent } from '@driver/contracts';
import { t } from '@driver/i18n';
import { API_URL, useTRPC } from '@/lib/trpc';

/** Sample Aziziyah intercity trip: center → Kut, front seat, door pickup, measured 55 km / 50 min. */
const SAMPLE: PriceRequestInput = {
  cityId: 'aziziyah',
  vertical: 'intercity',
  stops: [
    { zoneId: 'center', type: 'pickup' },
    { zoneId: 'kut', type: 'dropoff' },
  ],
  options: { frontSeat: true, doorPickup: true },
  at: new Date('2026-10-02T09:00:00Z'),
  distanceKm: 55,
  durationMin: 50,
};

const iqd = new Intl.NumberFormat('en-IQ', { maximumFractionDigits: 0 });

export function Dashboard() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions(undefined, { refetchInterval: 10_000 }));
  const quote = useQuery(trpc.pricing.quote.queryOptions(SAMPLE));

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">Driver Console</p>
          <h1 className="font-display text-3xl font-bold">{t('app.console')}</h1>
        </div>
        <StatusPill ok={health.isSuccess} loading={health.isPending} version={health.data?.version} />
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        <Card title="الخدمة" className="md:col-span-1">
          <dl className="space-y-2 text-sm">
            <Row k="API" v={API_URL} mono />
            <Row k="الحالة" v={health.isSuccess ? t('status.online') : health.isPending ? '…' : t('status.offline')} />
            <Row k="الوقت" v={health.data ? new Date(health.data.now).toLocaleTimeString('ar-IQ') : '—'} />
          </dl>
          {health.isError && <p className="mt-3 text-sm text-danger-700">{t('error.network')}</p>}
        </Card>

        <Card title="تسعيرة تجريبية — العزيزية ← الكوت" className="md:col-span-2">
          {quote.isPending && <p className="text-sm text-neutral-500">جاري الحساب…</p>}
          {quote.isError && <p className="text-sm text-danger-700">{t('error.generic')}</p>}
          {quote.data && (
            <>
              <QuoteTable shown={quote.data.components} shadow={quote.data.shadowComponents} />
              <div className="mt-4 flex items-baseline justify-between border-t border-neutral-200 pt-4">
                <span className="text-sm text-neutral-500">
                  {t('quote.total')} · تقريب {quote.data.rounding.step} · {quote.data.bounds.clamped ? 'ضمن الحدود' : 'بدون تقييد'}
                </span>
                <span className="font-display text-2xl font-bold">
                  {iqd.format(quote.data.total)} <span className="text-base font-normal text-neutral-500">{t('quote.currency')}</span>
                </span>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                لو فعّلنا المسافة والوقت: {iqd.format(quote.data.shadowTotal)} {t('quote.currency')}
              </p>
            </>
          )}
        </Card>
      </section>
    </main>
  );
}

function QuoteTable({ shown, shadow }: { shown: QuoteComponent[]; shadow: QuoteComponent[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-neutral-500">
        <tr className="border-b border-neutral-200 text-start">
          <th className="py-2 text-start font-medium">البند</th>
          <th className="py-2 text-start font-medium">الظهور</th>
          <th className="py-2 text-start font-medium">حصة السايق</th>
          <th className="py-2 text-end font-medium">المبلغ</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((c, i) => (
          <ComponentRow key={`s-${i}`} c={c} />
        ))}
        {shadow.map((c, i) => (
          <ComponentRow key={`h-${i}`} c={c} />
        ))}
      </tbody>
    </table>
  );
}

function ComponentRow({ c }: { c: QuoteComponent }) {
  const shadow = c.visibility === 'shadow';
  return (
    <tr className={`border-b border-neutral-100 ${shadow ? 'text-neutral-400' : ''}`}>
      <td className="py-2">
        {c.label_ar}
        {c.leg !== undefined && <span className="ms-2 text-xs text-neutral-400">مرحلة {c.leg + 1}</span>}
      </td>
      <td className="py-2">
        <span className={`rounded-pill px-2 py-0.5 text-xs ${shadow ? 'bg-neutral-100' : 'bg-success-50 text-success-700'}`}>
          {shadow ? 'ظل' : 'ظاهر'}
        </span>
      </td>
      <td className="py-2 text-xs">{shareLabel(c.driverShareRule)}</td>
      <td className="py-2 text-end tabular-nums">{iqd.format(c.amount)}</td>
    </tr>
  );
}

function shareLabel(rule: QuoteComponent['driverShareRule']): string {
  switch (rule) {
    case 'driver_full':
      return 'كامل للسايق';
    case 'driver_commissioned':
      return 'بعد العمولة';
    case 'platform_only':
      return 'المنصة';
  }
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-xs' : ''}`} dir={mono ? 'ltr' : undefined}>
        {v}
      </dd>
    </div>
  );
}

function StatusPill({ ok, loading, version }: { ok: boolean; loading: boolean; version?: string }) {
  const tone = loading ? 'bg-neutral-100 text-neutral-600' : ok ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700';
  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm ${tone}`}>
      <span className={`h-2 w-2 rounded-pill ${loading ? 'bg-neutral-400' : ok ? 'bg-success-500' : 'bg-danger-500'}`} />
      {loading ? '…' : ok ? `${t('status.online')} · v${version}` : t('status.offline')}
    </span>
  );
}
