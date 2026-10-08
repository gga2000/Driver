import { randomUUID } from 'node:crypto';
import type { AlertKind, LadderStep, OnCallDesk, OnCallShift } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** What a ladder's pages say (ids and keys only: the name is a logged vault read at page time). */
export interface AlertBrief {
  raiserId: string | null;
  role: string | null;
  subjectKind: string | null;
  orderId: string | null;
}

/** `alert_ladders` */
export interface LadderRecord {
  alertId: string;
  kind: AlertKind;
  cityId: string;
  brief: AlertBrief;
  openedAt: Date;
  nextRingAt: Date;
  rings: number;
  onCallStep: number;
  unanswered: boolean;
  takenAt: Date | null;
  closedAt: Date | null;
  steps: LadderStep[];
}

export interface OnCallRepository {
  addShift(
    input: Omit<OnCallShift, 'id' | 'createdAt' | 'endedAt'>,
    now: Date,
    tx?: Tx,
  ): Promise<OnCallShift>;
  shift(id: string, tx?: Tx): Promise<OnCallShift | null>;
  endShift(id: string, at: Date, tx?: Tx): Promise<OnCallShift>;
  /** Shifts of the city that end after `from` and start before `to` (ended ones included), by start. */
  shifts(cityId: string, from: Date, to: Date, tx?: Tx): Promise<OnCallShift[]>;
  /** On call at `at` (started, not ended, not taken off), rank 1 first. */
  onCallAt(cityId: string, desk: OnCallDesk, at: Date, tx?: Tx): Promise<OnCallShift[]>;

  /** Opens a ladder once (a replayed event is a no-op); returns null when it already existed. */
  openLadder(
    input: Omit<
      LadderRecord,
      'rings' | 'onCallStep' | 'unanswered' | 'takenAt' | 'closedAt' | 'steps'
    >,
    tx?: Tx,
  ): Promise<LadderRecord | null>;
  ladder(alertId: string, tx?: Tx): Promise<LadderRecord | null>;
  /** Not taken and not closed, oldest first. */
  ringing(limit: number, tx?: Tx): Promise<LadderRecord[]>;
  /**
   * Moves a ladder on only while it is exactly as the caller read it (`rings` and `onCallStep`) and
   * still ringing: true when this call did it. Two API machines racing on one ring: one wins.
   */
  advance(
    alertId: string,
    seen: { rings: number; onCallStep: number },
    patch: {
      rings: number;
      onCallStep: number;
      nextRingAt: Date;
      unanswered: boolean;
      step: LadderStep;
    },
    tx?: Tx,
  ): Promise<boolean>;
  /** Someone took it (first time wins); clears `unanswered`. */
  take(alertId: string, at: Date, tx?: Tx): Promise<boolean>;
  /** Resolved or cancelled (first time wins); also clears `unanswered`. */
  close(alertId: string, at: Date, tx?: Tx): Promise<boolean>;
}

export const ON_CALL_REPOSITORY = Symbol('ON_CALL_REPOSITORY');

