import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  CannedResponse,
  OpenTicketInput,
  SupportCustomer,
  SupportList,
  SupportListInput,
  TicketCase,
  TicketChatReadInput,
  TicketEscalateInput,
  TicketFaultInput,
  TicketIdInput,
  TicketRefundInput,
  TicketReplyInput,
  TicketResolveInput,
  TicketSummary,
} from '../support-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** The support desk: support agents, dispatchers (the launch rota combines them), finance and admin. */
export const SUPPORT_DESK_ROLES: readonly RoleKind[] = ['support', 'dispatcher', 'finance', 'admin'];

/** `support.*` — tickets and disputes with SLA timers, the case view and one-tap actions. */
export const supportRouter = router({
  list: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(SupportListInput)
    .output(SupportList)
    .query(({ ctx, input }) => ctx.support.list(ctx.actor, input)),
  get: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketIdInput)
    .output(TicketCase)
    .query(({ ctx, input }) => ctx.support.get(ctx.actor, input)),
  /** The customer card on a case: first name (logged vault read), orders, lifetime value, refunds, other tickets. */
  customer: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketIdInput)
    .output(SupportCustomer.nullable())
    .query(({ ctx, input }) => ctx.support.customer(ctx.actor, input)),
  canned: protectedProcedure(SUPPORT_DESK_ROLES)
    .output(z.array(CannedResponse))
    .query(({ ctx }) => ctx.support.canned()),
  open: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(OpenTicketInput)
    .output(TicketSummary)
    .mutation(({ ctx, input }) => ctx.support.open(ctx.actor, input)),
  /** On a `chat` case (the order's «كلّم الدعم» chat) a reply goes into that chat; otherwise as before. */
  reply: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketReplyInput)
    .output(TicketCase)
    .mutation(({ ctx, input }) => ctx.support.reply(ctx.actor, input)),
  /** The desk read the case's support chat up to `seq` (the customer's read tick). */
  chatRead: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketChatReadInput)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => ctx.support.chatRead(ctx.actor, input)),
  /** Wallet credit or points through the ledger, funded by the party at fault; capped per agent, customer and case. */
  refund: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketRefundInput)
    .output(TicketCase)
    .mutation(({ ctx, input }) => ctx.support.refund(ctx.actor, input)),
  attributeFault: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketFaultInput)
    .output(TicketCase)
    .mutation(({ ctx, input }) => ctx.support.attributeFault(ctx.actor, input)),
  escalate: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketEscalateInput)
    .output(TicketCase)
    .mutation(({ ctx, input }) => ctx.support.escalate(ctx.actor, input)),
  resolve: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(TicketResolveInput)
    .output(TicketCase)
    .mutation(({ ctx, input }) => ctx.support.resolve(ctx.actor, input)),
});
