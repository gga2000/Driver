import { DriverError, type RequestRiderInput } from '@driver/contracts';

/**
 * k2 «جيب واحد» (Ali 2026-10-07): the person a private car fetches. Resolved like a taxi booked for
 * someone else (orders' `identityRiders`, docs/api/ride-for-someone.md): a typed number becomes a
 * person (found, or created pseudonymously), a trusted person is read from the poster's own vault list
 * by position, a household member must share a household with him. Never the poster himself. The name
 * he gave them lives in `identity_vault.participant_identities` under `request:<id>`; the request
 * keeps only the person id.
 */
export interface RequestRidersPort {
  resolve(posterId: string, input: RequestRiderInput): Promise<{ personId: string; name: string }>;
  /** Keeps the name under the request (its own unit of work, after the request is written). */
  remember(requestId: string, personId: string, posterId: string, name: string): Promise<void>;
  /** Names by request id for the person asking (the poster or the picked driver); every read logged. */
  names(requestIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

export const ROUTES_REQUEST_RIDERS = Symbol('ROUTES_REQUEST_RIDERS');

/** The vault key a request's fetched person is named under (the participant-name table's key). */
export function requestRiderKey(requestId: string): string {
  return `request:${requestId}`;
}

/** The slice of identity the port needs (`IdentityService`). */
export interface RequestRiderIdentity {
  riderByPhone(rawPhone: string, bookerId: string): Promise<{ personId: string; phoneHash: string }>;
  trustedContactsOf(personId: string, accessorId: string, purpose: string): Promise<Array<{ name: string; phoneE164: string }>>;
  memberCards(personIds: readonly string[], accessorId: string, purpose?: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
  rememberParticipantName(input: { participantId: string; personId: string; givenById: string; name: string }): Promise<void>;
  participantNames(participantIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>>;
}

/** Whether a person is in a household (the orgs module). */
export type HouseholdMembership = (householdId: string, personId: string) => Promise<boolean>;

export function identityRequestRiders(identity: RequestRiderIdentity, inHousehold: HouseholdMembership): RequestRidersPort {
  const notMe = (posterId: string, r: { personId: string; name: string }) => {
    if (r.personId === posterId) throw new DriverError('ride_rider_is_you');
    return r;
  };
  return {
    resolve: async (posterId, input) => {
      if (input.from === 'typed') {
        const ref = await identity.riderByPhone(input.phone, posterId);
        return notMe(posterId, { personId: ref.personId, name: input.name.trim() });
      }
      if (input.from === 'trusted') {
        const contact = (await identity.trustedContactsOf(posterId, posterId, 'request_for_trusted'))[input.index];
        if (!contact) throw new DriverError('ride_rider_unknown');
        const ref = await identity.riderByPhone(contact.phoneE164, posterId);
        return notMe(posterId, { personId: ref.personId, name: contact.name });
      }
      if (input.personId === posterId) throw new DriverError('ride_rider_is_you');
      const [me, them] = await Promise.all([inHousehold(input.householdId, posterId), inHousehold(input.householdId, input.personId)]);
      if (!me || !them) throw new DriverError('ride_rider_unknown');
      const card = (await identity.memberCards([input.personId], posterId, 'request_for_family'))[input.personId];
      if (!card) throw new DriverError('ride_rider_unknown');
      return { personId: input.personId, name: card.name?.trim() || card.phoneMasked };
    },
    remember: (requestId, personId, posterId, name) => identity.rememberParticipantName({ participantId: requestRiderKey(requestId), personId, givenById: posterId, name }),
    names: async (requestIds, accessorId, purpose) => {
      const byKey = await identity.participantNames(requestIds.map(requestRiderKey), accessorId, purpose);
      return Object.fromEntries(requestIds.filter((id) => byKey[requestRiderKey(id)] !== undefined).map((id) => [id, byKey[requestRiderKey(id)]!]));
    },
  };
}

/** For tests and harnesses without identity: typed riders only, names kept in memory. */
export class InMemoryRequestRiders implements RequestRidersPort {
  private readonly people = new Map<string, string>();
  private readonly saved = new Map<string, string>();
  readonly reads: Array<{ requestId: string; accessorId: string; purpose: string }> = [];

  /** `phone → personId`, so a test can name the poster's own number. */
  constructor(people: Record<string, string> = {}) {
    for (const [phone, id] of Object.entries(people)) this.people.set(phone, id);
  }

  async resolve(posterId: string, input: RequestRiderInput): Promise<{ personId: string; name: string }> {
    if (input.from !== 'typed') throw new DriverError('ride_rider_unknown');
    const personId = this.people.get(input.phone) ?? `p_fetch_${input.phone.replace(/\D/g, '')}`;
    if (personId === posterId) throw new DriverError('ride_rider_is_you');
    return { personId, name: input.name.trim() };
  }

  async remember(requestId: string, _personId: string, _posterId: string, name: string): Promise<void> {
    this.saved.set(requestId, name);
  }

  async names(requestIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of requestIds) {
      const name = this.saved.get(id);
      if (name === undefined) continue;
      out[id] = name;
      this.reads.push({ requestId: id, accessorId, purpose });
    }
    return out;
  }
}
