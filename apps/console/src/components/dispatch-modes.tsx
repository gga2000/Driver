'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardPolicy, Vertical } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useState } from 'react';
import { POLICY_MODES, policyMode, setPolicyInput, type PolicyMode } from '@/lib/board';
import { verticalLabel } from '@/lib/labels';
import { CITY_ID, useDispatchBoard } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, SkeletonBlock, useToast } from './ui';

const MODE_KEY: Record<PolicyMode, MessageKey> = {
  broadcast: 'console.policy_broadcast',
  auto: 'console.policy_auto',
  suggest: 'console.policy_suggest',
  fixed: 'console.policy_fixed',
};
const MODE_EFFECT: Record<(typeof POLICY_MODES)[number], MessageKey> = {
  broadcast: 'console.modes_effect_broadcast',
  auto: 'console.modes_effect_auto',
  suggest: 'console.modes_effect_suggest',
};

type Change = { policy: BoardPolicy; to: (typeof POLICY_MODES)[number] } | { policy: BoardPolicy; reset: true };

/**
 * Dispatch modes per vertical (K-03 / K-14): moved off the dispatch board, where a stray click
 * changed how a whole service dispatches during the rush. Every change asks first, in a sentence
 * that says what will happen; the procedure (`dispatch.setPolicy`) and its audit log are unchanged.
 */
export function DispatchModes() {
  const board = useDispatchBoard();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [change, setChange] = useState<Change | null>(null);
  const setPolicy = useMutation(
    trpc.dispatch.setPolicy.mutationOptions({
      onSuccess: (p) => {
        toast({ title: t('console.policy_saved', { vertical: verticalLabel(p.vertical), mode: t(MODE_KEY[policyMode(p)]) }), tone: 'ok' });
        setChange(null);
        void qc.invalidateQueries({ queryKey: trpc.dispatch.board.queryKey() });
      },
    }),
  );
  const policies = board.data?.policies ?? [];

  const confirm = () => {
    if (!change) return;
    if ('reset' in change) setPolicy.mutate({ cityId: CITY_ID, vertical: change.policy.vertical, clear: true });
    else setPolicy.mutate(setPolicyInput(CITY_ID, change.policy.vertical as Vertical, change.to));
  };

  return (
    <section id="dispatch-modes" className="mt-6 scroll-mt-6">
      <Card title={t('console.policies')} hint={t('console.modes_hint')} flush>
        {board.isPending ? (
          <div className="space-y-2 p-5">
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
          </div>
        ) : policies.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">{t('console.policy_none')}</p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {policies.map((p) => {
              const mode = policyMode(p);
              return (
                <li key={p.vertical} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <span className="w-28 shrink-0 font-semibold">{verticalLabel(p.vertical)}</span>
                  {mode === 'fixed' ? (
                    <Chip>{t('console.policy_fixed')}</Chip>
                  ) : (
                    <div role="radiogroup" aria-label={verticalLabel(p.vertical)} className="inline-flex items-center gap-0.5 rounded-md bg-surface-3 p-0.5">
                      {POLICY_MODES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={mode === m}
                          onClick={() => mode !== m && setChange({ policy: p, to: m })}
                          className={cx(
                            'h-8 rounded-[8px] px-3 text-dense transition-colors',
                            mode === m ? 'bg-surface font-semibold text-text shadow-card' : 'text-muted hover:text-text',
                          )}
                        >
                          {t(MODE_KEY[m])}
                        </button>
                      ))}
                    </div>
                  )}
                  {p.overridden ? (
                    <span className="inline-flex items-center gap-2">
                      <Chip tone="warn">{t('console.policy_overridden')}</Chip>
                      <Button variant="ghost" size="sm" onClick={() => setChange({ policy: p, reset: true })}>
                        {t('console.policy_reset')}
                      </Button>
                    </span>
                  ) : null}
                  {mode !== 'fixed' ? <span className="min-w-0 flex-1 text-dense text-muted">{t(MODE_EFFECT[mode])}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={change !== null}
        onClose={() => {
          setChange(null);
          setPolicy.reset();
        }}
        title={
          change
            ? 'reset' in change
              ? t('console.modes_reset_title', { vertical: verticalLabel(change.policy.vertical) })
              : t('console.modes_confirm_title', { vertical: verticalLabel(change.policy.vertical), mode: t(MODE_KEY[change.to]) })
            : ''
        }
        labelledBy="modes-title"
        footer={
          <>
            <Button
              onClick={() => {
                setChange(null);
                setPolicy.reset();
              }}
            >
              {t('console.cancel')}
            </Button>
            <Button variant="primary" loading={setPolicy.isPending} onClick={confirm}>
              {change && !('reset' in change) ? t('console.modes_confirm_do', { mode: t(MODE_KEY[change.to]) }) : t('console.policy_reset')}
            </Button>
          </>
        }
      >
        {change ? (
          <div className="space-y-2 text-sm">
            <p>
              {'reset' in change
                ? t('console.modes_reset_body')
                : t('console.modes_confirm_body', { from: t(MODE_KEY[policyMode(change.policy)]), effect: t(MODE_EFFECT[change.to]) })}
            </p>
            <p className="text-muted">{t('console.modes_logged')}</p>
            {setPolicy.error ? <p className="text-bad">{errorText(setPolicy.error)}</p> : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
