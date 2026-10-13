'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { SecondStep } from '@driver/contracts';
import { t } from '@driver/i18n';
import qrcode from 'qrcode-generator';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Field, IconAlert, IconBack, IconCopy, Input, Skeleton } from './ui';

/** Like the SMS code strip: the demo API (STAFF_TOTP_DEMO) hands out the code; a deployed server never does. */
const SHOW_DEMO_CODE = process.env.NODE_ENV !== 'production' || process.env['NEXT_PUBLIC_DEV_OTP'] === '1';

/**
 * Admin and finance sign-in's second step (docs/api/staff-totp.md), after the SMS code:
 * - `enrol` (first time): the QR code for the authenticator app plus the key as text, confirmed with
 *   one code, then the 8 recovery codes, shown this once;
 * - `code`: the app's current 6-digit code, or one recovery code.
 * The server holds every admin and finance procedure shut until this passes on the session.
 */
export function SecondStepForm({ step, onDone, onBack }: { step: SecondStep; onDone: () => void; onBack: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  return step === 'enrol' ? <Enrol onConfirmed={setCodes} onBack={onBack} /> : <CodeEntry onDone={onDone} onBack={onBack} />;
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="-ms-1 mb-3 inline-flex min-h-11 items-center gap-1 rounded-md text-dense text-muted hover:text-text">
      <IconBack size={16} />
      {t('console.login_change_phone')}
    </button>
  );
}

function ErrorLine({ error }: { error: { message?: string; data?: unknown } | null }) {
  if (!error) return null;
  return (
    <p className="mt-4 flex items-start gap-2 text-sm text-bad" role="alert">
      <IconAlert size={16} className="mt-0.5 shrink-0" />
      {errorText(error)}
    </p>
  );
}

function Enrol({ onConfirmed, onBack }: { onConfirmed: (codes: string[]) => void; onBack: () => void }) {
  const trpc = useTRPC();
  const enrol = useMutation(trpc.identity.authenticator.enrol.mutationOptions());
  const confirm = useMutation(trpc.identity.authenticator.confirm.mutationOptions({ onSuccess: (res) => onConfirmed(res.recoveryCodes) }));
  const started = useRef(false);
  useEffect(() => {
    // One new secret per visit; a retry button covers a failed start.
    if (started.current) return;
    started.current = true;
    enrol.mutate();
  }, [enrol]);
  const secret = enrol.data?.secret ?? null;

  return (
    <>
      <BackLink onBack={onBack} />
      <h1 id="login-title" className="text-xl font-bold">
        {t('console.totp_enrol_title')}
      </h1>
      <p className="mt-1 text-sm text-muted">{t('console.totp_enrol_body')}</p>
      <div className="mt-5 flex flex-col items-center gap-3">
        {enrol.data ? (
          <QrCode text={enrol.data.uri} />
        ) : enrol.isError ? (
          <div className="flex h-[200px] w-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-line p-3 text-center">
            <ErrorLine error={enrol.error} />
            <Button needsNet onClick={() => enrol.mutate()}>
              {t('console.retry')}
            </Button>
          </div>
        ) : (
          <Skeleton className="h-[200px] w-[200px] rounded-lg" />
        )}
        {secret && (
          <div className="w-full text-center">
            <p className="flex items-center justify-center gap-1 text-xs text-muted">
              {t('console.totp_secret_label')}
              <CopyButton text={secret} />
            </p>
            <bdi dir="ltr" className="num block select-all font-mono text-sm font-semibold">
              {secret.replace(/(.{4})(?=.)/g, '$1 ')}
            </bdi>
          </div>
        )}
      </div>
      <CodeForm
        label={t('console.login_code_label')}
        submit={(code) => confirm.mutate({ code })}
        pending={confirm.isPending}
        error={confirm.error}
        ready={Boolean(secret)}
        recovery={false}
      />
    </>
  );
}

