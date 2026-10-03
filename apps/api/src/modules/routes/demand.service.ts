import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  PostDemandInput,
  type IntercityDirection,
  type PickupChoice,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { DeparturesService } from './departures.service.js';
import { ROUTES_EVENTS, type RoutesEventEmitter } from './events.adapter.js';
import { originCity, type IntercityNetworkConfig } from './intercity.config.js';
import type { DemandPostRecord, DepartureRecord } from './model.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { ROUTES_IDS, type IdSource } from './support.js';
import { ROUTES_NETWORK } from './tokens.js';
import { RoutesWriter } from './writer.js';

type PostDemand = z.output<typeof PostDemandInput>;

export interface DemandBucketView {
  garageId: string | null;
  windowStart: Date;
  windowEnd: Date;
  postedSeats: number;
  claimedSeats: number;
  posts: number;
}

/**
 * The demand board, "أريد أرجع" (customer spec §2, review C-34). A rider posts a window, seats and a
 * pickup preference; drivers see counts per garage and window (claimed vs posted) and announce
 * against them. A driver's announcement inside a post's window converts the post into a 10-minute
 * hold on the new car (the normal prepay / cash-reservation rules follow); a claim left to lapse
 * counts against the rider's cash reservation rights. Posts expire at the end of their window; an
 * open post whose window has started is escalated to the dispatcher once.
 */
