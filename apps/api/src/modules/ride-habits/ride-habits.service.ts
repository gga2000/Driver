import { Inject, Injectable } from '@nestjs/common';
import {
  askAt,
  atLocal,
  AZIZIYAH_ZONES,
  baghdadDate,
  baghdadMinuteOfDay,
  baghdadWeekday,
  dinnerDeliverAt,
  DriverError,
  dueReminders,
  encodeRideEnd,
  haversineM,
  isOccurrenceDate,
  isWorkDay,
  nextOccurrence,
  occurrenceState,
  RIDE_HABIT_RULES,
  sameRide,
  sameRideHabits,
  sameRidePushWindow,
  SaveRegularTripInput,
  shiftDate,
  westernDigits,
  workDaysBefore,
  type Actor,
  type BookingView,
  type CalendarDate,
  type ConfirmOccurrenceInput,
  type DepartureCard,
  type DinnerChance,
  type DinnerSource,
  type DinnerTime,
  type DinnerTimeInput,
  type FavouriteDriverView,
  type FavouriteInput,
  type FavouriteKind,
  type IntercitySeatId,
  type LatLng,
  type OccurrenceDecision,
  type OccurrenceInput,
  type OccurrenceSummary,
  type OccurrenceView,
  type RecentDriverView,
  type RegularTripIdInput,
  type RegularTripView,
  type RideFootprint,
  type RideHabitsPort,
  type SameRideHabit,
  type SavedPlaceView,
  type UnfavouriteInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { HABITS_EVENTS, HABITS_PEOPLE, HABITS_RAJAA, HABITS_RIDES, type FinishedRide, type HabitsEventsPort, type HabitsPeoplePort, type HabitsRajaaPort, type HabitsRidesPort } from './ports.js';
import { RIDE_HABITS_REPOSITORY, type FavouriteRecord, type OccurrenceRecord, type RegularTripRecord, type RideHabitsRepository } from './ride-habits.repository.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const CITY_ID = 'aziziyah';
/** Trips together are counted over the last year. */
const TOGETHER_DAYS = 365;
/** A الرجعة trip still on: booked, or checked in at the garage. */
const LIVE_SEAT = new Set<BookingView['state']>(['booked', 'checked_in']);

export const REGULAR_TRIP_DUE_EVENT = 'regular_trip.due';
/** Step 4 (o4): «نفس مشوار البارحة؟» is due for a rider today (once a day: keyed per person and date). */
export const SAME_RIDE_DUE_EVENT = 'same_ride.due';

/**
 * Joy J7d: favourite drivers (l9), regular trips (r5) and «عشاك يوصل وياك» (r6). Owns
 * `favourite_drivers`, `regular_trips` and their decisions; books only through orders (rides) and
 * routes (seats, «أريد أرجع»), so every price and check is theirs. Nothing is ever booked without the
 * rider's «أكدها».
 */
@Injectable()
export class RideHabitsService implements RideHabitsPort {
  constructor(
    @Inject(RIDE_HABITS_REPOSITORY) private readonly repo: RideHabitsRepository,
    @Inject(HABITS_RIDES) private readonly rides: HabitsRidesPort,
    @Inject(HABITS_RAJAA) private readonly rajaa: HabitsRajaaPort,
    @Inject(HABITS_PEOPLE) private readonly people: HabitsPeoplePort,
    @Inject(HABITS_EVENTS) private readonly events: HabitsEventsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── favourites (l9) ─────────────────────────

  async favourites(actor: Actor): Promise<FavouriteDriverView[]> {
    return this.favouriteViews(actor, await this.repo.favouritesOf(actor.personId));
  }

  /**
   * Hearts (or un-hearts) the driver of his own finished ride or الرجعة trip. Adding needs 4–5 stars
   * from him on that trip (`favourite_needs_good_rating`) and room in his 20.
   */
  async favourite(actor: Actor, input: z.infer<typeof FavouriteInput>): Promise<FavouriteDriverView[]> {
    const trip = input.orderId ? await this.rideTrip(actor, input.orderId) : await this.seatTrip(actor, input.bookingId!);
    if (!input.on) {
      await this.repo.removeFavourite(actor.personId, trip.driverId);
      return this.favourites(actor);
    }
    if ((trip.stars ?? 0) < RIDE_HABIT_RULES.favourite.goodStars) throw new DriverError('favourite_needs_good_rating');
    const mine = await this.repo.favouritesOf(actor.personId);
    if (!mine.some((f) => f.driverId === trip.driverId) && mine.length >= RIDE_HABIT_RULES.favourite.maxPerPerson) throw new DriverError('favourite_limit');
    await this.repo.addFavourite(actor.personId, trip.driverId, trip.kind, this.clock.now());
    return this.favourites(actor);
  }

  async unfavourite(actor: Actor, input: UnfavouriteInput): Promise<FavouriteDriverView[]> {
    const fav = await this.repo.favourite(actor.personId, input.favouriteId);
    if (!fav) throw new DriverError('favourite_not_found');
    await this.repo.removeFavourite(actor.personId, fav.driverId);
    return this.favourites(actor);
  }

  /** The driver of his last good trip (24 h, 4–5 stars) who isn't a favourite yet: «خليه سايقك المفضل؟». */
  async recentGood(actor: Actor): Promise<RecentDriverView | null> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - RIDE_HABIT_RULES.favourite.recentHours * 3_600_000);
    const favs = new Set((await this.repo.favouritesOf(actor.personId)).map((f) => f.driverId));
    const good = (stars: number | null) => (stars ?? 0) >= RIDE_HABIT_RULES.favourite.goodStars;
    const candidates: Array<{ orderId: string | null; bookingId: string | null; driverId: string; kind: FavouriteKind; stars: number; finishedAt: Date }> = [];
    for (const r of await this.rides.finishedRides(actor.personId, since)) {
      if (r.finishedAt >= since && good(r.stars) && !favs.has(r.driverId)) candidates.push({ orderId: r.orderId, bookingId: null, driverId: r.driverId, kind: r.vertical, stars: r.stars!, finishedAt: r.finishedAt });
    }
    for (const b of await this.rajaa.bookings(actor)) {
      if (b.state === 'completed' && b.completedAt && b.completedAt >= since && good(b.rating?.stars ?? null) && !favs.has(b.departure.driverId)) {
        candidates.push({ orderId: null, bookingId: b.id, driverId: b.departure.driverId, kind: 'intercity', stars: b.rating!.stars, finishedAt: b.completedAt });
      }
    }
    const best = candidates.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())[0];
    if (!best) return null;
    const [names, photos] = await Promise.all([this.people.firstNames([best.driverId], actor.personId), this.people.photoUrls([best.driverId], actor.personId)]);
    return { orderId: best.orderId, bookingId: best.bookingId, firstName: names[best.driverId] ?? null, photoUrl: photos[best.driverId] ?? null, kind: best.kind, stars: best.stars, finishedAt: best.finishedAt };
  }

  /** Orders' check at placement: the driver behind one of his favourites, or null. */
  async driverFor(personId: string, favouriteId: string): Promise<string | null> {
    return (await this.repo.favourite(personId, favouriteId))?.driverId ?? null;
  }

  private async rideTrip(actor: Actor, orderId: string): Promise<{ driverId: string; kind: FavouriteKind; stars: number | null }> {
    const ride = await this.rides.finishedRide(actor.personId, orderId);
    if (!ride) throw new DriverError('not_found');
    return { driverId: ride.driverId, kind: ride.vertical, stars: ride.stars };
  }

  private async seatTrip(actor: Actor, bookingId: string): Promise<{ driverId: string; kind: FavouriteKind; stars: number | null }> {
    const b = (await this.rajaa.bookings(actor)).find((x) => x.id === bookingId);
    if (!b || b.state !== 'completed') throw new DriverError('not_found');
    return { driverId: b.departure.driverId, kind: 'intercity', stars: b.rating?.stars ?? null };
  }

  private async favouriteViews(actor: Actor, favs: readonly FavouriteRecord[]): Promise<FavouriteDriverView[]> {
    if (favs.length === 0) return [];
    const ids = favs.map((f) => f.driverId);
    const since = new Date(this.clock.now().getTime() - TOGETHER_DAYS * DAY);
    const [names, photos, rides, seats, ratings] = await Promise.all([
      this.people.firstNames(ids, actor.personId),
      this.people.photoUrls(ids, actor.personId),
      this.rides.finishedRides(actor.personId, since),
      this.rajaa.bookings(actor),
      Promise.all(ids.map((id) => this.rides.driverRating(id))),
    ]);
    const together = (driverId: string) => rides.filter((r) => r.driverId === driverId).length + seats.filter((b) => b.state === 'completed' && b.departure.driverId === driverId).length;
    return favs.map((f, i) => ({
      id: f.id,
      driverId: f.driverId,
      firstName: names[f.driverId] ?? null,
      photoUrl: photos[f.driverId] ?? null,
      kinds: [...f.kinds],
      rating: ratings[i]?.rating ?? null,
      ratingCount: ratings[i]?.count ?? 0,
      tripsTogether: together(f.driverId),
      since: f.createdAt,
    }));
  }

  // ───────────────────────── regular trips (r5) ─────────────────────────

  async regularList(actor: Actor): Promise<RegularTripView[]> {
    const trips = await this.repo.tripsOf(actor.personId);
    return this.tripViews(actor, trips);
  }

  async regularSave(actor: Actor, raw: z.output<typeof SaveRegularTripInput>): Promise<RegularTripView> {
    const input = SaveRegularTripInput.parse(raw);
    const mine = await this.repo.tripsOf(actor.personId);
    if (input.id && !mine.some((t) => t.id === input.id)) throw new DriverError('not_found');
    if (!input.id && mine.length >= RIDE_HABIT_RULES.regular.maxPerPerson) throw new DriverError('regular_trip_limit');
    if (input.favouriteId && !(await this.repo.favourite(actor.personId, input.favouriteId))) throw new DriverError('favourite_not_found');
    const fields = { personId: actor.personId, days: input.days, timeMin: input.timeMin, remind: input.remind, paymentMethod: input.paymentMethod, favouriteId: input.favouriteId, active: input.active, plan: input.plan };
    const saved = input.id ? await this.repo.updateTrip(input.id, fields) : await this.repo.createTrip(fields, this.clock.now());
    return (await this.tripViews(actor, [saved]))[0]!;
  }

  async regularRemove(actor: Actor, input: RegularTripIdInput): Promise<{ ok: true }> {
    await this.ownTrip(actor, input.id);
    await this.repo.deleteTrip(input.id);
    return { ok: true };
  }

  /** One day of a regular trip with what «أكدها» would book: the server's fare, or that day's cars. */
  async occurrence(actor: Actor, input: OccurrenceInput): Promise<OccurrenceView> {
    const trip = await this.ownTrip(actor, input.id);
    if (!isOccurrenceDate(trip, input.date)) throw new DriverError('invalid_input');
    const view = (await this.tripViews(actor, [trip]))[0]!;
    const decision = await this.repo.decision(trip.id, input.date);
    const occ = this.summary(trip, input.date, decision);
    const open = occ.state === 'waiting' || occ.state === 'asking';
    if (trip.plan.kind === 'ride') {
      const p = trip.plan;
      const ride = open ? this.rides.fare({ cityId: CITY_ID, vertical: p.rideVertical, pickup: p.pickup, dropoff: p.dropoff, doorPickup: p.doorPickup, at: occ.at }) : null;
      return { trip: view, occurrence: occ, ride, rajaa: null };
    }
    const departures = open ? await this.departuresFor(actor, trip, occ.at, view.favourite?.driverId ?? null) : [];
    return { trip: view, occurrence: occ, ride: null, rajaa: { departures } };
  }

  /**
   * «أكدها»: books this one day — a ride for later through `orders.place` (the fare shown must still
   * be the server's: `price_changed`), or a seat on the chosen car (hold + book with his usual
   * payment), or «أريد أرجع» for the window when no car is announced yet. Too close → `occurrence_closed`.
   * A repeated tap answers with what the first booked.
   */
  async confirm(actor: Actor, input: z.output<typeof ConfirmOccurrenceInput>): Promise<OccurrenceView> {
    const trip = await this.ownTrip(actor, input.id);
    if (!isOccurrenceDate(trip, input.date)) throw new DriverError('invalid_input');
    const decided = await this.repo.decision(trip.id, input.date);
    if (decided) return this.occurrence(actor, input);
    const occ = this.summary(trip, input.date, null);
    if (occ.state === 'closed' || occ.at.getTime() <= this.clock.now().getTime()) throw new DriverError('occurrence_closed');
    const base: OccurrenceRecord = { regularTripId: trip.id, date: input.date, state: 'confirmed', orderId: null, bookingId: null, demandId: null, decidedAt: this.clock.now() };
    if (trip.plan.kind === 'ride') {
      const p = trip.plan;
      const favourite = trip.favouriteId ? await this.repo.favourite(actor.personId, trip.favouriteId) : null;
      const order = await this.rides.place(actor.personId, {
        cityId: CITY_ID,
        type: 'ride',
        rideVertical: p.rideVertical,
        ...(input.fareIqd !== undefined ? { fareIqd: input.fareIqd } : {}),
        options: { doorPickup: p.doorPickup },
        paymentMethod: trip.paymentMethod,
        pickup: point(p.pickup),
        dropoff: point(p.dropoff),
        scheduledFor: occ.at,
        ...(favourite ? { favouriteId: favourite.id } : {}),
        clientRequestId: input.clientRequestId,
      });
      await this.repo.decide({ ...base, orderId: order.id });
    } else if (input.departureId) {
      const plan = trip.plan;
      const card = (await this.departuresFor(actor, trip, occ.at, null)).find((d) => d.id === input.departureId);
      if (!card) throw new DriverError('not_found');
      const seat = seatFor(card);
      if (!seat) throw new DriverError('seat_unavailable');
      const booking = await this.rajaa.holdAndBook(actor, { departureId: card.id, seatId: seat, travellingAs: plan.travellingAs, payment: trip.paymentMethod });
      await this.repo.decide({ ...base, bookingId: booking.id });
    } else if (input.waitForCar) {
      const plan = trip.plan;
      const now = this.clock.now();
      const r = RIDE_HABIT_RULES.regular;
      const demand = await this.rajaa.postDemand(actor, {
        corridorId: plan.corridorId,
        direction: plan.direction,
        windowStart: new Date(Math.max(now.getTime(), occ.at.getTime() - r.rajaaBeforeMin * MIN)),
        windowEnd: new Date(occ.at.getTime() + r.rajaaAfterMin * MIN),
        seats: 1,
        travellingAs: plan.travellingAs,
        pickup: { kind: 'garage' },
      });
      await this.repo.decide({ ...base, demandId: demand.id });
    } else {
      throw new DriverError('invalid_input');
    }
    return this.occurrence(actor, input);
  }

  /** «مو هالمرة»: this day is skipped; the next one asks as usual. */
  async skip(actor: Actor, input: OccurrenceInput): Promise<OccurrenceView> {
    const trip = await this.ownTrip(actor, input.id);
    if (!isOccurrenceDate(trip, input.date)) throw new DriverError('invalid_input');
    const occ = this.summary(trip, input.date, await this.repo.decision(trip.id, input.date));
    if (occ.state === 'closed') throw new DriverError('occurrence_closed');
    if (occ.state === 'waiting' || occ.state === 'asking') {
      await this.repo.decide({ regularTripId: trip.id, date: input.date, state: 'skipped', orderId: null, bookingId: null, demandId: null, decidedAt: this.clock.now() });
    }
    return this.occurrence(actor, input);
  }

  /**
   * The reminder job's look: every active trip's occurrence whose ask time has come, still open, and
   * undecided gets one `regular_trip.due` (keyed per trip and date, so it is sent once ever).
   */
  async remindDue(): Promise<number> {
    const now = this.clock.now();
    const today = baghdadDate(now);
    const trips = await this.repo.activeTrips();
    const decided = await this.repo.decisions(
      trips.map((t) => t.id),
      today,
    );
    let n = 0;
    for (const t of trips) {
      const dates = new Set(decided.filter((d) => d.regularTripId === t.id).map((d) => d.date));
      for (const due of dueReminders(t, now, dates)) {
        await this.events.emit(
          {
            type: REGULAR_TRIP_DUE_EVENT,
            actorId: 'system',
            occurredAt: now,
            payload: { personId: t.personId, regularTripId: t.id, date: due.date, at: due.at.toISOString(), kind: t.plan.kind, route: this.routeOf(t) },
            idempotencyKey: `${REGULAR_TRIP_DUE_EVENT}:${t.id}:${due.date}`,
          },
          { name: 'person', id: t.personId },
        );
        n += 1;
      }
    }
    return n;
  }

  // ───────────────────────── «نفس مشوار البارحة؟» (step 4, o4) ─────────────────────────

  /** A ride he booked leaves its footprint (from `order.placed`; a redelivery changes nothing). */
  async recordRide(personId: string, f: RideFootprint): Promise<void> {
    await this.repo.addFootprint(personId, f);
  }

  /**
   * The job's look, every 5 minutes on working days: riders with a habit whose push time has come
   * (10 minutes before, until 3 before) get one `same_ride.due` — at most one a day (keyed per person
   * and date). Only finished rides count. Nothing when he has a ride on or booked around then, already
   * took that ride today, or has a regular trip for it (r5 asks him itself).
   */
  async sameRideDue(): Promise<number> {
    const now = this.clock.now();
    const today = baghdadDate(now);
    if (!isWorkDay(today)) return 0;
    const r = RIDE_HABIT_RULES.sameRide;
    const nowMin = baghdadMinuteOfDay(now);
    // A habit due now is timed in [now + 3, now + 10]; its rides lie within twice the window of that.
    const oldest = workDaysBefore(today, r.lookbackDays).at(-1)!;
    const prints = await this.repo.footprintsAround(atLocal(oldest, 0), nowMin + r.lastCallMin - 2 * r.windowMin, nowMin + r.pushBeforeMin + 2 * r.windowMin);
    const byPerson = new Map<string, RideFootprint[]>();
    for (const f of prints) byPerson.set(f.personId, [...(byPerson.get(f.personId) ?? []), f]);
    let n = 0;
    for (const [personId, mine] of byPerson) {
      if (mine.length < r.needed) continue;
      const finished = await this.rides.finishedOrderIds(mine.map((f) => f.orderId));
      const habit = sameRideHabits(
        mine.filter((f) => finished.has(f.orderId)),
        today,
      ).find((h) => {
        const w = sameRidePushWindow(h, today);
        return now >= w.from && now <= w.until;
      });
      if (!habit) continue;
      const { at } = sameRidePushWindow(habit, today);
      if (mine.some((f) => baghdadDate(f.at) === today && sameRide(f, { ...habit, at }))) continue;
      if (await this.rides.rideOn(personId, at)) continue;
      if (await this.regularCovers(personId, habit, at)) continue;
      await this.events.emit(
        {
          type: SAME_RIDE_DUE_EVENT,
          actorId: 'system',
          occurredAt: now,
          payload: {
            personId,
            date: today,
            at: at.toISOString(),
            vertical: habit.vertical,
            doorPickup: habit.doorPickup,
            from: encodeRideEnd(habit.pickup),
            to: encodeRideEnd(habit.dropoff),
            route: await this.sameRideRoute(personId, habit),
            // His last working day was not yesterday (a Sunday after the weekend): «نفس مشوار الخميس؟».
            afterWeekend: habit.dates[0] !== shiftDate(today, -1),
          },
          idempotencyKey: `${SAME_RIDE_DUE_EVENT}:${personId}:${today}`,
        },
        { name: 'person', id: personId },
      );
      n += 1;
    }
    return n;
  }

  /** One of his active regular rides on this weekday covers the habit (same ends, about the same time). */
  private async regularCovers(personId: string, habit: SameRideHabit, at: Date): Promise<boolean> {
    const r = RIDE_HABIT_RULES.sameRide;
    return (await this.repo.tripsOf(personId)).some(
      (t) =>
        t.active &&
        t.plan.kind === 'ride' &&
        t.days.includes(baghdadWeekday(at)) &&
        Math.abs(t.timeMin - habit.timeMin) <= r.windowMin &&
        haversineM(t.plan.pickup.pin, habit.pickup.pin) <= r.radiusM &&
        haversineM(t.plan.dropoff.pin, habit.dropoff.pin) <= r.radiusM,
    );
  }

  /** «البيت ← المدرسة»: his saved place's name at each end, else the zone's name. */
  private async sameRideRoute(personId: string, habit: SameRideHabit): Promise<string> {
    const places = await this.people.places(personId);
    const name = (end: SameRideHabit['pickup']) => {
      const place = places.find((p) => p.id === end.placeId) ?? places.find((p) => haversineM(p.pin, end.pin) <= RIDE_HABIT_RULES.sameRide.radiusM);
      if (place) return place.name;
      const zone = AZIZIYAH_ZONES.find((z) => z.id === end.zoneKey);
      return zone ? westernDigits(zone.name_ar) : end.zoneKey;
    };
    return `${name(habit.pickup)} ← ${name(habit.dropoff)}`;
  }

  private routeOf(t: RegularTripRecord): string {
    return t.plan.kind === 'ride' ? `${t.plan.pickup.label} ← ${t.plan.dropoff.label}` : this.rajaa.routeAr(t.plan.corridorId, t.plan.direction);
  }

  private async ownTrip(actor: Actor, id: string): Promise<RegularTripRecord> {
    const t = await this.repo.trip(id);
    if (!t || t.personId !== actor.personId) throw new DriverError('not_found');
    return t;
  }

  private summary(t: RegularTripRecord, date: CalendarDate, d: OccurrenceRecord | null): OccurrenceSummary {
    const at = atLocal(date, t.timeMin);
    const o = { at, askAt: askAt(date, t.remind) };
    return { date, ...o, state: occurrenceState(o, d ? decisionOf(d) : undefined, this.clock.now()), orderId: d?.orderId ?? null, bookingId: d?.bookingId ?? null, demandId: d?.demandId ?? null };
  }

  private async tripViews(actor: Actor, trips: readonly RegularTripRecord[]): Promise<RegularTripView[]> {
    const now = this.clock.now();
    const decisions = await this.repo.decisions(
      trips.map((t) => t.id),
      baghdadDate(now),
    );
    const favs = await this.favourites(actor);
    return trips.map((t) => {
      const mine = new Map(decisions.filter((d) => d.regularTripId === t.id).map((d) => [d.date, decisionOf(d)] as const));
      return {
        id: t.id,
        days: [...t.days],
        timeMin: t.timeMin,
        remind: t.remind,
        paymentMethod: t.paymentMethod,
        favourite: favs.find((f) => f.id === t.favouriteId) ?? null,
        active: t.active,
        plan: t.plan,
        next: t.active ? nextOccurrence(t, now, mine) : null,
        booked: decisions
          .filter((d) => d.regularTripId === t.id && d.state === 'confirmed')
          .map((d) => this.summary(t, d.date, d))
          .filter((o) => o.at.getTime() > now.getTime())
          .sort((a, b) => a.at.getTime() - b.at.getTime()),
      };
    });
  }

  /** That day's cars around the usual time (60 min before → 120 after), the favourite's first, then nearest in time. */
  private async departuresFor(actor: Actor, t: RegularTripRecord, at: Date, favouriteDriverId: string | null): Promise<DepartureCard[]> {
    if (t.plan.kind !== 'rajaa') return [];
    const r = RIDE_HABIT_RULES.regular;
    const board = await this.rajaa.board(actor, { corridorId: t.plan.corridorId, direction: t.plan.direction, from: new Date(at.getTime() - r.rajaaBeforeMin * MIN), to: new Date(at.getTime() + r.rajaaAfterMin * MIN), travellingAs: t.plan.travellingAs });
    const gap = (d: DepartureCard) => Math.abs(d.departAt.getTime() - at.getTime());
    return [...board.departures].sort((a, b) => Number(b.driverId === favouriteDriverId) - Number(a.driverId === favouriteDriverId) || gap(a) - gap(b));
  }

  // ───────────────────────── «عشاك يوصل وياك» (r6) ─────────────────────────

  /** His ride home (to one of his saved places) or his الرجعة to Aziziyah arriving within 150 minutes. */
  async dinnerChance(actor: Actor): Promise<DinnerChance | null> {
    const now = this.clock.now();
    const places = await this.people.places(actor.personId);
    const soon = (at: Date | null): at is Date => at !== null && at.getTime() > now.getTime() && at.getTime() - now.getTime() <= RIDE_HABIT_RULES.dinner.maxAheadMin * MIN;
    const ride = await this.rides.rideInProgress(actor.personId);
    if (ride) {
      const place = places.find((p) => p.id === ride.dropoff.placeId);
      if (place && soon(ride.arriveAt)) return { source: { kind: 'ride', orderId: ride.orderId }, vehicle: ride.vertical, arriveAt: ride.arriveAt, place: placeOf(place) };
    }
    for (const b of await this.rajaa.bookings(actor)) {
      const seat = await this.seatArrival(b, places);
      if (seat && soon(seat.arriveAt)) return { source: { kind: 'rajaa', bookingId: b.id }, vehicle: 'intercity', arriveAt: seat.arriveAt, place: placeOf(seat.place) };
    }
    return null;
  }

  /**
   * The server's pick for this kitchen: food at the door when he gets home, unless the kitchen can't
   * make it (prep + busy + the scheduled lead from now) — then the earliest it can, and by how much.
   * The app sends `deliverAt` as the order's `scheduledFor`; the kitchen then hears of it at
   * `deliverAt − prep − lead`, exactly like any pre-order.
   */
  async dinnerTime(actor: Actor, input: DinnerTimeInput): Promise<DinnerTime> {
    const chance = await this.dinnerChance(actor);
    if (!chance || !sameSource(chance.source, input.source)) throw new DriverError('dinner_not_available');
    const kitchen = await this.rides.kitchen(input.merchantOrgId);
    if (!kitchen) throw new DriverError('org_not_found');
    const now = this.clock.now();
    const earliest = new Date(now.getTime() + (kitchen.prepMin + kitchen.leadMin) * MIN);
    const { deliverAt, lateByMin } = dinnerDeliverAt(chance.arriveAt, earliest);
    return { arriveAt: chance.arriveAt, deliverAt, kitchenReadyAt: new Date(deliverAt.getTime() - kitchen.leadMin * MIN), lateByMin, place: chance.place };
  }

  /** A seat to Aziziyah still on: the car's arrival (left + travel, else announced + travel) + the garage → home ride. */
  private async seatArrival(b: BookingView, places: readonly SavedPlaceView[]): Promise<{ arriveAt: Date; place: SavedPlaceView } | null> {
    if (!LIVE_SEAT.has(b.state) || b.departure.direction !== 'to_aziziyah') return null;
    if (!['scheduled', 'boarding', 'departed'].includes(b.departure.state)) return null;
    const home = places.find((p) => p.label === 'home');
    const travel = this.rajaa.travelMin(b.departure.corridorId);
    if (!home || travel === null) return null;
    const left = (await this.rajaa.departedAt(b.departureId)) ?? b.departure.departAt;
    const garage = nearest(this.rajaa.aziziyahGarages(), home.pin);
    const lastLeg = garage ? await this.rides.minutes(garage, home.pin, 'tuktuk') : 0;
    return { arriveAt: new Date(left.getTime() + (travel + lastLeg) * MIN), place: home };
  }
}

