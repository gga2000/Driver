# Driver Map Essentials (SP6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The driver sees the real road on the offer and the job, opens his own navigation app (Google Maps or Waze, chosen once), and is asked "وصلت؟" when he has stopped at the stop — without ever arriving on his own.

**Architecture:** API: `partner.offerRoute({ offerId })` (his presence → the offer's kitchen; nothing for a ride or a door, which every driver in the wave would otherwise see) and `partner.jobRoute()` (his last fix → the job's remaining stops), both on the one routing service (`EtaService.path`). App: `DriverMap` draws the road solid when it has one, the honest dashed line otherwise; `useJobRoute` refreshes on stop change and every 2 min. `nav.ts` builds app links with web fallbacks and remembers the choice; `NavChooser` asks on the first "الخريطة" and lives in the account tab; الرجعة pickup links use it too. `useJobPositions` passes the server's `armed` stops to `arrive.ts`; `watchArrival` asks once he has been under 10 km/h inside the 60 m for 10 s; "مو بعد" holds until he leaves and comes back.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.6 (d2, d3, d4).

## Decisions

1. **Offer road to the kitchen only** (privacy): rides and drop-offs show their road after acceptance, on the job.
2. **Unknown speed counts as stopped** (web, some phones): the 10 s inside the geofence still applies.
3. **Not in this slice**: live puck from the device stream (d1, needs SP1 builds), delivery photo upload with 30-day retention (f11), demand heat (d5), الرجعة map (d7) — SP6b.

## Tasks

1. Contracts + API: `offerRoute`, `jobRoute` (+ tests: kitchen only, rides none, remaining stops in order).
2. App: road on `DriverMap`, route queries on offer and job.
3. App: `nav.ts` (+ tests), `NavChooser`, account row, iOS `LSApplicationQueriesSchemes`, الرجعة links.
4. App: `arrive.ts` (+ tests), `useAutoArrive`, `ArriveSheet`, `useJobPositions` feeds it.
5. Verify: checks, e2e, screenshots (offer road, job road, arrive sheet, chooser), commit, push, CI.