@Injectable()
export class DemandService {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Inject(ROUTES_EVENTS) private readonly events: RoutesEventEmitter,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly writer: RoutesWriter,
    private readonly departures: DeparturesService,
    @Inject(ROUTES_NETWORK) private readonly network: IntercityNetworkConfig,
    @Inject(ROUTES_IDS) private readonly ids: IdSource,
  ) {
    departures.onAnnounce(async (tx, dep) => {
      await this.claimFor(tx, dep);
    });
  }

  private now(): Date {
    return this.clock.now();
  }

  post(riderId: string, input: PostDemand): Promise<DemandPostRecord> {
    return this.writer.run(async (tx) => {
      const corridor = this.departures.corridor(input.corridorId);
      const from = originCity(corridor, input.direction);
      const now = this.now().getTime();
      if (
        input.windowEnd.getTime() <= now ||
        input.windowEnd.getTime() - input.windowStart.getTime() > 12 * 3600_000
      )
        throw new DriverError('invalid_input');
      let garageId: string | null = null;
      if (input.pickup.kind === 'garage' && input.pickup.garageId) {
        const g = this.departures.garage(input.pickup.garageId);
        if (g.cityId !== from) throw new DriverError('pickup_invalid');
        garageId = g.id;
      }
      if (input.pickup.kind === 'meeting_point') {
        const id = input.pickup.meetingPointId;
        if (!corridor.meetingPoints.some((m) => m.id === id))
          throw new DriverError('pickup_invalid');
      }
      const open = await this.repo.listDemand(
        { riderId, states: ['open'], corridorId: corridor.id, direction: input.direction },
        tx,
      );
      if (
        open.some(
          (p) =>
            p.windowStart.getTime() < input.windowEnd.getTime() &&
            input.windowStart.getTime() < p.windowEnd.getTime(),
        )
      )
        throw new DriverError('demand_state_conflict');
      const p: DemandPostRecord = {
        id: this.ids.id('dm'),
        riderId,
        corridorId: corridor.id,
        direction: input.direction,
        garageId,
        pickup: input.pickup,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        seats: input.seats,
        travellingAs: input.travellingAs,
        state: 'open',
        bookingId: null,
        escalatedAt: null,
        createdAt: this.now(),
      };
      await this.repo.saveDemand(p, tx);
      await this.emit(tx, 'demand.posted', riderId, p, {
        corridorId: p.corridorId,
        direction: p.direction,
        garageId,
        windowStart: p.windowStart,
        windowEnd: p.windowEnd,
        seats: p.seats,
      });
      return p;
    });
  }

  mine(riderId: string): Promise<DemandPostRecord[]> {
    return this.repo.listDemand({ riderId });
  }

  cancel(riderId: string, postId: string): Promise<DemandPostRecord> {
    return this.writer.run(async (tx) => {
      const p = await this.repo.getDemand(postId, tx);
      if (!p || p.riderId !== riderId) throw new DriverError('demand_not_found');
      if (p.state !== 'open') throw new DriverError('demand_state_conflict');
      p.state = 'cancelled';
      await this.repo.saveDemand(p, tx);
      await this.emit(tx, 'demand.cancelled', riderId, p, {});
      return p;
    });
  }

  /** Counts per garage and window for drivers: posted (open) vs claimed seats. */
  async board(input: {
    corridorId: string;
    direction: IntercityDirection;
    from?: Date | undefined;
    to?: Date | undefined;
    garageId?: string | undefined;
  }): Promise<DemandBucketView[]> {
    const now = this.now();
    const posts = await this.repo.listDemand({
      corridorId: input.corridorId,
      direction: input.direction,
      states: ['open', 'claimed'],
      endsAfter: input.from ?? now,
      ...(input.to ? { startsBefore: input.to } : {}),
    });
    const buckets = new Map<string, DemandBucketView>();
    for (const p of posts) {
      if (input.garageId && p.garageId !== null && p.garageId !== input.garageId) continue;
      const key = `${p.garageId ?? '*'}|${p.windowStart.toISOString()}|${p.windowEnd.toISOString()}`;
      const b = buckets.get(key) ?? {
        garageId: p.garageId,
        windowStart: p.windowStart,
        windowEnd: p.windowEnd,
        postedSeats: 0,
        claimedSeats: 0,
        posts: 0,
      };
      b.posts += 1;
      if (p.state === 'open') b.postedSeats += p.seats;
      else b.claimedSeats += p.seats;
      buckets.set(key, b);
    }
    return [...buckets.values()].sort(
      (a, b) =>
        a.windowStart.getTime() - b.windowStart.getTime() ||
        (a.garageId ?? '').localeCompare(b.garageId ?? ''),
    );
  }

  /**
   * A new departure claims the open posts whose window contains its time, oldest first: each becomes
   * a 10-minute hold on the car (seats away from the front), as long as seats remain and the
   * travelling-as and family-only rules allow it.
   */
  async claimFor(tx: Tx, dep: DepartureRecord): Promise<number> {
    const at = dep.departAt.getTime();
    const posts = (
      await this.repo.listDemand(
        { corridorId: dep.corridorId, direction: dep.direction, states: ['open'] },
        tx,
      )
    )
      .filter((p) => p.windowStart.getTime() <= at && at < p.windowEnd.getTime())
      .filter(
        (p) => p.pickup.kind !== 'garage' || p.garageId === null || p.garageId === dep.garageId,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let claimed = 0;
    for (const p of posts) {
      const pickup: PickupChoice = p.pickup.kind === 'garage' ? { kind: 'garage' } : p.pickup;
      const hold = await this.departures.holdForDemand(tx, dep, {
        id: p.id,
        riderId: p.riderId,
        seats: p.seats,
        travellingAs: p.travellingAs,
        pickup,
      });
      if (!hold) continue;
      p.state = 'claimed';
      p.bookingId = hold.id;
      await this.repo.saveDemand(p, tx);
      await this.emit(tx, 'demand.claimed', dep.driverId, p, {
        bookingId: hold.id,
        departureId: dep.id,
        garageId: dep.garageId,
        departAt: dep.departAt,
        heldUntil: hold.heldUntil,
        riderId: p.riderId,
      });
      claimed += 1;
    }
    return claimed;
  }

  /** Posts expire at the end of their window; an open post whose window started is escalated once. */
  async tick(tx: Tx): Promise<{ expired: number; escalated: number }> {
    const now = this.now();
    const out = { expired: 0, escalated: 0 };
    for (const p of await this.repo.listDemand({ states: ['open'] }, tx)) {
      if (p.windowEnd.getTime() <= now.getTime()) {
        p.state = 'expired';
        await this.repo.saveDemand(p, tx);
        await this.emit(tx, 'demand.expired', 'system', p, {});
        out.expired += 1;
      } else if (!p.escalatedAt && p.windowStart.getTime() <= now.getTime()) {
        p.escalatedAt = now;
        await this.repo.saveDemand(p, tx);
        await this.emit(tx, 'demand.unserved', 'system', p, {
          corridorId: p.corridorId,
          direction: p.direction,
          garageId: p.garageId,
          seats: p.seats,
          windowStart: p.windowStart,
          windowEnd: p.windowEnd,
        });
        out.escalated += 1;
      }
    }
    return out;
  }

  /** Network lookups for views. */
  get garages() {
    return this.network.garages;
  }

  private async emit(
    tx: Tx,
    type: string,
    actorId: string,
    p: DemandPostRecord,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.emit(
      tx,
      {
        type,
        actorId,
        occurredAt: this.now(),
        payload: JSON.parse(JSON.stringify({ postId: p.id, riderId: p.riderId, ...payload })),
      },
      { name: 'demand_post', id: p.id },
    );
  }
}
