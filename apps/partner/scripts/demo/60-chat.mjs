import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Chat and masked calls on the job screen (notifications & support §2).
//
//   POST /demo/chat?who=courier[&step=to_dropoff]   a food job at `step` (via /demo/job) with both
//                                                   conversations going → {orderId, tripId}
//
// The customer (the `buyer` persona) has written about the gate and sent a quick reply; the kitchen
// (سيف, staff at مطعم خالد) said the order is ready, and the customer left a 4-second voice note (ride
// ideas n7/n8; scripts/dev/demo-voice-note.m4a through the real upload store). Everything goes through
// the real ChatService, so the badges, read receipts and quick replies on the courier's screens are the API's.
export default async function register(demo) {
  const { ChatService } = await demo.load('modules/chat/index.js');
  const chat = demo.app.get(ChatService);
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const blobs = demo.app.get(BLOB_STORE);
  const clip = readFileSync(fileURLToPath(new URL('../../../../scripts/dev/demo-voice-note.m4a', import.meta.url)));
  /** The demo clip as `ownerId`'s own finished voice upload → upload id. */
  async function voiceNote(ownerId) {
    const ticket = await blobs.createUpload({ ownerId, contentType: 'audio/mp4', sizeBytes: clip.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'audio/mp4', bytes: clip });
    return ticket.uploadId;
  }
  const { identity } = demo.services;
  const as = (personId) => ({ personId, sessionId: 'demo' });
  let n = 0;
  const cid = () => `demo-${Date.now().toString(36)}-${++n}`;

  const staffId = await demo.person({ key: 'kitchen', phone: '07712990002', name: 'سيف' });
  await identity.grantRole({ personId: 'system:demo', sessionId: 'demo' }, { personId: staffId, kind: 'merchant_staff', orgId: demo.restaurants.khalid.orgId }).catch(() => undefined);

  demo.route('/demo/chat', async ({ req, res, query }) => {
    const p = demo.who(query);
    const step = query.step ?? 'to_dropoff';
    // Reuse the core section's job builder over the wire (same process).
    const r = await fetch(`http://${req.headers.host}/demo/job?who=${encodeURIComponent(query.who ?? '')}&personId=${encodeURIComponent(query.personId ?? '')}&step=${step}`, { method: 'POST' });
    if (!r.ok) throw new Error(`/demo/job: ${r.status} ${await r.text()}`);
    const { orderId, tripId } = await r.json();
    const buyer = demo.people.get('buyer').personId;

    await chat.send(as(p.personId), { orderId, kind: 'merchant_courier', clientId: cid(), quickReplyKey: 'courier_at_restaurant' });
    await chat.send(as(staffId), { orderId, kind: 'merchant_courier', clientId: cid(), quickReplyKey: 'merchant_ready' });
    await chat.send(as(staffId), { orderId, kind: 'merchant_courier', clientId: cid(), text: 'البيبسي بالكيس الثاني، لا تنساه' });

    await chat.send(as(p.personId), { orderId, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_on_the_way' });
    await chat.markRead(as(buyer), { orderId, kind: 'customer_courier', seq: 1 });
    await chat.send(as(buyer), { orderId, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'customer_other_gate' });
    await chat.send(as(buyer), { orderId, kind: 'customer_courier', clientId: cid(), text: 'الباب الأخضر يم جامع الرسول، دگ الجرس مرتين' });
    await chat.send(as(buyer), { orderId, kind: 'customer_courier', clientId: cid(), voiceUploadId: await voiceNote(buyer), durationSec: 4 });
    demo.json(res, 200, { orderId, tripId, step });
  });
}
