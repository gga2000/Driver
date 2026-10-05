# Delivery Photo, Busy Zones, الرجعة Run Map (SP6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The courier's door photo reaches support (and is gone after 30 days); the driver's home map shows where the work is; the الرجعة driver sees his pickup run on a map.

**Architecture:** f11: the partner app uploads the photo with a `places.photoUpload` ticket and sends `handover.photoUploadId`; `trips.completeStop` accepts only the courier's own stored upload (`HANDOVER_PHOTOS` port over the places blob store); support's `TicketOrderView.handoverPhotoUrl` signs it; `HandoverPhotoRetention` deletes photos 30 days after delivery (`photoPurgedAt` stays). d5: `partner.demandMap` = per zone the waiting jobs + the average pickups of this coming hour over the last 4 weeks (trips' pickup stops by zone, cached 5 min per city) vs online drivers → hot / warm / calm; `HeatLayer` fills busy zones under the puck on the home map, every minute. d7: the departure screen gets a `DriverMap` with the garage (name and seats taken/total) and numbered pickups in the run's order.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.6 (f11, d5, d7).

## Decisions

1. **No photo, no failure**: with no network the photo stays on the phone (noted) and the drop-off is still saved for later.
2. **Forecast from trips' pickup stops** (orders carry no zone of their own); a 1-hour window on the same weekday, 4 weeks back.
3. **Run map is straight and honest**: the الرجعة pickups are a short town run; a road shape can follow with OSRM.

## Tasks

1. Contracts: `HandoverProof.photoUploadId / photoPurgedAt`, `HANDOVER_PHOTO_RETENTION_DAYS`, `handover_photo_invalid`, `TicketOrderView.handoverPhotoUrl`, `PartnerDemandMap`, `DEMAND_MAP_RULES`, `partner.demandMap`.
2. API: photo check, `handoverPhotoUrl`, `purgeHandoverPhotos` + retention job (+ tests); `pickupsByZone`, `demandZones`, `forecastWindows`, `demandMap` (+ tests).
3. Apps: partner upload on handover; Console support photo; `HeatLayer` on the home map; run map on the departure screen; numbered and garage pins.
4. Verify: checks, e2e, screenshots, commit, push, CI.
