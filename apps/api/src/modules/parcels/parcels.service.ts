import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DriverError,
  PARCEL_RULES,
  type Actor,
  type DeliveryPoint,
  type LatLng,
  type Order,
  type OrderState,
  type CourierParcelInput,
  type CourierParcelPhotoInput,
  type CourierParcelPinInput,
  type CourierParcelRefusal,
  type CourierParcelView,
  type ParcelDoorPage,
  type ParcelDoorPageInput,
  type ParcelIdInput,
  type ParcelQuote,
  type ParcelQuoteInput,
  type ParcelState,
  type ParcelView,
  type ParcelsPort,
  type PlaceOrderInput,
  type SendParcelInput,
  type SetParcelDoorInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { t } from '@driver/i18n';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { startOfLocalDay } from '../../shared/local-time.js';
import { newStartCode, type OrdersRidersPort, type ResolvedRider } from '../orders/index.js';
import { distanceM } from '../places/index.js';
import { PARCELS_REPOSITORY, type ParcelRecord, type ParcelsRepository } from './parcels.repository.js';
import {
  PARCEL_DOOR_PURPOSE,
  PARCEL_READ_PURPOSE,
  PARCEL_TEXT_PURPOSE,
  PARCELS_LINK_BASE,
  PARCELS_NOTIFY,
  PARCELS_ORDERS,
  PARCELS_PEOPLE,
  PARCELS_PLACES,
  PARCELS_RIDERS,
  PARCELS_SMS_BUDGET,
  PARCELS_SYSTEM,
  type ParcelLinkBase,
  type ParcelsNotifyPort,
  type ParcelsOrdersPort,
  type ParcelsPeoplePort,
  type ParcelsPlacesPort,
  type ParcelsSmsBudgetPort,
} from './ports.js';

const HOUR = 3_600_000;
/** The receiver's link stops opening 48 h after sending, or once the parcel is closed (lane D). */
const LINK_LIFE_MS = 48 * HOUR;
/** The token in the link: 144 random bits, base64url (24 characters). Only its hash is stored. */
const TOKEN_BYTES = 18;
const MINE_LIMIT = 20;
/** A receipt code whose text did not go (notify was down) is retried by the sweep for this long after the door was set. */
const PIN_RETRY_MS = 6 * HOUR;

const DELIVERED: ReadonlySet<OrderState> = new Set(['delivered', 'completed', 'closed']);
const ENDED: ReadonlySet<OrderState> = new Set(['customer_cancelled', 'platform_cancelled', 'merchant_rejected', 'refunded', 'failed']);

export const hashDoorToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const participantKey = (parcelId: string): string => `parcel:${parcelId}`;

/**
 * طرود (Ali, 2026-10-12): send in one sheet, the receiver marks their own door from a text-message
 * link, the parcel's tag page. A parcel whose door the receiver marks waits here (`waiting_door`) with
 * no courier order at all, so nothing is dispatched, promised or timed until the door is set; then
 * the courier order is placed for the sender like any parcel order (fare, take and cash posting are
 * the orders module's own). A door never set in `doorWaitHours` cancels the parcel with no fee.
 */
@Injectable()
export class ParcelsService implements ParcelsPort {
  private readonly logger = new Logger('Parcels');

