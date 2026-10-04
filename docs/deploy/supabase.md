# Supabase: the production database (Frankfurt)

This page takes you from "I have a Supabase account" to "the Driver database is ready", step by step.
You copy values from the Supabase website into a few places. You never type SQL. The other pages:
[hosting.md](hosting.md) (API + Redis on Fly), [web.md](web.md) (customer web and the share page),
[console.md](console.md), [mobile.md](mobile.md), [runbook.md](runbook.md) (deploy, rollback,
backups, incidents, and the environment matrix).

## What Supabase is used for (and what it is not)

| Supabase feature | Used? | Why |
| --- | --- | --- |
| **Postgres database** (with PostGIS) | **Yes** | All Driver data. Only our API talks to it. |
| **Storage** (S3-compatible) | **Yes** | Photos: gate photos, menu photos, documents. Private bucket `uploads`. |
| Auth, Data API (PostgREST / GraphQL), Realtime, Edge Functions | **No** | Driver has its own sign-in (OTP), its own API and its own realtime. We switch the Data API off and lock the tables against it anyway (below). |

## Two things in the code that exist because of Supabase

1. **The identity vault is the `identity_vault` schema, not `vault`.** Every Supabase project already
   has a schema called `vault`, owned by Supabase (its "Vault" secrets feature). Our migrations used to
   create tables there, which Supabase refuses (`permission denied for schema vault`). Since migration
   `20261004210000_identity_vault_rename` our tables live in `identity_vault`; a database created with
   the old migrations is moved automatically. Supabase's own `vault` is never touched.
2. **Migration `20261004210100_supabase_hardening`** turns on row level security on every table (with no
   policies), and removes every permission Supabase's public roles (`anon`, `authenticated`, and for the
   vault also `service_role`) have on our tables. Our API connects as the owner of the tables, which row
   level security does not limit, so nothing changes for the app. What it blocks: anyone who has your
   project's public "anon" key reading data through Supabase's Data API. The function it installs,
   `driver_harden()`, runs again after every deploy so new tables are covered too.

## Step by step

### 1. Create the project (5 minutes)

1. Go to <https://supabase.com/dashboard> → **New project**.
2. **Name**: `driver-prod`. **Database password**: press **Generate a password**, then **copy it into
   your password manager now** (you need it in step 4, and Supabase will not show it again).
3. **Region**: **Central EU (Frankfurt)** — `eu-central-1`. This matters: the API runs in Frankfurt too.
4. Plan: **Pro** ($25/month) for production. It includes daily backups kept 7 days and never pauses.
   (The Free plan pauses after a week without traffic and has no backups: fine for a test project only.)
5. Press **Create new project** and wait until it says the project is ready (1–2 minutes).

### 2. Do NOT enable PostGIS yourself

Our first migration enables PostGIS in the `public` schema. If you already turned it on under
Database → Extensions, turn it **off** again before step 7 (the setup script stops and tells you if it
finds PostGIS somewhere else).

### 3. Switch off the Data API

Project Settings → **Data API** → turn off **Enable Data API** (if your project shows "Exposed schemas"
instead, remove `public` from the list). Driver does not use it. The hardening migration protects the
tables even if you skip this, but off is better than protected.

### 4. Copy the two connection strings

Press the **Connect** button at the top of the project page. You need two strings; in both, replace
`[YOUR-PASSWORD]` with the password from step 1.

| Name we use | Where in the Connect dialog | Looks like | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Transaction pooler** (port **6543**) | `postgresql://postgres.abcdefghijkl:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` | the API, all the time |
| `DIRECT_URL` | **Session pooler** (port **5432**, same host) | `postgresql://postgres.abcdefghijkl:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` | migrations, the seed, backups |

Add `?sslmode=require` to the end of both (encrypted connection). If you also do step 6, you can leave
it off — the certificate takes over.

Why two: the transaction pooler (Supavisor) lets hundreds of API requests share a few database
connections, but it cannot run migrations, which need one connection for the whole session. Use the
**session pooler** for `DIRECT_URL`, not the "Direct connection" (`db.<ref>.supabase.co`): the direct
one is IPv6-only unless you buy the IPv4 add-on, and GitHub Actions (where deploys run migrations) has
no IPv6. The user name on the pooler is `postgres.<project-ref>`, not just `postgres`.

### 5. Storage: bucket and S3 keys (for photos)

1. **Storage** → **New bucket** → name `uploads` → **Public bucket: OFF** → Create.
2. **Storage** → **Settings** (or Project Settings → Storage) → section **S3 Connection** → make sure
   "Enable connection via S3 protocol" is on → **New access key** → description `driver-api` → Create.
   Copy the **Access key ID** and the **Secret access key** (shown once).
3. On the same page copy the **Endpoint** and the **Region**.

The API needs these (the values go to the API host, [hosting.md](hosting.md)):

| Variable | Value | Secret? |
| --- | --- | --- |
| `S3_ENDPOINT` | the endpoint, e.g. `https://abcdefghijkl.storage.supabase.co/storage/v1/s3` | no |
| `S3_BUCKET` | `uploads` | no |
| `S3_REGION` | `eu-central-1` | no |
| `S3_FORCE_PATH_STYLE` | `true` | no |
| `S3_ACCESS_KEY_ID` | the access key id | **yes** |
| `S3_SECRET_ACCESS_KEY` | the secret access key | **yes** |

