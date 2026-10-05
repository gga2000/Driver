import { randomUUID } from 'node:crypto';
import type { SafetyEntryKind, SafetyIncidentState, SafetyOutcome, SosCategory, SosRole, SosSubjectKind } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `safety_incidents` */
export interface IncidentRecord {
  id: string;
  cityId: string;
  raiserId: string;
  raiserRole: SosRole;
  subjectKind: SosSubjectKind;
  subjectId: string;
  tripId: string | null;
  orderId: string | null;
  departureId: string | null;
  counterpartId: string | null;
  state: SafetyIncidentState;
  category: SosCategory | null;
  clientId: string;
  raiseEventId: string | null;
  contactSet: boolean;
  contactAt: Date | null;
  subjectLabel: string;
  vehicleLabel: string | null;
  pressedAt: Date | null;
  raisedAt: Date;
  cancelUntil: Date;
  last: { lat: number; lng: number; accuracyM: number | null; deviceAt: Date; at: Date } | null;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  escalatedAt: Date | null;
  cancelledAt: Date | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  outcome: SafetyOutcome | null;
  resolution: string | null;
}

/** `safety_incident_entries` (append-only timeline). */
export interface EntryRecord {
  id: string;
  incidentId: string;
  kind: SafetyEntryKind;
  at: Date;
  byId: string | null;
  note: string | null;
  data: Record<string, string>;
}

/** `safety_incident_fixes` (the position trail). */
export interface FixRecord {
  id: string;
  incidentId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  deviceAt: Date;
  at: Date;
}

export type IncidentPatch = Partial<Omit<IncidentRecord, 'id' | 'cityId' | 'raiserId' | 'clientId' | 'raisedAt'>>;

/** Open (not taken) and acknowledged: the alerts that still need someone. */
export const LIVE_STATES: readonly SafetyIncidentState[] = ['open', 'acknowledged'];

export interface SafetyRepository {
  create(input: Omit<IncidentRecord, 'id'>, tx?: Tx): Promise<IncidentRecord>;
  get(id: string, tx?: Tx): Promise<IncidentRecord | null>;
  byClient(raiserId: string, clientId: string, tx?: Tx): Promise<IncidentRecord | null>;
  update(id: string, patch: IncidentPatch, tx?: Tx): Promise<IncidentRecord>;
  /**
   * Sets `field` to `at` only while it is still null (and the incident is in `states`): true when this
   * call did it. Two API instances racing on an escalation or the contact message: one wins.
   */
  claim(id: string, field: 'escalatedAt' | 'contactAt', at: Date, states: readonly SafetyIncidentState[], tx?: Tx): Promise<boolean>;
  /** Newest first. */
  list(filter: { states?: readonly SafetyIncidentState[] | undefined; limit: number }, tx?: Tx): Promise<IncidentRecord[]>;
  /** The person's incidents raised since `since`, newest first. */
  ofRaiser(raiserId: string, since: Date, tx?: Tx): Promise<IncidentRecord[]>;
  addEntry(input: Omit<EntryRecord, 'id'>, tx?: Tx): Promise<EntryRecord>;
  entries(incidentId: string, tx?: Tx): Promise<EntryRecord[]>;
  addFix(input: Omit<FixRecord, 'id'>, tx?: Tx): Promise<FixRecord>;
  fixes(incidentId: string, tx?: Tx): Promise<FixRecord[]>;
  countFixesSince(incidentId: string, since: Date, tx?: Tx): Promise<number>;
}

