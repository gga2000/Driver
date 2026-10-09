import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  CannedResponse,
  OpenTicketInput,
  RefundApproval,
  RefundApprovalDeclineInput,
  RefundApprovalIdInput,
  RefundApprovalListInput,
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
/** Who may give the second OK on a refund over a limit (never the person who asked). */
export const REFUND_APPROVER_ROLES: readonly RoleKind[] = ['finance', 'admin'];

/** `support.refundApprovals.*` — refunds over a limit wait here for a second staff member's OK. */
const refundApprovalsRouter = router({
  list: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(RefundApprovalListInput)
    .output(z.array(RefundApproval))
    .query(({ ctx, input }) => ctx.support.refundApprovals(ctx.actor, input)),
  approve: protectedProcedure(REFUND_APPROVER_ROLES)
    .input(RefundApprovalIdInput)
    .output(RefundApproval)
    .mutation(({ ctx, input }) => ctx.support.approveRefund(ctx.actor, input)),
  decline: protectedProcedure(REFUND_APPROVER_ROLES)
    .input(RefundApprovalDeclineInput)
    .output(RefundApproval)
    .mutation(({ ctx, input }) => ctx.support.declineRefund(ctx.actor, input)),
  /** The person who asked takes it back. */
  cancel: protectedProcedure(SUPPORT_DESK_ROLES)
    .input(RefundApprovalIdInput)
    .output(RefundApproval)
    .mutation(({ ctx, input }) => ctx.support.cancelRefund(ctx.actor, input)),
});

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
  /**
   * Wallet credit or points through the ledger, funded by the party at fault. Over a limit (per refund,
   * per agent a day, per customer a month) nothing posts: it waits in `refundApprovals` for a second OK.
   */
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
  refundApprovals: refundApprovalsRouter,
});
