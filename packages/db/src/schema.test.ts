import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../prisma/schema.prisma'), 'utf8');
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1]!, body: m[2]! }));
const enums = new Map(
  [...schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)].map((m) => [
    m[1]!,
    m[2]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@')),
  ]),
);
const model = (name: string) => {
  const m = models.find((x) => x.name === name);
  if (!m) throw new Error(`model ${name} missing`);
  return m.body;
};
const fields = (body: string) =>
  body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@') && !l.startsWith('///'))
    .map((l) => l.split(/\s+/)[0]!);

/** Domain spec §1 objects + plan Step 1 additions + amendments. */
const REQUIRED_MODELS = [
  // identity
  'Person', 'Role', 'Org', 'OrgMember', 'Device', 'Session', 'OtpChallenge', 'GuardianLink',
  // vault
  'PersonIdentity', 'ChildIdentity', 'VaultAccessLog',
  // fleet & geography
  'Vehicle', 'City', 'Zone', 'Place', 'PlacePhoto', 'MeetingPoint',
  // catalog
  'Catalog', 'CatalogItem', 'ModifierGroup', 'Modifier', 'TaxonomyNode',
  // commerce
  'Order', 'OrderLine', 'Participant', 'TripOrder', 'Parcel', 'Quote', 'QuoteComponent',
  // logistics
  'Trip', 'Stop', 'TrailPoint', 'Route', 'Departure', 'Seat', 'Subscription',
  // promos, incidents, money, events
  'Promotion', 'PromoRedemption', 'Incident', 'LedgerEvent', 'MerchantSettlement',
  'Event', 'Outbox', 'SubscriberDelivery', 'DispatchOffer',
];

describe('prisma schema — structure', () => {
  it('declares every model from the domain spec and the M2 plan', () => {
    const names = models.map((m) => m.name);
    for (const r of REQUIRED_MODELS) expect(names, `missing model ${r}`).toContain(r);
  });

  it('uses postgres with postgis and the identity_vault schema (not `vault`: Supabase reserves it)', () => {
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    expect(schema).toMatch(/extensions\s*=\s*\[postgis\]/);
    expect(schema).toMatch(/previewFeatures\s*=\s*\["postgresqlExtensions"\]/);
    expect(schema).toMatch(/schemas\s*=\s*\["public",\s*"identity_vault"\]/);
  });

  it('every model has created_at, updated_at and a schema', () => {
    for (const m of models) {
      expect(m.body, `${m.name} lacks created_at`).toMatch(/@map\("created_at"\)/);
      expect(m.body, `${m.name} lacks updated_at`).toMatch(/@updatedAt @map\("updated_at"\)/);
      expect(m.body, `${m.name} lacks @@schema`).toMatch(/@@schema\("(public|identity_vault)"\)/);
    }
  });

  it('ids default to cuid except the human-keyed City and the partitioned TrailPoint', () => {
    for (const m of models) {
      if (m.name === 'City') continue;
      if (m.name === 'TrailPoint') {
        // Partition key must be part of the primary key: composite (id, at), id still a cuid.
        expect(m.body).toMatch(/id\s+String\s+@default\(cuid\(\)\)/);
        expect(m.body).toMatch(/@@id\(\[id, at\]\)/);
        continue;
      }
      expect(m.body, `${m.name} id is not cuid`).toMatch(/@id @default\(cuid\(\)\)/);
    }
  });

  it('IQD amounts are integers, never floats or decimals', () => {
    const codeOnly = schema
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    const iqdFields = codeOnly
      .split('\n')
      .map((l) => /^\s+(\w+)\s+(\w+\??)\s+.*@map\("(\w+_iqd)"\)/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null);
    expect(iqdFields.length).toBeGreaterThan(20);
    for (const f of iqdFields) expect(f[2]!.replace('?', ''), `${f[3]} must be Int`).toBe('Int');
    expect(codeOnly).not.toMatch(/\bFloat\b.*iqd/i);
    expect(codeOnly).not.toMatch(/\bDecimal\b/);
  });

  it('geography columns are PostGIS geography(…, 4326)', () => {
    const geo = [...schema.matchAll(/Unsupported\("geography\((\w+), 4326\)"\)/g)].map((m) => m[1]);
    expect(geo).toContain('Polygon');
    expect(geo).toContain('Point');
  });
});

