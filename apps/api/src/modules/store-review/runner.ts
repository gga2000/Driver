import { Logger } from '@nestjs/common';
import { isDriverError, type DeliveryPoint, type LatLng, type Trip } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import { TEST_CREW_ID, isTestId, newTestId } from '../../shared/test-scope.js';
import type { OrdersService } from '../orders/index.js';
import type { TripsService } from '../trips/index.js';
import { TEST_KITCHEN } from './test-kitchen.js';

/**
 * The steps a store reviewer's test order walks through after the test kitchen accepts it, and how
 * long after acceptance each one runs: cooking, the crew takes the trip, picks up, reaches the door,
 * hands over. About five minutes end to end, so a reviewer sees every tracking screen.
 */
export const STORE_REVIEW_STEPS = [
  { step: 'preparing', afterSec: 20 },
  { step: 'courier', afterSec: 45 },
  { step: 'pickup', afterSec: 120 },
  { step: 'door', afterSec: 240 },
  { step: 'delivered', afterSec: 300 },
] as const;

export type StoreReviewStep = (typeof STORE_REVIEW_STEPS)[number]['step'];

export interface StoreReviewJob {
  orderId: string;
  step: StoreReviewStep;
}

/** The order's states in which the walk stops for good (the reviewer cancelled, or it is done). */
const ENDED = new Set([
  'delivered',
  'closed',
  'completed',
  'merchant_rejected',
  'customer_cancelled',
  'platform_cancelled',
  'refunded',
  'disputed',
  'failed',
]);

/**
 * Walks a test-kitchen order (id `test_…`) from accepted to delivered as the test kitchen and the
 * test crew would, through the same order and trip calls a real kitchen and courier make, so the
 * reviewer's app shows the real tracking. Dispatch is never involved (a test trip is offered only to
 * the crew), and the registry keeps every event of it away from money, learning and messages.
 *
 * Each step is a delayed job on the `store-review.steps` queue with a stable job id, so a redelivered
 * acceptance, a retry or a second machine never runs a step twice; each step checks the order first
 * and does nothing once it has moved on.
 */
export class StoreReviewRunner {
  private readonly logger = new Logger(StoreReviewRunner.name);

  constructor(
    private readonly orders: Pick<OrdersService, 'aggregate' | 'markPreparing' | 'markReady'>,
    private readonly trips: Pick<
      TripsService,
      | 'activeForOrder'
      | 'createForOrders'
      | 'offer'
      | 'accept'
      | 'arrive'
      | 'completeStop'
      | 'reportPosition'
      | 'get'
    >,
    private readonly queue: Queue<StoreReviewJob>,
    private readonly clock: Clock,
  ) {}

  /** The test kitchen accepted `orderId`: schedule its walk. Real orders are ignored. */
  async accepted(orderId: string): Promise<void> {
    if (!isTestId(orderId)) return;
    for (const { step, afterSec } of STORE_REVIEW_STEPS) {
      await this.queue.add(
        'step',
        { orderId, step },
        {
          delayMs: afterSec * 1000,
          jobId: jobKey('store_review', orderId, step),
          attempts: 3,
          backoffMs: 5_000,
        },
      );
    }
  }

  async run(job: StoreReviewJob): Promise<void> {
    if (!isTestId(job.orderId)) return;
    const { order } = await this.orders.aggregate(job.orderId);
    if (ENDED.has(order.state)) return;
    try {
      await this.step(
        job.step,
        order.id,
        order.cityId,
        order.dropoff ?? null,
        order.paymentMethod === 'cash' ? order.totalIqd : null,
        order.state,
      );
    } catch (err) {
      // The reviewer cancelled, or the order moved on between the read and the step: nothing to do.
      if (isDriverError(err) && /state_conflict$/.test(err.code)) {
        this.logger.debug(`test order ${order.id}: ${job.step} skipped (${err.code})`);
        return;
      }
      throw err;
    }
  }

