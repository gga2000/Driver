import type { MessageKey } from '@driver/i18n';

/**
 * "جاهز تستلم طلبات" (UI/UX audit S-8, every shift), pure: GPS · النت · صوت الطلبات · البطارية, each
 * ok / needs a look / blocking, with the sentence that explains it and the fix it links to. The
 * probes (permissions, battery, audio) live in `lib/readiness-probe(.native).ts`; this only decides.
 * Plain Node (unit-tested).
 */

/** on: allowed and the phone's location is on · ask: not allowed yet (or we can't tell) · off: refused or location off. */
export type GpsState = 'on' | 'ask' | 'off';
/** ready: the offer sound can play · blocked: it can't (browser before a tap, a failed load) · unknown: still loading. */
export type SoundState = 'ready' | 'blocked' | 'unknown';
export type NetState = 'online' | 'offline' | 'unreachable';
/** Push permission on a phone; `n/a` on the web (no push there). */
export type PushState = 'granted' | 'denied' | 'undetermined' | 'n/a';
export interface BatteryState {
  /** 0–1 */
  level: number;
  charging: boolean;
}

export interface ReadyInputs {
  gps: GpsState;
  net: NetState;
  sound: SoundState;
  push: PushState;
  /** null: the platform can't say (web without the Battery API) — the chip is hidden. */
  battery: BatteryState | null;
  /**
   * The phone saves battery on Driver (Android battery optimisation, or low-power mode): offers and
   * the live position can arrive late with the screen off (launch-week phone check, l5).
   */
  saver?: boolean;
}

export type ReadyKey = 'gps' | 'net' | 'sound' | 'battery';
export type ReadyTone = 'ok' | 'warn' | 'bad';
/** What the fix button does: ask for location, open the phone's settings, play the test sound, retry. */
export type ReadyFix = 'gps' | 'settings' | 'sound' | 'retry' | null;

export interface ReadyItem {
  key: ReadyKey;
  tone: ReadyTone;
  /** The sentence that explains a non-ok item ("الصوت مطفي، شغّله حتى ما يفوتك طلب"). */
  problem: MessageKey | null;
  fix: ReadyFix;
  /** Battery only: 0–100. */
  percent?: number;
}

/** Below these (and not charging) the battery chip warns, then blocks. */
export const BATTERY_WARN = 0.3;
export const BATTERY_LOW = 0.15;

export function readiness(i: ReadyInputs): { items: ReadyItem[]; issues: number } {
  const items: ReadyItem[] = [];

  if (i.gps === 'on') items.push({ key: 'gps', tone: 'ok', problem: null, fix: null });
  else if (i.gps === 'ask') items.push({ key: 'gps', tone: 'warn', problem: 'partner.ready_gps_ask', fix: 'gps' });
  else items.push({ key: 'gps', tone: 'bad', problem: 'partner.ready_gps_off', fix: 'settings' });

  if (i.net === 'online') items.push({ key: 'net', tone: 'ok', problem: null, fix: null });
  else items.push({ key: 'net', tone: 'bad', problem: 'partner.ready_net_off', fix: 'retry' });

  // The sound the app plays first; with the app closed it is the push that rings.
  if (i.sound === 'blocked') items.push({ key: 'sound', tone: 'bad', problem: 'partner.ready_sound_off', fix: 'sound' });
  else if (i.push === 'denied') items.push({ key: 'sound', tone: 'bad', problem: 'partner.ready_push_off', fix: 'settings' });
  else items.push({ key: 'sound', tone: 'ok', problem: null, fix: null });

  if (i.battery) {
    const percent = Math.round(Math.max(0, Math.min(1, i.battery.level)) * 100);
    const low = !i.battery.charging && i.battery.level < BATTERY_LOW;
    const warn = !i.battery.charging && i.battery.level < BATTERY_WARN;
    if (low || warn) items.push({ key: 'battery', tone: low ? 'bad' : 'warn', problem: 'partner.ready_battery_low', fix: null, percent });
    else if (i.saver) items.push({ key: 'battery', tone: 'warn', problem: 'partner.ready_battery_saver', fix: 'settings', percent });
    else items.push({ key: 'battery', tone: 'ok', problem: null, fix: null, percent });
  }

  return { items, issues: items.filter((x) => x.tone !== 'ok').length };
}
