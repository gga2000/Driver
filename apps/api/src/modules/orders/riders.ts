import { DriverError, type RideRiderInput } from '@driver/contracts';
import type { OrdersHouseholdsPort } from './households.port.js';

/**
 * Ride ideas c9/s3 «لمنو المشوار؟»: a ride booked for someone else. The rider is a person on a `rider`
 * participant (so the driver's call, the chat and the SMS reach them through what already exists);
 * the name the booker gave them lives in the identity vault, keyed by the participant id. The booker
 * stays the orderer: he pays, cancels and rates as always.
 */

/** Who rides, resolved on the server: the person, the peppered hash of their number, the booker's name for them. */
export interface ResolvedRider {
  personId: string;
  phoneHash: string | null;
  name: string;
}

/** The sources the port resolves; `recent` (one of the booker's own earlier rides) is read by orders itself. */
export type RiderSource = Exclude<RideRiderInput, { from: 'recent' }>;

export interface OrdersRidersPort {
  /** Resolves the choose screen's choice for `bookerId`; runs in the placing unit of work. */
  resolve(bookerId: string, input: RiderSource): Promise<ResolvedRider>;
  /** Keeps the name under the participant the order was written with (same unit of work). */
  remember(participantId: string, rider: ResolvedRider, bookerId: string): Promise<void>;
  /** Names by participant id for the person asking (booker, rider, driver); every read logged. */
  names(participantIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

export const ORDERS_RIDERS = Symbol('ORDERS_RIDERS');

/** The slice of identity the riders port needs (`IdentityService`). */
export interface RiderIdentity {
  riderByPhone(rawPhone: string, bookerId: string): Promise<{ personId: string; phoneHash: string }>;
  trustedContactsOf(personId: string, accessorId: string, purpose: string): Promise<Array<{ name: string; phoneE164: string }>>;
  memberCards(personIds: readonly string[], accessorId: string, purpose?: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
  phoneHashOf(personId: string): Promise<string | null>;
  rememberParticipantName(input: { participantId: string; personId: string; givenById: string; name: string }): Promise<void>;
  participantNames(participantIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

/**
 * The port over identity and the household: a typed number becomes a person (found or created
 * pseudonymously); a trusted person (w9) is read from the booker's own vault list by position; a
 * household member (w4) must share a household with the booker. Never the booker himself.
 */
export function identityRiders(identity: RiderIdentity, households: Pick<OrdersHouseholdsPort, 'member'>): OrdersRidersPort {
  const notMe = (bookerId: string, rider: ResolvedRider): ResolvedRider => {
    if (rider.personId === bookerId) throw new DriverError('ride_rider_is_you');
    return rider;
  };
  return {
    resolve: async (bookerId, input) => {
      if (input.from === 'typed') {
        const ref = await identity.riderByPhone(input.phone, bookerId);
        return notMe(bookerId, { ...ref, name: input.name.trim() });
      }
      if (input.from === 'trusted') {
        const contact = (await identity.trustedContactsOf(bookerId, bookerId, 'ride_for_trusted'))[input.index];
        if (!contact) throw new DriverError('ride_rider_unknown');
        const ref = await identity.riderByPhone(contact.phoneE164, bookerId);
        return notMe(bookerId, { ...ref, name: contact.name });
      }
      if (input.personId === bookerId) throw new DriverError('ride_rider_is_you');
      const [me, them] = await Promise.all([households.member(input.householdId, bookerId), households.member(input.householdId, input.personId)]);
      if (!me || !them) throw new DriverError('ride_rider_unknown');
      const card = (await identity.memberCards([input.personId], bookerId, 'ride_for_family'))[input.personId];
      if (!card) throw new DriverError('ride_rider_unknown');
      return { personId: input.personId, phoneHash: await identity.phoneHashOf(input.personId), name: card.name?.trim() || card.phoneMasked };
    },
    remember: (participantId, rider, bookerId) => identity.rememberParticipantName({ participantId, personId: rider.personId, givenById: bookerId, name: rider.name }),
    names: (participantIds, accessorId, purpose) => identity.participantNames(participantIds, accessorId, purpose),
  };
}
