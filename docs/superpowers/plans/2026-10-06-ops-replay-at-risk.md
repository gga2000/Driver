# Order Replay and Late-Before-Late (SP8a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ops replays any order's courier path from the order page, and sees live orders that will miss their promise before they do.

**Architecture:** o2: `orders.replay({ orderId })` (Console read roles) = every trip that carried the order with its stored trail (`trips.trailOf`, thinned to 3,000 points), the order's stops and the moments that matter (accepted, near, arrived, completed…, never a quarantined replay); `trailPurged` once the trips are past the trail's 30 days. The Console order page gets `OrderReplay`: a MapLibre map (path faint, driven part bright, courier dot, kitchen and door), play/pause at 10× / 30× / 60× real time, a scrub slider and the moments as chips that jump there. o4: `orders.atRisk({ cityId })` = live deliveries whose one ETA (`liveEta` from his last fix) lands more than 2 minutes after the promise (`promisedArrival`), worst first, one prediction per order per 30 s. The orders list shows "متوقع +N د" where an order is not yet late; the order header shows the same chip.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.8 (o2, o4).

## Decisions

1. **Speeds are real-time multiples** (10×, 30×, 60×): a 30-minute delivery replays in 3 min, 1 min or 30 s. The spec's "1×–16×" read as multiples of real time would be too slow to be useful.
2. **At-risk needs a live fix**: an order without a courier or a fix is judged by the existing "late" rule only.
3. **Map-side pieces wait** (o1 smooth fleet, o3 drag to assign, o4's pulsing halo on the map, o5 heat): the live map is being changed by the zones switch-over in parallel.

## Tasks

1. Contracts: `OrderReplay`, `REPLAY_RULES`, `AtRiskOrder`, `AT_RISK_RULES`, `orders.replay`, `orders.atRisk`.
2. API: `trailForTrip`, `trailOf`, `tripIdsForOrder`; `ConsoleReadService.orderReplay` (+ pure `thinPoints`, `replayMarks`, `trailPurged` tests); `TrackingService.atRisk` (+ test).
3. Console: `lib/replay.ts` (+ tests), `replay-map.tsx`, `order-replay.tsx` on the order page; at-risk chip in the list and the header.
4. Verify: checks, e2e, screenshots, commit, push, CI.
