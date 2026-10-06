# Live Fleet, Drag to Assign, At-Risk Ring (SP8b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Console's dispatch and map pages the fleet moves smoothly and points where it is going, quiet drivers fade, couriers with a likely-late order pulse, and dropping an order on a driver sends it after a 3-second undo.

**Architecture:** `DriverPin.heading` comes from presence (the driver's own movement). `live-map.ts` carries heading and last-seen on each driver feature. `LiveMapCanvas` glides each pin from where it is drawn to the new fix over 1.8 s in one animation loop (`glideAt`, eased; instant under reduced motion), shows a heading arrow, fades pins with no fix for 45 s (`isQuiet`) and rings `atRiskDrivers` (`useAtRiskDrivers`: `orders.atRisk` → live trips → courier). Dispatch: a drop picks the driver, shows "نرسل الطلب لـ … بعد N ثانية · تراجع" and then calls the same send as the button (blockers still ask for a reason).

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.8 (o1, o3, o4 halo).

## Decisions

1. **Shared file, own lines only**: `live-map-canvas.tsx` also carries the zones switch-over in progress (uncommitted, another session); this change touches separate regions and is committed on its own.
2. **o5 (zone heat + "send drivers here")** follows separately: it needs a message to drivers on the server.

## Tasks

1. API: presence heading on `DriverPin`.
2. Console: `lib/fleet-motion.ts` (+ tests), `lib/at-risk.ts`, live-map feature props, canvas glide / arrow / quiet / ring, styles, dispatch undo.
3. Verify: checks, screenshots (arrows, ring, undo bar), commit, push, CI.
