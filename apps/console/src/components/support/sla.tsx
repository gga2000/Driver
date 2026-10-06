import type { TicketChannel, TicketSummary } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import type { ComponentType } from 'react';
import { slaClock } from '@/lib/control-room';
import { slaFraction } from '@/lib/support-views';
import { cx, IconApp, IconChat, IconCog, IconPhone, type IconProps } from '../ui';

/**
 * The SLA fuse — the desk's signature mark. A ring that burns down across the same-day window
 * (opened → due), with the time left in words beside it: "باقي 2 س 30 د", "متأخرة 20 س". Calm grey
 * while there's time, amber in the last hour, red once late, green when it was answered in time.
 */
export function SlaPill({
  row,
  now,
  size = 'md',
}: {
  row: Pick<TicketSummary, 'openedAt' | 'slaDueAt' | 'status' | 'slaState'>;
  now: Date;
  size?: 'sm' | 'md';
}) {
  const clock = slaClock(row, now);
  const frac = slaFraction(row, now);
  const tone = clock.tone;
  const pill =
    tone === 'bad'
      ? 'bg-bad-tint text-bad'
      : tone === 'warn'
        ? 'bg-warn-tint text-warn'
        : tone === 'done'
          ? 'bg-ok-tint text-ok'
          : 'bg-surface-3 text-muted';
  const arc =
    tone === 'bad'
      ? 'stroke-bad-solid'
      : tone === 'warn'
        ? 'stroke-warn-solid'
        : tone === 'done'
          ? 'stroke-ok-solid'
          : 'stroke-muted';
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill font-medium',
        size === 'sm' ? 'h-[22px] ps-1.5 pe-2 text-xs' : 'h-6 ps-1.5 pe-2.5 text-xs',
        pill,
      )}
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="-rotate-90">
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="2"
          className="stroke-current opacity-20"
        />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.001, frac) * c} ${c}`}
          className={tone === 'bad' && frac === 0 ? 'hidden' : arc}
        />
        {tone === 'bad' ? <circle cx="7" cy="7" r="2.2" className="fill-bad-solid" /> : null}
      </svg>
      <span className="num">{clock.text}</span>
    </span>
  );
}

const CHANNEL_ICON: Record<TicketChannel, ComponentType<IconProps>> = {
  in_app: IconApp,
  whatsapp: IconChat,
  phone: IconPhone,
  system: IconCog,
};

export function ChannelIcon({
  channel,
  size = 15,
  className,
}: {
  channel: TicketChannel;
  size?: number;
  className?: string;
}) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <Icon
      size={size}
      title={t(`console.sup_channel_${channel}` as MessageKey)}
      className={className}
    />
  );
}

export function kindTone(kind: TicketSummary['kind']) {
  return kind === 'incident' ? 'bad' : kind === 'dispute' ? 'warn' : 'neutral';
}

export function statusTone(status: TicketSummary['status']) {
  return status === 'escalated'
    ? 'warn'
    : status === 'resolved'
      ? 'done'
      : status === 'waiting'
        ? 'live'
        : 'neutral';
}
