# Tracking Moments (SP5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tracking screen has moments: the camera tells the order's story, the customer is told "almost there" (in the app and by push, with the cash to have ready), the courier is on the map with call/chat, the delivery ends in a short celebration, and a small family of soft sounds marks the steps.

**Architecture:** Server: a dropoff stop records `courier_near_at` the first time a live fix is within `NEAR_DROPOFF_M` and emits `stop.courier_near`; the notify subscriber turns it into the existing `courier_arriving` template (push + WhatsApp) and `order.picked_up` into the existing `order_picked_up` push — both templates were defined with no producer. Client: `moments.ts` derives transitions (accepted, picked up, near, delivered) from the tracking view and fix; `sound.ts` plays bundled ≤ 30 KB tones through expo-av, off when the in-app switch is off and silent under the iPhone mute switch; `AlmostThereCard` over the map; story camera rules per phase in `TrackMap` plus a prep ring around the kitchen; a floating courier chip with call/chat; a 900 ms burst on the delivered overlay. Every animation has a reduced-motion variant.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.5 (c4, c5, c6, c7, x2).

## Decisions

1. **Near = 500 m straight line** (≈ 700 m of road, about two minutes in town), not the spec's 300 m: the existing push copy and the notification prompt promise "two minutes before".
2. **Food orders only** for the near push and card (rides: the rider is the one waiting at the door already).
3. **No courier photo yet**: the card shows initials; the photo needs the vault selfie behind a signed URL (separate change; `photoUrl` stays null).
4. **Sounds**: synthesised in `scripts/dev/make-alert-sounds.mjs` (no licensing), played only while the tracking screen is open; push sounds stay the OS default.

## Tasks

1. Contracts `NEAR_DROPOFF_M`; DB `stops.courier_near_at`; trips emits `stop.courier_near` once; tests.
2. Notify: `stop.courier_near` → `courier_arriving` (customer name, courier first name, kitchen, cash amount); `order.picked_up` → `order_picked_up` (courier, arrival clock from the tracking ETA rule); tests.
3. Sounds: four tones; customer `sound.ts` (expo-av), switch in profile › notifications; tests for the preference.
4. `moments.ts` (+ tests): transitions per order; near detection from the fix; `AlmostThereCard`.
5. Celebration: burst on `ArrivalOverlay`; reduced motion on its entrances.
6. Story camera: focus and zoom per phase; prep ring around the kitchen while preparing.
7. Floating courier chip with call/chat over the collapsed sheet.
8. Verify: typecheck/lint/tests, e2e, screenshots (on the way, near, delivered), commit, push, CI.