  private async step(
    step: StoreReviewStep,
    orderId: string,
    cityId: string,
    dropoff: DeliveryPoint | null,
    cashIqd: number | null,
    state: string,
  ): Promise<void> {
    switch (step) {
      case 'preparing':
        if (state === 'merchant_accepted')
          await this.orders.markPreparing(TEST_CREW_ID, { orderId });
        return;
      case 'courier':
        await this.takeTrip(orderId, cityId, dropoff);
        return;
      case 'pickup': {
        if (state === 'merchant_accepted' || state === 'preparing')
          await this.orders.markReady(TEST_CREW_ID, { orderId });
        const trip = await this.tripOf(orderId, cityId, dropoff);
        const stop = trip.stops.find((s) => s.type === 'pickup');
        if (!stop || stop.completedAt) return;
        await this.trips.reportPosition(TEST_CREW_ID, {
          tripId: trip.id,
          pin: TEST_KITCHEN.pin,
          at: this.clock.now(),
        });
        if (!stop.arrivedAt)
          await this.trips.arrive(trip.id, stop.id, TEST_CREW_ID, { pin: TEST_KITCHEN.pin });
        await this.trips.completeStop(trip.id, stop.id, TEST_CREW_ID);
        return;
      }
      case 'door': {
        const trip = await this.tripOf(orderId, cityId, dropoff);
        const stop = trip.stops.find((s) => s.type === 'dropoff');
        if (!stop || stop.arrivedAt) return;
        const door = doorOf(dropoff);
        await this.trips.reportPosition(TEST_CREW_ID, {
          tripId: trip.id,
          pin: door,
          at: this.clock.now(),
        });
        await this.trips.arrive(trip.id, stop.id, TEST_CREW_ID, { pin: door });
        return;
      }
      case 'delivered': {
        const trip = await this.tripOf(orderId, cityId, dropoff);
        const stop = trip.stops.find((s) => s.type === 'dropoff');
        if (!stop || stop.completedAt) return;
        if (!stop.arrivedAt)
          await this.trips.arrive(trip.id, stop.id, TEST_CREW_ID, { pin: doorOf(dropoff) });
        await this.trips.completeStop(
          trip.id,
          stop.id,
          TEST_CREW_ID,
          cashIqd !== null ? { handover: { cashCollectedIqd: cashIqd } } : {},
        );
        return;
      }
    }
  }

  /** The order's trip, made and taken by the crew if an earlier step has not done it yet. */
  private async tripOf(
    orderId: string,
    cityId: string,
    dropoff: DeliveryPoint | null,
  ): Promise<Trip> {
    return (await this.trips.activeForOrder(orderId)) ?? this.takeTrip(orderId, cityId, dropoff);
  }

  /** A test trip (id `test_…`) for the order, offered to and accepted by the crew only. */
  private async takeTrip(
    orderId: string,
    cityId: string,
    dropoff: DeliveryPoint | null,
  ): Promise<Trip> {
    let trip = await this.trips.activeForOrder(orderId);
    if (!trip) {
      trip = await this.trips.createForOrders({
        id: newTestId(),
        cityId,
        vertical: 'food',
        orders: [{ orderId }],
        stops: [
          { orderId, type: 'pickup', zoneKey: TEST_KITCHEN.zoneKey, target: TEST_KITCHEN.pin },
          {
            orderId,
            type: 'dropoff',
            zoneKey: dropoff?.zoneKey ?? TEST_KITCHEN.zoneKey,
            target: dropoff ? doorOf(dropoff) : TEST_KITCHEN.pin,
            placeId: dropoff?.placeId ?? null,
          },
        ],
      });
    }
    if (trip.state === 'created' || trip.state === 'declined')
      trip = await this.trips.offer(trip.id, { driverIds: [TEST_CREW_ID] });
    if (trip.state === 'offered') {
      // The crew carries every test order at once (several reviewers may test together), so it takes
      // this trip as an assignment, not as a one-job courier's own accept.
      trip = await this.trips.accept(
        trip.id,
        TEST_CREW_ID,
        { vehicleClass: 'bike' },
        { assignedByDispatch: true },
      );
      await this.trips.reportPosition(TEST_CREW_ID, {
        tripId: trip.id,
        pin: TEST_KITCHEN.pin,
        at: this.clock.now(),
      });
    }
    return trip;
  }
}

/** Where the crew stops at the customer's: the saved door, else the pin, else the kitchen (a zone-only drop-off). */
function doorOf(dropoff: DeliveryPoint | null): LatLng {
  return dropoff?.door ?? dropoff?.pin ?? TEST_KITCHEN.pin;
}
