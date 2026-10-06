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

## Slice 2 — self-fixing door points (a3)

`DOOR_RULES` (contracts place.ts: accuracy ≤ 30 m, cluster 60 m, 3 agreeing, newest 10, ≤ 150 m from the pin). `ArriveStopInput.accuracyM` → `stops.arrival_accuracy_m` (migration `20261006170000_stop_arrival_accuracy`; a tap without a fix uses the last trail point's accuracy). `stop.completed` carries `door { placeId, lat, lng, accuracyM }` for drop-offs at saved places; `SavedPlacesService` subscribes (`places:door-learning`) and `learnDoor` keeps one sample per drop-off in `places.arrival_samples` (own writer, never overwritten by an owner's edit). `doorPoint` = median of the cluster, null until 3 agree; samples far from the current pin are ignored (moving the pin forgets the old door). Orders get `dropoff.door` from `deliveryPlace` (a client's door is dropped); dispatch's drop-off stop targets the door (navigation and the 60 m geofence), the customer's pin is unchanged. `SavedPlaceView.doorConfirmed` ("الباب مأكّد" on the place screen), `PartnerDoor.doorConfirmed` (chip on the job). The partner app sends the fix accuracy with "وصلت" (also when replayed offline).

## Slice 3 — pin picker (a1) and which gate (a4)

The ride screen's `PinPicker` moves to `features/places/PinPicker` and replaces tap-to-drop in the place editor (move the map under the pin; "my location" draws its GPS accuracy ring until the map is moved by hand). Entrance: `places.entrance` JSONB (migration `20261006171000_place_entrance`), `SavePlaceInput.entrance`, `UpdatePlaceInput.entrance` (null clears), `SavedPlaceView.entrance`, `PLACE_ENTRANCE_MAX_M` = 150 (`place_entrance_too_far`; a pin moved further forgets it). `deliveryPlace` door = entrance ?? learned door. `PartnerDoor.entranceSet` ("الزبون أشّر باب الدخول"). Editor: optional "باب الدخول" step with a green-pin map from the pin and "شيل".
