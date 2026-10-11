import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  ApprovalsInput,
  ApprovalsView,
  AuditEntry,
  AuditInput,
  AuditPage,
  AuditPageInput,
  BannerInput,
  ClearBannerInput,
  ClearQuietDaysInput,
  ClearSeasonInput,
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
  PublicScreens,
  PublicSeason,
  QuietDaysView,
  ScreenSwitchView,
  ScreensInput,
  SeasonInput,
  SeasonView,
  SetIftarTimeInput,
  SetSeasonInput,
  SetBannerInput,
  SetKillSwitchInput,
  SetQuietDaysInput,
  SetScreenSwitchInput,
  SetZoneCapacityInput,
  SettlementExport,
  SettlementExportInput,
  SystemBannerView,
  ZoneCapacityView,
} from '../control-room-io.js';
import { DriverError } from '../errors.js';
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
/** Who shows a new customer screen to staff or to everyone (a product call). Any CONTROL_ROLES may switch one off. */
export const SCREEN_ON_ROLES: readonly RoleKind[] = ['admin'];
/** Staff for screen switches: anyone who can open the Console. */
const SCREEN_STAFF_ROLES: readonly RoleKind[] = CONSOLE_READ_ROLES;
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
  /** v10: the audit page, 50 rows at a time, with a chip filter and the matching count. */
  auditPage: protectedProcedure(CONSOLE_READ_ROLES)
    .input(AuditPageInput)
    .output(AuditPage)
    .query(({ ctx, input }) => ctx.controls.auditPage(input)),
  /** W6: the redesigned customer screens and who sees each (off, staff, everyone). */
  screens: protectedProcedure(CONSOLE_READ_ROLES)
    .input(ControlsInput)
    .output(z.array(ScreenSwitchView))
    .query(({ ctx, input }) => ctx.controls.screenSwitches(input.cityId)),
  /** A dispatcher on shift can always switch a new screen off; showing it to anyone is an admin's call. */
  setScreen: protectedProcedure(CONTROL_ROLES)
    .input(SetScreenSwitchInput)
    .output(ScreenSwitchView)
    .mutation(async ({ ctx, input }) => {
      if (input.audience !== 'off') {
        let allowed = false;
        for (const kind of SCREEN_ON_ROLES) if (await ctx.identity.hasRole(ctx.actor.personId, kind)) allowed = true;
        if (!allowed) throw new DriverError('forbidden');
      }
      return ctx.controls.setScreen(ctx.actor, input);
    }),
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

/**
 * `system.screens` (public, read once when an app starts): which redesigned screens this caller
 * sees. Signed out = only screens on for everyone. Spread into `system`.
 */
export const screenProcedures = {
  screens: publicProcedure
    .input(ScreensInput)
    .output(PublicScreens)
    .query(({ ctx, input }) => {
      const auth = ctx.auth;
      const isStaff = async (): Promise<boolean> => {
        if (!auth) return false;
        if (ctx.identity.activeRoles) {
          const held = await ctx.identity.activeRoles(auth.sub);
          return SCREEN_STAFF_ROLES.some((k) => held.includes(k));
        }
        for (const kind of SCREEN_STAFF_ROLES) if (await ctx.identity.hasRole(auth.sub, kind)) return true;
        return false;
      };
      return ctx.controls.screens(input, isStaff);
    }),
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
  /** J6: every kind of season period (quiet, Ramadan, Eid, a special Friday), with Ramadan's day times. */
  seasons: protectedProcedure(CONSOLE_READ_ROLES)
    .output(z.array(SeasonView))
    .query(({ ctx }) => ctx.controls.seasons()),
  setSeason: protectedProcedure(BANNER_ROLES)
    .input(SetSeasonInput)
    .output(SeasonView)
    .mutation(({ ctx, input }) => ctx.controls.setSeason(ctx.actor, input)),
  clearSeason: protectedProcedure(BANNER_ROLES)
    .input(ClearSeasonInput)
    .output(SeasonView)
    .mutation(({ ctx, input }) => ctx.controls.clearSeason(ctx.actor, input)),
  setIftarTime: protectedProcedure(BANNER_ROLES)
    .input(SetIftarTimeInput)
    .output(SeasonView)
    .mutation(({ ctx, input }) => ctx.controls.setIftarTime(ctx.actor, input)),
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
