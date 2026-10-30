import { router } from 'expo-router';
import type { SetupStep } from '@driver/contracts';
import { useCashAccount } from '@/features/money/queries';
import { useT, type TKey } from '@/lib/i18n';
import { STEP_HREF } from './logic';
import { setupSession } from './queries';

/** «فلوسك توصلك …» in the words the money screen uses (the way field ops set it). */
export function usePayoutLine(storeId: string | null, owner: boolean): string | null {
  const t = useT();
  const cash = useCashAccount(storeId, owner);
  return cash.data ? t(`merchant.money.mode_${cash.data.mode}` as TKey) : null;
}

/** Opens a step's screen. */
export function openStep(step: SetupStep) {
  router.push(STEP_HREF[step]);
}

/** «بعدين»: back to the board; setup stays one tap away on its card. */
export function setupLater() {
  setupSession.landed = true;
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

