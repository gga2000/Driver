# Persistence: what lives where

Every repository in `apps/api` has an in-memory twin (tests, the simulator, the demo API) and a Prisma
implementation. The module's factory picks one by `DATABASE_URL` (`PrismaService.configured`); Redis-backed
stores pick by `REDIS_URL`. This page lists every store and which one is bound when a database **is**
configured, so a state holder that silently stays in memory (and loses data on restart) is visible.

## Audit (2026-10-04, fixed by migration `20261004120000_persist_orgs_places`)

Stores that stayed **in memory even with `DATABASE_URL` set**:

| Module | Store | What was lost on restart | Status |
| --- | --- | --- | --- |
| orgs | `OrgsService` private maps (`orgs`, `approvals`) | merchant orgs created by field ops, members, merchant settings (busy mode, open / early close, printer status, auto-accept, pause windows, prep time, commission tier, kitchen location), households, member limits, payer approvals. Seeded restaurants were rows in `orgs` that `OrgsService.get` never read, so `orders.place` refused them in DB mode | **fixed**: `OrgsRepository` (`InMemoryOrgsRepository` / `PrismaOrgsRepository`) |
| places | `SAVED_PLACES_REPOSITORY` bound to `InMemorySavedPlacesRepository` unconditionally | customers' saved places, labels, confirmations, household sharing, gate-photo refs | **fixed**: `PrismaSavedPlacesRepository` on `places` |
| places | `PlacesService` private map | learned places and the landmark layer (ops landmark picker) | **fixed**: `PlacesRepository` (`InMemoryPlacesRepository` / `PrismaPlacesRepository`) on `places` + `place_photos` |
| places | `DevBlobStore` (upload records + bytes in maps; bytes on disk only with `UPLOADS_DIR`) | every photo upload record (gate photos, menu / shop photos, documents, evidence), so `upload_invalid` after a restart | **fixed**: `uploads` table (`PrismaUploadRecords`) + `ObjectStoragePort` (dev disk/memory or S3-compatible) |
| ops | merchant onboarding drafts | the onboarding row was persisted, but the draft merchant org it points at was in memory | **fixed** with orgs (settlement mode was already in `merchant_settlements`) |

Already Prisma-backed with a database: catalog, dispatch offers, driver account, events/outbox, fleet,
identity (+ vault), khat, ledger and merchant settlement settings, merchant-admin, ops (photos, cash
receipts, onboardings, tasks), orders, promotions, routes, trips, courier vehicles. Redis-backed with
`REDIS_URL`: dispatch store and geo index, BullMQ queues, OTP rate limits.

Still in memory with a database (known gaps, not part of this change):

| Module | State | Effect of a restart |
| --- | --- | --- |
| support | `SupportService.tickets` | open tickets are dropped (incidents themselves are events) |
| ledger | `AdjustmentService.pending` | unapproved adjustment requests are dropped; nothing was posted (documented safe failure) |
| identity | `IdentityService.phoneChanges` | an in-flight number change must be restarted (OTP-length window) |
| caches | `MerchantService.names`, `TrackingService.cards`, `LedgerIncidents.known`, `SessionService.keys`, `StaticCapProfiles` | caches / derived only; rebuilt on demand |

## Tables

| Store | Tables | Notes |
| --- | --- | --- |
| `PrismaOrgsRepository` | `orgs`, `org_members`, `payer_approvals` | Merchant settings are columns on `orgs` (`busy_until`, `closed_*`, `printer_*`, `default_prep_min`, `commission_tier`, `location_zone_key` + `location_pin geography(Point)` with a GIST index). `pause_windows` NULL = the city's seeded windows. Member names and phones stay in `identity_vault.person_identities`; `org_members` holds person ids only. |
| `PrismaSavedPlacesRepository` | `places` (`label` NOT NULL) | `pin geography(Point)` (GIST), `zone_key`, `photo_refs` (upload ids, never URLs), `confirmed_at`, `share_with_household`, `client_ref` (unique per owner). |
| `PrismaPlacesRepository` | `places` (`label` NULL) + `place_photos` | Learned places and landmarks; `nearby` uses `ST_DWithin` on the GIST index. |
| `PrismaUploadRecords` | `uploads` | Owner person id, declared type and size, state, object key. Bytes live in object storage. |

## Photo storage (`ObjectStoragePort`)

`BLOB_STORE` (`ObjectBlobStore`) keeps the record in `uploads` (or memory) and the bytes behind
`ObjectStoragePort`:

- **S3-compatible** (`S3ObjectStorage`, Supabase Storage / Cloudflare R2 / MinIO) when `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are all set (`S3_REGION`, default `auto`;
  `S3_FORCE_PATH_STYLE`, default `true`). `places.photoUpload` returns a presigned PUT (15 min, signed
  `content-type`) straight to the private bucket. The first `get` of a pending upload checks the object
  (HEAD for size, first bytes for the image magic) and marks it stored, or deletes it. Reads keep the API's
  signed `/files/:id` URL (stable within the hour); it answers with a 302 to a 5-minute presigned GET.
- **Dev** (`DevObjectStorage`) otherwise: bytes in memory, and on disk under `UPLOADS_DIR` when set; the API
  serves `PUT /uploads/:id` and `GET /files/:id`. With a database but neither S3 nor `UPLOADS_DIR`, the API
  logs a warning at boot: records survive a restart, the bytes do not.

## Seed

`pnpm db:seed` writes the day-1 launch restaurants (`AZIZIYAH_RESTAURANTS`: مطعم خالد، مشويات الحاج كريم،
مأكولات الشام، مطعم المسافر) and the demo restaurant as orderable merchant orgs: kitchen zone + pin, prep time,
commission tier `base`, Friday-prayer pause window, settlement row, storefront and sectioned menu. Re-running
updates in place. The launch playbook plans 10 restaurants but names only these four; the other six are
added through field-ops onboarding (`ops.merchantOnboarding`), which now creates a persisted org.

## Tests

`apps/api/src/persistence.integration.test.ts` boots `AppModule` twice on the same database (nothing else
shared) and reads back merchant settings, households and approvals, saved places with their gate photo,
landmarks and upload records, then places an order with a seeded restaurant.
`apps/api/src/modules/places/object-storage.test.ts` checks the S3 presigned URLs against an independent
SigV4 computation on a fake endpoint (no network).