export const SAFETY_REPOSITORY = Symbol('SAFETY_REPOSITORY');

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export class InMemorySafetyRepository implements SafetyRepository {
  private readonly incidents = new Map<string, IncidentRecord>();
  private readonly entryRows: EntryRecord[] = [];
  private readonly fixRows: FixRecord[] = [];

  async create(input: Omit<IncidentRecord, 'id'>): Promise<IncidentRecord> {
    if (await this.byClient(input.raiserId, input.clientId)) throw new Error('safety_incidents_raiser_id_client_id_key');
    const rec: IncidentRecord = { ...input, id: newId('sos') };
    this.incidents.set(rec.id, rec);
    return { ...rec };
  }
  async get(id: string): Promise<IncidentRecord | null> {
    const r = this.incidents.get(id);
    return r ? { ...r } : null;
  }
  async byClient(raiserId: string, clientId: string): Promise<IncidentRecord | null> {
    for (const r of this.incidents.values()) if (r.raiserId === raiserId && r.clientId === clientId) return { ...r };
    return null;
  }
  async update(id: string, patch: IncidentPatch): Promise<IncidentRecord> {
    const r = this.incidents.get(id);
    if (!r) throw new Error(`no incident ${id}`);
    Object.assign(r, patch);
    return { ...r };
  }
  async claim(id: string, field: 'escalatedAt' | 'contactAt', at: Date, states: readonly SafetyIncidentState[]): Promise<boolean> {
    const r = this.incidents.get(id);
    if (!r || r[field] !== null || !states.includes(r.state)) return false;
    r[field] = at;
    return true;
  }
  async list(filter: { states?: readonly SafetyIncidentState[] | undefined; limit: number }): Promise<IncidentRecord[]> {
    return [...this.incidents.values()]
      .filter((r) => !filter.states || filter.states.includes(r.state))
      .sort((a, b) => b.raisedAt.getTime() - a.raisedAt.getTime())
      .slice(0, filter.limit)
      .map((r) => ({ ...r }));
  }
  async ofRaiser(raiserId: string, since: Date): Promise<IncidentRecord[]> {
    return [...this.incidents.values()]
      .filter((r) => r.raiserId === raiserId && r.raisedAt.getTime() >= since.getTime())
      .sort((a, b) => b.raisedAt.getTime() - a.raisedAt.getTime())
      .map((r) => ({ ...r }));
  }
  async addEntry(input: Omit<EntryRecord, 'id'>): Promise<EntryRecord> {
    const rec = { ...input, id: newId('soe') };
    this.entryRows.push(rec);
    return { ...rec };
  }
  async entries(incidentId: string): Promise<EntryRecord[]> {
    return this.entryRows.filter((e) => e.incidentId === incidentId).sort((a, b) => a.at.getTime() - b.at.getTime()).map((e) => ({ ...e }));
  }
  async addFix(input: Omit<FixRecord, 'id'>): Promise<FixRecord> {
    const rec = { ...input, id: newId('sof') };
    this.fixRows.push(rec);
    return { ...rec };
  }
  async fixes(incidentId: string): Promise<FixRecord[]> {
    return this.fixRows.filter((f) => f.incidentId === incidentId).sort((a, b) => a.at.getTime() - b.at.getTime()).map((f) => ({ ...f }));
  }
  async countFixesSince(incidentId: string, since: Date): Promise<number> {
    return this.fixRows.filter((f) => f.incidentId === incidentId && f.at.getTime() >= since.getTime()).length;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const incidentFrom = (r: any): IncidentRecord => ({
  id: r.id,
  cityId: r.cityId,
  raiserId: r.raiserId,
  raiserRole: r.raiserRole,
  subjectKind: r.subjectKind,
  subjectId: r.subjectId,
  tripId: r.tripId,
  orderId: r.orderId,
  departureId: r.departureId,
  counterpartId: r.counterpartId,
  state: r.state,
  category: r.category,
  clientId: r.clientId,
  raiseEventId: r.raiseEventId,
  contactSet: r.contactSet,
  contactAt: r.contactAt,
  subjectLabel: r.subjectLabel,
  vehicleLabel: r.vehicleLabel,
  pressedAt: r.pressedAt,
  raisedAt: r.raisedAt,
  cancelUntil: r.cancelUntil,
  last: r.lastLat !== null && r.lastLng !== null && r.lastAt ? { lat: r.lastLat, lng: r.lastLng, accuracyM: r.lastAccuracyM, deviceAt: r.lastDeviceAt ?? r.lastAt, at: r.lastAt } : null,
  acknowledgedAt: r.acknowledgedAt,
  acknowledgedById: r.acknowledgedById,
  escalatedAt: r.escalatedAt,
  cancelledAt: r.cancelledAt,
  resolvedAt: r.resolvedAt,
  resolvedById: r.resolvedById,
  outcome: r.outcome,
  resolution: r.resolution,
});
const entryFrom = (r: any): EntryRecord => ({
  id: r.id,
  incidentId: r.incidentId,
  kind: r.kind,
  at: r.at,
  byId: r.byId,
  note: r.note,
  data: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, string>) : {},
});
const fixFrom = (r: any): FixRecord => ({ id: r.id, incidentId: r.incidentId, lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, deviceAt: r.deviceAt, at: r.at });
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Flattens `last` into the row's columns. */
function columns(patch: IncidentPatch | Omit<IncidentRecord, 'id'>): Record<string, unknown> {
  const { last, ...rest } = patch as IncidentPatch;
  const out: Record<string, unknown> = { ...rest };
  if (last !== undefined) {
    out['lastLat'] = last?.lat ?? null;
    out['lastLng'] = last?.lng ?? null;
    out['lastAccuracyM'] = last?.accuracyM ?? null;
    out['lastDeviceAt'] = last?.deviceAt ?? null;
    out['lastAt'] = last?.at ?? null;
  }
  return out;
}

export class PrismaSafetyRepository implements SafetyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(input: Omit<IncidentRecord, 'id'>, tx?: Tx): Promise<IncidentRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- flattened columns
    return incidentFrom(await this.db(tx).safetyIncident.create({ data: columns(input) as any }));
  }
  async get(id: string, tx?: Tx): Promise<IncidentRecord | null> {
    const r = await this.db(tx).safetyIncident.findUnique({ where: { id } });
    return r ? incidentFrom(r) : null;
  }
  async byClient(raiserId: string, clientId: string, tx?: Tx): Promise<IncidentRecord | null> {
    const r = await this.db(tx).safetyIncident.findUnique({ where: { raiserId_clientId: { raiserId, clientId } } });
    return r ? incidentFrom(r) : null;
  }
  async update(id: string, patch: IncidentPatch, tx?: Tx): Promise<IncidentRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- flattened columns
    return incidentFrom(await this.db(tx).safetyIncident.update({ where: { id }, data: columns(patch) as any }));
  }
  async claim(id: string, field: 'escalatedAt' | 'contactAt', at: Date, states: readonly SafetyIncidentState[], tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).safetyIncident.updateMany({ where: { id, [field]: null, state: { in: [...states] } }, data: { [field]: at } });
    return res.count === 1;
  }
  async list(filter: { states?: readonly SafetyIncidentState[] | undefined; limit: number }, tx?: Tx): Promise<IncidentRecord[]> {
    const rows = await this.db(tx).safetyIncident.findMany({ where: filter.states ? { state: { in: [...filter.states] } } : {}, orderBy: { raisedAt: 'desc' }, take: filter.limit });
    return rows.map(incidentFrom);
  }
  async ofRaiser(raiserId: string, since: Date, tx?: Tx): Promise<IncidentRecord[]> {
    const rows = await this.db(tx).safetyIncident.findMany({ where: { raiserId, raisedAt: { gte: since } }, orderBy: { raisedAt: 'desc' } });
    return rows.map(incidentFrom);
  }
  async addEntry(input: Omit<EntryRecord, 'id'>, tx?: Tx): Promise<EntryRecord> {
    return entryFrom(await this.db(tx).safetyIncidentEntry.create({ data: { incidentId: input.incidentId, kind: input.kind, at: input.at, byId: input.byId, note: input.note, data: input.data } }));
  }
  async entries(incidentId: string, tx?: Tx): Promise<EntryRecord[]> {
    return (await this.db(tx).safetyIncidentEntry.findMany({ where: { incidentId }, orderBy: { at: 'asc' } })).map(entryFrom);
  }
  async addFix(input: Omit<FixRecord, 'id'>, tx?: Tx): Promise<FixRecord> {
    return fixFrom(await this.db(tx).safetyIncidentFix.create({ data: input }));
  }
  async fixes(incidentId: string, tx?: Tx): Promise<FixRecord[]> {
    return (await this.db(tx).safetyIncidentFix.findMany({ where: { incidentId }, orderBy: { at: 'asc' } })).map(fixFrom);
  }
  async countFixesSince(incidentId: string, since: Date, tx?: Tx): Promise<number> {
    return this.db(tx).safetyIncidentFix.count({ where: { incidentId, at: { gte: since } } });
  }
}
