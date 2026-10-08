// Staff section (wave 2): مطعم خالد's team. خالد (owner, the demo login), مصطفى (staff, also at الحاج
// كريم), علي (staff), زينب on the till and أبو حيدر the second owner — all signed in — plus two invites still
// waiting for a first sign-in (one never set a name).
//
//   POST /demo/staff/reset      back to this team (undo invites/removals from a shot run)
const TEAM = [
  { phone: '07801112233', name: 'زينب', role: 'merchant_staff', verify: true },
  { phone: '07802223344', name: 'أبو حيدر', role: 'merchant_owner', verify: true },
  { phone: '07803334455', name: 'كرار', role: 'merchant_staff', verify: false },
  { phone: '07804445566', name: null, role: 'merchant_staff', verify: false },
];

export default async function register(ctx) {
  const { identity } = ctx.services;
  const { khalid } = ctx.stores;
  const SYSTEM = { personId: 'system:demo' };

  async function signIn(phone) {
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    return (await identity.verifyOtp({ phone, code })).personId;
  }

  // The owner and مصطفى have signed in on their phones (not "waiting").
  await signIn(ctx.people.owner.phone);
  await signIn(ctx.people.multi.phone);
  await signIn(ctx.people.ali.phone);

  const ids = [];
  async function seed() {
    for (const m of TEAM) {
      const id = await identity.ensurePersonByPhone(m.phone, 'system:demo', 'demo');
      if (m.name)
        await identity.updateProfile({ personId: id, sessionId: 'demo' }, { name: m.name });
      for (const kind of ['merchant_owner', 'merchant_staff'])
        await identity
          .revokeRole(SYSTEM, { personId: id, kind, orgId: khalid.orgId })
          .catch(() => undefined);
      await identity.grantRole(SYSTEM, { personId: id, kind: m.role, orgId: khalid.orgId });
      // Signed in after the role was given: a member, not a waiting invite (review 2026-10-04 #6).
      if (m.verify) {
        await new Promise((r) => setTimeout(r, 5));
        await signIn(m.phone);
      }
      ids.push(id);
    }
  }
  await seed();

  ctx.route('/demo/staff/reset', async () => {
    // Anyone added during a shot run is dropped; the seeded team comes back.
    const holders = await identity.orgRoleHolders(khalid.orgId, ['merchant_owner', 'merchant_staff']);
    const keep = new Set([ctx.people.owner.id, ctx.people.multi.id, ctx.people.ali.id]);
    for (const h of holders) if (!keep.has(h.personId)) await identity.revokeRole(SYSTEM, { personId: h.personId, kind: h.kind, orgId: khalid.orgId }).catch(() => undefined);
    ids.length = 0;
    await seed();
    return { team: ids.length + 3 };
  });
}
