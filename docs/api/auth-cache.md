# Sessions and roles in memory (speed x4)

Every signed-in call checks the caller's session (`sessions` row: live, not revoked, same person and
device), and most also read the person's roles. At a full evening those two reads were a large share
of the database's work, and they compete for the same 10 database lines as sign-in.

Each API machine now keeps both in its own memory for up to **30 seconds**
(`apps/api/src/modules/identity/auth-cache.ts`).

## What makes it safe

- **Any change drops the entry at once, on every machine.** Sign-out, a refresh, a reused refresh
  token (theft signal), revoking all of a person's sessions, granting, revoking or freezing a role:
  the identity repository is the only place these are written, and each write drops what it touched
  on this machine and tells the others over Redis pub/sub (`driver:identity:auth-drop`). A write
  inside a transaction drops again after the commit.
- **A slow read never puts an old row back.** A read that started before a drop does not store what
  it got.
- **A missed message costs at most 30 seconds.** If a machine's Redis connection drops and comes
  back, it forgets everything it kept. If Redis is down, other machines keep the old entry until it
  expires.
- **Reads inside a transaction always go to the database** (sign-in, refresh, role changes see the
  current row).
- Expiry is checked on every use: a cached session past its end time is refused as before.

## Unchanged

- The private-data access log: `identity.me` still writes its `vault_access_logs` row on every call
  (Ali, 8 Oct: only the memory part of x4).
- Within one request, roles are still read once for the whole batch (CON-21).

## Setting

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_CACHE_TTL_SEC` | `30` | Seconds an entry is kept. `0` turns the cache off; anything above 30 is capped at 30. |

Without `REDIS_URL` (one machine, dev, tests) drops stay on that machine, which is all there is.

## If something looks wrong

If a signed-out phone or a removed role still works on any machine (for example, Redis was down
when the change happened), set `AUTH_CACHE_TTL_SEC=0` on the API and restart: every call reads the
database again, as before x4. The worst case without the switch is 30 seconds.
