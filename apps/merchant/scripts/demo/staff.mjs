// Staff section (wave 2): مطعم خالد's team. خالد (owner, the demo login), مصطفى (staff, also at الحاج
// كريم), علي (staff), زينب on the till and أبو حيدر the second owner — all members — plus two invites still
// waiting to be accepted (PRV-08: an invite gives no role until the person accepts; one never set a name).
//
// Invites the other way (the invitee's side, «<store> يدعوك تشتغل وياهم»):
//   0770 444 0000  no store yet, invited to مطعم خالد → the "no access" screen shows the invite
//   0770 999 0000  مصطفى (picker) is also invited to a third store → the store picker shows it
//
//   POST /demo/staff/reset      back to this team and these invites (undo invites/removals/answers from a shot run)
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

  const { MerchantAdminService } = await ctx.load('modules/merchant-admin/index.js');
  const admin = ctx.app.get(MerchantAdminService);
  const ownerActor = { personId: ctx.people.owner.id, sessionId: 'demo' };
  const scope = { merchantOrgId: khalid.orgId };

  // A third store whose owner invites مصطفى (so the picker shows an invite next to his two stores).
  const third = ctx.stores.all.find((s) => s.orgId !== khalid.orgId && s.orgId !== ctx.stores.kareem.orgId);
  const thirdOwner = await identity.ensurePersonByPhone('07706660000', 'system:demo', 'demo');
  await identity.updateProfile({ personId: thirdOwner, sessionId: 'demo' }, { name: 'أبو سيف' });
  if (third) await identity.grantRole(SYSTEM, { personId: thirdOwner, kind: 'merchant_owner', orgId: third.orgId });
  const invitee = await identity.ensurePersonByPhone('07704440000', 'system:demo', 'demo');
  await identity.updateProfile({ personId: invitee, sessionId: 'demo' }, { name: 'حسين' });

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
      if (m.verify) {
        // Already accepted: a member.
        await identity.grantRole(SYSTEM, { personId: id, kind: m.role, orgId: khalid.orgId });
        await signIn(m.phone);
      } else {
        // Invited, not accepted yet: no role, a waiting row on the owner's team.
        await admin.staffInvite(ownerActor, { ...scope, phone: m.phone, role: m.role });
      }
      ids.push(id);
    }
    await admin.staffInvite(ownerActor, { ...scope, phone: '07704440000', role: 'merchant_staff' });
    if (third) await admin.staffInvite({ personId: thirdOwner, sessionId: 'demo' }, { merchantOrgId: third.orgId, phone: ctx.people.multi.phone, role: 'merchant_staff' });
  }
  await seed();

  ctx.route('/demo/staff/reset', async () => {
    // Anyone added during a shot run is dropped, waiting invites cancelled; the seeded team comes back.
    const holders = await identity.orgRoleHolders(khalid.orgId, ['merchant_owner', 'merchant_staff']);
    const keep = new Set([ctx.people.owner.id, ctx.people.multi.id, ctx.people.ali.id]);
    for (const h of holders) if (!keep.has(h.personId)) await identity.revokeRole(SYSTEM, { personId: h.personId, kind: h.kind, orgId: khalid.orgId }).catch(() => undefined);
    for (const row of await admin.staffList(ownerActor, scope)) if (row.pending) await admin.staffRemove(ownerActor, { ...scope, personId: row.personId });
    if (third) {
      await identity.revokeRole(SYSTEM, { personId: ctx.people.multi.id, kind: 'merchant_staff', orgId: third.orgId }).catch(() => undefined);
      await admin.staffRemove({ personId: thirdOwner, sessionId: 'demo' }, { merchantOrgId: third.orgId, personId: ctx.people.multi.id }).catch(() => undefined);
    }
    ids.length = 0;
    await seed();
    return { team: ids.length + 3 };
  });
}
