'use client';

import { useMutation } from '@tanstack/react-query';
import type { DemandLevel } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { formatClock } from '@/lib/format';
import { CITY_ID } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { useZoneDemand } from '@/lib/zone-demand';
import { Button, Chip, Row, useToast } from './ui';

const LEVEL: Record<DemandLevel, { key: MessageKey; tone: 'bad' | 'warn' | 'neutral' }> = {
  hot: { key: 'console.heat_hot', tone: 'bad' },
  warm: { key: 'console.heat_warm', tone: 'warn' },
  calm: { key: 'console.heat_calm', tone: 'neutral' },
};

/**
 * A zone's demand on the map page (maps program o5): orders waiting, the usual for this hour, the
 * drivers there — and "ابعث سواق هنا", a push to the free drivers around it (dispatchers, once per
 * 10 minutes per zone).
 */
export function ZoneDemandPanel({ zoneId }: { zoneId: string }) {
  const trpc = useTRPC();
  const toast = useToast();
  const roles = useMyRoles();
  const demand = useZoneDemand();
  const nudge = useMutation(trpc.dispatch.nudgeZone.mutationOptions());
  const z = demand.data?.zones.find((x) => x.zoneId === zoneId) ?? { zoneId, waiting: 0, expected: 0, drivers: 0, level: 'calm' as const };
  const canNudge = hasAny(roles.roles, ['dispatcher', 'admin']);
  const level = LEVEL[z.level];
  return (
    <section className="space-y-2" data-testid="zone-demand">
      <h3 className="flex items-center justify-between text-sm font-semibold">
        {t('console.heat_title')}
        <Chip size="sm" tone={level.tone}>
          {t(level.key)}
        </Chip>
      </h3>
      <dl>
        <Row k={t('console.heat_waiting')} v={<span className="num">{z.waiting}</span>} />
        <Row k={t('console.heat_expected')} v={<span className="num">{z.expected}</span>} />
        <Row k={t('console.heat_drivers')} v={<span className="num">{z.drivers}</span>} />
      </dl>
      {canNudge ? (
        <Button
          variant={z.level === 'hot' ? 'primary' : 'secondary'}
          size="sm"
          loading={nudge.isPending}
          data-testid="zone-nudge"
          onClick={() =>
            nudge.mutate(
              { cityId: CITY_ID, zoneId },
              {
                onSuccess: (out) => toast({ title: out.sent > 0 ? t('console.nudge_sent', { count: out.sent }) : t('console.nudge_none'), body: t('console.nudge_wait', { time: formatClock(out.nextAt) }), tone: out.sent > 0 ? 'ok' : 'default' }),
                onError: (err) => toast({ title: errorText(err), tone: 'bad' }),
              },
            )
          }
        >
          {t('console.nudge_send')}
        </Button>
      ) : null}
    </section>
  );
}
