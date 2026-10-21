// طرود on the courier's job (features/parcel): the pickup photo at the sender's (saved, and a failed
// upload with its retry), then at the receiver's door the receipt code, a wrong code with the tries
// left, «رفضت تستلم»'s second confirmation with who pays the trip back, the right code, and the refusal.
//
//   SHOTS=parcel node scripts/web-shots.mjs <out-dir>          (SHOTS_LOOK=night for the night look)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doorPng } from '../door-photo.mjs';

export const name = 'parcel';

const COURIER = '0770 111 0001';

export default async function run(s) {
  const c = await s.signIn(COURIER);
  const photo = join(mkdtempSync(join(tmpdir(), 'parcel-shot-')), 'parcel.png');
  writeFileSync(photo, doorPng());
  /** Taps the photo button and answers the web file picker (the camera on a phone). */
  const pick = async (id) => {
    const chooser = c.page.waitForEvent('filechooser');
    await c.byTestId(id).click();
    await (await chooser).setFiles(photo);
  };
  const show = async (id) => {
    await c.wait(id);
    await c.byTestId(id).scrollIntoViewIfNeeded();
  };

  // At the sender's: what it is, and «صوّر الطرد عند الاستلام».
  await s.demoPost('/demo/parcel?who=courier&step=at_pickup');
  await c.goto('/job');
  await show('parcel-photo-take');
  await c.shot('pickup-photo', { settle: 1500 });
  await pick('parcel-photo-take');
  await show('parcel-photo-saved');
  await c.shot('pickup-photo-saved');
  // A failed upload says so and offers a retry (the ticket call refused here).
  await c.page.route('**/trpc/places.photoUpload**', (r) => r.abort());
  await pick('parcel-photo-retake');
  await show('parcel-photo-retry');
  await c.shot('pickup-photo-failed');
  await c.page.unroute('**/trpc/places.photoUpload**');

  // At the receiver's door: who pays, the code pad, «رفضت تستلم» under it.
  const job = await s.demoPost('/demo/parcel?who=courier&step=at_dropoff');
  await c.goto('/job');
  await show('parcel-collect');
  await c.byTestId('parcel-card').scrollIntoViewIfNeeded();
  await c.shot('door', { settle: 1500 });
  await show('parcel-pin');
  await c.shot('door-pin');
  const wrong = job.pin === '1111' ? '2222' : '1111';
  for (const d of wrong) await c.byTestId(`pin-key-${d}`).click();
  await show('parcel-pin-wrong');
  await c.shot('door-pin-wrong');
  await c.byTestId('parcel-refuse').scrollIntoViewIfNeeded();
  await c.byTestId('parcel-refuse').click();
  await show('parcel-refuse-amounts');
  await c.byTestId('parcel-refuse-confirm').scrollIntoViewIfNeeded();
  await c.shot('refuse-confirm');
  await c.byTestId('parcel-refuse-no').click();
  // No network: the code needs the server, said plainly, the pad resting.
  await c.context.setOffline(true);
  await show('parcel-pin-offline');
  await c.shot('door-pin-offline');
  await c.context.setOffline(false);
  await c.page.waitForTimeout(800);

  // The right code: the normal hand-over follows.
  for (const d of job.pin) await c.byTestId(`pin-key-${d}`).click();
  await show('parcel-pin-verified');
  await c.shot('door-verified');

  // A refusal on another parcel: «رجّع الطرد للمرسل».
  await s.demoPost('/demo/parcel?who=courier&step=at_dropoff&payer=sender');
  await c.goto('/job');
  await show('parcel-refuse');
  await c.byTestId('parcel-refuse').click();
  await show('parcel-refuse-amounts');
  await c.byTestId('parcel-refuse-yes').click();
  await show('parcel-returning');
  await c.shot('refused');
  await c.close();
}
