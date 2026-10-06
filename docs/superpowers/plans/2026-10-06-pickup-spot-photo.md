# Pickup-Spot Photo (maps program r7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restaurant's owner adds up to 2 photos of where couriers collect orders (the takeaway window, the side door) and a short note («الاستلام من الشباك اليسار»). The courier on a job sees them on the pickup stop until he has picked up — the kitchen's version of the customer's door card. Approved by Ali.

**Architecture:** The spot lives on the restaurant's org row, next to the kitchen pin it describes (`orgs.pickup_note`, `pickup_photo_refs`, `pickup_updated_at`). The merchant module owns reading and writing it (`merchant.pickupSpot` / `merchant.setPickupSpot`) and exposes `MerchantService.courierPickupSpot` for couriers, which applies the customer's door rule (`courierMaySeePlaceDetails` from places — reused, not copied). Photos are uploads in the places blob store (`places.photoUpload` ticket + PUT), read only through signed links, behind an optional `MERCHANT_PHOTOS` port (fakes keep working). The partner read side gets an optional `pickupSpots` dep and fills `PartnerJobStop.pickupSpot` on pickups not completed or skipped. The Partner app shows `PickupSpotCard`; the photo strip and full-screen viewer are pulled out of `DoorCard` into `PlacePhotos.tsx` and shared by both cards. The Merchant app gets «مكان الاستلام» under المزيد.

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.7 (r7).

## Constants (`PICKUP_SPOT_RULES`, packages/contracts merchant-io.ts)

| Rule | Value | Why |
|---|---|---|
| `maxPhotos` | 2 | The door and the counter behind it; more is a gallery the courier won't scroll. |
| `noteMaxChars` | 140 | A glance on the job card, not a paragraph. |

## Decisions

1. **Stored on `orgs`, not the catalog storefront.** The org row already holds the pickup pin (`location_pin`) couriers are sent to; the storefront JSON is customer-facing. Three additive columns, no new table (so no `driver_harden` line). Migration `20261006191000_pickup_spot`.
2. **Upload ids, never URLs**, like saved places' gate photos: signed, hour-stable read links; the photos are not public.
3. **Replace semantics.** `setPickupSpot` sends the whole spot. Ids already on it stay (another owner may have uploaded them); a new id must be the caller's own stored upload (`ownsStoredUpload`, now shared with خطوط child photos) or `upload_invalid`; ids left out are deleted from storage. No note and no photos clears the spot.
4. **Owner edits, staff read** — same split as opening hours. Event `merchant.pickup_spot_set {photos, note}` on the store's stream.
5. **Who sees it:** only the assigned courier, from accepting until an hour after the trip (`courierMaySeePlaceDetails`, the door rule), and only on a pickup not completed or skipped. Once the food is in his bag the card disappears. Offers never carry it (every driver in a wave sees an offer).
6. **No auto-open on arrival** (the door card does open its photo on arrival): at the counter the courier needs the 4-digit pickup code on screen, not a photo over it.
7. **Merchant upload flow:** a picked photo uploads at once (reusing `menu/photo.ts` `pickPhotos` / `uploadPhoto` and `usePhotoUpload`), the draft shows the local file, and nothing reaches couriers until «احفظ». An upload dropped before saving stays an orphan upload (same as the menu editor).
8. No money rules touched.

## API

| Procedure | Roles | Input | Output |
|---|---|---|---|
| `merchant.pickupSpot` | owner or staff of the store | `{merchantOrgId}` | `PickupSpotView {merchantOrgId, note, photos[{id,url}], canEdit, updatedAt}` |
| `merchant.setPickupSpot` | owner (staff `FORBIDDEN`) | `{merchantOrgId, note ≤ 140 \| null, photoIds ≤ 2, unique}` | `PickupSpotView` |

`partner.activeJob`: `PartnerJobStop.pickupSpot {note, photos[{id,url}]} | null` (additive, optional). Documented in `docs/api/partner-merchant-wave2.md`.

## Tasks

- [x] **Contracts:** `PICKUP_SPOT_RULES`, `PickupSpotPhoto`, `PickupSpotView`, `SetPickupSpotInput`, `MerchantPort.pickupSpot/setPickupSpot`, router procedures; `PartnerPickupSpot` + `PartnerJobStop.pickupSpot`. Role-gate and input-validation cases in `routers/wave2.test.ts`.
- [x] **DB:** `Org.pickupNote`, `pickupPhotoRefs`, `pickupUpdatedAt`; migration `20261006191000_pickup_spot`; `prisma generate`.
- [x] **Orgs:** `MerchantSettings.pickupSpot` (`MerchantPickupSpot`), Prisma read/patch, in-memory default; persistence integration test round-trips it.
- [x] **Places:** `ownsStoredUpload` helper (used by merchant and khat modules).
- [x] **Merchant module:** `MERCHANT_PHOTOS` port bound to the blob store; `pickupSpot`, `setPickupSpot`, `courierPickupSpot`; tests: save/read, staff and other stores refused, someone else's upload refused, replace deletes dropped photos, empty clears, no photo store, courier rule (other courier, not accepted, cancelled, long after, store without a spot).
- [x] **Partner module:** optional `pickupSpots` dep (bound to `MerchantService`), `pickupSpotsOf` on pickups still to do (one read per kitchen); tests: shown on the pending pickup only, gone after pickup, none without the dep.
- [x] **Partner app:** `PlacePhotos.tsx` (strip + viewer) shared by `DoorCard` and the new `PickupSpotCard`; card on the pickup stop in `app/job.tsx`; copy `partner.pickup_spot_title`, `partner.pickup_spot_photo_open` (ar-IQ + en).
- [x] **Merchant app:** `app/pickup-spot.tsx` → `features/pickup/PickupSpotScreen.tsx` (loading, error + retry, empty, read-only for staff, upload spinner, limit message), pure `logic.ts` with tests, `queries.ts`; المزيد tile; `guard.ts` section; copy in `locales/ar.json` + `en.json`.
- [x] **Demo:** partner demo gives مطعم خالد a drawn takeaway window (`pickupWindowPng` in `scripts/door-photo.mjs`, PNG encoder shared with the door) and a note, so `POST /demo/job?who=courier&step=to_pickup` shows the card (checked over the wire: pickup stop carries the spot, the signed photo serves `image/png`, `to_dropoff` shows none). Merchant demo seeds the same and adds `POST /demo/pickup/reset|clear`.
- [x] **Docs:** API doc section, app READMEs, this plan.

## Open questions

- Should field ops be able to set the pickup spot from the Console / onboarding visit (they photograph the shop anyway)?
- Show the photo to the courier on the *offer* too? Today no (an offer goes to every driver in a wave); the kitchen is not personal data, so it could be allowed later.
