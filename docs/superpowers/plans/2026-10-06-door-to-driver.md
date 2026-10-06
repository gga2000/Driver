# The Customer's Door to the Driver (SP3d, f6 + a5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer orders to one of their saved places, the courier on the job sees that place's door photos and standing note, and on a first delivery there, "أول توصيلة لهالبيت — اتصل قبل لا توصل" with a call button. The photo opens full screen by itself when he arrives.

**Architecture:** The missing link was the order → stop → place chain: nothing set `Stop.placeId`. `DeliveryPoint.placeId` (optional, JSON on the order, no migration); `OrdersService.place` keeps it only when `SavedPlacesService.usableBy` (owner, or household-shared) — otherwise the link is dropped and pin/zone stay. Dispatch's `TripsAdapter` copies it to the drop-off stop. `PartnerJobStop.door { placeNote, photos (signed), firstVisit }` from `SavedPlacesService.courierDoor` (domain §7 `courierMaySeePlaceDetails`: assigned courier, accepted → completed + 1 h) and `TripsService.dropoffsAt(placeId, excludeTripId) === 0`. Customer app: `deliveryPointOf` sends the id of server-synced places. Partner app: `DoorCard` on the drop-off stop.

**Demo:** `POST /demo/job?who=courier&step=to_dropoff&door=1` (buyer's saved home in الزكور with a drawn door photo and a note).

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.3 (f6, a5). Next slices: a3 self-fixing door point + "الباب مأكّد", a1 pin picker in the place editor + a4 which gate, a2 landmark chips, driver zone confirmation.

## Tasks

1. Contracts: `DeliveryPoint.placeId`, `PartnerDoor`, `PartnerJobStop.door`.
2. API: `usableBy`, `courierDoor` (+ tests); orders `ORDERS_PLACES` port + `placeLink` (+ test); dispatch adapter copies `placeId`; trips `dropoffsAt` (Prisma + memory); partner `places` dep + `doorsOf` (+ test).
3. Customer: `deliveryPointOf` sends `placeId` for synced places (+ test).
4. Partner: `DoorCard` (first-visit banner + call, note, thumbnails, full-screen viewer, opens on arrival); copy.
5. Verify over the wire with the demo (done: door note, signed photo, firstVisit true), typecheck, lint, tests, commit, push, CI.