function CodeEntry({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const trpc = useTRPC();
  const [recovery, setRecovery] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const verify = useMutation(
    trpc.identity.authenticator.verify.mutationOptions({
      onSuccess: (res) => {
        if (res.recoveryLeft === null) onDone();
        else setLeft(res.recoveryLeft);
      },
    }),
  );
  if (left !== null) {
    return (
      <>
        <h1 id="login-title" className="text-xl font-bold">
          {t('console.totp_recovery_title')}
        </h1>
        <p className="num mt-2 text-sm text-text" role="status">
          {t('console.totp_recovery_left', { n: left })}
        </p>
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={onDone}>
          {t('console.login_enter')}
        </Button>
      </>
    );
  }
  return (
    <>
      <BackLink onBack={onBack} />
      <h1 id="login-title" className="text-xl font-bold">
        {t('console.totp_code_title')}
      </h1>
      {!recovery && <p className="mt-1 text-sm text-muted">{t('console.totp_code_body')}</p>}
      <CodeForm
        key={recovery ? 'recovery' : 'app'}
        label={recovery ? t('console.totp_recovery_label') : t('console.login_code_label')}
        submit={(code) => verify.mutate({ code })}
        pending={verify.isPending}
        error={verify.error}
        ready
        recovery={recovery}
      />
      <p className="mt-3 text-center text-dense">
        <button
          type="button"
          className="min-h-11 rounded-md font-semibold text-accent-text underline-offset-4 hover:underline"
          onClick={() => {
            setRecovery((r) => !r);
            verify.reset();
          }}
        >
          {recovery ? t('console.totp_use_app') : t('console.totp_use_recovery')}
        </button>
      </p>
    </>
  );
}

/** The code box (6 digits, or a recovery code `XXXXX-XXXXX`), the demo fill strip and the submit button. */
function CodeForm({
  label,
  submit,
  pending,
  error,
  ready,
  recovery,
}: {
  label: string;
  submit: (code: string) => void;
  pending: boolean;
  error: { message?: string; data?: unknown } | null;
  ready: boolean;
  recovery: boolean;
}) {
  const trpc = useTRPC();
  const id = useId();
  const [code, setCode] = useState('');
  const demo = useQuery(trpc.identity.authenticator.demoCode.queryOptions(undefined, { enabled: SHOW_DEMO_CODE && ready && !recovery, refetchInterval: 5_000, retry: false }));
  const valid = recovery ? code.replace(/[^A-Za-z0-9]/g, '').length === 10 : /^\d{6}$/.test(code);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) submit(code.trim());
  };
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <Field label={label} htmlFor={id}>
        {recovery ? (
          <Input
            id={id}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            dir="ltr"
            required
            autoFocus
            className="num h-14 text-center font-mono text-xl font-semibold tracking-[0.2em]"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        ) : (
          <Input
            id={id}
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
        )}
      </Field>
      {!recovery && demo.data?.code && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-warn/60 bg-warn-tint/50 px-3 py-2 text-dense" role="status">
          <span className="text-text">
            <span className="font-semibold text-warn">{t('console.login_dev_label')}</span>{' '}
            <bdi dir="ltr" className="num font-semibold tracking-[0.15em]">
              {demo.data.code}
            </bdi>
          </span>
          <Button size="sm" onClick={() => setCode(demo.data?.code ?? '')}>
            {t('console.login_dev_fill')}
          </Button>
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending} needsNet disabled={!valid || !ready}>
        {t('console.login_enter')}
      </Button>
      <ErrorLine error={error} />
    </form>
  );
}

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <>
      <h1 id="login-title" className="text-xl font-bold">
        {t('console.totp_recovery_title')}
      </h1>
      <p className="mt-1 text-sm text-muted">{t('console.totp_recovery_body')}</p>
      <ol dir="ltr" className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2 p-4" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c} className="num select-all text-center font-mono text-base font-semibold tracking-wider">
            {c}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex justify-center">
        <CopyButton text={codes.join('\n')} label />
      </div>
      <Button variant="primary" size="lg" className="mt-5 w-full" onClick={onDone}>
        {t('console.totp_recovery_saved')}
      </Button>
    </>
  );
}

function CopyButton({ text, label = false }: { text: string; label?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2_000);
    } catch {
      // No clipboard (blocked or an old browser): the text stays selectable.
    }
  };
  return (
    <Button size="sm" variant="ghost" icon={<IconCopy size={16} />} aria-label={label ? undefined : t('console.copied')} onClick={() => void copy()} className="min-h-11 min-w-11">
      {done ? t('console.copied') : label ? t('console.totp_copy_codes') : null}
    </Button>
  );
}

/**
 * The otpauth:// link as a QR code, drawn as one SVG path with its quiet zone. Plain black on white in
 * either theme: phone cameras read that most reliably, so it is the one place no theme role applies.
 */
export function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg role="img" aria-label={t('console.totp_enrol_title')} viewBox={`0 0 ${size} ${size}`} width={200} height={200} className="rounded-lg border border-line" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}
