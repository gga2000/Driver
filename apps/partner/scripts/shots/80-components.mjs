// Shared-component shots (S-05, S-12): the OTP cells, the "لا يفوتك طلب" pre-prompt and two modal
// sheets (the cash hand-over code, a document upload) as the Partner app draws them. Uses numbers the
// other modules don't sign in with right before (one OTP per number per minute).
export const name = 'components';

export default async function run(s) {
  // The OTP screen (signed out).
  const p = await s.openPage();
  await p.goto('/');
  await p.wait('welcome-start', 30_000);
  await p.byTestId('welcome-start').click();
  await p.page.locator('[data-testid="phone-input"]').fill('0770 111 0009');
  await p.byTestId('phone-submit').click();
  await p.wait('otp-dev-strip');
  await p.shot('otp', { settle: 900 });
  await p.close();

  // The notification pre-prompt on the work home (tuktuk driver): asked when he goes online (f4).
  const tk = await s.signIn('0770 111 0002', { prePrompt: true });
  await tk.wait('online-switch');
  await tk.byTestId('online-switch').click();
  await tk.page.getByTestId('check-go').click({ timeout: 4000 }).catch(() => undefined);
  await tk.wait('push-preprompt');
  await tk.shot('push-preprompt', { settle: 1200 });
  await tk.byTestId('push-preprompt-later').click();
  await s.demoPost('/demo/clear?who=tuktuk');

  // Modal sheet: the hand-over code from the earnings tab.
  await tk.goto('/earnings');
  await tk.wait('handover-cta');
  await tk.byTestId('handover-cta').click();
  await tk.wait('handover-sheet');
  await tk.shot('handover-sheet', { settle: 1200 });

  // Modal sheet: a document upload.
  await tk.goto('/documents');
  // His licence (12 days left) always has «جدّد»; the registration may already be sent by the earnings run.
  await tk.wait('doc-licence-action');
  await tk.byTestId('doc-licence-action').click();
  await tk.wait('upload-sheet');
  await tk.shot('upload-sheet', { settle: 900 });
  await tk.close();
}