describe('prisma schema — identity vault (domain §13)', () => {
  it('people are pseudonymous: no phone, name, email or document columns', () => {
    const f = fields(model('Person'));
    for (const banned of ['phone', 'phoneE164', 'name', 'fullName', 'email', 'nationalId', 'selfieUrl', 'documentRefs']) {
      expect(f, `people.${banned} is PII`).not.toContain(banned);
    }
    // The only "phone" on people is the shared-family-phone declaration flag (edge-case §7), a boolean.
    const code = model('Person')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
      .replace(/sharedFamilyPhone\s+Boolean[^\n]*/g, '');
    expect(code).not.toMatch(/phone/i);
  });

  it('participants carry only a phone hash, the phone itself lives in the vault', () => {
    const p = model('Participant');
    expect(p).toMatch(/phoneHash/);
    expect(p).not.toMatch(/phoneE164/);
    expect(fields(p)).not.toContain('name');
  });

  it('vault tables are in the vault schema and hold the identifiers', () => {
    const pi = model('PersonIdentity');
    expect(pi).toMatch(/@@schema\("identity_vault"\)/);
    for (const col of ['personId', 'phoneE164', 'phoneHash', 'name', 'documentRefs', 'selfieRefs']) {
      expect(fields(pi), `vault.person_identities.${col}`).toContain(col);
    }
    expect(pi).toMatch(/phoneE164\s+String\s+@unique/);
    expect(pi).toMatch(/phoneHash\s+String\s+@unique/);
    expect(pi).toMatch(/personId\s+String\s+@unique/);
    expect(model('VaultAccessLog')).toMatch(/@@schema\("identity_vault"\)/);
    for (const col of ['personId', 'accessorId', 'purpose']) expect(fields(model('VaultAccessLog'))).toContain(col);
  });

  it('only vault tables live in the vault schema', () => {
    const inVault = models.filter((m) => /@@schema\("identity_vault"\)/.test(m.body)).map((m) => m.name).sort();
    expect(inVault).toEqual(['ChildIdentity', 'PersonIdentity', 'VaultAccessLog']);
  });

  it('M2 follow-up: stops hold no child name — only an opaque childRef into vault.child_identities', () => {
    const stop = fields(model('Stop'));
    for (const banned of ['childName', 'name', 'phone', 'phoneE164']) expect(stop, `stops.${banned} is PII`).not.toContain(banned);
    expect(model('Stop')).not.toMatch(/@map\("child_name"\)/);
    expect(stop).toContain('childRef');
    const child = model('ChildIdentity');
    expect(child).toMatch(/@@schema\("identity_vault"\)/);
    for (const col of ['id', 'guardianId', 'name']) expect(fields(child), `vault.child_identities.${col}`).toContain(col);
    expect(fields(model('VaultAccessLog'))).toContain('childRef');
  });

  it('M2 follow-up: no public-schema model carries a person or child name column', () => {
    for (const m of models.filter((x) => /@@schema\("public"\)/.test(x.body))) {
      const f = fields(m.body);
      for (const banned of ['childName', 'fullName', 'firstName', 'lastName', 'phoneE164']) expect(f, `${m.name}.${banned} belongs in the vault`).not.toContain(banned);
    }
  });

  it('identity hygiene fields (edge-case §7) exist', () => {
    expect(fields(model('Person'))).toContain('lastVerifiedAt');
    expect(fields(model('Person'))).toContain('sharedFamilyPhone');
    expect(fields(model('Device'))).toContain('verifiedAt');
  });
});

