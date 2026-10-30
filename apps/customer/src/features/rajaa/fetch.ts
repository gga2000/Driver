import type { HouseholdView, MeView, RequestRiderInput } from '@driver/contracts';
import { riderOptions, typedRider, type RiderOption, type RiderPick, type TypedRiderError } from '@/features/ride/rider';

/**
 * k1–k4 «جيب واحد» (Ali 2026-10-07): the car fetches someone else. Who is picked the way a taxi is
 * booked for someone (`features/ride/rider`): one of his trusted people, someone in his household, or
 * a name and number typed now. No «إلي» (he is not the one fetched) and no earlier taxi riders (those
 * are taxi orders; the request board resolves only these three).
 */
export type FetchPick = Extract<RiderPick, { kind: 'trusted' | 'household' | 'typed' }>;

/** The chips the form offers before «شخص ثاني». */
export function fetchOptions(trusted: MeView['trustedContacts'] | null | undefined, household: Pick<HouseholdView, 'id' | 'members'> | null | undefined): RiderOption[] {
  return riderOptions({ orders: [], trusted, household });
}

/** The chip id that means «شخص ثاني» (a name and number typed now). */
export const FETCH_TYPED = 'other';

/**
 * What the form sends for the chip picked: an offered person, or the typed name and number checked
 * like every number in the app (the errors say which field to fix); null while nothing is picked.
 */
export function fetchPick(chip: string | null, options: readonly RiderOption[], name: string, phone: string): { pick: FetchPick } | { errors: TypedRiderError[] } | null {
  if (!chip) return null;
  if (chip === FETCH_TYPED) return typedRider(name, phone);
  const o = options.find((x) => x.id === chip);
  if (!o || o.pick.kind === 'recent') return null;
  return { pick: o.pick };
}

/** `requests.post`'s `rider` for a pick. */
export function fetchRiderInput(pick: FetchPick): RequestRiderInput {
  switch (pick.kind) {
    case 'trusted':
      return { from: 'trusted', index: pick.index };
    case 'household':
      return { from: 'household', householdId: pick.householdId, personId: pick.personId };
    case 'typed':
      return { from: 'typed', name: pick.name, phone: pick.phone };
  }
}

/** k4: where the person is brought — home in Aziziyah (the default) or another place typed or picked. */
export type FetchDrop = 'home' | 'other';