How it works: the app asks the API for an upload; the API returns a 15-minute presigned PUT URL straight
to the private bucket; reads go through the API's `/files/<id>` link, which redirects to a 5-minute
presigned GET ([persistence.md](../persistence.md#photo-storage-objectstorageport)). Supabase supports
presigned URLs, HEAD and ranged GET on its S3 endpoint. These keys bypass every Supabase policy: keep
them only on the API host.

### 6. (Recommended) the database certificate

Project Settings → **Database** → **SSL Configuration** → **Download certificate**. Open the file in a
text editor and copy everything, from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`.
That text is `DATABASE_CA_CERT`: with it, the API checks it is really talking to your Supabase database.
On the same page you can turn on **Enforce SSL on incoming connections**.

### 7. Run the setup script (once)

On a computer with the repository, Node 22 and pnpm (or ask whoever helps you with the code):

```bash
pnpm install
pnpm turbo run build --filter=@driver/db

export DATABASE_URL='<transaction pooler string, port 6543>'
export DIRECT_URL='<session pooler string, port 5432>'
export DATABASE_CA_CERT="$(cat ~/Downloads/prod-ca-2021.crt)"     # if you did step 6
export PHONE_HASH_PEPPER='<the same long random value the API will use — hosting.md>'
export SEED_ADMIN_PHONE='07XXXXXXXXX'                              # your own mobile: you become admin
export SEED_ADMIN_NAME='علي'

node scripts/deploy/supabase-setup.mjs
```

It does, in order, and prints each step:

1. **Preflight** — connects with `DIRECT_URL`, checks the ports, finds PostGIS in the wrong place or an
   old `vault` layout.
2. **Migrations** — `prisma migrate deploy` over `DIRECT_URL` (all of them, in order, once each).
3. **Harden** — `driver_harden()` again (RLS on, Supabase roles revoked) and this and next month's
   `trail_points` partitions.
4. **Seed (production profile)** — the 3 cities, 34 Aziziyah zones, garages and meeting points, the
   taxonomy, and the four launch restaurants with their menus. **No** demo restaurant and **no** demo
   dispatcher. Your phone (`SEED_ADMIN_PHONE`) becomes admin + dispatcher + support + finance.
5. **Verify** and print a checklist: PostGIS version, every migration applied, the identity vault exists
   and nobody but the owner can open it, row level security on every table, the `anon` /
   `authenticated` roles can read nothing, Supabase's own vault untouched, partitions present,
   append-only triggers present, seed counts, an admin exists, and the API's pooled string works.

All ✔ → the database is ready. Running it again is safe (everything is idempotent). Later, to only
check: `node scripts/deploy/supabase-setup.mjs --verify-only`.

`PHONE_HASH_PEPPER` must be **exactly** the value the API gets: phone numbers are stored as a keyed
hash, so with a different pepper the API would not recognise your number. Generate it once
(`openssl rand -hex 32`), store it in your password manager, never change it.

### If something fails

| Message | What to do |
| --- | --- |
| `password authentication failed` / `Tenant or user not found` | Wrong password, or the user is not `postgres.<project-ref>`. Copy the strings again from **Connect**. |
| `self-signed certificate in certificate chain` | Do step 6 (`DATABASE_CA_CERT`). To get unblocked only, end the URL with `?sslmode=no-verify` (encrypted, not verified). |
| `PostGIS is enabled in schema "extensions"` | Database → Extensions → postgis → off. Run the script again. |
| `DIRECT_URL is not port 6543` | You pasted the transaction pooler into `DIRECT_URL`. Use the session pooler (5432). |
| `migrate deploy` fails | The output names the migration and the SQL error; see [runbook.md](runbook.md#a-migration-failed). |
| `an admin exists ✘` | Set `SEED_ADMIN_PHONE` and `PHONE_HASH_PEPPER`, run again. |

## Backups and point-in-time recovery

- **Pro plan**: daily backups, kept 7 days, restorable from Database → Backups (one click; restores the
  whole project to that day).
- **PITR** (point-in-time recovery to any second) is a paid add-on (about $100/month for 7 days, and it
  needs a bigger compute size). Not worth it at ~100 orders/day; turn it on when a lost hour of orders
  costs more than that.
- **Our own nightly copy**: `.github/workflows/backup.yml` dumps the `public` and `identity_vault`
  schemas every night, encrypted with your passphrase. How to restore: [runbook.md](runbook.md#restore).

## Limits to keep an eye on (Pro, Micro compute)

| Limit | Value | When it matters |
| --- | --- | --- |
| Database size | 8 GB included, then $0.125/GB | `trail_points` (GPS) grows fastest; it is partitioned by month. |
| Pooler clients | ~200 on Micro | The API holds at most `DATABASE_POOL_MAX` (10) per machine. |
| Direct connections | 60 on Micro | Migrations and backups use 1 each. |
| Compute | Micro (1 GB RAM, shared) | Upgrade to Small (+~$15/month) when the API's DB time climbs (Database → Reports). |