describe('prisma schema — exact enum sets', () => {
  const exact = (name: string, values: string[]) => {
    expect(enums.has(name), `enum ${name} missing`).toBe(true);
    expect([...enums.get(name)!].sort()).toEqual([...values].sort());
  };

  it('RoleKind', () =>
    exact('RoleKind', [
      'customer', 'courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver', 'merchant_staff',
      'merchant_owner', 'fleet_owner', 'guardian', 'field_ops', 'dispatcher', 'support', 'finance', 'admin',
    ]));
  it('OrgType', () => exact('OrgType', ['restaurant', 'grocer', 'fleet', 'household']));
  it('OrgMemberRole', () => exact('OrgMemberRole', ['payer', 'orderer', 'member']));
  it('VehicleClass', () => exact('VehicleClass', ['bike', 'tuktuk', 'car', 'suv', 'van', 'intercity']));
  it('ZoneTier', () => exact('ZoneTier', ['centre', 'near', 'mid', 'far', 'edge']));
  it('OrderType', () => exact('OrderType', ['food', 'grocery_catalog', 'errand', 'parcel', 'ride', 'seat', 'subscription']));
  it('OrderState', () =>
    exact('OrderState', [
      'placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'closed',
      'matched', 'completed',
      'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'disputed', 'failed',
    ]));
  it('ParticipantRole', () => exact('ParticipantRole', ['recipient', 'diner', 'rider', 'parcel_recipient']));
  it('TripState', () =>
    exact('TripState', [
      'created', 'offered', 'accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff', 'completed',
      'declined', 'timed_out', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed',
    ]));
  it('StopState', () => exact('StopState', ['pending', 'arrived', 'completed', 'skipped']));
  it('StopType', () => exact('StopType', ['pickup', 'dropoff', 'wait', 'shop']));
  it('RouteType / RouteState', () => {
    exact('RouteType', ['khat', 'intercity']);
    exact('RouteState', ['draft', 'active', 'paused', 'ended']);
  });
  it('DepartureState', () =>
    exact('DepartureState', ['scheduled', 'boarding', 'departed', 'arrived', 'closed', 'cancelled_by_driver', 'cancelled_low_fill']));
  it('SeatPosition includes parcel', () =>
    exact('SeatPosition', ['front', 'back_left', 'back_middle', 'back_right', 'row_2_left', 'row_2_middle', 'row_2_right', 'row_3_left', 'row_3_middle', 'row_3_right', 'parcel']));
  it('SeatState', () => exact('SeatState', ['held', 'booked', 'checked_in', 'completed', 'cancelled_by_rider', 'no_show', 'moved']));
  it('TravellingAs (edge-case §9)', () => exact('TravellingAs', ['rijal', 'nisa', 'aila']));
  it('SubscriptionState', () => exact('SubscriptionState', ['trial', 'active', 'past_due', 'cancelled']));
  it('LedgerKind', () => exact('LedgerKind', ['money', 'points']));
  it('LedgerEventType = domain §5 + edge-case §3 merchant cash account', () =>
    exact('LedgerEventType', [
      // money (domain §5)
      'cash_collected', 'commission_accrued', 'merchant_payable', 'driver_settlement', 'merchant_payout', 'refund',
      'credit_issued', 'cancellation_fee', 'promo_funded', 'seat_premium', 'subscription_charge', 'subscription_proration',
      'late_penalty_driver', 'late_penalty_rider_credit', 'departure_cancel_fee', 'errand_cost_actual', 'errand_fee', 'tip',
      'parcel_fee', 'adjustment',
      // amendments
      'merchant_paid_by_courier', 'merchant_settlement_requested', 'debt_settled', 'cash_rounding_credit', 'refund_cash_delivered',
      // M2 Step 6 posting-group lines
      'service_fee', 'delivery_fee', 'fare', 'driver_incentive', 'driver_payout', 'rounding_residue',
      // points (domain §5 + edge-case decisions §1)
      'points_earned', 'points_pending', 'points_claimed', 'points_redeemed', 'points_expired', 'organizer_bonus', 'referral_bonus',
    ]));
  it('SettlementMode (edge-case §3)', () => exact('SettlementMode', ['nightly_courier', 'on_demand', 'daily_zaincash', 'weekly_bulk']));
  it('OutboxStatus', () => exact('OutboxStatus', ['pending', 'published', 'failed']));
  it('DispatchOfferState', () => exact('DispatchOfferState', ['sent', 'seen', 'accepted', 'declined', 'timed_out', 'withdrawn']));
  it('IncidentState', () => exact('IncidentState', ['open', 'investigating', 'resolved', 'closed']));
  it('GuardianLinkState', () => exact('GuardianLinkState', ['pending', 'active', 'revoked']));
});

