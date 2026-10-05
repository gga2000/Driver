import {
  LIVE_RULES,
  liveChannel,
  positionVisible,
  type EtaBasis,
  type LatLng,
  type Trip,
} from '@driver/contracts';
import type { PositionReport } from '../trips/index.js';
import type { LiveBus } from './live.bus.js';

/** The courier's ETA for one order from a fix (tracking's one-ETA rule); null when it can't be told. */
export type PositionEta = (orderId: string, trip: Trip, pin: LatLng, now: Date) => Promise<{ at: Date; basis: EtaBasis } | null>;
/**
 * The kitchen's radar for one order (maps program SP7a): its store and where the courier is from the
 * kitchen, while his pickup for that order is still to do; null otherwise.
 */
export type PositionRadar = (
  orderId: string,
  trip: Trip,
  pin: LatLng,
) => Promise<{ merchantOrgId: string; distanceM: number; bearingDeg: number; etaMinutes: number } | null>;

/**
 * Courier positions to the live channel, throttled per driver to at most one every
 * `positionThrottleMs` (≥ 2 s; the newest fix wins, the last one of a burst is sent when the window
 * ends). Each fix goes to the order channels of his trip — only inside the sharing window the
 * customer's `orders.courierPosition` applies: trip accepted and in a visible state, this order's
 * own drop-off not done yet — and as a pin to the city's Console board.
 */
export class PositionFanout {
  private readonly lastSent = new Map<string, number>();
  private readonly pending = new Map<
    string,
    { report: PositionReport; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly bus: LiveBus,
    private readonly trips: { get(tripId: string): Promise<Trip> },
    private readonly nowMs: () => number = Date.now,
    private readonly throttleMs: number = LIVE_RULES.positionThrottleMs,
    private readonly etaFor: PositionEta | null = null,
    private readonly radarFor: PositionRadar | null = null,
  ) {}

  report(r: PositionReport): void {
    const last = this.lastSent.get(r.driverId);
    const now = this.nowMs();
    if (last === undefined || now - last >= this.throttleMs) {
      this.lastSent.set(r.driverId, now);
      void this.send(r);
      return;
    }
    const queued = this.pending.get(r.driverId);
    if (queued) {
      queued.report = r;
      return;
    }
    const timer = setTimeout(
      () => {
        const p = this.pending.get(r.driverId);
        this.pending.delete(r.driverId);
        if (!p) return;
        this.lastSent.set(r.driverId, this.nowMs());
        void this.send(p.report);
      },
      Math.max(0, last + this.throttleMs - now),
    );
    timer.unref?.();
    this.pending.set(r.driverId, { report: r, timer });
  }

  close(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  private async send(r: PositionReport): Promise<void> {
    const pin: LatLng = r.pin;
    if (r.tripIds.length === 0) {
      await this.bus
        .publish(liveChannel.anyCity(), {
          type: 'driver_pin',
          driverId: r.driverId,
          tripId: null,
          pin,
          at: r.at,
        })
        .catch(() => undefined);
      return;
    }
    for (const tripId of r.tripIds) {
      let trip: Trip;
      try {
        trip = await this.trips.get(tripId);
      } catch {
        continue;
      }
      if (trip.courierId !== r.driverId) continue;
      await this.bus
        .publish(liveChannel.city(trip.cityId), {
          type: 'driver_pin',
          driverId: r.driverId,
          tripId,
          pin,
          at: r.at,
        })
        .catch(() => undefined);
      if (!positionVisible(trip.state) || !trip.acceptedAt) continue;
      const orders = new Set(
        trip.stops.map((s) => s.orderId).filter((id): id is string => Boolean(id)),
      );
      for (const orderId of orders) {
        // The kitchen's radar (maps program SP7a): until he has collected this order.
        const radar = this.radarFor ? await this.radarFor(orderId, trip, pin).catch(() => null) : null;
        if (radar) {
          await this.bus
            .publish(liveChannel.merchant(radar.merchantOrgId), {
              type: 'courier_radar',
              orderId,
              distanceM: radar.distanceM,
              bearingDeg: radar.bearingDeg,
              etaMinutes: radar.etaMinutes,
              at: r.at,
            })
            .catch(() => undefined);
        }
        const myDrop = trip.stops.find((s) => s.orderId === orderId && s.type === 'dropoff');
        if (myDrop && (myDrop.state === 'completed' || myDrop.state === 'skipped')) continue;
        // The ETA rides along (maps program SP4b); if it can't be told the position still goes out.
        const eta = this.etaFor ? await this.etaFor(orderId, trip, pin, new Date(this.nowMs())).catch(() => null) : null;
        await this.bus
          .publish(liveChannel.order(orderId), {
            type: 'position',
            orderId,
            tripId,
            pin,
            bearing: r.bearing,
            speedKmh: r.speedKmh,
            at: r.at,
            ...(eta ? { etaAt: eta.at, etaBasis: eta.basis } : {}),
          })
          .catch(() => undefined);
      }
    }
  }
}
