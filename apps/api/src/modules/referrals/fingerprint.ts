import type { LatLng, ReferralBlockReason } from '@driver/contracts';

/**
 * The referral fingerprint (edge-case decisions §1: «fingerprint on device + phone + home place»). A
 * referral pays only when the friend shares none of the three with the inviter, nor with anyone who
 * already earned a referral. Everything here works on one-way marks: `p:` the peppered phone hash,
 * `d:` a peppered device-fingerprint mark, `h:` a peppered home-cell mark. Pure.
 */

/** Home cells: ≈ 44 m north–south, ≈ 37 m east–west at Aziziyah's latitude. */
export const HOME_CELL_DEG = 0.0004;

/**
 * The map cells a home pin falls in, on four grids shifted by half a cell (none, east, north, both):
 * two pins less than half a cell apart on each axis always share at least one cell, wherever the grid
 * lines fall. Keys only; the caller peppers them before they are stored.
 */
export function homeCells(pin: LatLng, step: number = HOME_CELL_DEG): string[] {
  const cell = (v: number, shift: number) => Math.floor(v / step + shift);
  const out: string[] = [];
  for (const [sy, sx] of [
    [0, 0],
    [0, 0.5],
    [0.5, 0],
    [0.5, 0.5],
  ] as const) {
    out.push(`${sy}${sx}:${cell(pin.lat, sy)}:${cell(pin.lng, sx)}`);
  }
  return out;
}

export interface FingerprintParts {
  phoneHash: string | null;
  deviceMarks: readonly string[];
  homeMarks: readonly string[];
}

/** The marks stored for a person on a referral row. */
export function marksOf(parts: FingerprintParts): string[] {
  return [...new Set([...(parts.phoneHash ? [`p:${parts.phoneHash}`] : []), ...parts.deviceMarks.map((m) => `d:${m}`), ...parts.homeMarks.map((m) => `h:${m}`)])];
}

const KIND_ORDER = ['d', 'p', 'h'] as const;
const SHARED: Record<(typeof KIND_ORDER)[number], ReferralBlockReason> = { d: 'shared_device', p: 'shared_phone', h: 'shared_home' };
const EARNED: Record<(typeof KIND_ORDER)[number], ReferralBlockReason> = { d: 'device_earned', p: 'phone_earned', h: 'home_earned' };

/** The first kind (device, then phone, then home) the two sets of marks share; null when none. */
function sharedKind(a: readonly string[], b: ReadonlySet<string>): (typeof KIND_ORDER)[number] | null {
  const kinds = new Set(a.filter((m) => b.has(m)).map((m) => m.slice(0, 1)));
  return KIND_ORDER.find((k) => kinds.has(k)) ?? null;
}

/**
 * Why this referral must not pay, or null: the friend shares a device, a phone or a home with the
 * inviter (`shared_*`), or with someone who already earned a referral (`*_earned`; `earners` = the
 * marks recorded on referrals that already paid, either side).
 */
export function blockReason(input: { friend: readonly string[]; inviter: readonly string[]; earners: readonly string[] }): ReferralBlockReason | null {
  const withInviter = sharedKind(input.friend, new Set(input.inviter));
  if (withInviter) return SHARED[withInviter];
  const withEarner = sharedKind(input.friend, new Set(input.earners));
  return withEarner ? EARNED[withEarner] : null;
}
