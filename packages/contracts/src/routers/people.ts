import {
  CustomerProfile,
  CustomersPage,
  DriverPeopleProfile,
  PEOPLE_READ_ROLES,
  PeopleCustomersInput,
  PersonInput,
  PHONE_REVEAL_ROLES,
  RevealedPhone,
  RevealPhoneInput,
  StoryInput,
  StoryPage,
} from '../people-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** `people.*` — «الناس»: every customer and driver, a profile with analytics, the timeline and a logged number reveal. */
export const peopleRouter = router({
  /** Customers in the city with the list's numbers, filtered and searched (name, last 4 digits, id). */
  customers: protectedProcedure(PEOPLE_READ_ROLES)
    .input(PeopleCustomersInput)
    .output(CustomersPage)
    .query(({ ctx, input }) => ctx.people.customers(input, ctx.actor.personId)),
  /** One customer: totals, charts, live orders, tickets and signals (the name and masked number are a logged read). */
  customer: protectedProcedure(PEOPLE_READ_ROLES)
    .input(PersonInput)
    .output(CustomerProfile)
    .query(({ ctx, input }) => ctx.people.customer(input, ctx.actor.personId)),
  /** One driver of any kind: live state, scorecard, money, documents, ratings and complaints. */
  driver: protectedProcedure(PEOPLE_READ_ROLES)
    .input(PersonInput)
    .output(DriverPeopleProfile)
    .query(({ ctx, input }) => ctx.people.driver(input, ctx.actor.personId)),
  /** «القصة»: what happened to the person, newest first. Pseudonymous: ids and amounts. */
  story: protectedProcedure(PEOPLE_READ_ROLES)
    .input(StoryInput)
    .output(StoryPage)
    .query(({ ctx, input }) => ctx.people.story(input)),
  /** The whole number, for a reason the staff member picks; one vault access row per reveal. */
  revealPhone: protectedProcedure(PHONE_REVEAL_ROLES)
    .input(RevealPhoneInput)
    .output(RevealedPhone)
    .mutation(({ ctx, input }) => ctx.people.revealPhone(ctx.actor, input)),
});
