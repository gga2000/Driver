# Courier Radar for Kitchens (SP7a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The restaurant sees every courier coming to collect: a radar around the kitchen with each courier's direction, distance and minutes, updated as he moves; a chime and a highlight when he is about to walk in; and on each order, who is coming (first name, vehicle, plate) with a 4-digit pickup code the courier shows at the counter.

**Architecture:** Server: `PositionFanout` gains a `radarFor` hook — while a courier's pickup for an order is not done, each throttled fix (≤ every 2 s) also goes to that store's `merchant:<org>` channel as `courier_radar { orderId, distanceM, bearingDeg, etaMinutes }` (no coordinates; minutes on the one ETA with the same vehicle the board uses). `BoardCourier` gains `distanceM`, `bearingDeg`, `plate`, `pickupCode`. The pickup code is `HMAC(orderId:courierId)` → 4 digits (a new courier gets a new code), shown on the partner job's pickup stop and on the kitchen's card, and written into the pickup's handover proof when the courier completes it. Merchant app: `useLiveMerchantBoard` patches radar events into the board cache; a radar strip above the columns (SVG rings at 250 m / 1 km / 3 km, north up, a dot per courier with the ticket number) and a list beside it; `useCourierArrivals` chimes once per order when he crosses 250 m or 1 minute (or arrives) with its own two-note sound; the card's courier pill turns "على وصول" and shows the code.

**Tech Stack:** zod/tRPC, NestJS, React Native + react-native-svg, expo-av / WebAudio, vitest.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.7 (r1, r2, r4).

## Decisions

1. **No coordinates to the kitchen**: distance, bearing and minutes only (spec: "distance and bearing"). The "tap for a small map" part waits for our own basemap (SP2); the radar works without tiles.
2. **Pickup code is checked by eye**: the kitchen reads the code on its card, the courier shows his; no typing, no change to who completes the pickup. The code used is stored in the pickup's handover proof (`pickupCode`) for support.
3. **No courier photo** yet (vault selfie behind a signed URL, separate change — same as the customer card).
4. **Arriving** = within `RADAR_NEAR_M` (250 m) or `etaMinutes ≤ 1`, or the stop says arrived — once per order and courier.
5. The arriving sound is new (two soft notes, distinct from the new-order chime) and follows the existing sound switch.

## Constants

| Where | Name | Value |
|---|---|---|
| contracts merchant-io | `RADAR_NEAR_M` | 250 |
| contracts merchant-io | `RADAR_RINGS_M` | [250, 1000, 3000] |
| contracts trip | `PICKUP_CODE_DIGITS` | 4 |

## Tasks

1. Contracts: `LiveCourierRadar` event; `BoardCourier` fields; `PartnerJobStop.pickupCode`; `HandoverProof.pickupCode`; constants. Tests where logic.
2. API: `pickupCode()` (shared, HMAC) + tests; `radarOf(kitchen, courier)` (distance, bearing) + tests; merchant board fills the new fields; partner job fills the code; trips stores the code on pickup completion; `PositionFanout.radarFor` + tests.
3. Merchant app: live patch; `CourierRadar` strip; card pill and code chip; `useCourierArrivals` (pure `arrivalsBetween` + tests) with the new sound (native WAV + web synth); demo hook to drive a courier to the kitchen.
4. Partner app: the pickup code on the pickup stop of the job screen.
5. Verify: typecheck/lint/tests, e2e, screenshots (tablet board with radar and arriving card; partner job with code), commit, push, CI.
