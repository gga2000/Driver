import type { AbsenceReason, KhatSweepCloseReason } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface AbsenceRecord {
  id: string;
  tripId: string;
  childRef: string;
  localDate: string;
  reportedById: string;
  reason: AbsenceReason;
  note: string | null;
  skippedStopIds: string[];
  createdAt: Date;
}

/** `khat_sweep_alerts`: a run that ended without the "car is empty" sweep in time (one per run). */
export interface SweepAlertRecord {
  id: string;
  tripId: string;
  cityId: string;
  driverId: string;
  childrenTotal: number;
  lastDropAt: Date | null;
  lastDropZone: string | null;
  runEndedAt: Date;
  raisedAt: Date;
  confirmedAt: Date | null;
  /** A dispatcher's close from the Console: when, who (staff person id), why. */
  closedAt: Date | null;
  closedById: string | null;
  closeReason: KhatSweepCloseReason | null;
  closeNote: string | null;
}

export type NewSweepAlert = Omit<SweepAlertRecord, 'id' | 'confirmedAt' | 'closedAt' | 'closedById' | 'closeReason' | 'closeNote'>;

export interface SweepAlertClose {
  closedAt: Date;
  closedById: string;
  closeReason: KhatSweepCloseReason;
  closeNote: string | null;
}

/** `khat_absences`: one row per child per run; `khat_sweep_alerts`: one row per run at most. */
export interface KhatRepository {
  createAbsence(input: Omit<AbsenceRecord, 'id'>, tx?: Tx): Promise<AbsenceRecord>;
  absence(tripId: string, childRef: string, tx?: Tx): Promise<AbsenceRecord | null>;
  absencesForTrips(tripIds: readonly string[], tx?: Tx): Promise<AbsenceRecord[]>;
  /** Inserts the run's alert; `created: false` with the existing row when the run already has one. */
  raiseSweepAlert(input: NewSweepAlert, tx?: Tx): Promise<{ alert: SweepAlertRecord; created: boolean }>;
  sweepAlertForTrip(tripId: string, tx?: Tx): Promise<SweepAlertRecord | null>;
  sweepAlert(id: string, tx?: Tx): Promise<SweepAlertRecord | null>;
  /** Sets `confirmedAt` once (a second confirm keeps the first time); null when there is no alert. */
  confirmSweepAlert(tripId: string, at: Date, tx?: Tx): Promise<SweepAlertRecord | null>;
  /**
   * Closes an open alert once: only while neither closed nor confirmed (a conditional update, so two
   * racing closes keep the first). `closed: false` with the row as it is otherwise; null when absent.
   */
  closeSweepAlert(id: string, close: SweepAlertClose, tx?: Tx): Promise<{ alert: SweepAlertRecord; closed: boolean } | null>;
  /** The city's alerts raised at or after `since`, oldest first. */
  sweepAlertsSince(cityId: string, since: Date, tx?: Tx): Promise<SweepAlertRecord[]>;
}

export const KHAT_REPOSITORY = Symbol('KHAT_REPOSITORY');

export class InMemoryKhatRepository implements KhatRepository {
  readonly rows: AbsenceRecord[] = [];
  private seq = 0;

  async createAbsence(input: Omit<AbsenceRecord, 'id'>): Promise<AbsenceRecord> {
    if (this.rows.some((r) => r.tripId === input.tripId && r.childRef === input.childRef)) throw new Error('unique violation: khat_absences(trip_id, child_ref)');
    this.seq += 1;
    const row = { id: `kabs_${this.seq}`, ...input, skippedStopIds: [...input.skippedStopIds] };
    this.rows.push(row);
    return { ...row };
  }

  async absence(tripId: string, childRef: string): Promise<AbsenceRecord | null> {
    const r = this.rows.find((x) => x.tripId === tripId && x.childRef === childRef);
    return r ? { ...r } : null;
  }

  async absencesForTrips(tripIds: readonly string[]): Promise<AbsenceRecord[]> {
    return this.rows.filter((r) => tripIds.includes(r.tripId)).map((r) => ({ ...r }));
  }

  readonly sweepAlerts: SweepAlertRecord[] = [];

  async raiseSweepAlert(input: NewSweepAlert): Promise<{ alert: SweepAlertRecord; created: boolean }> {
    const existing = this.sweepAlerts.find((a) => a.tripId === input.tripId);
    if (existing) return { alert: { ...existing }, created: false };
    this.seq += 1;
    const row: SweepAlertRecord = { id: `ksw_${this.seq}`, ...input, confirmedAt: null, closedAt: null, closedById: null, closeReason: null, closeNote: null };
    this.sweepAlerts.push(row);
    return { alert: { ...row }, created: true };
  }

  async sweepAlertForTrip(tripId: string): Promise<SweepAlertRecord | null> {
    const r = this.sweepAlerts.find((a) => a.tripId === tripId);
    return r ? { ...r } : null;
  }

  async sweepAlert(id: string): Promise<SweepAlertRecord | null> {
    const r = this.sweepAlerts.find((a) => a.id === id);
    return r ? { ...r } : null;
  }

  async confirmSweepAlert(tripId: string, at: Date): Promise<SweepAlertRecord | null> {
    const r = this.sweepAlerts.find((a) => a.tripId === tripId);
    if (!r) return null;
    r.confirmedAt ??= at;
    return { ...r };
  }