describe('prisma schema — amendments (edge-case decisions 2026-10-03)', () => {
  it('Seat: travellingAs, prepaid, walkUp, heldUntil, on a Departure', () => {
    const s = fields(model('Seat'));
    for (const c of ['departureId', 'position', 'state', 'travellingAs', 'prepaid', 'walkUp', 'heldUntil', 'priceIqd']) expect(s).toContain(c);
  });
  it('Vehicle: seatMap per vehicle', () => expect(fields(model('Vehicle'))).toContain('seatMap'));
  it('Route: familyOnly attribute', () => expect(fields(model('Route'))).toContain('familyOnly'));
  it('Stop: per-child hand-over fields and geofence/handover proof', () => {
    const s = fields(model('Stop'));
    for (const c of ['state', 'meetingPointId', 'arrivedAt', 'completedAt', 'geofenceEnteredAt', 'arrivedOutsideGeofence', 'handoverProof', 'childTapInAt', 'childTapOutAt', 'childRef']) {
      expect(s, `stops.${c}`).toContain(c);
    }
  });
  it('Event: device wall time, monotonic uptime, flagged, quarantined, unique idempotency key', () => {
    const e = model('Event');
    const f = fields(e);
    for (const c of ['occurredAt', 'recordedAt', 'deviceUptimeMs', 'flagged', 'quarantined', 'idempotencyKey']) expect(f).toContain(c);
    expect(e).toMatch(/idempotencyKey\s+String\?\s+@unique/);
    expect(e).toMatch(/quarantined\s+Boolean\s+@default\(false\)/);
  });
  it('LedgerEvent: kind, idempotency, no quarantine column (quarantine lives on Event)', () => {
    const l = model('LedgerEvent');
    expect(fields(l)).toContain('kind');
    expect(l).toMatch(/occurred_at/);
    expect(l).toMatch(/recorded_at/);
    expect(l).toMatch(/idempotency_key/);
    expect(fields(l)).not.toContain('quarantined');
  });
  it('Outbox: idempotencyKey, lastError, nextAttemptAt and a drain index', () => {
    const o = model('Outbox');
    for (const c of ['idempotencyKey', 'lastError', 'nextAttemptAt', 'attempts', 'status']) expect(fields(o)).toContain(c);
    expect(o).toMatch(/@@index\(\[status, nextAttemptAt/);
  });
  it('MerchantSettlement: mode + exposure cap default 300000', () => {
    const m = model('MerchantSettlement');
    expect(m).toMatch(/mode\s+SettlementMode/);
    expect(m).toMatch(/exposureCapIqd\s+Int\s+@default\(300000\)/);
  });
  it('OrgMember: role + spendingLimitIqd (households)', () => {
    const m = model('OrgMember');
    expect(m).toMatch(/role\s+OrgMemberRole/);
    expect(fields(m)).toContain('spendingLimitIqd');
  });
  it('GuardianLink targets a ward Person or a Participant', () => {
    const g = fields(model('GuardianLink'));
    expect(g).toContain('guardianId');
    expect(g).toContain('wardPersonId');
    expect(g).toContain('wardParticipantId');
  });
  it('Zone has tier and extId; Place has localNames, flaggedAt, arrivalSamples', () => {
    expect(fields(model('Zone'))).toContain('tier');
    expect(fields(model('Zone'))).toContain('extId');
    for (const c of ['localNames', 'flaggedAt', 'arrivalSamples']) expect(fields(model('Place'))).toContain(c);
  });
  it('TripOrder keeps attach/detach history; PromoRedemption unique per order', () => {
    for (const c of ['attachedAt', 'detachedAt', 'reason']) expect(fields(model('TripOrder'))).toContain(c);
    expect(model('PromoRedemption')).toMatch(/@@unique\(\[promotionId, orderId\]\)/);
  });
  it('Step 4: offer timing, promised ready, vehicle caps and stop target pins', () => {
    for (const c of ['merchantOfferedAt', 'promisedReadyAt', 'minVehicleClass']) expect(fields(model('Order'))).toContain(c);
    expect(fields(model('TripOrder'))).toContain('minVehicleClass');
    expect(model('Stop')).toMatch(/targetPin\s+Unsupported\("geography\(Point, 4326\)"\)\?/);
  });
});

describe('prisma schema — الرجعة (routes module, additive)', () => {
  it('Departure carries corridor, origin garage, direction, seat layout, family-only and run state', () => {
    for (const c of ['corridorId', 'garageId', 'direction', 'fromCityId', 'toCityId', 'seatLayout', 'vehicleSnapshot', 'familyOnly', 'seatPriceIqd', 'frontPremiumIqd', 'selfieAt', 'runState', 'lowFillCheckedAt']) {
      expect(fields(model('Departure')), `departures.${c}`).toContain(c);
    }
  });
  it('SeatBooking: one row per rider and sale (a re-sold position gets a new booking)', () => {
    for (const c of ['departureId', 'riderId', 'seatIds', 'travellingAs', 'state', 'origin', 'prepaid', 'trusted', 'pin', 'pickup', 'heldUntil', 'atGarageAt', 'checkedInAt', 'lateMinutes', 'movedToBookingId']) {
      expect(fields(model('SeatBooking')), `seat_bookings.${c}`).toContain(c);
    }
  });
  it('DemandPost and the request board (RideRequest + RideRequestOffer)', () => {
    for (const c of ['corridorId', 'direction', 'garageId', 'windowStart', 'windowEnd', 'seats', 'state', 'bookingId', 'escalatedAt']) expect(fields(model('DemandPost'))).toContain(c);
    for (const c of ['fromPlace', 'toPlace', 'when', 'privateCar', 'state', 'origin', 'priceCapIqd', 'pickedOfferId', 'depositIqd', 'driverArrivedAt']) expect(fields(model('RideRequest'))).toContain(c);
    for (const c of ['requestId', 'driverId', 'priceIqd', 'state']) expect(fields(model('RideRequestOffer'))).toContain(c);
  });
});

describe('prisma schema — hot-query indexes (review 2026-10-04)', () => {
  it("events by aggregate: the Merchant app's cash screen reads merchant/<id> on every open", () => {
    expect(model('Event')).toMatch(/@@index\(\[aggregate, aggregateId(, [a-zA-Z]+)?\]\)/);
  });
  it('fleet links carry the driver consent column', () => {
    expect(fields(model('FleetDriver'))).toContain('acceptedAt');
  });
  it("orders by merchant and placed time: the Merchant app's money and insights read one date range", () => {
    expect(model('Order')).toMatch(/@@index\(\[merchantOrgId, placedAt\]\)/);
  });
});
