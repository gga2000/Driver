'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { errorText } from '@/lib/network';
import { setSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';

/** The fake SMS provider's last code is shown in development (the API refuses it in production). */
const SHOW_DEV_OTP = process.env.NODE_ENV !== 'production' || process.env['NEXT_PUBLIC_DEV_OTP'] === '1';

export function LoginForm() {
  const trpc = useTRPC();
  const router = useRouter();
  const phoneId = useId();
  const codeId = useId();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const request = useMutation(trpc.identity.requestOtp.mutationOptions({ onSuccess: () => setStep('code') }));
  const verify = useMutation(
    trpc.identity.verifyOtp.mutationOptions({
      onSuccess: (res) => {
        setSession(res.tokens);
        router.replace('/pricing');
      },
    }),
  );
  const devOtp = useQuery(
    trpc.identity.devLastOtp.queryOptions({ phone }, { enabled: SHOW_DEV_OTP && step === 'code', refetchInterval: 3_000, retry: false }),
  );

  const onRequest = (e: FormEvent) => {
    e.preventDefault();
    request.mutate({ phone: phone.trim(), purpose: 'login' });
  };
  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate({ phone: phone.trim(), code });
  };

  const error = request.error ?? verify.error;

  return (
    <section className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-surface p-6 shadow-card md:mt-16">
      <h1 className="font-display text-2xl font-bold">{t('console.login_title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('console.login_subtitle')}</p>

      {step === 'phone' ? (
        <form onSubmit={onRequest} className="mt-6 space-y-4">
          <div>
            <label htmlFor={phoneId} className="mb-1.5 block text-sm text-muted">
              {t('onboarding.phone_label')}
            </label>
            <input
              id={phoneId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              required
              minLength={7}
              maxLength={20}
              placeholder={t('onboarding.phone_placeholder')}
              className={inputCls}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-faint">{t('onboarding.phone_hint')}</p>
          </div>
          <button type="submit" className={primaryBtn} disabled={request.isPending || phone.trim().length < 7}>
            {request.isPending ? t('status.loading') : t('onboarding.send_otp')}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="mt-6 space-y-4">
          <p className="text-sm">{t('onboarding.otp_sent_to', { phone: request.data?.phoneMasked ?? phone })}</p>
          <div>
            <label htmlFor={codeId} className="mb-1.5 block text-sm text-muted">
              {t('console.login_code_label')}
            </label>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              dir="ltr"
              required
              autoFocus
              className={`${inputCls} text-center font-mono text-lg tracking-[0.4em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>

          {SHOW_DEV_OTP && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-accent/60 px-3 py-2 text-xs text-accent" role="status">
              <span>
                {devOtp.data?.code ? t('console.login_dev_code', { code: devOtp.data.code }) : t('console.login_dev_none')}
              </span>
              {devOtp.data?.code && (
                <button type="button" className="rounded-md px-2 py-1 font-semibold underline" onClick={() => setCode(devOtp.data?.code ?? '')}>
                  {t('console.login_dev_fill')}
                </button>
              )}
            </div>
          )}

          <button type="submit" className={primaryBtn} disabled={verify.isPending || code.length !== 6}>
            {verify.isPending ? t('status.loading') : t('action.confirm')}
          </button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <button
              type="button"
              className="rounded-md text-muted underline hover:text-text"
              onClick={() => {
                setStep('phone');
                setCode('');
                request.reset();
                verify.reset();
              }}
            >
              {t('console.login_change_phone')}
            </button>
            <button type="button" className="rounded-md text-muted underline hover:text-text disabled:opacity-50" disabled={request.isPending} onClick={() => request.mutate({ phone: phone.trim(), purpose: 'login' })}>
              {t('onboarding.otp_resend')}
            </button>
          </div>
        </form>
      )}

      {verify.isSuccess && (
        <p className="mt-4 text-sm text-ok" role="status">
          {t('console.login_done')}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-bad" role="alert">
          {errorText(error)}
        </p>
      )}
    </section>
  );
}

const inputCls = 'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-faint';
const primaryBtn =
  'w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50';
