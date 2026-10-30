'use client';

import { t } from '@driver/i18n';
import { modLabel } from '@/lib/hotkeys';
import { NAV } from '@/lib/nav';
import { Dialog, Kbd } from '../ui';

/** The "?" sheet: every shortcut, grouped. Keys are physical (they work on an Arabic layout too). */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod = modLabel();
  const groups: Array<{ title: string; rows: Array<[string[], string]> }> = [
    {
      title: t('console.kb_group_general'),
      rows: [
        [[mod, 'K'], t('console.kb_palette')],
        [['/'], t('console.kb_palette')],
        [['?'], t('console.kb_help')],
        [['esc'], t('console.kb_close')],
      ],
    },
    {
      title: t('console.kb_group_go'),
      rows: NAV.map((i) => [['G', (i.jump ?? '').toUpperCase()], t(i.key)] as [string[], string]),
    },
    {
      title: t('console.kb_group_dispatch'),
      rows: [
        [['J'], t('console.kb_card_next')],
        [['K'], t('console.kb_card_prev')],
        [['A'], t('console.kb_take')],
        [['1–5'], t('console.kb_pick_driver')],
        [['↵'], t('console.kb_send_offer')],
        [['esc'], t('console.kb_unpick')],
        [['M'], t('console.kb_mute')],
      ],
    },
    {
      title: t('console.kb_group_map'),
      rows: [
        [['F'], t('console.kb_follow')],
        [['esc'], t('console.kb_follow_stop')],
      ],
    },
    {
      title: t('console.kb_group_support'),
      rows: [
        [['J'], t('console.kb_next')],
        [['K'], t('console.kb_prev')],
        [['R'], t('console.kb_reply')],
        [['N'], t('console.kb_note')],
        [['E'], t('console.kb_resolve')],
        [['/'], t('console.kb_canned')],
        [[mod, '↵'], t('console.kb_send')],
      ],
    },
    {
      title: t('console.kb_group_today'),
      rows: [
        [['J'], t('console.kb_today_next')],
        [['K'], t('console.kb_today_prev')],
        [['↵'], t('console.kb_row_open')],
        [['A'], t('console.kb_today_take')],
        [['S'], t('console.kb_today_snooze')],
        [['E'], t('console.kb_today_close')],
      ],
    },
    {
      title: t('console.kb_group_lists'),
      rows: [
        [['J'], t('console.kb_next')],
        [['K'], t('console.kb_prev')],
        [['↵'], t('console.kb_row_open')],
      ],
    },
    {
      title: t('console.kb_group_approvals'),
      rows: [
        [['A'], t('console.kb_approve')],
        [['X'], t('console.kb_reject')],
        [['1', '–', '4'], t('console.kb_reason')],
        [['J'], t('console.kb_next_item')],
        [['K'], t('console.kb_prev_item')],
      ],
    },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('console.shortcuts_open')}
      width="lg"
      labelledBy="kb-title"
    >
      <div className="grid gap-x-8 gap-y-5 pb-3 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} className={g.rows.length > 8 ? 'md:row-span-2' : ''}>
            <h3 className="mb-1.5 text-dense font-semibold text-muted">{g.title}</h3>
            <dl className="divide-y divide-line">
              {g.rows.map(([keys, label], i) => (
                <div
                  key={`${label}-${i}`}
                  className="flex items-center justify-between gap-4 py-1.5 text-sm"
                >
                  <dt>{label}</dt>
                  <dd dir="ltr" className="flex items-center gap-1">
                    {keys.map((k, j) => (
                      <Kbd key={`${k}-${j}`}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