  constructor(
    @Inject(PARCELS_REPOSITORY) private readonly repo: ParcelsRepository,
    @Inject(PARCELS_ORDERS) private readonly orders: ParcelsOrdersPort,
    @Inject(PARCELS_PEOPLE) private readonly people: ParcelsPeoplePort,
    @Inject(PARCELS_PLACES) private readonly places: ParcelsPlacesPort,
    @Inject(PARCELS_RIDERS) private readonly riders: OrdersRidersPort,
    @Inject(PARCELS_LINK_BASE) private readonly linkBase: ParcelLinkBase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PARCELS_NOTIFY) private readonly notify: ParcelsNotifyPort,
    @Inject(PARCELS_SMS_BUDGET) private readonly smsBudget: ParcelsSmsBudgetPort,
  ) {}

  async quote(actor: Actor, input: z.output<typeof ParcelQuoteInput>): Promise<ParcelQuote> {
    const zone = this.zoneOrThrow(input.cityId, input.dropZoneKey);
    const fareIqd = await this.orders.fare(actor.personId, { cityId: input.cityId, pickup: input.pickup, dropoff: { zoneKey: input.dropZoneKey } });
    return { fareIqd, zoneKey: input.dropZoneKey, zoneName: zone.name };
  }

  async send(actor: Actor, input: z.output<typeof SendParcelInput>): Promise<ParcelView> {
    const senderId = actor.personId;
    const prior = await this.repo.byRequest(senderId, input.clientRequestId);
    if (prior) return this.view(prior, senderId, null);
    if (input.recipient.from === 'recent') throw new DriverError('invalid_input');
    if (input.photoUploadId && !(await this.places.photoOwned(input.photoUploadId, senderId))) throw new DriverError('parcel_photo_unknown');

    const door = input.door;
    let zoneKey: string;
    let dropoff: DeliveryPoint | null = null;
    if (door.by === 'receiver') {
      zoneKey = door.zoneKey;
      this.zoneOrThrow(input.cityId, zoneKey);
    } else {
      const pinned = door.dropoff.pin ? this.places.zoneOf(input.cityId, door.dropoff.pin) : door.dropoff.zoneKey;
      if (!pinned) throw new DriverError('outside_zone');
      zoneKey = pinned;
      dropoff = door.dropoff.pin ? { zoneKey, pin: door.dropoff.pin } : { zoneKey };
    }
    const fareIqd = await this.orders.fare(senderId, { cityId: input.cityId, pickup: input.pickup, dropoff: dropoff ?? { zoneKey } });
    if (fareIqd !== input.fareIqd) throw new DriverError('price_changed');

    const rider = await this.receiver(senderId, input.recipient);
    const token = door.by === 'receiver' ? randomBytes(TOKEN_BYTES).toString('base64url') : null;
    const now = this.clock.now();
    // Trusted contacts and household members are picked from the sender's own lists; a typed number is
    // known once it took a parcel from him before. Only strangers count toward his daily text cap.
    const receiverKnown = input.recipient.from !== 'typed' || (await this.repo.deliveredTo(senderId, rider.personId));
    const rec = await this.repo.create({
      cityId: input.cityId,
      senderId,
      clientRequestId: input.clientRequestId,
      what: input.what,
      size: input.size,
      declaredValueIqd: input.declaredValueIqd,
      photoUploadId: input.photoUploadId ?? null,
      recipientPersonId: rider.personId,
      pickup: input.pickup,
      doorBy: door.by,
      zoneKey,
      dropoff,
      payer: input.payer,
      fareIqd,
      courierNote: input.courierNote ?? null,
      pin: newStartCode(),
      doorTokenHash: token ? hashDoorToken(token) : null,
      doorDueAt: token ? new Date(linkGoesAt(now).getTime() + PARCEL_RULES.doorWaitHours * HOUR) : null,
      doorSetAt: token ? null : now,
      orderId: null,
      pinFails: 0,
      pickupPhotoUploadId: null,
      pinVerifiedAt: null,
      refusedAt: null,
      // The door-link text: now, or 08:00 for a link made 23:00–08:00. No link address set: no text.
      doorTextDueAt: token && this.linkBase ? linkGoesAt(now) : null,
      doorTextedAt: null,
      pinTextedAt: null,
      textTokenHash: null,
      textCapped: false,
      receiverKnown,
      stage: 'waiting_door',
      cancelledAt: null,
      createdAt: now,
    });
    await this.riders.remember(participantKey(rec.id), rider, senderId);
    const placed = dropoff ? await this.placeOrder(rec, dropoff, now) : rec;
    const texted = dropoff ? await this.quietly(() => this.textPin(placed)) : await this.quietly(() => this.textDoor(placed));
    return this.view(texted ?? placed, senderId, token);
  }

  async get(actor: Actor, input: ParcelIdInput): Promise<ParcelView> {
    return this.view(await this.mineOrThrow(actor, input.parcelId), actor.personId, null);
  }

  async mine(actor: Actor): Promise<ParcelView[]> {
    const recs = await this.repo.bySender(actor.personId, MINE_LIMIT);
    return Promise.all(recs.map((r) => this.view(r, actor.personId, null)));
  }

  async cancel(actor: Actor, input: ParcelIdInput): Promise<ParcelView> {
    const rec = await this.mineOrThrow(actor, input.parcelId);
    const now = this.clock.now();
    if (rec.stage === 'cancelled') return this.view(rec, actor.personId, null);
    if (rec.stage === 'waiting_door') {
      const done = await this.repo.update(rec.id, 'waiting_door', { stage: 'cancelled', cancelledAt: now });
      if (done) return this.view(done, actor.personId, null);
      return this.cancel(actor, input);
    }
    const order = rec.orderId ? await this.orders.order(rec.orderId) : null;
    if (order && order.state !== 'placed' && order.state !== 'matched') throw new DriverError('parcel_not_cancellable');
    if (order) await this.orders.cancel(actor.personId, order.id);
    return this.view(rec, actor.personId, null);
  }

  async doorPage(input: ParcelDoorPageInput): Promise<ParcelDoorPage> {
    const rec = await this.byLink(input.token);
    return this.page(rec);
  }

  async setDoor(input: SetParcelDoorInput): Promise<ParcelDoorPage> {
    const rec = await this.byLink(input.token);
    const now = this.clock.now();
    if (rec.stage !== 'waiting_door' || this.lapsedAt(rec, now)) throw new DriverError('parcel_door_closed');
    const zoneKey = this.places.zoneOf(rec.cityId, input.pin);
    if (!zoneKey) throw new DriverError('outside_zone');
    const dropoff: DeliveryPoint = { zoneKey, pin: input.pin };
    // The fare was locked to the area the sender chose: a door in another area is fine only at the same fare.
    if (zoneKey !== rec.zoneKey && (await this.orders.fare(rec.senderId, { cityId: rec.cityId, pickup: rec.pickup, dropoff })) !== rec.fareIqd) {
      throw new DriverError('parcel_door_outside_zone');
    }
    const placed = await this.placeOrder({ ...rec, courierNote: joinNote(rec.courierNote, input.doorNote) }, dropoff, now);
    // The receipt code goes as soon as the door is set (any hour: the receiver just asked for the parcel).
    return this.page((await this.quietly(() => this.textPin(placed))) ?? placed);
  }

  /**
   * Every minute (the parcels job, reading the table so nothing is lost on a restart): parcels whose
   * door was never set in time are cancelled with no fee (no order exists) and the sender hears it;
   * door-link texts held for the morning go out at 08:00; a receipt-code text that failed is retried.
   * Returns how many parcels were cancelled.
   */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    let n = 0;
    for (const rec of await this.repo.lapsed(now)) {
      const done = await this.repo.update(rec.id, 'waiting_door', { stage: 'cancelled', cancelledAt: now });
      if (!done) continue;
      n++;
      await this.quietly(() => this.notify.dispatch({ eventId: `parcel:${rec.id}:lapsed`, template: 'parcel_door_lapsed', to: rec.senderId, params: { parcelId: rec.id }, data: { parcelId: rec.id } }));
    }
    for (const rec of await this.repo.doorTextsDue(now)) await this.quietly(() => this.textDoor(rec));
    for (const rec of await this.repo.pinTextsDue(new Date(now.getTime() - PIN_RETRY_MS))) await this.quietly(() => this.textPin(rec));
    return n;
  }

  // ── the receiver's texts ───────────────────────────────────────────────────────────────────────

  /**
   * The door-link text, once per parcel (dedupe `parcel:<id>:door`), when it is due. The link in it has
   * its own token, made now (only hashes are stored, so a text held for the morning cannot reuse the
   * sender's); the sender's shared link keeps working. Over a cap: no text, the parcel is marked capped.
   */
  private async textDoor(rec: ParcelRecord): Promise<ParcelRecord | null> {
    const now = this.clock.now();
    if (rec.stage !== 'waiting_door' || rec.doorTextedAt || rec.textCapped || !rec.doorTextDueAt || rec.doorTextDueAt > now || this.lapsedAt(rec, now) || !this.linkBase) return null;
    if (await this.overTextCap(rec, now)) return this.repo.update(rec.id, 'waiting_door', { textCapped: true }, 'doorTextedAt');
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const claimed = await this.repo.update(rec.id, 'waiting_door', { doorTextedAt: now, textTokenHash: hashDoorToken(token) }, 'doorTextedAt');
    if (!claimed) return null;
    try {
      const sender = await this.senderForText(rec);
      await this.notify.dispatch({ eventId: `parcel:${rec.id}:door`, template: 'parcel_door_link', to: rec.recipientPersonId, params: { sender, link: `${this.linkBase}/p/${token}` }, data: { parcelId: rec.id } });
      return claimed;
    } catch (err) {
      // Not handed to notify: let the next sweep try again with a fresh token.
      await this.repo.update(rec.id, 'waiting_door', { doorTextedAt: null, textTokenHash: null });
      throw err;
    }
  }

  /**
   * The receipt-code text, once per parcel (dedupe `parcel:<id>:pin`), as soon as the door is set. A
   * parcel whose door-link text already went is not counted again; a parcel over a cap gets no texts.
   */
  private async textPin(rec: ParcelRecord): Promise<ParcelRecord | null> {
    const now = this.clock.now();
    if (rec.stage !== 'placed' || rec.pinTextedAt || rec.textCapped || rec.refusedAt || rec.pinVerifiedAt) return null;
    if (!rec.doorTextedAt && (await this.overTextCap(rec, now))) return this.repo.update(rec.id, 'placed', { textCapped: true }, 'pinTextedAt');
    const claimed = await this.repo.update(rec.id, 'placed', { pinTextedAt: now }, 'pinTextedAt');
    if (!claimed) return null;
    try {
      const sender = await this.senderForText(rec);
      await this.notify.dispatch({ eventId: `parcel:${rec.id}:pin`, template: 'parcel_pin', to: rec.recipientPersonId, params: { sender, pin: rec.pin }, data: { parcelId: rec.id } });
      return claimed;
    } catch (err) {
      await this.repo.update(rec.id, 'placed', { pinTextedAt: null });
      throw err;
    }
  }

  /**
   * The caps, counted per parcel on its first text, by Baghdad day: `textsPerSenderDay` from one sender
   * to strangers, `textsPerReceiverDay` to one receiver from everyone, and the day's shared SMS budget.
   */
  private async overTextCap(rec: ParcelRecord, now: Date): Promise<boolean> {
    const day = startOfLocalDay(now);
    if (!rec.receiverKnown && (await this.repo.textedSince({ senderId: rec.senderId, strangersOnly: true }, day)) >= PARCEL_RULES.textsPerSenderDay) return true;
    if ((await this.repo.textedSince({ recipientPersonId: rec.recipientPersonId }, day)) >= PARCEL_RULES.textsPerReceiverDay) return true;
    return this.smsBudget.spent();
  }

  /** The sender's first name from the vault, at most 20 characters — never free text. */
  private async senderForText(rec: ParcelRecord): Promise<string> {
    return shortName(await this.people.firstName(rec.senderId, PARCELS_SYSTEM, PARCEL_TEXT_PURPOSE)) || t('parcel.t_sender_fallback', {}, 'ar-IQ');
  }

  /** A text that fails never fails the parcel: logged (ids only), and the sweep tries again. */
  private async quietly<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn(`parcel text not handed to notify: ${(err as Error).message}`);
      return null;
    }
  }

  /** A new link for the receiver (the sender shares it himself, or the old one was lost); the old one stops opening. */
  async newDoorLink(actor: Actor, input: ParcelIdInput): Promise<ParcelView> {
    const rec = await this.mineOrThrow(actor, input.parcelId);
    if (rec.stage !== 'waiting_door' || this.lapsedAt(rec, this.clock.now())) throw new DriverError('parcel_door_closed');
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const next = await this.repo.update(rec.id, 'waiting_door', { doorTokenHash: hashDoorToken(token) });
    if (!next) throw new DriverError('parcel_door_closed');
    return this.view(next, actor.personId, token);
  }

  // ── the courier's side ──────────────────────────────────────────────────────────────────────

  async courierJob(actor: Actor, input: CourierParcelInput): Promise<CourierParcelView> {
    return this.courierView(await this.carried(actor, input.orderId), actor.personId);
  }

  /** The receipt code the receiver reads out. Right: the hand-over may complete. Wrong `pinTries` times: locked. */
  async checkPin(actor: Actor, input: CourierParcelPinInput): Promise<CourierParcelView> {
    const rec = await this.carried(actor, input.orderId);
    if (rec.pinVerifiedAt) return this.courierView(rec, actor.personId);
    if (rec.pinFails >= PARCEL_RULES.pinTries) throw new DriverError('parcel_pin_locked');
    const ok = timingSafeEqual(Buffer.from(input.pin.padEnd(8)), Buffer.from(rec.pin.padEnd(8)));
    const next = await this.repo.update(rec.id, 'placed', ok ? { pinVerifiedAt: this.clock.now() } : { pinFails: rec.pinFails + 1 });
    return this.courierView(next ?? rec, actor.personId);
  }

  /** The courier's photo at the sender's door: their own stored upload, kept on the parcel (the tag shows it). */
  async pickupPhoto(actor: Actor, input: CourierParcelPhotoInput): Promise<CourierParcelView> {
    const rec = await this.carried(actor, input.orderId);
    if (!(await this.places.photoOwned(input.uploadId, actor.personId))) throw new DriverError('parcel_photo_unknown');
    const next = await this.repo.update(rec.id, 'placed', { pickupPhotoUploadId: input.uploadId });
    return this.courierView(next ?? rec, actor.personId);
  }

  async refusalPreview(actor: Actor, input: CourierParcelInput): Promise<CourierParcelRefusal> {
    const rec = await this.carried(actor, input.orderId);
    const back = await this.returnFare(rec);
    return { returnFareIqd: back, totalForSenderIqd: rec.fareIqd + back, payer: 'sender' };
  }

  /**
   * «رفضت تستلم»: only at the door (the courier's last fix within `refuseWithinM` of the drop pin).
   * Recorded here; the trip back and its money (the sender pays both trips) are the orders module's.
   */
  async refuse(actor: Actor, input: CourierParcelInput): Promise<CourierParcelView> {
    const rec = await this.carried(actor, input.orderId);
    if (rec.refusedAt) return this.courierView(rec, actor.personId);
    const carried = await this.orders.courierOf(input.orderId);
    const fix = carried ? await this.orders.lastFix(carried.tripId) : null;
    const door = rec.dropoff?.pin ?? null;
    if (!fix || !door || distanceM(fix, door) > PARCEL_RULES.refuseWithinM) throw new DriverError('parcel_refuse_too_far');
    const next = await this.repo.update(rec.id, 'placed', { refusedAt: this.clock.now() });
    if (this.orders.returnTrip) await this.orders.returnTrip(actor.personId, input.orderId);
    return this.courierView(next ?? rec, actor.personId);
  }

  /** Orders asks before it builds the trip back: the courier marked this parcel refused at the door. */
  async refusalRecorded(orderId: string): Promise<boolean> {
    return Boolean((await this.repo.byOrder(orderId))?.refusedAt);
  }

  /**
   * Trips asks before a parcel drop-off completes: the receiver's code was verified, or this is the
   * trip back after a refusal (no code then). A parcel order this module doesn't hold: allowed.
   */
  async dropoffProblem(orderId: string): Promise<'parcel_pin_not_verified' | null> {
    const rec = await this.repo.byOrder(orderId);
    if (!rec || rec.pinVerifiedAt || rec.refusedAt) return null;
    return 'parcel_pin_not_verified';
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  private async receiver(senderId: string, input: Exclude<z.output<typeof SendParcelInput>['recipient'], { from: 'recent' }>): Promise<ResolvedRider> {
    try {
      return await this.riders.resolve(senderId, input);
    } catch (err) {
      if (err instanceof DriverError && err.code === 'ride_rider_is_you') throw new DriverError('parcel_receiver_is_you');
      throw err;
    }
  }

  /** Places the courier order for the sender and moves the parcel on; a parcel cancelled meanwhile cancels the order again. */
  private async placeOrder(rec: ParcelRecord, dropoff: DeliveryPoint, now: Date): Promise<ParcelRecord> {
    const order = await this.orders.place(rec.senderId, orderInput(rec, dropoff));
    const next = await this.repo.update(rec.id, 'waiting_door', { stage: 'placed', orderId: order.id, dropoff, doorSetAt: rec.doorSetAt ?? now });
    if (next) return next;
    await this.orders.cancel(rec.senderId, order.id).catch(() => undefined);
    throw new DriverError('parcel_door_closed');
  }

  /** The parcel on an order this courier is carrying now; anyone else: not found. */
  private async carried(actor: Actor, orderId: string): Promise<ParcelRecord> {
    const [rec, carrier] = await Promise.all([this.repo.byOrder(orderId), this.orders.courierOf(orderId)]);
    if (!rec || !carrier || carrier.courierId !== actor.personId) throw new DriverError('parcel_not_found');
    return rec;
  }

  private returnFare(rec: ParcelRecord): Promise<number> {
    return this.orders.fare(rec.senderId, { cityId: rec.cityId, pickup: rec.dropoff ?? { zoneKey: rec.zoneKey }, dropoff: rec.pickup });
  }

  private async courierView(rec: ParcelRecord, courierId: string): Promise<CourierParcelView> {
    const names = await this.riders.names([participantKey(rec.id)], courierId, 'parcel_courier');
    return {
      parcelId: rec.id,
      what: rec.what,
      size: rec.size,
      declaredValueIqd: rec.declaredValueIqd,
      photoUrl: rec.photoUploadId ? this.places.photoUrl(rec.photoUploadId) : null,
      receiverName: shortName(names[participantKey(rec.id)] ?? null),
      payer: rec.payer,
      collectAtDoorIqd: rec.payer === 'receiver' ? rec.fareIqd : 0,
      pinVerified: rec.pinVerifiedAt !== null,
      pickupPhoto: rec.pickupPhotoUploadId !== null,
      pinTriesLeft: Math.max(0, PARCEL_RULES.pinTries - rec.pinFails),
      refused: rec.refusedAt !== null,
    };
  }

  private async mineOrThrow(actor: Actor, parcelId: string): Promise<ParcelRecord> {
    const rec = await this.repo.get(parcelId);
    if (!rec || rec.senderId !== actor.personId) throw new DriverError('parcel_not_found');
    return rec;
  }

  /** The parcel a link opens, while the link lives (48 h, and not once the parcel is closed). Any other token: closed. */
  private async byLink(token: string): Promise<ParcelRecord> {
    const rec = await this.repo.byDoorToken(hashDoorToken(token));
    if (!rec || this.clock.now().getTime() - rec.createdAt.getTime() > LINK_LIFE_MS) throw new DriverError('parcel_door_closed');
    const state = await this.state(rec, rec.orderId ? await this.orders.order(rec.orderId) : null);
    if (state === 'cancelled' || state === 'delivered' || state === 'returned') throw new DriverError('parcel_door_closed');
    return rec;
  }

  private lapsedAt(rec: ParcelRecord, now: Date): boolean {
    return rec.doorDueAt !== null && rec.doorDueAt.getTime() <= now.getTime();
  }

  private zoneOrThrow(cityId: string, zoneKey: string): { name: string; centre: LatLng } {
    const zone = this.places.zone(cityId, zoneKey);
    if (!zone) throw new DriverError('outside_zone');
    return zone;
  }

  private async state(rec: ParcelRecord, order: Order | null): Promise<ParcelState> {
    if (rec.stage === 'cancelled') return 'cancelled';
    if (rec.refusedAt) return 'returning';
    if (rec.stage === 'waiting_door') return this.lapsedAt(rec, this.clock.now()) ? 'cancelled' : 'waiting_door';
    if (!order) return 'finding_courier';
    if (DELIVERED.has(order.state)) return 'delivered';
    if (ENDED.has(order.state)) return 'cancelled';
    if (order.state === 'picked_up') return 'on_the_way';
    return 'finding_courier';
  }

  private async page(rec: ParcelRecord): Promise<ParcelDoorPage> {
    const zone = this.zoneOrThrow(rec.cityId, rec.zoneKey);
    const order = rec.orderId ? await this.orders.order(rec.orderId) : null;
    const [state, senderName] = await Promise.all([this.state(rec, order), this.people.firstName(rec.senderId, rec.recipientPersonId, PARCEL_DOOR_PURPOSE)]);
    return {
      senderName: shortName(senderName),
      what: rec.what,
      photoUrl: rec.photoUploadId ? this.places.photoUrl(rec.photoUploadId) : null,
      zone: { key: rec.zoneKey, name: zone.name, centre: zone.centre },
      payAtDoorIqd: rec.payer === 'receiver' ? rec.fareIqd : null,
      open: state === 'waiting_door',
      doorSet: rec.stage === 'placed',
      state,
    };
  }

  private async view(rec: ParcelRecord, accessorId: string, token: string | null): Promise<ParcelView> {
    const order = rec.orderId ? await this.orders.order(rec.orderId) : null;
    const [state, names, phoneMasked, senderName, proofs] = await Promise.all([
      this.state(rec, order),
      this.riders.names([participantKey(rec.id)], accessorId, PARCEL_READ_PURPOSE),
      this.people.phoneMasked(rec.recipientPersonId, accessorId, PARCEL_READ_PURPOSE),
      this.people.firstName(rec.senderId, accessorId, PARCEL_READ_PURPOSE),
      rec.orderId ? this.orders.proofs(rec.orderId) : Promise.resolve({ pickup: null, dropoff: null }),
    ]);
    const zoneName = (key: string): string => this.places.zone(rec.cityId, key)?.name ?? key;
    return {
      id: rec.id,
      state,
      what: rec.what,
      size: rec.size,
      declaredValueIqd: rec.declaredValueIqd,
      coveredIqd: Math.min(rec.declaredValueIqd, PARCEL_RULES.declaredValueMaxIqd),
      photoUrl: rec.photoUploadId ? this.places.photoUrl(rec.photoUploadId) : null,
      recipientName: names[participantKey(rec.id)] ?? '',
      recipientPhoneMasked: phoneMasked ?? '',
      senderName,
      fromLabel: zoneName(rec.pickup.zoneKey),
      toLabel: zoneName(rec.dropoff?.zoneKey ?? rec.zoneKey),
      payer: rec.payer,
      fareIqd: order?.totalIqd ?? rec.fareIqd,
      pin: accessorId === rec.senderId ? rec.pin : null,
      doorLink: token && this.linkBase ? `${this.linkBase}/p/${token}` : null,
      doorBy: rec.doorBy,
      doorDueAt: state === 'waiting_door' ? rec.doorDueAt : null,
      doorTextAt: state === 'waiting_door' && !rec.doorTextedAt && !rec.textCapped ? rec.doorTextDueAt : null,
      doorLinkTexted: rec.doorTextedAt !== null,
      pinTexted: rec.pinTextedAt !== null,
      textCapped: rec.textCapped,
      steps: [
        { key: 'sent', at: rec.createdAt },
        { key: 'door_set', at: rec.doorSetAt },
        { key: 'picked_up', at: order?.pickedUpAt ?? null },
        { key: 'delivered', at: order?.deliveredAt ?? null },
      ],
      orderId: rec.orderId,
      pickupPhotoUrl: (rec.pickupPhotoUploadId ?? proofs.pickup) ? this.places.photoUrl((rec.pickupPhotoUploadId ?? proofs.pickup)!) : null,
      dropoffPhotoUrl: proofs.dropoff ? this.places.photoUrl(proofs.dropoff) : null,
      placedAt: rec.createdAt,
    };
  }
}

