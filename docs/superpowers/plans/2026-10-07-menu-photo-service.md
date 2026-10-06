# Menu Photo Service (maps program k3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restaurant asks for its dishes to be photographed. Field ops see the request in the Partner app, set a visit, shoot each dish through the app and hand the photos over; the owner accepts or rejects each photo in the Merchant app, and an accepted photo becomes the dish's photo. The Console sees the queue. Approved by Ali.

**Architecture:** A new API module `menu-photos` (own tables, own port `MenuPhotosPort` on `ctx.menuPhotos`) sits between three audiences: `merchantAdmin.menuPhotos.*` (the store), `ops.menuPhotos.*` (field ops, plus the read-only Console `queue`). It reads the menu through `CatalogService`, the store through `OrgsService`, the photographer's first name through `IdentityService.firstNamesFor` (logged vault read), and keeps photos as blob-store upload ids (`places.photoUpload`). Accepting calls `CatalogService.replacePhoto(orgId, itemId, 'upload:<id>')` — the same write and the same `item.photo_replaced` event as the owner's own photo edit — so nothing about how menus show photos changes. Handing over emits `menu_photos.shot`; the notify subscriber turns it into the merchant push `menu_photos_ready` («صور المنيو جاهزة»).

Spec: `docs/specs/2026-10-05-maps-world-class.md` §5.7 (k3).

## Constants (`MENU_PHOTO_RULES`, packages/contracts menu-photos-io.ts)

| Rule | Value | Why |
|---|---|---|
| `maxItems` | 80 | Bigger than any Aziziyah menu; none named = the whole menu. |
| `noteMaxChars` | 200 | «الأفضل الصبح قبل الزحمة» and a bit more. |
| `maxScheduleAheadDays` | 14 | A visit further out is a mistake, not a plan. |
| `scheduleGraceMin` | 60 | He may set the visit on arrival («بعد ساعة» chips, or a minute late). |
| `historyLimit` | 10 | The store's screen: the running request plus recent closed ones. |
| `queueLimit` | 200 | Console list and the Partner list per city. |

## Decisions

1. **The owner accepts; nothing goes live by itself.** Today a menu photo is whatever the owner (or staff) uploads in the item editor, live at once. Here the photographer is not the merchant, so each photo is a proposal until the owner says yes; a rejected photo is deleted. (Customers' menus only change with the owner's yes.)
2. **Owner acts, staff read.** The brief said owner/manager; the merchant roles are only `merchant_owner` and `merchant_staff`, so it is the owner (same split as opening hours and the pickup spot). Field ops can't decide for the merchant (`forbidden`); the merchant can't hand over (`ops.*` is field ops / admin only).
3. **States:** `requested → scheduled → shot → done | cancelled`. One open request per store (`menu_photo_request_open`). Every move is a guarded update (`menu_photo_state_conflict` when another phone moved it first).
4. **Who holds a visit:** setting the visit takes an unassigned request; a colleague's request is read only (`menu_photo_taken`); an admin can move anyone's visit without taking it over. Shooting a request with no visit takes it on the spot (visit = now): someone in the shop needs no appointment first.
5. **Photos:** one per dish per request (`menu_photo_shots`, unique `(request_id, item_id)`); a re-shoot replaces it and deletes the old upload. Uploads must be the caller's own finished upload (`ownsStoredUpload`, `upload_invalid`) and the dish must be on the request (`menu_photo_item_not_listed`). Cancelling deletes the photos taken so far.
6. **Done** when no photo of the visit is left undecided (the last accept/reject closes it).
7. **Visit time in the Partner app** is four one-tap chips (in an hour rounded to the quarter, this afternoon while ahead, tomorrow 10:00, tomorrow 16:00, Baghdad time), not a date picker.
8. **Console:** a read-only «تصوير المنيو» card under the approvals queue (open first, oldest first; who has the visit and when). No Console workflow: assigning is done by field ops themselves.
9. **Notification:** `menu_photos_ready`, push only, category `work`, to the store's owners, deep link `driver-merchant://menu-photos`. No WhatsApp template (nothing worth a paid message). Field ops are not pushed on a new request; they see the count on the Ops home tile.
10. **Free.** No fee exists for this anywhere, so none was added (open question for Ali).

## Data (migration `20261007161000_menu_photo_service`)

- `menu_photo_requests` (id, org_id, city_id, requested_by_id, note, item_ids text[], state, assigned_ops_id, scheduled_for, shot_at, closed_at, closed_by_id, created_at, updated_at); indexes `(org_id, created_at)`, `(city_id, state)`.
- `menu_photo_shots` (id, request_id, item_id, upload_id, state proposed/accepted/rejected, taken_by_id, decided_by_id, decided_at, created_at, updated_at); unique `(request_id, item_id)`.
- Ends with the `driver_harden` call (new tables).

## API

- `merchantAdmin.menuPhotos.list | request | cancel | decide` (merchant roles; owner-only actions in the service).
- `ops.menuPhotos.open | get | schedule | addShot | markShot` (field ops, admin); `ops.menuPhotos.queue` (dispatcher, support, finance, admin, field ops).
- Errors: `menu_photo_request_open`, `menu_photo_not_found`, `menu_photo_state_conflict`, `menu_photo_taken`, `menu_photo_no_shots`, `menu_photo_item_not_listed`, `menu_photo_schedule_invalid`.
- Events on the store's stream: `menu_photos.requested | scheduled | shot_added | shot | accepted | rejected | done | cancelled`, plus `item.photo_replaced {via: 'menu_photo_service'}` on accept.

## Tasks

- [x] Contracts: `menu-photos-io.ts`, routers, `AppContext.menuPhotos`, error codes, `menu_photos_ready` template; router role/input tests.
- [x] DB: Prisma models + migration (after every existing one; outside the reserved 1300–1559 range).
- [x] API module `menu-photos` (repository in memory + Prisma, service, module, wiring in app and tRPC); `itemPhotoUrl` shared from merchant-admin; notify subscriber; service tests (state machine, roles, uploads, accept sets the item photo, Console queue).
- [x] Merchant app: «تصوير المنيو» under المزيد (`app/menu-photos.tsx`, `src/features/menu-photos/`), guard section, locales; pure logic + tests.
- [x] Partner app: Ops tile, `app/ops/menu-photos.tsx` list, `app/ops/menu-shoot.tsx` shoot screen, `MenuPhotoParts.tsx`; logic helpers (visit chips, dish counts, hand-over gate) + tests; shared copy in packages/i18n.
- [x] Console: `menu-photo-queue.tsx` on the approvals page, `lib/menu-photos.ts` + test.
- [x] Demo: partner — an open request for مطعم خالد (`/demo/menu-photos/reset`); merchant — a handed-over shoot with 3 drawn plates (`reset | scheduled | clear`).

## Open questions for Ali

1. Should a shoot ever cost the restaurant money? Built free (no fee exists).
2. Should field ops get a push when a restaurant asks? Today they see the count on the Ops home.
3. Customer menus pass a merchant-uploaded photo through as `upload:<id>` without signing it (`catalog.rpc` / `storefront.ts` `menuItemView`) — true for the owner's own photo edit before this feature too, so accepted photos show in the Merchant app but not yet on the customer menu. Needs its own fix (sign `upload:` refs in the customer read).
