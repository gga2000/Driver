import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { CityId, Iqd } from './common.js';
import { EventLogEntry } from './console-io.js';
import { ChatThreadKind } from './chat-io.js';

/**
 * Support desk (notifications & support spec §2–3; edge-case review O.144–148, 101, 83; decisions
 * "AI-support refund limits"). Tickets live in Postgres (`support_tickets`, `support_ticket_entries`);
 * an order dispute opens one by itself. Served by `apps/api/src/modules/support`.
 */

export const TicketKind = z.enum(['dispute', 'complaint', 'incident', 'question']);
export type TicketKind = z.infer<typeof TicketKind>;

export const TicketStatus = z.enum(['open', 'waiting', 'escalated', 'resolved']);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketChannel = z.enum(['in_app', 'whatsapp', 'phone', 'system']);
export type TicketChannel = z.infer<typeof TicketChannel>;

/** Who the case blames: refunds are funded by the party at fault (courier / merchant) or the platform. */
export const FaultParty = z.enum(['none', 'courier', 'merchant', 'platform', 'customer']);
export type FaultParty = z.infer<typeof FaultParty>;

/** Same-day rule: answered by local midnight of the day it opened, and never unresolved past 24 h. */
export const SlaState = z.enum(['ok', 'due_soon', 'breached', 'met']);
export type SlaState = z.infer<typeof SlaState>;

