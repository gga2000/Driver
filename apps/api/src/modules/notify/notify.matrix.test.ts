import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NotifyTemplateId, type OrderState, type OrderType } from '@driver/contracts';
import type { PublishedEvent } from '../events/index.js';
import { orderEventType, transitionsFor } from '../orders/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { ORDER_NOTIFY_MATRIX, type NotifyFamily, type TransitionKey } from './notify.matrix.js';
import { requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-04T09:30:00Z');
const FAMILY_TYPE: Record<NotifyFamily, OrderType> = { merchant: 'food', courier: 'errand', ride: 'ride' };

const lookups = (type: OrderType): NotifyLookups => ({
  order: async (id) => ({ id, type, customerId: 'cust', merchantOrgId: type === 'food' ? 'org_k' : null, totalIqd: 12_500, itemCount: 2 }),
  storeName: async () => 'مطعم خالد',
  orgPeople: async () => [],
  firstName: async () => 'حيدر',
  booking: async () => null,
  departurePasses: async () => null,
  child: async () => null,
  stopPlace: async () => null,
  tripZones: async () => null,
  deliveryEta: async () => new Date('2026-10-04T09:52:00Z'),
});

function transitionEvent(type: string, from: OrderState, to: OrderState): PublishedEvent {
  const cancelled = to.endsWith('_cancelled') ? { cancelledState: to, by: to === 'customer_cancelled' ? 'customer' : 'platform', reason: 'ops', free: true, feeIqd: 0 } : {};
  const payload = { from, to, ...cancelled, ...(to === 'merchant_rejected' ? { reason: 'closing early' } : {}) };
  return { id: `ev-${from}-${to}`, outboxId: 'ob', type, actorId: 'drv', occurredAt: AT, recordedAt: AT, payload, aggregate: 'order', aggregateId: 'ord_1', orderId: 'ord_1', tripId: 'trp_1', skewMs: 0, flagged: false, quarantined: false };
}

const families = Object.keys(FAMILY_TYPE) as NotifyFamily[];

describe('W2 notify matrix: every turn of every order says something, or says why not', () => {
  it.each(families)('%s orders: every transition of the machine has a line, and no line is stale', (family) => {
    const table = transitionsFor(FAMILY_TYPE[family]);
    const machine = Object.entries(table).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}` as TransitionKey));
    expect(Object.keys(ORDER_NOTIFY_MATRIX[family]).sort()).toEqual([...machine].sort());
  });

  it.each(families)('%s orders: each line holds when the real subscribers run its event', async (family) => {
    const type = FAMILY_TYPE[family];
    const deps = { engine: notifyHarness().engine, repo: notifyHarness().repo, lookups: lookups(type), receiptBaseUrl: 'https://driver.iq/r' };
    for (const [key, entry] of Object.entries(ORDER_NOTIFY_MATRIX[family])) {
      const [from, to] = key.split('>') as [OrderState, OrderState];
      const event = 'templates' in entry ? (entry.event ?? orderEventType(to)) : orderEventType(to);
      const sent = (await requestsFor(transitionEvent(event, from, to), deps)).filter((r) => r.to === 'cust');
      if ('silent' in entry) {
        expect(sent.map((r) => r.template), `${family} ${key} is silent`).toEqual([]);
      } else {
        expect(sent.length, `${family} ${key} sends`).toBeGreaterThan(0);
        for (const r of sent) expect(entry.templates, `${family} ${key}`).toContain(r.template);
      }
    }
  });
});

/** Templates sent from somewhere other than an `apps/api` source file, or kept for a later step. */
const PRODUCED_ELSEWHERE: Partial<Record<NotifyTemplateId, string>> = {
  phone_ride_matched: 'phone-booking sends it through PHONE_BOOKING_SMS.matched (contracts)',
  phone_driver_arrived: 'phone-booking sends it through PHONE_BOOKING_SMS.arrived (contracts)',
  marketing_offer: 'the offers sender is not built yet; the template fixes its rules (marketing switch, quiet hours) ahead of it',
};

describe('W2: every template has a sender', () => {
  it('each NotifyTemplateId is named by non-test API code (or says here why not)', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.includes('test-harness') && !name.endsWith('notify.matrix.ts')) sources.push(readFileSync(path, 'utf8'));
      }
    };
    walk(root);
    const all = sources.join('\n');
    const orphans = NotifyTemplateId.options.filter((id) => !PRODUCED_ELSEWHERE[id] && !all.includes(`'${id}'`));
    expect(orphans).toEqual([]);
  });
});
