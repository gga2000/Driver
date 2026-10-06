import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  ApprovalsInput,
  ApprovalsView,
  AuditEntry,
  AuditInput,
  BannerInput,
  ClearBannerInput,
  ClearQuietDaysInput,
  ControlsInput,
  ControlsView,
  DecideApprovalInput,
  DecideApprovalOutput,
  FinanceDeskView,
  FinanceInput,
  KillSwitchView,
  LaunchMetricsView,
  MetricsInput,
  PublicBanner,
  PublicSeason,
  QuietDaysView,
  SeasonInput,
  SetBannerInput,
  SetKillSwitchInput,
  SetQuietDaysInput,
  SetZoneCapacityInput,
  SettlementExport,
  SettlementExportInput,
  SystemBannerView,
  ZoneCapacityView,
} from '../control-room-io.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';

/** Who flips kill switches and zone throttles (launch playbook §3: dispatchers on shift, Ali). */
export const CONTROL_ROLES: readonly RoleKind[] = ['admin', 'dispatcher'];
/** Who sets the status banner every open app shows. */
export const BANNER_ROLES: readonly RoleKind[] = ['admin'];
/** Reviewers in the approvals queue (per-kind roles are checked in the API). */
export const APPROVAL_ROLES: readonly RoleKind[] = ['admin', 'support', 'field_ops'];
/** The nightly cash desk: finance, plus the dispatcher and field ops who run the 23:00 round. */
export const FINANCE_DESK_ROLES: readonly RoleKind[] = ['finance', 'admin', 'dispatcher', 'field_ops'];
/** Settlement exports leave the system: finance and admin only. */
export const FINANCE_EXPORT_ROLES: readonly RoleKind[] = ['finance', 'admin'];

/** `ops.controls.*` — kill switches per vertical / zone / restaurant / corridor and the zone throttle. */
export const opsControlsRouter = router({
  view: protectedProcedure(CONSOLE_READ_ROLES)
    .input(ControlsInput)
    .output(ControlsView)
    .query(({ ctx, input }) => ctx.controls.view(input.cityId)),
  setSwitch: protectedProcedure(CONTROL_ROLES)
    .input(SetKillSwitchInput)
    .output(KillSwitchView)
    .mutation(({ ctx, input }) => ctx.controls.setSwitch(ctx.actor, input)),
  setCapacity: protectedProcedure(CONTROL_ROLES)
    .input(SetZoneCapacityInput)
    .output(ZoneCapacityView)
    .mutation(({ ctx, input }) => ctx.controls.setCapacity(ctx.actor, input)),
  audit: protectedProcedure(CONSOLE_READ_ROLES)
    .input(AuditInput)
    .output(z.array(AuditEntry))
    .query(({ ctx, input }) => ctx.controls.audit(input)),
});

/** `system.banner` (public, every open app polls it) and the admin side. Spread into `system`. */
export const bannerProcedures = {
  banner: publicProcedure
    .input(BannerInput)
    .output(PublicBanner.nullable())
    .query(({ ctx, input }) => ctx.controls.banner(input)),
  banners: protectedProcedure(CONSOLE_READ_ROLES)
    .output(z.array(SystemBannerView))
    .query(({ ctx }) => ctx.controls.banners()),
  setBanner: protectedProcedure(BANNER_ROLES)
    .input(SetBannerInput)
    .output(SystemBannerView)
    .mutation(({ ctx, input }) => ctx.controls.setBanner(ctx.actor, input)),
  clearBanner: protectedProcedure(BANNER_ROLES)
    .input(ClearBannerInput)
    .output(SystemBannerView)
    .mutation(({ ctx, input }) => ctx.controls.clearBanner(ctx.actor, input)),
};

/** `system.season` (public: what an open app may do today) and the quiet days ops set. Spread into `system`. */
export const seasonProcedures = {
  season: publicProcedure
    .input(SeasonInput)
    .output(PublicSeason)
    .query(({ ctx, input }) => ctx.controls.season(input)),
  quietDays: protectedProcedure(CONSOLE_READ_ROLES)
    .output(z.array(QuietDaysView))
    .query(({ ctx }) => ctx.controls.quietDays()),
  setQuietDays: protectedProcedure(BANNER_ROLES)
    .input(SetQuietDaysInput)
    .output(QuietDaysView)
    .mutation(({ ctx, input }) => ctx.controls.setQuietDays(ctx.actor, input)),
  clearQuietDays: protectedProcedure(BANNER_ROLES)
    .input(ClearQuietDaysInput)
    .output(QuietDaysView)
    .mutation(({ ctx, input }) => ctx.controls.clearQuietDays(ctx.actor, input)),
};

/** `approvals.*` — driver documents, merchant deals, landmark photos, onboarding drafts, fleet vehicles. */
export const approvalsRouter = router({
  list: protectedProcedure(APPROVAL_ROLES)
    .input(ApprovalsInput)
    .output(ApprovalsView)
    .query(({ ctx, input }) => ctx.controlRoom.approvals(ctx.actor, input)),
  decide: protectedProcedure(APPROVAL_ROLES)
    .input(DecideApprovalInput)
    .output(DecideApprovalOutput)
    .mutation(({ ctx, input }) => ctx.controlRoom.decide(ctx.actor, input)),
});

/** `finance.*` — the nightly cash desk and settlement exports (CSV). */
export const financeRouter = router({
  desk: protectedProcedure(FINANCE_DESK_ROLES)
    .input(FinanceInput)
    .output(FinanceDeskView)
    .query(({ ctx, input }) => ctx.controlRoom.finance(ctx.actor, input)),
  exportSettlement: protectedProcedure(FINANCE_EXPORT_ROLES)
    .input(SettlementExportInput)
    .output(SettlementExport)
    .mutation(({ ctx, input }) => ctx.controlRoom.exportSettlement(ctx.actor, input)),
});

/** `metrics.wall` — the week-one launch metrics (playbook §6). */
export const metricsRouter = router({
  wall: protectedProcedure(CONSOLE_READ_ROLES)
    .input(MetricsInput)
    .output(LaunchMetricsView)
    .query(({ ctx, input }) => ctx.controlRoom.metrics(input)),
});
