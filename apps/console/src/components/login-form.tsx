'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { errorText } from '@/lib/network';
import { setSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { BrandMark } from './shell/brand';
import { Button, Field, IconAlert, IconBack, IconCheckCircle, Input } from './ui';

/** The fake SMS provider's last code is shown in development (the API refuses it in production). */
const SHOW_DEV_OTP = process.env.NODE_ENV !== 'production' || process.env['NEXT_PUBLIC_DEV_OTP'] === '1';

/**
 * Sign-in, centred on the cream page with the Driver mark (K-19): phone, then the 6-digit code. In
 * development a dashed strip under the code box shows the fake SMS's last code with "عبّيه".
 */
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
        router.replace('/');
      },
    }),
  );
  const devOtp = useQuery(trpc.identity.devLastOtp.queryOptions({ phone }, { enabled: SHOW_DEV_OTP && step === 'code', refetchInterval: 3_000, retry: false }));

  const onRequest = (e: FormEvent) => {
    e.preventDefault();
    request.mutate({ phone: phone.trim(), purpose: 'login' });
  };
  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate({ phone: phone.trim(), code });
  };
  const back = () => {
    setStep('phone');
    setCode('');
    request.reset();
    verify.reset();
  };

  const error = request.error ?? verify.error;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandMark size={52} />
          <p className="mt-3 text-[22px] font-bold leading-8 tracking-[-0.01em]">{t('console.brand')}</p>
          <p className="text-dense text-muted">{t('console.brand_sub')}</p>
        </div>

        <section aria-labelledby="login-title" className="rounded-xl border border-line bg-surface p-7 shadow-pop">
          {step === 'phone' ? (
            <>
              <h1 id="login-title" className="text-xl font-bold">
                {t('console.login_title')}
              </h1>
              <p className="mt-1 text-sm text-muted">{t('console.login_subtitle')}</p>
              <form onSubmit={onRequest} className="mt-6 space-y-4">
                <Field label={t('onboarding.phone_label')} htmlFor={phoneId} hint={t('onboarding.phone_hint')}>
                  <Input
                    id={phoneId}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    dir="ltr"
                    required
                    autoFocus
                    minLength={7}
                    maxLength={20}
                    placeholder={t('onboarding.phone_placeholder')}
                    className="num h-12 text-base"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={request.isPending} disabled={phone.trim().length < 7}>
                  {t('onboarding.send_otp')}
                </Button>
              </form>
            </>
          ) : (
            <>
              <button type="button" onClick={back} className="-ms-1 mb-3 inline-flex items-center gap-1 rounded-md text-dense text-muted hover:text-text">
                <IconBack size={16} />
                {t('console.login_change_phone')}
              </button>
              <h1 id="login-title" className="text-xl font-bold">
                {t('console.login_code_title')}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {t('console.login_code_sent')}{' '}
                <bdi dir="ltr" className="num font-semibold text-text">
                  {request.data?.phoneMasked ?? phone}
                </bdi>
              </p>
              <form onSubmit={onVerify} className="mt-6 space-y-4">
                <Field label={t('console.login_code_label')} htmlFor={codeId}>
                  <Input
                    id={codeId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    dir="ltr"
                    required
                    autoFocus
                    className="num h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </Field>

                {SHOW_DEV_OTP && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-warn/60 bg-warn-tint/50 px-3 py-2 text-dense" role="status">
                    <span className="text-text">
                      <span className="font-semibold text-warn">{t('console.login_dev_label')}</span>{' '}
                      {devOtp.data?.code ? (
                        <>
                          {t('console.login_dev_code_short')}{' '}
                          <bdi dir="ltr" className="num font-semibold tracking-[0.15em]">
                            {devOtp.data.code}
                          </bdi>
                        </>
                      ) : (
                        t('console.login_dev_waiting')
                      )}
                    </span>
                    {devOtp.data?.code && (
                      <Button size="sm" onClick={() => setCode(devOtp.data?.code ?? '')}>
                        {t('console.login_dev_fill')}
                      </Button>
                    )}
                  </div>
                )}

                <Button type="submit" variant="primary" size="lg" className="w-full" loading={verify.isPending} disabled={code.length !== 6}>
                  {t('console.login_enter')}
                </Button>
                <p className="text-center text-dense text-muted">
                  {t('console.login_no_code')}{' '}
                  <button type="button" className="rounded-md font-semibold text-accent-text underline-offset-4 hover:underline disabled:opacity-50" disabled={request.isPending} onClick={() => request.mutate({ phone: phone.trim(), purpose: 'login' })}>
                    {t('onboarding.otp_resend')}
                  </button>
                </p>
              </form>
            </>
          )}

          {verify.isSuccess && (
            <p className="mt-4 flex items-center gap-2 text-sm text-ok" role="status">
              <IconCheckCircle size={16} />
              {t('console.login_done')}
            </p>
          )}
          {error && (
            <p className="mt-4 flex items-start gap-2 text-sm text-bad" role="alert">
              <IconAlert size={16} className="mt-0.5 shrink-0" />
              {errorText(error)}
            </p>
          )}
        </section>
        <p className="mt-5 text-center text-xs text-muted">{t('console.login_staff_only')}</p>
      </div>
    </div>
  );
}