  async closeSweepAlert(id: string, close: SweepAlertClose): Promise<{ alert: SweepAlertRecord; closed: boolean } | null> {
    const r = this.sweepAlerts.find((a) => a.id === id);
    if (!r) return null;
    if (r.closedAt || r.confirmedAt) return { alert: { ...r }, closed: false };
    Object.assign(r, close);
    return { alert: { ...r }, closed: true };
  }

  async sweepAlertsSince(cityId: string, since: Date): Promise<SweepAlertRecord[]> {
    return this.sweepAlerts
      .filter((a) => a.cityId === cityId && a.raisedAt.getTime() >= since.getTime())
      .sort((a, b) => a.raisedAt.getTime() - b.raisedAt.getTime())
      .map((a) => ({ ...a }));
  }
}

const isUniqueViolation = (err: unknown): boolean => /P2002|unique/i.test(`${(err as { code?: string })?.code ?? ''} ${(err as Error)?.message ?? ''}`);

const SWEEP_FIELDS = {
  id: true,
  tripId: true,
  cityId: true,
  driverId: true,
  childrenTotal: true,
  lastDropAt: true,
  lastDropZone: true,
  runEndedAt: true,
  raisedAt: true,
  confirmedAt: true,
  closedAt: true,
  closedById: true,
  closeReason: true,
  closeNote: true,
} as const;

/** `close_reason` is written only from `KhatSweepCloseReason` (the router validates it). */
function sweepFromRow(r: Omit<SweepAlertRecord, 'closeReason'> & { closeReason: string | null }): SweepAlertRecord {
  return { ...r, closeReason: r.closeReason as KhatSweepCloseReason | null };
}

function fromRow(r: { id: string; tripId: string; childRef: string; localDate: string; reportedById: string; reason: string; note: string | null; skippedStopIds: string[]; createdAt: Date }): AbsenceRecord {
  return { ...r, reason: r.reason as AbsenceReason, skippedStopIds: [...r.skippedStopIds] };
}

export class PrismaKhatRepository implements KhatRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async createAbsence(input: Omit<AbsenceRecord, 'id'>, tx?: Tx): Promise<AbsenceRecord> {
    return fromRow(await this.db(tx).khatAbsence.create({ data: input }));
  }

  async absence(tripId: string, childRef: string, tx?: Tx): Promise<AbsenceRecord | null> {
    const r = await this.db(tx).khatAbsence.findUnique({ where: { tripId_childRef: { tripId, childRef } } });
    return r ? fromRow(r) : null;
  }

  async absencesForTrips(tripIds: readonly string[], tx?: Tx): Promise<AbsenceRecord[]> {
    if (tripIds.length === 0) return [];
    return (await this.db(tx).khatAbsence.findMany({ where: { tripId: { in: [...tripIds] } }, orderBy: { createdAt: 'asc' } })).map(fromRow);
  }

  async raiseSweepAlert(input: NewSweepAlert, tx?: Tx): Promise<{ alert: SweepAlertRecord; created: boolean }> {
    try {
      return { alert: sweepFromRow(await this.db(tx).khatSweepAlert.create({ data: input, select: SWEEP_FIELDS })), created: true };
    } catch (err) {
      // Another instance raised it first (unique trip_id): once per run.
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.sweepAlertForTrip(input.tripId, tx);
      if (!existing) throw err;
      return { alert: existing, created: false };
    }
  }

  async sweepAlertForTrip(tripId: string, tx?: Tx): Promise<SweepAlertRecord | null> {
    const r = await this.db(tx).khatSweepAlert.findUnique({ where: { tripId }, select: SWEEP_FIELDS });
    return r ? sweepFromRow(r) : null;
  }

  async sweepAlert(id: string, tx?: Tx): Promise<SweepAlertRecord | null> {
    const r = await this.db(tx).khatSweepAlert.findUnique({ where: { id }, select: SWEEP_FIELDS });
    return r ? sweepFromRow(r) : null;
  }

  async confirmSweepAlert(tripId: string, at: Date, tx?: Tx): Promise<SweepAlertRecord | null> {
    // Only the first confirm sets the time (conditional update, so two racing confirms keep one).
    await this.db(tx).khatSweepAlert.updateMany({ where: { tripId, confirmedAt: null }, data: { confirmedAt: at } });
    return this.sweepAlertForTrip(tripId, tx);
  }

  async closeSweepAlert(id: string, close: SweepAlertClose, tx?: Tx): Promise<{ alert: SweepAlertRecord; closed: boolean } | null> {
    // Conditional update: the first close wins, and a confirmed alert is not closed over the driver.
    const { count } = await this.db(tx).khatSweepAlert.updateMany({ where: { id, closedAt: null, confirmedAt: null }, data: close });
    const alert = await this.sweepAlert(id, tx);
    return alert ? { alert, closed: count > 0 } : null;
  }

  async sweepAlertsSince(cityId: string, since: Date, tx?: Tx): Promise<SweepAlertRecord[]> {
    return (await this.db(tx).khatSweepAlert.findMany({ where: { cityId, raisedAt: { gte: since } }, orderBy: { raisedAt: 'asc' }, select: SWEEP_FIELDS })).map(sweepFromRow);
  }
}
