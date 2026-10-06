# Landmark Address Chips (maps a2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People here give directions by landmarks. When a customer saves a place, the editor offers the approved landmarks near the pin as chips («يم تقاطع شارع 30», «يم كراج البوابة 2»); the one chosen is stored on the place, and the courier on a job to that place reads «قرب X» on the door card.

**Architecture:** One landmark list for every reader. `cityLandmarks` (`apps/api/src/modules/places/landmarks.ts`) merges the seed (`AZIZIYAH_LANDMARKS`, ids `lm_<key>`) with approved landmark places (`PlacesService.landmarks`, behind the narrow `LEARNED_LANDMARKS` port), names with Western digits; `places.landmarks` ("وين رايح؟"), `places.landmarksNear`, saved places and the courier's door all read it through `SavedPlacesService.landmarks`, so an id means the same landmark everywhere. `nearestLandmarks` keeps those within `PLACE_LANDMARK_MAX_M` (500 m), nearest first (ties by id), at most `PLACE_LANDMARK_CHOICES` (5), with whole-metre `distanceM`. The place stores `places.landmark_id` (migration `20261006180000_place_landmark`, nullable TEXT, no foreign key — seeded landmarks are not rows).

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.3 "Landmark address (a2)".

## Decisions

- **Validated on the server** against the pin after the edit: unknown or farther than 500 m → `place_landmark_invalid`. An app can send any id; a far «قرب» sends the courier astray.
- **The house moves, the landmark follows the rule of the entrance (a4):** a pin moved by hand or by "موقعي هنا" farther than 500 m from it forgets it; a small nudge keeps it. `null` clears it.
- **A landmark that disappears** (an approved place withdrawn) stays stored but shows as none on the place and the job — it may come back, and nothing breaks meanwhile.
- **Views read the landmark list only when a place has one** (`viewsOf` loads each city once for `mine`).
- **Courier sees the Arabic name** (`PartnerDoor.landmark`), as people here say it; the card shows when any of note, photos, door confirmed, entrance or landmark is set.
- **Editor:** the step is optional and quiet — hidden with no pin, when nothing is within 500 m, on a load error, or when signed out; a skeleton while loading. Single choice with «ولا وحدة». If the pin moves and the settled list for the new pin no longer has the chosen landmark, the editor drops it rather than have the save refused. The edit screen sends `landmarkId` only when it changed, so an untouched one is left to the server's own pin-move rule.
- `places.landmarks` names now carry Western digits too (one list); search already folds digits.

## Tasks

1. Contracts: `PLACE_LANDMARK_MAX_M`, `PLACE_LANDMARK_CHOICES`, `PlaceLandmark` (head of `LandmarkView`), `SavedPlaceView.landmark`, `SavePlaceInput.landmarkId`, `UpdatePlaceInput.landmarkId` (null clears), `LandmarksNearInput` / `LandmarkNearView`, `places.landmarksNear`, `PartnerDoor.landmark`, error `place_landmark_invalid` (+ copy).
2. DB: migration `20261006180000_place_landmark`, `Place.landmarkId` (`landmark_id`); repository columns.
3. API: `landmarks.ts` (`cityLandmarks`, `nearestLandmarks`) + tests; `SavedPlacesService` save/update/confirm/view/courierDoor/landmarks/landmarksNear + tests (near kept and named, far/unknown refused, null clears, pin move forgets, gone shows none); `PlacesRpc` delegates; partner port; e2e over the wire; integration round trip.
4. Customer: `useLandmarksNear`, `landmark-chips.ts` (+ test), `LandmarkStep` in the place editor, `edit.tsx` mapping and update.
5. Partner: «قرب X» line with the map-pin icon on `DoorCard`.
6. Demo: `savedHome()` asks `landmarksNear` for الزكور and sets the nearest one; none is within 500 m today (all seeded ones are ~2.5 km away), so it is skipped until field ops approve one there.
