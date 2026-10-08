import type { SafetyEntry, SafetyFix, SafetyIncidentSummary, SosCategory, SosContactStatus } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { formatClock } from './format';
import { compactDuration } from './support-views';

/**
 * SOS on the Console (scoring & safety §3): pure helpers for the red banner and the incident desk.
 * The banner shows open (not taken) alerts first, oldest first; the alarm rings while any is open.
 */

/** Open and taken alerts, the ones nobody took first, then the oldest. */
export function bannerOrder(rows: readonly SafetyIncidentSummary[]): SafetyIncidentSummary[] {
  return rows
    .filter((r) => r.state === 'open' || r.state === 'acknowledged')
    .sort((a, b) => (a.state === b.state ? a.raisedAt.getTime() - b.raisedAt.getTime() : a.state === 'open' ? -1 : 1));
}

/** The alarm rings while an alert is open and its id is not muted (a new alert always rings). */
export function shouldRing(rows: readonly SafetyIncidentSummary[], muted: ReadonlySet<string>): boolean {
  return rows.some((r) => r.state === 'open' && !muted.has(r.id));
}

/** "40 ث", "3 د", "1 س 5 د". */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? t('console.dur_s', { s }) : compactDuration(ms);
}

export function roleText(role: 'driver' | 'customer'): string {
  return t(role === 'driver' ? 'console.safety.role_driver' : 'console.safety.role_customer');
}

export function personName(p: { displayName: string | null; role: 'driver' | 'customer' } | null | undefined): string {
  if (!p) return '—';
  return p.displayName ?? roleText(p.role);
}

const CONTACT_KEY: Record<SosContactStatus, MessageKey> = {
  none: 'console.safety.contact_none',
  queued: 'console.safety.contact_queued',
  sent: 'console.safety.contact_sent',
  delivered: 'console.safety.contact_delivered',
  sms: 'console.safety.contact_sms',
  failed: 'console.safety.contact_failed',
};
export const contactText = (s: SosContactStatus) => t(CONTACT_KEY[s]);
export const contactTone = (s: SosContactStatus): 'neutral' | 'live' | 'done' | 'bad' | 'warn' => (s === 'delivered' || s === 'sms' ? 'done' : s === 'failed' ? 'bad' : s === 'none' ? 'warn' : 'live');

const STATE_KEY = {
  open: 'console.safety.state_open',
  acknowledged: 'console.safety.state_acknowledged',
  resolved: 'console.safety.state_resolved',
  cancelled: 'console.safety.state_cancelled',
} as const satisfies Record<SafetyIncidentSummary['state'], MessageKey>;
export const stateText = (s: SafetyIncidentSummary['state']) => t(STATE_KEY[s]);
export const stateTone = (s: SafetyIncidentSummary['state']): 'bad' | 'warn' | 'done' | 'neutral' => (s === 'open' ? 'bad' : s === 'acknowledged' ? 'warn' : s === 'resolved' ? 'done' : 'neutral');

const CATEGORY_KEY: Record<SosCategory, MessageKey> = {
  accident: 'console.safety.cat_accident',
  harassment: 'console.safety.cat_harassment',
  threat: 'console.safety.cat_threat',
  medical: 'console.safety.cat_medical',
  other: 'console.safety.cat_other',
};
export const categoryText = (c: SosCategory) => t(CATEGORY_KEY[c]);

/** Google Maps search link for a fix (opens the app on a phone, the site on a desk). */
export function mapsUrl(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

export function coordsText(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** One timeline line in words ("استلمه حيدر", "اتصل حيدر بالطرف الثاني"). */
export function entryText(e: SafetyEntry, raiserName: string): string {
  const by = e.byName ?? t('console.safety.who_raiser');
  switch (e.kind) {
    case 'raised':
      return `${raiserName}: ${t('console.safety.ev_raised')}`;
    case 'cancelled':
      return `${raiserName}: ${t('console.safety.ev_cancelled')}`;
    case 'paged':
      return t('console.safety.ev_paged', { count: e.data['count'] ?? '0' });
    case 'contact':
      return e.data['status'] === 'none' ? t('console.safety.ev_contact_none') : t('console.safety.ev_contact');
    case 'acknowledged':
      return t('console.safety.ev_acknowledged', { name: by });
    case 'call': {
      const who = e.data['who'] === 'counterpart' ? 'console.safety.who_other' : e.data['who'] === 'contact' ? 'console.safety.who_contact' : 'console.safety.who_raiser';
      return t('console.safety.ev_call', { name: by, who: t(who) });
    }
    case 'note':
      return t('console.safety.ev_note', { name: by });
    case 'escalated':
      return t('console.safety.ev_escalated');
    case 'resolved':
      return t('console.safety.ev_resolved', { name: by });
    case 'category':
      return `${t('console.safety.category')}: ${e.data['category'] ? categoryText(e.data['category'] as SosCategory) : '—'}`;
  }
}

export function entryTime(e: SafetyEntry): string {
  return formatClock(e.at);
}

/**
 * The trail as an SVG polyline in a `w`×`h` box (north up, east right — a map's orientation even in
 * RTL), padded, keeping the aspect ratio. Returns the points and the last point.
 */
export function trailPath(fixes: readonly Pick<SafetyFix, 'lat' | 'lng'>[], w: number, h: number, pad = 12): { points: string; first: { x: number; y: number } | null; last: { x: number; y: number } | null; spanM: number } {
  if (fixes.length === 0) return { points: '', first: null, last: null, spanM: 0 };
  const latMid = fixes.reduce((a, f) => a + f.lat, 0) / fixes.length;
  const kx = 111_320 * Math.cos((latMid * Math.PI) / 180);
  const ky = 110_540;
  const xs = fixes.map((f) => f.lng * kx);
  const ys = fixes.map((f) => f.lat * ky);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 60);
  const scale = Math.min(w - 2 * pad, h - 2 * pad) / span;
  const ox = (w - (maxX - minX) * scale) / 2;
  const oy = (h - (maxY - minY) * scale) / 2;
  const pts = fixes.map((_, i) => ({ x: ox + (xs[i]! - minX) * scale, y: h - (oy + (ys[i]! - minY) * scale) }));
  return { points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), first: pts[0]!, last: pts[pts.length - 1]!, spanM: Math.round(Math.max(maxX - minX, maxY - minY)) };
}
