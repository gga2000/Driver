import type { HouseholdView, MeView, Order, RideRiderInput } from '@driver/contracts';
import { RIDE_RIDER_NAME_MAX } from '@driver/contracts';
import { normalizeIraqiPhone } from '@/lib/phone';

/**
 * «لمنو المشوار؟» (ride ideas c9/s3): who the ride is for. «إلي» is the default; otherwise someone the
 * booker booked a ride for before (from his own rides, so no number is kept on the phone), one of his
 * trusted people (w9), someone in his household (w4), or a name and number typed now. The server turns
 * each into the person the driver calls and the SMS reaches.
 */
export type RiderPick =
  | { kind: 'me' }
  | { kind: 'recent'; orderId: string; name: string }
  | { kind: 'trusted'; index: number; name: string }
  | { kind: 'household'; householdId: string; personId: string; name: string }
  | { kind: 'typed'; name: string; phone: string };

export const RIDER_ME: RiderPick = { kind: 'me' };

/** One person the sheet offers, with a stable id for the chip. */
export interface RiderOption {
  id: string;
  name: string;
  pick: Exclude<RiderPick, { kind: 'me' } | { kind: 'typed' }>;
}

/** How many earlier riders the sheet offers. */
export const RECENT_RIDERS_MAX = 4;

/**
 * The people he booked rides for, newest first, one chip per person (the rider's person id): each
 * points at his latest ride for them, which the server reads the person and the name from.
 */
export function recentRiders(orders: readonly Pick<Order, 'id' | 'type' | 'placedAt' | 'rider' | 'participants'>[], max = RECENT_RIDERS_MAX): RiderOption[] {
  const seen = new Set<string>();
  const out: RiderOption[] = [];
  for (const o of [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())) {
    if (o.type !== 'ride' || !o.rider?.name) continue;
    const person = o.participants.find((p) => p.role === 'rider')?.personId ?? `order:${o.id}`;
    if (seen.has(person)) continue;
    seen.add(person);
    out.push({ id: `recent:${o.id}`, name: o.rider.name, pick: { kind: 'recent', orderId: o.id, name: o.rider.name } });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Everyone the sheet offers before «شخص ثاني»: earlier riders, trusted people, then the household
 * (not himself). A name already offered is not offered twice (the earliest source wins).
 */
export function riderOptions(input: {
  orders: readonly Pick<Order, 'id' | 'type' | 'placedAt' | 'rider' | 'participants'>[];
  trusted: MeView['trustedContacts'] | null | undefined;
  household: Pick<HouseholdView, 'id' | 'members'> | null | undefined;
}): RiderOption[] {
  const all: RiderOption[] = [
    ...recentRiders(input.orders),
    ...(input.trusted ?? []).map((c, index) => ({ id: `trusted:${index}`, name: c.name, pick: { kind: 'trusted' as const, index, name: c.name } })),
    ...(input.household?.members ?? [])
      .filter((m) => !m.isMe)
      .map((m) => {
        const name = m.name?.trim() || m.phoneMasked;
        return { id: `household:${m.personId}`, name, pick: { kind: 'household' as const, householdId: input.household!.id, personId: m.personId, name } };
      }),
  ];
  const names = new Set<string>();
  return all.filter((o) => {
    const key = o.name.trim();
    if (!key || names.has(key)) return false;
    names.add(key);
    return true;
  });
}

/** What `orders.place` gets: nothing for «إلي». */
export function riderInput(pick: RiderPick): RideRiderInput | undefined {
  switch (pick.kind) {
    case 'me':
      return undefined;
    case 'recent':
      return { from: 'recent', orderId: pick.orderId };
    case 'trusted':
      return { from: 'trusted', index: pick.index };
    case 'household':
      return { from: 'household', householdId: pick.householdId, personId: pick.personId };
    case 'typed':
      return { from: 'typed', name: pick.name, phone: pick.phone };
  }
}

/** The rider's name, or null for «إلي». */
export function riderName(pick: RiderPick): string | null {
  return pick.kind === 'me' ? null : pick.name;
}

export type TypedRiderError = 'name' | 'phone';

/**
 * «شخص ثاني»: a name (trimmed, at most 40 characters) and an Iraqi mobile number, checked like every
 * number in the app; the errors say which field to fix.
 */
export function typedRider(name: string, phone: string): { pick: Extract<RiderPick, { kind: 'typed' }> } | { errors: TypedRiderError[] } {
  const clean = name.trim().slice(0, RIDE_RIDER_NAME_MAX);
  const e164 = normalizeIraqiPhone(phone);
  const errors: TypedRiderError[] = [...(clean ? [] : ['name' as const]), ...(e164 ? [] : ['phone' as const])];
  return errors.length > 0 || !e164 ? { errors } : { pick: { kind: 'typed', name: clean, phone: e164 } };
}

/** The chip id of a pick in the sheet. */
export function riderChipId(pick: RiderPick): string {
  switch (pick.kind) {
    case 'me':
      return 'me';
    case 'typed':
      return 'other';
    case 'trusted':
      return `trusted:${pick.index}`;
    case 'household':
      return `household:${pick.personId}`;
    case 'recent':
      return `recent:${pick.orderId}`;
  }
}
