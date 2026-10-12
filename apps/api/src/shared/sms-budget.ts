/**
 * The server's daily SMS count. Sign-in codes (identity's OTP guard) and notification texts (notify's
 * SMS twins and SMS-first messages) go out through the same SMS account, so both count every accepted
 * text in one rolling 24-hour window counter under `SMS_DAY_KEY`, measured against one budget
 * (`OTP_SMS_DAILY_BUDGET`). Ops hear at 50, 80 and 100 % of it once per level per window, whichever
 * side crossed the line (`smsBudgetAlertKey`); the Console shows it; notify holds back its own backup
 * texts past it. The OTP guard's throttle never reads it: sign-in codes keep their own count, so
 * notification texts can never lock anyone out of signing in.
 */
export const SMS_DAY_KEY = 'sms:day';
export const SMS_DAY_MS = 86_400_000;
export const SMS_BUDGET_LEVELS = [50, 80, 100] as const;
export type SmsBudgetLevel = (typeof SMS_BUDGET_LEVELS)[number];
/** About 3 × the expected day-one installs (docs/api/otp-guard.md). */
export const DEFAULT_SMS_DAILY_BUDGET = 4500;

/** `OTP_SMS_DAILY_BUDGET`, or the default; a malformed value stops the boot. */
export function smsDailyBudgetFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env['OTP_SMS_DAILY_BUDGET'];
  if (raw === undefined || raw === '') return DEFAULT_SMS_DAILY_BUDGET;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`OTP_SMS_DAILY_BUDGET must be a positive integer, got "${raw}"`);
  return n;
}

/** `OTP_BUDGET_MODE=alert` (checked by the OTP guard's config) only counts and alerts; `throttle` (default) also holds texts back. */
export function smsBudgetThrottlesFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env['OTP_BUDGET_MODE'] !== 'alert';
}

/** The levels `used` texts have reached out of `budget`. */
export function smsBudgetLevelsReached(used: number, budget: number): SmsBudgetLevel[] {
  return SMS_BUDGET_LEVELS.filter((level) => used >= (budget * level) / 100);
}

/** The once-per-window marker of one budget alert: the key the OTP guard's `alertOnce` writes, which notify shares. */
export function smsBudgetAlertKey(level: SmsBudgetLevel): string {
  return `otp:guard:alerted:sms_budget:${level}`;
}
