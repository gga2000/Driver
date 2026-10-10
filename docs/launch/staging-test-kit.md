# Staging test kit: one person tries every side

No screen can make a staging test number a courier, a driver or a restaurant owner yet (that is the
admin-only `identity.grantRole`, and drivers also need a registered vehicle, which only a fleet owner
can add). So on staging a tester could only ever be a customer. **Actions → Staging test kit** fixes
that for three fixed numbers in the test range (`docs/api/staging-test-numbers.md`):

| Number | Becomes |
| --- | --- |
| 0770 000 0150 | owner of the four seeded restaurants (مطعم خالد, مشويات الحاج كريم, مأكولات الشام, مطعم المسافر) |
| 0770 000 0151 | courier + taxi driver, white Hyundai Elantra `TEST-151`: food and taxi offers |
| 0770 000 0152 | courier + tuktuk driver, Bajaj `TEST-152`: food, errands, parcels and tuktuk offers |

Any other test number (e.g. 0770 000 0101) is the customer: it needs nothing.

1. Sign in once with each number (partner app for 0151/0152, restaurant website for 0150). Until the
   kit runs they see "not active yet": that is expected.
2. Actions → **Staging test kit** → Run workflow → `give`. Approve it when GitHub asks.
3. Sign out and back in (or wait 30 seconds and reopen the app): the roles are there.

`undo` takes back exactly what the kit gave and parks its two vehicles. Running it again is safe. It
refuses to run outside the `staging` environment and never touches a number outside the test range.
The kit writes straight to the staging database (`scripts/staging/test-kit.mjs`); it is a test tool,
never a way to make real partners: real couriers, drivers and shops go through the Console.
