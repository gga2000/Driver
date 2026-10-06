# Share a Delivery with the Family (SP3c, first slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer's "شارك" on a food (or shop, errand, parcel) order sends a link the family at home can open without the app: the store's name, the courier's first name and vehicle, the courier moving on the map with the road to the store and then to the door, and the same arrival time the customer sees. Before, it sent `/order/<id>`, which only the customer can open.

**Architecture:** `ShareSubject` gains `delivery`; `SharedTrip.storeName` (the store's business name, null for rides and intercity). `ShareLinksService.deliveryState`: preparing → `waiting`; a courier accepted → `to_pickup` (target: the pickup stop, the store); collected (order mark, or the pickup stop completed — the order's mark lands after the trip's event) → `on_trip` (target: the door); delivered (order mark, or the drop-off stop completed) → `arrived`, link lasts 30 minutes after. ETA from `TrackingService.liveEta` through the `SHARE_DELIVERY_ETA` port, so the family and the customer see one time. Live: the order's channel, like rides. Customer app: the order screen's share uses the link and the share sheet for every order; the public page and the share sheet word a delivery as an order ("الطلب بالطريق", "الدليفري", "من مطعم خالد"), the store pin is the kitchen pin.

**Privacy:** same as rides: no phone, no full name, no address in words, and nothing about what was ordered (tested).

Spec: `docs/specs/2026-10-05-maps-world-class.md` (open gap noted after SP5c: "food-order share link posts /order/<id>").

## Tasks

1. Contracts: `ShareSubject.delivery`, `SharedTrip.storeName`, docs.
2. API: `deliveryState`, `state()` dispatcher, `tripOf`, ports `TRACKING_MERCHANTS` and `SHARE_DELIVERY_ETA`; tests (journey and cancel).
3. Customer: order screen share; `SharePanel` delivery copy; share page and map wording; copy (ar-IQ + en).
4. Verify: typecheck, lint, tests; commit, push, CI. Screenshots blocked (Console Ninja build hook in `@expo/cli` stalls Metro).
