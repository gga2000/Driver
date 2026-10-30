# Household invites «بيتنا» — nobody joins without saying yes (SEC-06, 2026-10-08)

Before: a payer typed a phone number and that person was in the household at once — the payer saw
their spending, they saw the household's shared places, and they never agreed to it.

Now `household.inviteMember` creates an **invite**. The person joins only when they tap «انضم»; until
then the payer sees a masked number (`0770 ••• 0011`) and nothing else about them. Rules live in
`HOUSEHOLD_INVITE_RULES` (`@driver/contracts/account-io.ts`). No money rule changes.

| Rule | Value |
|---|---|
| People in a household (members + open invites) | 10 (`household_full`) |
| Invites a household may send | 10 a day (`rate_limited`, retry after 1 h) |
| An open invite lasts | 14 days, then it is gone (no row change; reads filter it out) |
| After «لا شكراً» the same household can't invite that number again | 30 days (answers as sent, nothing is shown) |

## Procedures (`household.*`)

- `inviteMember({ householdId, phone, role, spendingLimitIqd })` (payer) → `HouseholdView`. Already a
  member: nothing changes. An open invite keeps its date (re-inviting doesn't push it up the list or
  spend the daily count). An unregistered number gets a person row; the invite shows the first time
  they sign in. Events `org.household_invited`.
- `myInvites()` → `MyHouseholdInvite[]` (`householdName`, `invitedByName` = the payer's first name,
  role, limit). Read of the payer's name is logged in the vault (purpose `household_invite`).
- `respondInvite({ inviteId, accept })` → the household on accept, `null` on decline. Accept fails with
  `household_exists` (already in a household), `household_full`, or `household_invite_gone` (expired,
  cancelled, someone else's). Events `org.member_added` (with `inviteId`, `invitedBy`) or
  `org.household_invite_declined`.
- `cancelInvite({ householdId, inviteId })` (payer) → `HouseholdView`; `org.household_invite_cancelled`.
- `leave({ householdId })` (any member but the last payer) → `null`; `org.member_left`.
  `household_last_payer` for the only payer.
- `removeMember({ householdId, personId })` (payer, not on a payer) → `HouseholdView`;
  `org.member_removed`. Orders already waiting for the payer stay with the payer to decide.
- `HouseholdView.invites` — open invites (payer only; `[]` for others): `id`, `phoneHint`, `role`,
  `spendingLimitIqd`, `invitedAt`. Phone hints are vault reads (purpose `household_invite`, logged).

## Races

Every change takes a transaction lock on the household (`household:<orgId>`); accept and create also
lock the person (`household.person:<personId>`) first. So two invites for the last place give one
`household_full`, and one person accepting two households at once ends in exactly one
(`apps/api/src/modules/orgs/household-invites.integration.test.ts`, Postgres).

## Storage

`public.household_invites` (migration `20261010430000_household_invites`): one row per household and
person (`unique (org_id, person_id)`, reused on re-invite), `state pending | accepted | declined |
cancelled`, CHECKs on role and limit. No personal data: the phone stays in `identity_vault`.

## App

`app/household/index.tsx`: someone with an invite and no household sees `HouseholdInviteCard` above
«أو سوّي بيت إلك»; the payer sees «ينتظرون موافقتهم» with «اسحب الدعوة»; others see «اطلع من البيت»
(a confirm sheet). `app/household/member.tsx`: «شيل من البيت» (payer). The account row says
«عندك دعوة للعائلة» while one is open. Demo: `POST /demo/household-invite?personId=…`.

Not yet: a push or SMS telling the invited person (they see it in the app); a later notify step.
