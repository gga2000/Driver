// Smoke-checks a running demo API over the wire (the same calls the app makes):
//   node apps/partner/scripts/demo-check.mjs [who=courier]
// Signs in as the persona, prints partner.status, then exercises /demo/offer and /demo/job.
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer as superjson } from '@driver/contracts';

const base = (process.env.DEMO_API ?? 'http://127.0.0.1:3301').replace(/\/$/, '');
const phones = { courier: '07701110001', tuktuk: '07701110002', intercity: '07701110003', khat: '07701110004', customer: '07701110009' };
const who = process.argv[2] ?? 'courier';

const anon = createTRPCClient({ links: [httpBatchLink({ url: `${base}/trpc`, transformer: superjson })] });
await anon.identity.requestOtp.mutate({ phone: phones[who] });
const { code } = await anon.identity.devLastOtp.query({ phone: phones[who] });
const { tokens } = await anon.identity.verifyOtp.mutate({ phone: phones[who], code, device: { fingerprint: `check-${who}-xxxx`, platform: 'web' } });
const api = createTRPCClient({ links: [httpBatchLink({ url: `${base}/trpc`, transformer: superjson, headers: { authorization: `Bearer ${tokens.accessToken}` } })] });
const post = async (path) => {
  const r = await fetch(`${base}${path}`, { method: 'POST' });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${body.error}`);
  return body;
};

console.log('status', JSON.stringify(await api.partner.status.query()));
if (who === 'courier' || who === 'tuktuk') {
  console.log('offer', await post(`/demo/offer?who=${who}&kind=${who === 'tuktuk' ? 'ride' : 'food'}`));
  console.log('currentOffer', JSON.stringify(await api.partner.currentOffer.query()));
}
if (who === 'courier') {
  console.log('batch', await post('/demo/offer?who=courier&kind=batch'));
  console.log('currentOffer(batch)', JSON.stringify(await api.partner.currentOffer.query()));
  console.log('job', await post('/demo/job?who=courier&step=at_dropoff'));
  console.log('activeJob', JSON.stringify(await api.partner.activeJob.query()));
  console.log('status', JSON.stringify(await api.partner.status.query()));
  await post('/demo/clear?who=courier');
}
