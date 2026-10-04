import { router } from 'expo-router';
import { profile } from './profile';

/**
 * Guest browsing (audit C-18): the phone number is asked only when it is needed ("كمّل الطلب",
 * "احجز", "خبرني"). Remembers where the person was going and opens the phone screen; after OTP (and
 * setup for a new account) the root guard brings them back there.
 */
export async function requireSignIn(returnTo: string): Promise<void> {
  await profile.setReturnTo(returnTo);
  router.push('/phone');
}
