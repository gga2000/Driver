import { Injectable } from '@nestjs/common';
import { EventsService } from '../events/index.js';

export type Tier = 'bronze' | 'silver' | 'gold';

export interface Scorecard {
  driverId: string;
  offers: number;
  accepted: number;
  declined: number;
  timedOut: number;
  cancelledAfterAccept: number;
  complaints: number;
  /** 0–100 reliability index, explained by components. */
  index: number;
  components: Array<{ key: string; label_ar: string; delta: number }>;
  tier: Tier;
  /** Days 1–30 are an observation period: visible to admins only. */
  observation: boolean;
}

export interface ScoringThresholds {
  silver: number;
  gold: number;
  observationDays: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = { silver: 70, gold: 85, observationDays: 30 };

@Injectable()
export class ScoringService {
  constructor(private readonly events: EventsService) {}

  scorecard(driverId: string, firstActiveAt: Date, now = new Date(), thresholds = DEFAULT_THRESHOLDS): Scorecard {
    const evs = this.events.forActor(driverId);
    const count = (type: string) => evs.filter((e) => e.type === type).length;
    const offers = count('offer.sent');
    const accepted = count('offer.accepted');
    const declined = count('offer.declined');
    const timedOut = count('offer.timeout');
    const cancelledAfterAccept = count('trip.cancelled_by_driver');
    const complaints = count('complaint.received');

    const components: Scorecard['components'] = [];
    let index = 100;
    const push = (key: string, label_ar: string, delta: number) => {
      if (delta === 0) return;
      components.push({ key, label_ar, delta });
      index += delta;
    };
    if (offers > 0) {
      push('acceptance', 'نسبة القبول', -Math.round((1 - accepted / offers) * 30));
      push('timeouts', 'طلبات بدون رد', -Math.round((timedOut / offers) * 20));
    }
    push('cancellations', 'إلغاء بعد القبول', -cancelledAfterAccept * 5);
    push('complaints', 'شكاوى', -complaints * 10);
    index = Math.max(0, Math.min(100, index));

    const daysActive = (now.getTime() - firstActiveAt.getTime()) / 86_400_000;
    const tier: Tier = index >= thresholds.gold ? 'gold' : index >= thresholds.silver ? 'silver' : 'bronze';
    return {
      driverId, offers, accepted, declined, timedOut, cancelledAfterAccept, complaints, index, components, tier,
      observation: daysActive < thresholds.observationDays,
    };
  }
}
