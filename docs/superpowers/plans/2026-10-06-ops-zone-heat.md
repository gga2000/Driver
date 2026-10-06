# Busy Zones and "Send Drivers Here" (SP8c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Console map shows where orders outnumber drivers, and a dispatcher can nudge the free drivers around a busy zone with one tap.

**Architecture:** The busy-zone rule (`demandZones`, `forecastWindows`, `WAITING_STATUSES`) moves to contracts so the driver's home map (d5) and the Console share it. `dispatch.zoneDemand({ cityId })` = per zone the board's waiting jobs + the usual pickups of this coming hour (same weekday, 4-week average, cached 5 min) + online drivers → hot / warm / calm. `dispatch.nudgeZone({ cityId, zoneId })` (dispatchers) picks up to 15 free drivers within 4 km of the zone and not in it, emits `dispatch.zone_nudged`; the notify subscriber sends each one a `partner_zone_nudge` push ("طلبات هواي بـ …"); at most once per zone per 10 minutes (`nudge_too_soon`). The Console map fills busy zones in the accent with a bold outline (from the shapes on the map), and the zone panel shows the numbers with "ابعث سواق هنا".

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.8 (o5).

## Decisions

1. **Cooldown per API instance** (in memory): with several instances a zone could be nudged once per instance in 10 minutes; acceptable for a nudge, revisit if it is abused.
2. **Only free drivers outside the zone** are nudged (those inside are already there).

## Tasks

1. Contracts: `demand.ts`, `NUDGE_RULES`, `NudgeZoneInput/Result`, `dispatch.zoneDemand`, `dispatch.nudgeZone`, `nudge_too_soon`, `partner_zone_nudge`.
2. API: `ZoneDemandService` (+ tests), notify subscriber (+ test).
3. Console: heat fill + outline on the live map, legend, `ZoneDemandPanel`.
4. Verify: checks, screenshots, commit, push, CI.