/** The courier order for a parcel: from the sender's door to the receiver's, cash, keyed to the parcel so a retry never places two. */
export function orderInput(rec: Pick<ParcelRecord, 'id' | 'cityId' | 'pickup' | 'courierNote'>, dropoff: DeliveryPoint): PlaceOrderInput {
  return {
    cityId: rec.cityId,
    type: 'parcel',
    pickup: rec.pickup,
    dropoff,
    options: { doorPickup: true },
    paymentMethod: 'cash',
    clientRequestId: `parcel-${rec.id}`.slice(0, 64),
    ...(rec.courierNote ? { courierNote: rec.courierNote } : {}),
  } as PlaceOrderInput;
}

/** Baghdad is UTC+3 all year. A link made 23:00–08:00 goes out at 08:00 (quiet hours), and the wait starts then. */
const BAGHDAD_OFFSET_MS = 3 * HOUR;
export function linkGoesAt(now: Date): Date {
  const local = new Date(now.getTime() + BAGHDAD_OFFSET_MS);
  const h = local.getUTCHours();
  if (h >= 8 && h < 23) return now;
  const eight = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 8) - BAGHDAD_OFFSET_MS);
  return h >= 23 ? new Date(eight.getTime() + 24 * HOUR) : eight;
}

/** The sender's first name as the receiver sees it (never free text, at most 20 characters). */
function shortName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0]?.slice(0, 20) ?? '';
}

function joinNote(a: string | null, b: string | undefined): string | null {
  const parts = [a, b].map((s) => s?.trim()).filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(' · ').slice(0, 300) : null;
}
