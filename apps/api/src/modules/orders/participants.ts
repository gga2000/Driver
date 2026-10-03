import { DriverError, type OrderType, type ParticipantInput } from '@driver/contracts';
import { ORDERS_RULES } from './orders.config.js';

/**
 * Participants and points (domain §3, edge-case §2). Lines are tagged to participants; points per
 * line go to the tagged participant, the orderer gets untagged lines plus the organiser bonus, and a
 * participant without an account gets `points_pending` keyed by the phone hash, claimed on
 * verification. Pure: the service resolves phones and persists.
 */

/** Resolves a participant's phone to a Person (when one exists) and the peppered phone hash. */
export interface ParticipantResolver {
  resolvePhone(phone: string): Promise<{ personId: string | null; phoneHash: string }>;
}

export const PARTICIPANT_RESOLVER = Symbol('PARTICIPANT_RESOLVER');

export interface ResolvedParticipant {
  ref: string;
  role: ParticipantInput['role'];
  personId: string | null;
  phoneHash: string | null;
  label: string | null;
  note: string | null;
}

export async function resolveParticipants(inputs: readonly ParticipantInput[], resolver: ParticipantResolver): Promise<ResolvedParticipant[]> {
  const refs = new Set<string>();
  const out: ResolvedParticipant[] = [];
  for (const p of inputs) {
    if (refs.has(p.ref)) throw new DriverError('invalid_input');
    refs.add(p.ref);
    const resolved = p.phone ? await resolver.resolvePhone(p.phone) : { personId: null, phoneHash: null };
    out.push({ ref: p.ref, role: p.role, personId: resolved.personId, phoneHash: resolved.phoneHash, label: p.label ?? null, note: p.note ?? null });
  }
  return out;
}

/** Every `participantRef` on a line must name a participant on the order. */
export function assertLineTags(lines: ReadonlyArray<{ participantRef?: string | undefined }>, participants: readonly ResolvedParticipant[]): void {
  const refs = new Set(participants.map((p) => p.ref));
  for (const l of lines) if (l.participantRef !== undefined && !refs.has(l.participantRef)) throw new DriverError('participant_unknown');
}

// ───────────────────────── points ─────────────────────────

export interface PointsLine {
  participantId: string | null;
  valueIqd: number;
  pointsEligible: boolean;
}

export interface PointsParticipant {
  id: string;
  role: string;
  personId: string | null;
  phoneHash: string | null;
}

export interface PointsAllocation {
  /** Who earns: a person, or a phone hash when the participant has no account yet. */
  personId: string | null;
  phoneHash: string | null;
  participantId: string | null;
  points: number;
  organizerBonus: boolean;
  pending: boolean;
}

/** Edge-case §2: points come from platform revenue — 1 per 100 IQD (rides and seats 1 per 200), capped per order. */
export function orderPoints(input: { type: OrderType; platformRevenueIqd: number }): number {
  const per = input.type === 'ride' || input.type === 'seat' ? ORDERS_RULES.ridePointsPerIqd : ORDERS_RULES.pointsPerIqd;
  return Math.max(0, Math.min(ORDERS_RULES.pointsCapPerOrder, Math.floor(input.platformRevenueIqd / per)));
}

/**
 * Splits `basePoints` over participants pro rata to the value of their eligible lines; untagged
 * lines and rounding remainders go to the orderer, who also earns the organiser bonus. Rides give
 * the base to the rider participant when there is one (ride-for-someone-else, domain §3).
 * Allocations to the same earner are merged.
 */
export function allocatePoints(input: {
  type: OrderType;
  ordererId: string;
  basePoints: number;
  lines: readonly PointsLine[];
  participants: readonly PointsParticipant[];
}): PointsAllocation[] {
  const { basePoints, ordererId } = input;
  const out: PointsAllocation[] = [];
  const add = (a: Omit<PointsAllocation, 'pending'>) => {
    if (a.points <= 0) return;
    const pending = a.personId === null && a.phoneHash !== null;
    const same = out.find((o) => o.organizerBonus === a.organizerBonus && (a.personId ? o.personId === a.personId : o.phoneHash === a.phoneHash && o.personId === null));
    if (same) same.points += a.points;
    else out.push({ ...a, pending });
  };
  const toOrderer = (points: number, organizerBonus = false) => add({ personId: ordererId, phoneHash: null, participantId: null, points, organizerBonus });
  const earner = (p: PointsParticipant) =>
    p.personId || p.phoneHash ? { personId: p.personId, phoneHash: p.personId ? null : p.phoneHash, participantId: p.id } : { personId: ordererId, phoneHash: null, participantId: null };

  if (basePoints > 0) {
    if (input.type === 'ride') {
      const rider = input.participants.find((p) => p.role === 'rider');
      if (rider) add({ ...earner(rider), points: basePoints, organizerBonus: false });
      else toOrderer(basePoints);
    } else {
      const eligible = input.lines.filter((l) => l.pointsEligible && l.valueIqd > 0);
      const total = eligible.reduce((a, l) => a + l.valueIqd, 0);
      let given = 0;
      if (total > 0) {
        const byParticipant = new Map<string, number>();
        for (const l of eligible) if (l.participantId) byParticipant.set(l.participantId, (byParticipant.get(l.participantId) ?? 0) + l.valueIqd);
        for (const [participantId, value] of byParticipant) {
          const p = input.participants.find((x) => x.id === participantId);
          if (!p) continue;
          const pts = Math.floor((basePoints * value) / total);
          add({ ...earner(p), points: pts, organizerBonus: false });
          given += pts;
        }
      }
      toOrderer(basePoints - given);
    }
    toOrderer(Math.floor((basePoints * ORDERS_RULES.organizerBonusPct) / 100), true);
  }
  return out;
}