const newId = () => `onc_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const live = (s: OnCallShift, at: Date) =>
  s.endedAt === null && s.startsAt.getTime() <= at.getTime() && s.endsAt.getTime() > at.getTime();
const byRankThenStart = (a: OnCallShift, b: OnCallShift) =>
  a.rank - b.rank || a.startsAt.getTime() - b.startsAt.getTime();

export class InMemoryOnCallRepository implements OnCallRepository {
  private readonly shiftRows = new Map<string, OnCallShift>();
  private readonly ladders = new Map<string, LadderRecord>();

  async addShift(
    input: Omit<OnCallShift, 'id' | 'createdAt' | 'endedAt'>,
    now: Date,
  ): Promise<OnCallShift> {
    const rec: OnCallShift = { ...input, id: newId(), createdAt: now, endedAt: null };
    this.shiftRows.set(rec.id, rec);
    return { ...rec };
  }
  async shift(id: string): Promise<OnCallShift | null> {
    const r = this.shiftRows.get(id);
    return r ? { ...r } : null;
  }
  async endShift(id: string, at: Date): Promise<OnCallShift> {
    const r = this.shiftRows.get(id);
    if (!r) throw new Error(`no shift ${id}`);
    r.endedAt ??= at;
    return { ...r };
  }
  async shifts(cityId: string, from: Date, to: Date): Promise<OnCallShift[]> {
    return [...this.shiftRows.values()]
      .filter(
        (s) =>
          s.cityId === cityId &&
          s.endsAt.getTime() > from.getTime() &&
          s.startsAt.getTime() < to.getTime(),
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((s) => ({ ...s }));
  }
  async onCallAt(cityId: string, desk: OnCallDesk, at: Date): Promise<OnCallShift[]> {
    return [...this.shiftRows.values()]
      .filter((s) => s.cityId === cityId && s.desk === desk && live(s, at))
      .sort(byRankThenStart)
      .map((s) => ({ ...s }));
  }

  async openLadder(
    input: Omit<
      LadderRecord,
      'rings' | 'onCallStep' | 'unanswered' | 'takenAt' | 'closedAt' | 'steps'
    >,
  ): Promise<LadderRecord | null> {
    if (this.ladders.has(input.alertId)) return null;
    const rec: LadderRecord = {
      ...input,
      rings: 0,
      onCallStep: 0,
      unanswered: false,
      takenAt: null,
      closedAt: null,
      steps: [],
    };
    this.ladders.set(rec.alertId, rec);
    return structuredClone(rec);
  }
  async ladder(alertId: string): Promise<LadderRecord | null> {
    const r = this.ladders.get(alertId);
    return r ? structuredClone(r) : null;
  }
  async ringing(limit: number): Promise<LadderRecord[]> {
    return [...this.ladders.values()]
      .filter((l) => l.takenAt === null && l.closedAt === null)
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
      .slice(0, limit)
      .map((l) => structuredClone(l));
  }
  async advance(
    alertId: string,
    seen: { rings: number; onCallStep: number },
    patch: {
      rings: number;
      onCallStep: number;
      nextRingAt: Date;
      unanswered: boolean;
      step: LadderStep;
    },
  ): Promise<boolean> {
    const r = this.ladders.get(alertId);
    if (!r || r.takenAt || r.closedAt || r.rings !== seen.rings || r.onCallStep !== seen.onCallStep)
      return false;
    Object.assign(r, {
      rings: patch.rings,
      onCallStep: patch.onCallStep,
      nextRingAt: patch.nextRingAt,
      unanswered: patch.unanswered,
    });
    r.steps.push(patch.step);
    return true;
  }
  async take(alertId: string, at: Date): Promise<boolean> {
    const r = this.ladders.get(alertId);
    if (!r || r.takenAt) return false;
    r.takenAt = at;
    r.unanswered = false;
    return true;
  }
  async close(alertId: string, at: Date): Promise<boolean> {
    const r = this.ladders.get(alertId);
    if (!r || r.closedAt) return false;
    r.closedAt = at;
    r.unanswered = false;
    return true;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const shiftFrom = (r: any): OnCallShift => ({
  id: r.id,
  cityId: r.cityId,
  desk: r.desk,
  personId: r.personId,
  rank: r.rank,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  createdById: r.createdById,
  createdAt: r.createdAt,
  endedAt: r.endedAt,
});
const ladderFrom = (r: any): LadderRecord => ({
  alertId: r.alertId,
  kind: r.kind,
  cityId: r.cityId,
  brief: {
    raiserId: r.brief?.raiserId ?? null,
    role: r.brief?.role ?? null,
    subjectKind: r.brief?.subjectKind ?? null,
    orderId: r.brief?.orderId ?? null,
  },
  openedAt: r.openedAt,
  nextRingAt: r.nextRingAt,
  rings: r.rings,
  onCallStep: r.onCallStep,
  unanswered: r.unanswered,
  takenAt: r.takenAt,
  closedAt: r.closedAt,
  steps: Array.isArray(r.steps)
    ? r.steps.map((s: any) => ({ at: new Date(s.at), step: s.step, count: s.count }))
    : [],
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const stepJson = (s: LadderStep) => ({ at: s.at.toISOString(), step: s.step, count: s.count });

export class PrismaOnCallRepository implements OnCallRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async addShift(
    input: Omit<OnCallShift, 'id' | 'createdAt' | 'endedAt'>,
    now: Date,
    tx?: Tx,
  ): Promise<OnCallShift> {
    return shiftFrom(
      await this.db(tx).onCallShift.create({ data: { ...input, id: newId(), createdAt: now } }),
    );
  }
  async shift(id: string, tx?: Tx): Promise<OnCallShift | null> {
    const r = await this.db(tx).onCallShift.findUnique({ where: { id } });
    return r ? shiftFrom(r) : null;
  }
  async endShift(id: string, at: Date, tx?: Tx): Promise<OnCallShift> {
    await this.db(tx).onCallShift.updateMany({
      where: { id, endedAt: null },
      data: { endedAt: at },
    });
    return shiftFrom(await this.db(tx).onCallShift.findUniqueOrThrow({ where: { id } }));
  }
  async shifts(cityId: string, from: Date, to: Date, tx?: Tx): Promise<OnCallShift[]> {
    const rows = await this.db(tx).onCallShift.findMany({
      where: { cityId, endsAt: { gt: from }, startsAt: { lt: to } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(shiftFrom);
  }
  async onCallAt(cityId: string, desk: OnCallDesk, at: Date, tx?: Tx): Promise<OnCallShift[]> {
    const rows = await this.db(tx).onCallShift.findMany({
      where: { cityId, desk, endedAt: null, startsAt: { lte: at }, endsAt: { gt: at } },
      orderBy: [{ rank: 'asc' }, { startsAt: 'asc' }],
    });
    return rows.map(shiftFrom);
  }

  async openLadder(
    input: Omit<
      LadderRecord,
      'rings' | 'onCallStep' | 'unanswered' | 'takenAt' | 'closedAt' | 'steps'
    >,
    tx?: Tx,
  ): Promise<LadderRecord | null> {
    const res = await this.db(tx).alertLadder.createMany({
      data: [
        {
          alertId: input.alertId,
          kind: input.kind,
          cityId: input.cityId,
          brief: { ...input.brief },
          openedAt: input.openedAt,
          nextRingAt: input.nextRingAt,
        },
      ],
      skipDuplicates: true,
    });
    return res.count === 1 ? this.ladder(input.alertId, tx) : null;
  }
  async ladder(alertId: string, tx?: Tx): Promise<LadderRecord | null> {
    const r = await this.db(tx).alertLadder.findUnique({ where: { alertId } });
    return r ? ladderFrom(r) : null;
  }
  async ringing(limit: number, tx?: Tx): Promise<LadderRecord[]> {
    const rows = await this.db(tx).alertLadder.findMany({
      where: { takenAt: null, closedAt: null },
      orderBy: { openedAt: 'asc' },
      take: limit,
    });
    return rows.map(ladderFrom);
  }
  async advance(
    alertId: string,
    seen: { rings: number; onCallStep: number },
    patch: {
      rings: number;
      onCallStep: number;
      nextRingAt: Date;
      unanswered: boolean;
      step: LadderStep;
    },
    tx?: Tx,
  ): Promise<boolean> {
    const db = this.db(tx);
    const current = await db.alertLadder.findUnique({
      where: { alertId },
      select: { steps: true },
    });
    if (!current) return false;
    const steps = [...(Array.isArray(current.steps) ? current.steps : []), stepJson(patch.step)];
    const res = await db.alertLadder.updateMany({
      where: {
        alertId,
        takenAt: null,
        closedAt: null,
        rings: seen.rings,
        onCallStep: seen.onCallStep,
      },
      data: {
        rings: patch.rings,
        onCallStep: patch.onCallStep,
        nextRingAt: patch.nextRingAt,
        unanswered: patch.unanswered,
        steps,
      },
    });
    return res.count === 1;
  }
  async take(alertId: string, at: Date, tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).alertLadder.updateMany({
      where: { alertId, takenAt: null },
      data: { takenAt: at, unanswered: false },
    });
    return res.count === 1;
  }
  async close(alertId: string, at: Date, tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).alertLadder.updateMany({
      where: { alertId, closedAt: null },
      data: { closedAt: at, unanswered: false },
    });
    return res.count === 1;
  }
}