export const TicketSummary = z.object({
  id: z.string(),
  cityId: z.string(),
  kind: TicketKind,
  kind_ar: z.string(),
  status: TicketStatus,
  status_ar: z.string(),
  channel: TicketChannel,
  subject: z.string(),
  orderId: z.string().nullable(),
  tripId: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  openedAt: z.coerce.date(),
  firstResponseAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  /** min(local midnight of the opening day, opened + 24 h). */
  slaDueAt: z.coerce.date(),
  slaState: SlaState,
  /** Unresolved for more than 24 h (the week-one wall counts these: target zero). */
  overdue24h: z.boolean(),
  /** Queue rank (higher first): active trip, money, safety, tone, age. */
  urgency: z.number().int(),
  urgencyReasons: z.array(z.string()),
  assigneeId: z.string().nullable(),
  faultParty: FaultParty,
  refundedIqd: Iqd,
  escalatedTo: z.string().nullable(),
  lastActivityAt: z.coerce.date(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TicketEntryKind = z.enum(['opened', 'note', 'reply', 'refund', 'fault', 'escalate', 'resolve', 'reopen', 'assign']);
export type TicketEntryKind = z.infer<typeof TicketEntryKind>;

export const TicketEntry = z.object({
  id: z.string(),
  at: z.coerce.date(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  kind: TicketEntryKind,
  text: z.string(),
  amountIqd: z.number().int().nullable(),
  meta: z.record(z.unknown()),
});
export type TicketEntry = z.infer<typeof TicketEntry>;

/** A canned Iraqi-Arabic answer and the one-tap action that goes with it. */
export const CannedResponse = z.object({
  key: z.string(),
  title_ar: z.string(),
  text_ar: z.string(),
  action: z.enum(['none', 'refund', 'fault_courier', 'fault_merchant', 'escalate', 'resolve']),
  amountIqd: z.number().int().nullable(),
});
export type CannedResponse = z.infer<typeof CannedResponse>;

export const RefundLimits = z.object({
  /** Per agent per local day (edge-case 101): above it, finance approves (escalate). */
  agentDailyCapIqd: Iqd,
  agentUsedTodayIqd: Iqd,
  /** Per customer per month, visible to agents (edge-case O.148). */
  customerMonthlyCapIqd: Iqd,
  customerUsedMonthIqd: Iqd,
  /** Money over this goes to Ali / the deputy on escalation duty (support spec §2). */
  escalateAboveIqd: Iqd,
  /** What this agent may still give on this case right now. */
  availableIqd: Iqd,
  /** Refunds above 10,000 default to cash via the next courier (edge-case 83); below, wallet credit. */
  cashAboveIqd: Iqd,
});
export type RefundLimits = z.infer<typeof RefundLimits>;

export const LedgerLineView = z.object({
  id: z.string(),
  at: z.coerce.date(),
  type: z.string(),
  label_ar: z.string(),
  amountIqd: Iqd,
  fromAccount: z.string(),
  toAccount: z.string(),
  memo: z.string().nullable(),
});
export type LedgerLineView = z.infer<typeof LedgerLineView>;

export const TicketOrderView = z.object({
  id: z.string(),
  type: z.string(),
  state: z.string(),
  totalIqd: Iqd,
  paymentMethod: z.string(),
  merchantOrgId: z.string().nullable(),
  merchantName: z.string().nullable(),
  placedAt: z.coerce.date(),
  deliveredAt: z.coerce.date().nullable(),
  courierId: z.string().nullable(),
  lines: z.array(z.object({ name: z.string(), qty: z.number().int(), totalIqd: Iqd })),
});
export type TicketOrderView = z.infer<typeof TicketOrderView>;

export const TicketCase = z.object({
  ticket: TicketSummary,
  entries: z.array(TicketEntry),
  order: TicketOrderView.nullable(),
  /** Order + trip events, oldest first. */
  timeline: z.array(EventLogEntry),
  ledger: z.array(LedgerLineView),
  /** Chat threads the console may read (read-only) through `chat.thread`. */
  chatKinds: z.array(ChatThreadKind),
  limits: RefundLimits,
  canned: z.array(CannedResponse),
  /** Pre-selected resolution (support spec §3) from the dispute kind and the evidence. */
  suggestion: z.object({ cannedKey: z.string(), reason_ar: z.string() }).nullable(),
  /** Disputes by this customer in the last 30 days (> 3 → manual review). */
  customerDisputes30d: z.number().int(),
});
export type TicketCase = z.infer<typeof TicketCase>;

export const SupportListInput = z.object({
  cityId: CityId.default('aziziyah'),
  status: z.enum(['active', 'all', 'resolved', 'escalated']).default('active'),
  kind: TicketKind.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export const SupportList = z.object({
  at: z.coerce.date(),
  rows: z.array(TicketSummary),
  counts: z.object({ open: z.number().int(), breached: z.number().int(), overdue24h: z.number().int(), escalated: z.number().int(), resolvedToday: z.number().int() }),
});
export type SupportList = z.infer<typeof SupportList>;

export const TicketIdInput = z.object({ ticketId: z.string().min(1) });

export const OpenTicketInput = z.object({
  cityId: CityId.default('aziziyah'),
  kind: TicketKind,
  channel: TicketChannel.default('phone'),
  subject: z.string().trim().min(3).max(200),
  note: z.string().trim().max(2000).optional(),
  orderId: z.string().optional(),
  customerId: z.string().optional(),
});
export type OpenTicketInput = z.input<typeof OpenTicketInput>;

export const TicketReplyInput = z.object({
  ticketId: z.string().min(1),
  text: z.string().trim().min(1).max(2000),
  cannedKey: z.string().max(60).optional(),
  /** An internal note is not sent to the customer. */
  internal: z.boolean().default(false),
});

export const TicketRefundInput = z.object({
  ticketId: z.string().min(1),
  /** Multiples of 250 (customer totals stay round). */
  amountIqd: z.number().int().min(250).max(500_000).refine((n) => n % 250 === 0, 'multiple of 250'),
  method: z.enum(['wallet', 'points']),
  faultParty: FaultParty.exclude(['customer']).default('platform'),
  note: z.string().trim().max(500).optional(),
  /** Client-generated: a double click posts once. */
  idempotencyKey: z.string().min(8).max(80),
});
export type TicketRefundInput = z.input<typeof TicketRefundInput>;

export const TicketFaultInput = z.object({ ticketId: z.string().min(1), faultParty: FaultParty, note: z.string().trim().min(3).max(500) });
export const TicketEscalateInput = z.object({ ticketId: z.string().min(1), reason: z.string().trim().min(3).max(500) });
export const TicketResolveInput = z.object({ ticketId: z.string().min(1), resolution: z.string().trim().min(3).max(1000) });

/** `ctx.support`: the support desk. Roles are checked by the router; limits by the service. */
export interface SupportPort {
  list(actor: Actor, input: z.output<typeof SupportListInput>): Promise<SupportList>;
  get(actor: Actor, input: { ticketId: string }): Promise<TicketCase>;
  open(actor: Actor, input: z.output<typeof OpenTicketInput>): Promise<TicketSummary>;
  reply(actor: Actor, input: z.output<typeof TicketReplyInput>): Promise<TicketCase>;
  refund(actor: Actor, input: z.output<typeof TicketRefundInput>): Promise<TicketCase>;
  attributeFault(actor: Actor, input: z.output<typeof TicketFaultInput>): Promise<TicketCase>;
  escalate(actor: Actor, input: z.output<typeof TicketEscalateInput>): Promise<TicketCase>;
  resolve(actor: Actor, input: z.output<typeof TicketResolveInput>): Promise<TicketCase>;
  canned(): CannedResponse[];
}