function decisionOf(d: OccurrenceRecord): OccurrenceDecision {
  return { state: d.state, orderId: d.orderId, bookingId: d.bookingId, demandId: d.demandId };
}

/** The first free seat he may take on this car, a plain one before the front seat. */
function seatFor(card: DepartureCard): IntercitySeatId | null {
  const free = card.seats.filter((s) => s.state === 'free' && s.blocked === null);
  return (free.find((s) => s.premiumIqd === 0) ?? free[0])?.id ?? null;
}

function point(p: { zoneKey: string; pin: LatLng; placeId?: string | undefined }) {
  return { zoneKey: p.zoneKey, pin: p.pin, ...(p.placeId ? { placeId: p.placeId } : {}) };
}

function placeOf(p: SavedPlaceView) {
  return { placeId: p.id, name: p.name, label: p.label };
}

function sameSource(a: DinnerSource, b: DinnerSource): boolean {
  return a.kind === 'ride' && b.kind === 'ride' ? a.orderId === b.orderId : a.kind === 'rajaa' && b.kind === 'rajaa' ? a.bookingId === b.bookingId : false;
}

function nearest(points: readonly LatLng[], to: LatLng): LatLng | null {
  let best: LatLng | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const d = (p.lat - to.lat) ** 2 + (p.lng - to.lng) ** 2;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export type { FinishedRide };
