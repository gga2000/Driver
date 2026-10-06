# Driver photos and خطوط child photos

Ali, 2026-10-06: **every driver has one approved main photo shown to customers; guardian-added child
photos are seen only by that child's خطوط driver.** Decision recorded at the end of
`docs/specs/2026-10-03-edge-case-decisions.md`.

## Where the photos live

| What | Stored | Who reads it |
|---|---|---|
| Driver main photo | `identity_vault.person_identities.main_photo_ref` (+ `main_photo_at`): the upload of his latest **approved** `photo` driver document | Customers on his card, the driver himself, Console reviewers |
| A driver's photo under review | the vault's `document_refs` entry of that `photo` document (as for every paper) | The driver himself, Console reviewers |
| A child's photo | `identity_vault.child_identities.photo_ref` | The guardian; the driver of the child's run (and the substitute once the run is his) |

The bytes are uploads in the places blob store (`places.photoUpload` → signed PUT, magic bytes checked),
read only through short-lived signed URLs (`/files/<id>?exp&sig`, valid 1–2 hours; absolute when
`UPLOADS_PUBLIC_ORIGIN` is set, else relative to the API origin — apps resolve them). Migration
`20261006181000_driver_main_photo` adds the columns and backfills the main photo of drivers whose
`photo` document was already approved.

Every read outside the owner is a `vault_access_logs` row: `main_photo` (purposes `courier_card`,
`intercity_driver_card`, `share_trip`), `child_photo` (purpose `khat_today_run`, against the guardian,
with the `childRef`).

## Driver main photo

The main photo **is** the `photo` driver document (the personal photo onboarding already asks for).

State machine (`mainPhotoState`, from his latest `photo` document):

```
none ──send──▶ pending ──approve──▶ approved
                  │                    │ send a new one → pending (the approved one stays shown)
                  └──reject(reason)──▶ rejected (the previous approved one, or his initial, stays shown)
```

Only approving promotes a photo (`IdentityService.promoteMainPhoto`, in the review's unit of work). A
reviewer never decides on his own photo (`forbidden` / `approval_own_item`).

### Procedures

| Procedure | Who | What |
|---|---|---|
| `driverAccount.mainPhoto` (query) | driving roles, own only | `{ state, approved: {url, approvedAt} \| null, latest: {documentId, status, url, submittedAt, reviewedAt, rejectReason} \| null }` |
| `driverAccount.setMainPhoto({ uploadId })` | driving roles | Upload first (`places.photoUpload`); creates a pending `photo` document (replaces a pending or rejected one) → returns the view. `upload_invalid` for someone else's or an unstored upload |
| `approvals.list` / `approvals.decide` (`kind: 'driver_document'`) | field ops, support, admin | The queue titles it «الصورة الرئيسية» · «تبين للزبائن بعد الموافقة», next to his approved photo, ID and latest check-in selfie; reject presets include «الوجه مو واضح…» |
| `driverAccount.uploadDocument({ kind: 'photo' })` | driving roles | Same as `setMainPhoto` (the documents screen opens the photo screen instead) |

### Where customers see it

`photoUrl` (nullable; null → the app draws the initial) on:

- `orders.track` → `courier` (food courier card, ride match card, driver-here / almost-there cards)
- `routes.driverCards` (الرجعة board, seat sheet, boarding pass, claimed seat) and the request board's
  offers (`RequestOfferDriver`)
- `tracking.shared` → `driverPhotoUrl` (the public share page)

## خطوط child photos

| Procedure | Who | What |
|---|---|---|
| `khat.guardian.children` (query) | any signed-in person | His own children: `{ childRef, name, photoUrl }[]` (others' never) |
| `khat.guardian.setPhoto({ childRef, uploadId })` | the child's guardian | Adds or replaces it (the replaced photo's bytes are deleted). `forbidden` for anyone else, `not_found` for an unknown child, `upload_invalid` for an upload that isn't his |
| `khat.guardian.removePhoto({ childRef })` | the child's guardian | Clears it and deletes the bytes; the driver sees the initial again |
| `khat.todayRun` / `tapIn` / `tapOut` / … | the run's driver | Each child row: `child: { childRef, firstName, photoUrl }` |

Strict rules: the photo goes to the run's own driver only (`trips.forDriver` / `ownRun`: the assigned
driver, or the substitute once dispatch gave him the run); never to another driver, the Console, share
pages or notifications. Events `child.photo_set` / `child.photo_removed` carry the `childRef` only.

## Apps

- Partner: `/photo` («صورتك الرئيسية»: what customers see, the latest one's state, camera or gallery
  with a face-framing circle, preview, send); the account tab shows the approved photo and the state;
  the documents list's personal photo opens it. خطوط rows show the child's photo.
- Customer: driver cards resolve the signed URL (`apiPhoto`); العائلة / الحساب → «أطفال الخطوط»
  (`/household/children`) when he has a child registered.
- Console: approvals queue as above.

## Demo

- Partner demo: every driver has an approved drawn portrait; courier's new photo «تنتظر الموافقة»,
  tuktuk's «مرفوضة» with a reason, rookie none. `POST /demo/account/photo?who=…&decision=approve|reject`
  decides the waiting one. Three khat children (زينب، حسن، مريم) have a guardian photo. Shots:
  `SHOTS=photo` (`scripts/shots/main-photo.mjs`).
- Customer demo: couriers (every other one), ride and الرجعة drivers have approved photos (one الرجعة
  driver keeps the initial); `POST /demo/account?personId=…` adds two خطوط children, one with a photo.
- Console demo: مرتضى's new photo waits next to his approved one; عباس's first photo waits.
- Portraits: `scripts/dev/demo-avatar.mjs` (drawn PNG per seed, no dependencies).
