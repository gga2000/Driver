import { z } from 'zod';

/** Mirrors the Prisma `ParticipantRole` enum (domain §1). */
export const ParticipantRole = z.enum(['recipient', 'diner', 'rider', 'parcel_recipient']);
export type ParticipantRole = z.infer<typeof ParticipantRole>;

/**
 * A person on an order who is not necessarily the orderer (domain §3). The orderer gives a phone;
 * the API resolves it to a Person when one exists, otherwise keeps only the peppered phone hash —
 * the number itself never lands on `participants`.
 */
export const ParticipantInput = z.object({
  /** Client-side handle that order lines use to tag themselves to this participant. */
  ref: z.string().min(1).max(40),
  role: ParticipantRole,
  phone: z.string().min(7).max(20).optional(),
  /** Grouping tag printed on the merchant ticket ("الكبير"), never an identifier. */
  label: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});
export type ParticipantInput = z.infer<typeof ParticipantInput>;

export const Participant = z.object({
  id: z.string(),
  role: ParticipantRole,
  personId: z.string().nullable(),
  /** True for phone-only participants: their points go to `points_pending` keyed by phone (domain §3). */
  phoneOnly: z.boolean(),
  label: z.string().nullable(),
  note: z.string().nullable(),
});
export type Participant = z.infer<typeof Participant>;
