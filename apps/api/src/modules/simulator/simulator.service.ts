import { Injectable } from '@nestjs/common';
import { AZIZIYAH_ZONES, type PriceRequest } from '@driver/contracts';
import { DispatchService, type DriverCandidate } from '../dispatch/index.js';
import { Accounts, LedgerService } from '../ledger/index.js';
import { PricingService } from '../pricing/index.js';
import { TripsService } from '../trips/index.js';

export interface SimulationResult {
  trips: number;
  completed: number;
  noDrivers: number;
  totalFaresIqd: number;
  ledgerBalanced: boolean;
}

/** Small deterministic PRNG so simulator runs are reproducible from a seed. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Runs fake customers through quote → dispatch → complete → ledger using only the public
 * interfaces of the other modules. Later milestones add real geography and a clock.
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly pricing: PricingService,
    private readonly dispatch: DispatchService,
    private readonly trips: TripsService,
    private readonly ledger: LedgerService,
  ) {}

  async run(opts: { cityId: string; trips: number; drivers: number; seed?: number; commissionPct?: number }): Promise<SimulationResult> {
    const rand = rng(opts.seed ?? 1);
    const zones = AZIZIYAH_ZONES.map((z) => z.id);
    const commission = opts.commissionPct ?? 20;
    const drivers: DriverCandidate[] = Array.from({ length: opts.drivers }, (_, i) => ({
      driverId: `sim-d${i + 1}`,
      distanceKm: Math.round(rand() * 50) / 10,
      activeTrips: 0,
      tier: 'bronze',
    }));

    let completed = 0;
    let noDrivers = 0;
    let totalFares = 0;

    for (let i = 0; i < opts.trips; i++) {
      const from = zones[Math.floor(rand() * zones.length)]!;
      const to = zones[Math.floor(rand() * zones.length)]!;
      const req: PriceRequest = {
        cityId: opts.cityId,
        vertical: 'taxi',
        stops: [{ zoneId: from, type: 'pickup' }, { zoneId: to, type: 'dropoff' }],
        options: { frontSeat: false, doorPickup: rand() < 0.3, streetHandover: false, waitMinutes: 0, promoIqd: 0 },
        at: new Date('2026-10-02T09:00:00Z'),
        distanceKm: Math.round(rand() * 80) / 10,
        durationMin: Math.round(rand() * 25),
      };
      const quote = this.pricing.quote(req);
      const customerId = `sim-c${i + 1}`;
      const orderId = `sim-o${i + 1}`;
      const trip = await this.trips.createForOrders(
        {
          cityId: opts.cityId,
          vertical: 'taxi',
          orders: [{ orderId }],
          stops: [
            { orderId, type: 'pickup', zoneKey: from },
            { orderId, type: 'dropoff', zoneKey: to },
          ],
        },
        customerId,
      );

      const plan = this.dispatch.plan({ tripId: trip.id, cityId: opts.cityId, vertical: 'taxi', zoneId: from }, drivers);
      if (plan.kind !== 'broadcast') {
        noDrivers += 1;
        await this.trips.cancel(trip.id, 'platform', 'system', 'no_drivers');
        continue;
      }
      const driverId = plan.waves[0]!.driverIds[0]!;
      await this.trips.offer(trip.id, { driverIds: plan.waves[0]!.driverIds });
      await this.trips.accept(trip.id, driverId, { vehicleClass: 'car' });
      for (const stop of trip.stops) {
        await this.trips.arrive(trip.id, stop.id, driverId);
        await this.trips.completeStop(trip.id, stop.id, driverId);
      }
      const fare = quote.total;
      const fee = Math.round((fare * commission) / 100);
      await this.ledger.record({ type: 'cash_collected', amount: fare, fromAccount: Accounts.customer(customerId), toAccount: Accounts.cash(driverId), tripId: trip.id, occurredAt: new Date() });
      await this.ledger.record({ type: 'driver_settlement', amount: fare, fromAccount: Accounts.cash(driverId), toAccount: Accounts.driver(driverId), tripId: trip.id, occurredAt: new Date() });
      await this.ledger.record({ type: 'commission_accrued', amount: fee, fromAccount: Accounts.driver(driverId), toAccount: Accounts.platform, tripId: trip.id, occurredAt: new Date() });
      completed += 1;
      totalFares += fare;
    }

    const inv = await this.ledger.checkInvariant();
    return { trips: opts.trips, completed, noDrivers, totalFaresIqd: totalFares, ledgerBalanced: inv.ok };
  }
}
