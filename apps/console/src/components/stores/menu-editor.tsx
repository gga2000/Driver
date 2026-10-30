'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { AdminMenu, AdminMenuItem } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { fileUrl } from '@/lib/control-room';
import { formatIqd, formatMoney } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { useConsoleNetwork } from '@/lib/network';
import { photoProblem, uploadPhoto } from '@/lib/pickup-spots';
import { LIBRARY, LIBRARY_SECTIONS, libraryFile, libraryPath, librarySuggest, parsePastedMenu, westernDigits, type LibraryDish, type LibrarySection } from '@/lib/store-setup';
import { API_URL, useTRPC, useTRPCClient } from '@/lib/trpc';
import { Button, Card, Checkbox, Chip, cx, Dialog, EmptyState, Field, IconButton, IconClose, IconPlus, IconStore, Input, QueryError, Select, Skeleton, Spinner, Switch, Textarea } from '../ui';
import { useStoreWrite } from './store-write';

const NO_SECTION = '';

/** An amount box: Western digits left to right, «دينار» beside it. */
function PriceInput({ wrapClassName, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { wrapClassName?: string }) {
  return (
    <span className={cx('relative block', wrapClassName)}>
      <Input inputMode="numeric" dir="ltr" className={cx('num h-11 pl-14 text-right', className)} {...rest} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">
        {t('console.stores.iqd')}
      </span>
    </span>
  );
}

/** A price as typed: Western or Eastern digits, commas allowed; null when it is not a whole positive amount. */
export function readPrice(text: string): number | null {
  const n = Number(westernDigits(text).replace(/[,٬\s]/g, ''));
  return Number.isInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
}

/**
 * «المنيو» (concept B): the whole menu as rows to type into, section by section — name and price
 * save on Enter or when leaving the row, the on-sale switch and «خلص اليوم» at once, a photo from our
 * library in two taps, «الصق المنيو» for a menu typed or read off a photo. The owner's rules apply
 * (the server checks them) and every change is in «السجل» under the staff member's name.
 */
export function MenuEditor({ storeId, canEdit, inSetup }: { storeId: string; canEdit: boolean; inSetup: boolean }) {
  const trpc = useTRPC();
  const menu = useQuery(trpc.ops.stores.menu.queryOptions({ merchantOrgId: storeId }, { retry: queryRetry }));
  const [pasting, setPasting] = useState(false);
  const [photoFor, setPhotoFor] = useState<AdminMenuItem | null>(null);
  const [optionsFor, setOptionsFor] = useState<AdminMenuItem | null>(null);
  const [onlyNoPhoto, setOnlyNoPhoto] = useState(false);
  const [newSection, setNewSection] = useState<string | null>(null);

  if (menu.error) return <QueryError error={menu.error} onRetry={() => void menu.refetch()} />;
  if (!menu.data) {
    return (
      <Card>
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </Card>
    );
  }
  const data = menu.data;
  const items = data.categories.flatMap((c) => c.items);
  const noPhoto = items.filter((i) => !i.photoUrl).length;
  const sections = data.categories.map((c) => c.nameAr ?? NO_SECTION);
  const shown = newSection !== null && !sections.includes(newSection) ? [...data.categories, { nameAr: newSection, items: [] }] : data.categories;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-dense text-muted">
            <span>{t('console.stores.menu_count', { n: items.length })}</span>
            {noPhoto > 0 ? (
              <button type="button" aria-pressed={onlyNoPhoto} onClick={() => setOnlyNoPhoto((v) => !v)} className={cx('inline-flex h-11 items-center rounded-pill border px-3 text-dense', onlyNoPhoto ? 'border-warn bg-warn-tint text-text' : 'border-line text-warn hover:border-line-strong')}>
                {t('console.stores.menu_no_photo', { n: noPhoto })}
              </button>
            ) : items.length > 0 ? (
              <Chip size="sm" tone="done">
                {t('console.stores.menu_all_photos')}
              </Chip>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={!canEdit} onClick={() => setNewSection(t('console.stores.section_new_name'))} icon={<IconPlus size={18} />}>
              {t('console.stores.section_add')}
            </Button>
            <Button size="lg" variant="primary" disabled={!canEdit} onClick={() => setPasting(true)}>
              {t('console.stores.paste')}
            </Button>
          </div>
        </div>
      </Card>

      {items.length === 0 && newSection === null ? (
        <Card>
          <EmptyState icon={<IconStore size={20} />} title={t('console.stores.menu_empty')} hint={t('console.stores.menu_empty_hint')} />
          <div className="mt-2 flex justify-center">
            <Button size="lg" variant="primary" disabled={!canEdit} onClick={() => setPasting(true)}>
              {t('console.stores.paste')}
            </Button>
          </div>
        </Card>
      ) : (
        shown.map((c, i) => (
          <Section
            key={c.nameAr ?? NO_SECTION}
            storeId={storeId}
            name={c.nameAr ?? NO_SECTION}
            items={onlyNoPhoto ? c.items.filter((x) => !x.photoUrl) : c.items}
            order={sections}
            index={i}
            canEdit={canEdit}
            onPhoto={setPhotoFor}
            onOptions={setOptionsFor}
          />
        ))
      )}

      {pasting ? <PasteDialog storeId={storeId} sections={sections.filter(Boolean)} onClose={() => setPasting(false)} /> : null}
      {photoFor ? <PhotoDialog storeId={storeId} item={photoFor} inSetup={inSetup} onClose={() => setPhotoFor(null)} /> : null}
      {optionsFor ? <OptionsDialog storeId={storeId} item={optionsFor} onClose={() => setOptionsFor(null)} /> : null}
    </div>
  );
}

// ───────────────────────── one section ─────────────────────────

function Section({
  storeId,
  name,
  items,
  order,
  index,
  canEdit,
  onPhoto,
  onOptions,
}: {
  storeId: string;
  name: string;
  items: AdminMenuItem[];
  order: string[];
  index: number;
  canEdit: boolean;
  onPhoto: (i: AdminMenuItem) => void;
  onOptions: (i: AdminMenuItem) => void;
}) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = useMutation(trpc.ops.stores.upsertCategory.mutationOptions({ ...write.handlers(t('console.stores.section_saved')), onSuccess: () => (write.refresh(), setRenaming(null)) }));
  const reorder = useMutation(trpc.ops.stores.reorderCategories.mutationOptions(write.handlers()));
  const named = order.filter(Boolean);
  const pos = named.indexOf(name);
  function move(by: -1 | 1) {
    const next = [...named];
    const j = pos + by;
    if (pos < 0 || j < 0 || j >= next.length) return;
    [next[pos], next[j]] = [next[j]!, next[pos]!];
    reorder.mutate({ merchantOrgId: storeId, order: next });
  }
  const title = name || t('console.stores.section_none');
  return (
    <Card flush>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 pt-4">
        {renaming !== null ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = renaming.trim();
              if (v && v !== name) rename.mutate({ merchantOrgId: storeId, nameAr: v, ...(name ? { renameFrom: name } : {}) });
              else setRenaming(null);
            }}
          >
            <Input aria-label={t('console.stores.section_name')} value={renaming} maxLength={40} autoFocus onChange={(e) => setRenaming(e.target.value)} className="h-11 !w-56" />
            <Button size="lg" variant="primary" type="submit" loading={rename.isPending}>
              {t('console.stores.save')}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setRenaming(null)}>
              {t('console.stores.cancel')}
            </Button>
          </form>
        ) : (
          <h3 className="text-base font-semibold text-text">
            {title} <span className="num ms-1 text-dense font-normal text-faint">{items.length}</span>
          </h3>
        )}
        {canEdit && renaming === null ? (
          <div className="flex items-center gap-1">
            {name ? (
              <>
                <Button size="sm" variant="ghost" disabled={pos <= 0 || reorder.isPending} onClick={() => move(-1)} aria-label={t('console.stores.section_up', { name })}>
                  {t('console.stores.up')}
                </Button>
                <Button size="sm" variant="ghost" disabled={pos < 0 || pos >= named.length - 1 || reorder.isPending} onClick={() => move(1)} aria-label={t('console.stores.section_down', { name })}>
                  {t('console.stores.down')}
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setRenaming(name)}>
              {t('console.stores.section_rename')}
            </Button>
          </div>
        ) : null}
      </div>
      <div role="table" aria-label={title} className="border-t border-line/70">
        <div role="row" className="hidden gap-3 px-5 py-2 text-xs text-muted md:grid md:grid-cols-[56px_minmax(0,1fr)_128px_196px]">
          <span role="columnheader">{t('console.stores.col_photo')}</span>
          <span role="columnheader">{t('console.stores.col_name')}</span>
          <span role="columnheader">{t('console.stores.col_price')}</span>
          <span role="columnheader">{t('console.stores.col_state')}</span>
        </div>
        {items.map((item) => (
          <DishRow key={item.id} storeId={storeId} item={item} section={name} canEdit={canEdit} onPhoto={onPhoto} onOptions={onOptions} />
        ))}
        {canEdit ? <NewDish storeId={storeId} section={name} first={index === 0 && items.length === 0} /> : null}
      </div>
    </Card>
  );
}

// ───────────────────────── one dish ─────────────────────────

function DishRow({ storeId, item, section, canEdit, onPhoto, onOptions }: { storeId: string; item: AdminMenuItem; section: string; canEdit: boolean; onPhoto: (i: AdminMenuItem) => void; onOptions: (i: AdminMenuItem) => void }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const net = useConsoleNetwork();
  const [name, setName] = useState(item.nameAr);
  const [price, setPrice] = useState(formatIqd(item.priceIqd));
  const parsed = readPrice(price);
  const dirty = name.trim() !== item.nameAr || parsed !== item.priceIqd;
  const valid = name.trim().length > 0 && parsed !== null;
  const save = useMutation(trpc.ops.stores.upsertItem.mutationOptions(write.handlers(t('console.stores.dish_saved', { name: name.trim() }))));
  const avail = useMutation(trpc.ops.stores.setAvailability.mutationOptions(write.handlers()));
  const soldOut = useMutation(trpc.ops.stores.soldOutToday.mutationOptions(write.handlers(t('console.stores.sold_out_saved', { name: item.nameAr }))));
  const off = !canEdit || net.state === 'offline';
  function commit() {
    if (!dirty || !valid || save.isPending || off) return;
    save.mutate({ merchantOrgId: storeId, itemId: item.id, nameAr: name.trim(), priceIqd: parsed!, ...(section ? { categoryAr: section } : {}) });
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      setName(item.nameAr);
      setPrice(formatIqd(item.priceIqd));
    }
  };
  const extras = item.modifierGroups.reduce((n, g) => n + g.modifiers.length, 0);
  return (
    <div role="row" className={cx('grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2 border-b border-line/50 px-5 py-2 md:grid-cols-[56px_minmax(0,1fr)_128px_196px]', !item.onSale && 'bg-surface-2/60')} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && commit()} data-testid="dish-row">
      <div role="cell">
      <button type="button" disabled={!canEdit} onClick={() => onPhoto(item)} aria-label={t('console.stores.photo_for', { name: item.nameAr })} className="relative block h-14 w-14 overflow-hidden rounded-md border border-line bg-surface-3" data-testid="dish-photo">
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- API media
          <img src={fileUrl(item.photoUrl, API_URL)} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] leading-tight text-warn">{t('console.stores.no_photo')}</span>
        )}
        {item.photoLibrary ? <span className="absolute inset-x-0 bottom-0 bg-surface/85 text-center text-[10px] leading-4 text-muted">{t('console.stores.library_tag')}</span> : null}
      </button>
      </div>
      <div role="cell" className="min-w-0">
        <Input aria-label={t('console.stores.col_name')} value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} className="h-11" />
      </div>
      <div role="cell" className="col-start-2 md:col-start-auto">
        <PriceInput
          aria-label={t('console.stores.price_of', { name: item.nameAr })}
          value={price}
          disabled={!canEdit}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={onKey}
          className={cx(parsed === null && 'border-bad')}
        />
      </div>
      <div role="cell" className="col-start-2 md:col-start-auto">
        {dirty ? (
          <Button size="lg" variant="primary" loading={save.isPending} disabled={!valid || off} onClick={commit}>
            {t('console.stores.save')}
          </Button>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <span className={cx('inline-flex items-center gap-2 text-xs', item.available && item.onSale ? 'text-muted' : 'font-medium text-warn')}>
              <Switch on={item.available} label={t('console.stores.on_sale', { name: item.nameAr })} disabled={off || avail.isPending} onToggle={() => avail.mutate({ merchantOrgId: storeId, itemId: item.id, available: !item.available })} />
              {item.available ? (item.onSale ? t('console.stores.on') : t('console.stores.sold_out')) : t('console.stores.off')}
            </span>
            <span className="flex flex-wrap items-center gap-x-1">
              {item.available && item.onSale ? (
                <Button size="sm" variant="ghost" className="px-2" disabled={off} loading={soldOut.isPending} onClick={() => soldOut.mutate({ merchantOrgId: storeId, itemId: item.id })}>
                  {t('console.stores.sold_out_today')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" className="px-2" disabled={!canEdit} onClick={() => onOptions(item)}>
                {extras > 0 ? t('console.stores.extras_n', { n: extras }) : t('console.stores.extras')}
              </Button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function NewDish({ storeId, section, first }: { storeId: string; section: string; first: boolean }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const parsed = readPrice(price);
  const add = useMutation(
    trpc.ops.stores.upsertItem.mutationOptions({
      ...write.handlers(t('console.stores.dish_added', { name: name.trim() })),
      onSuccess: () => {
        write.refresh();
        setName('');
        setPrice('');
        nameRef.current?.focus();
      },
    }),
  );
  const ok = name.trim().length > 0 && parsed !== null;
  return (
    <form
      className="grid grid-cols-[56px_1fr] items-center gap-x-3 gap-y-2 px-5 py-3 md:grid-cols-[56px_minmax(0,1fr)_128px_196px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) add.mutate({ merchantOrgId: storeId, nameAr: name.trim(), priceIqd: parsed!, ...(section ? { categoryAr: section } : {}) });
      }}
    >
      <span aria-hidden className="flex h-11 w-14 items-center justify-center text-faint">
        <IconPlus size={18} />
      </span>
      <Input ref={nameRef} aria-label={t('console.stores.new_dish_name')} placeholder={t('console.stores.new_dish_name')} value={name} maxLength={80} autoFocus={first} onChange={(e) => setName(e.target.value)} className="h-11" />
      <PriceInput
        aria-label={t('console.stores.col_price')}
        placeholder={t('console.stores.new_dish_price')}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        wrapClassName="col-start-2 md:col-start-auto"
      />
      <div className="col-start-2 md:col-start-auto">
        <Button size="lg" type="submit" disabled={!ok} loading={add.isPending}>
          {t('console.stores.add')}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── «الصق المنيو» ─────────────────────────

function PasteDialog({ storeId, sections, onClose }: { storeId: string; sections: string[]; onClose: () => void }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [text, setText] = useState('');
  const [into, setInto] = useState(sections[0] ?? '');
  const [skip, setSkip] = useState<ReadonlySet<number>>(new Set());
  const parsed = useMemo(() => parsePastedMenu(text), [text]);
  const keep = parsed.dishes.filter((d) => !skip.has(d.line));
  const add = useMutation(trpc.ops.stores.addItems.mutationOptions(write.handlers()));
  const [busy, setBusy] = useState(false);
  async function run() {
    // One call per section, in the order they were pasted.
    const groups = new Map<string, Array<{ nameAr: string; priceIqd: number }>>();
    for (const d of keep) {
      const s = d.categoryAr ?? into;
      groups.set(s, [...(groups.get(s) ?? []), { nameAr: d.nameAr, priceIqd: d.priceIqd }]);
    }
    setBusy(true);
    try {
      for (const [s, items] of groups) {
        for (let i = 0; i < items.length; i += 100) await add.mutateAsync({ merchantOrgId: storeId, ...(s ? { categoryAr: s } : {}), items: items.slice(i, i + 100) });
      }
      onClose();
    } catch {
      // The toast already says why; what was added stays added.
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={t('console.stores.paste')}
      description={t('console.stores.paste_desc')}
      footer={
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('console.stores.cancel')}
          </Button>
          <Button size="lg" variant="primary" disabled={keep.length === 0} loading={busy} onClick={() => void run()}>
            {t('console.stores.paste_add', { n: keep.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('console.stores.paste_label')} htmlFor="paste-menu" hint={t('console.stores.paste_hint')}>
          <Textarea id="paste-menu" rows={7} value={text} placeholder={t('console.stores.paste_placeholder')} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label={t('console.stores.paste_into')} htmlFor="paste-into">
          <Select id="paste-into" value={into} onChange={(e) => setInto(e.target.value)} className="h-11">
            <option value="">{t('console.stores.section_none')}</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        {parsed.dishes.length > 0 ? (
          <ul className="max-h-64 divide-y divide-line/70 overflow-y-auto rounded-md border border-line" aria-label={t('console.stores.paste_read')}>
            {parsed.dishes.map((d) => (
              <li key={d.line} className="flex min-h-11 items-center gap-3 px-3 text-sm">
                <Checkbox checked={!skip.has(d.line)} onChange={() => setSkip((s) => toggle(s, d.line))} label={d.nameAr} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{d.categoryAr ?? into ?? ''}</span>
                <span className="num font-medium">{formatMoney(d.priceIqd)}</span>
                {d.short ? (
                  <Chip size="sm" tone="warn">
                    {t('console.stores.paste_short')}
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {parsed.unread.length > 0 ? (
          <div className="rounded-md border border-warn/40 bg-warn-tint px-3 py-2 text-xs text-text">
            <p className="font-medium">{t('console.stores.paste_unread')}</p>
            <ul className="mt-1 list-inside list-disc">
              {parsed.unread.slice(0, 6).map((u) => (
                <li key={u.line}>
                  <bdi>{u.text}</bdi>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function toggle(s: ReadonlySet<number>, n: number): ReadonlySet<number> {
  const next = new Set(s);
  if (next.has(n)) next.delete(n);
  else next.add(n);
  return next;
}

// ───────────────────────── a photo: our library, or one taken on the visit ─────────────────────────

const SECTION_KEY: Record<LibrarySection, `console.stores.lib_${LibrarySection}`> = {
  grill: 'console.stores.lib_grill',
  rice: 'console.stores.lib_rice',
  breakfast: 'console.stores.lib_breakfast',
  fast: 'console.stores.lib_fast',
  sweets: 'console.stores.lib_sweets',
  drinks: 'console.stores.lib_drinks',
};

function PhotoDialog({ storeId, item, inSetup, onClose }: { storeId: string; item: AdminMenuItem; inSetup: boolean; onClose: () => void }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const write = useStoreWrite(storeId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<LibrarySection | 'match'>('match');
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const done = { ...write.handlers(t('console.stores.photo_saved', { name: item.nameAr })), onSuccess: () => (write.refresh(), onClose()) };
  const pick = useMutation(trpc.ops.stores.libraryPhoto.mutationOptions(done));
  const own = useMutation(trpc.ops.stores.dishPhoto.mutationOptions(done));
  const matches = librarySuggest(item.nameAr);
  const dishes: readonly LibraryDish[] = section === 'match' ? (matches.length > 0 ? matches : LIBRARY) : LIBRARY.filter((d) => d.section === section);
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const bad = photoProblem(file);
    if (bad) return setProblem(t(bad === 'type' ? 'console.pickup.photo_type' : 'console.pickup.photo_size'));
    setProblem(null);
    setUploading(true);
    try {
      const uploadId = await uploadPhoto(file, (i) => client.places.photoUpload.mutate(i), (url) => fileUrl(url, API_URL));
      own.mutate({ merchantOrgId: storeId, itemId: item.id, uploadId });
    } catch {
      setProblem(t('console.stores.upload_failed'));
    } finally {
      setUploading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} width="lg" title={t('console.stores.photo_title', { name: item.nameAr })} description={t('console.stores.photo_desc')}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('console.stores.lib_sections')}>
          {(['match', ...LIBRARY_SECTIONS] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={section === s}
              onClick={() => setSection(s)}
              className={cx('inline-flex h-9 items-center rounded-pill border px-3 text-dense', section === s ? 'border-accent bg-accent-tint font-semibold text-text' : 'border-line text-muted hover:border-line-strong')}
            >
              {s === 'match' ? t('console.stores.lib_match') : t(SECTION_KEY[s])}
            </button>
          ))}
        </div>
        {section === 'match' && matches.length === 0 ? <p className="text-xs text-muted">{t('console.stores.lib_no_match')}</p> : null}
        <ul className="grid max-h-[46vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
          {dishes.flatMap((d) =>
            d.photos.map((n) => (
              <li key={`${d.slug}-${n}`}>
                <button
                  type="button"
                  disabled={pick.isPending}
                  onClick={() => pick.mutate({ merchantOrgId: storeId, itemId: item.id, photo: libraryFile(d.slug, n) })}
                  className="group block w-full overflow-hidden rounded-md border border-line text-start transition-colors duration-fast hover:border-accent focus-visible:border-accent"
                  aria-label={t('console.stores.lib_pick', { dish: d.nameAr, n })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- API media */}
                  <img src={fileUrl(libraryPath(d.slug, n), API_URL)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  <span className="block truncate px-2 py-1 text-xs text-muted group-hover:text-text">{d.nameAr}</span>
                </button>
              </li>
            )),
          )}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="max-w-[46ch] text-xs text-muted">{inSetup ? t('console.stores.own_photo_hint') : t('console.stores.own_photo_owner')}</p>
          {inSetup ? (
            <>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void upload(e)} />
              <Button size="lg" icon={uploading ? <Spinner /> : <IconPlus size={18} />} disabled={uploading || own.isPending} onClick={() => fileInput.current?.click()}>
                {t('console.stores.own_photo')}
              </Button>
            </>
          ) : null}
          {problem ? (
            <p role="alert" className="w-full text-xs text-bad">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

// ───────────────────────── sizes and extras ─────────────────────────

type Group = { nameAr: string; required: boolean; maxSelect: number; modifiers: Array<{ nameAr: string; price: string; available: boolean }> };

function OptionsDialog({ storeId, item, onClose }: { storeId: string; item: AdminMenuItem; onClose: () => void }) {
  const trpc = useTRPC();
  const write = useStoreWrite(storeId);
  const [groups, setGroups] = useState<Group[]>(() =>
    item.modifierGroups.map((g) => ({ nameAr: g.nameAr, required: g.required, maxSelect: g.maxSelect, modifiers: g.modifiers.map((m) => ({ nameAr: m.nameAr, price: m.priceIqd ? formatIqd(m.priceIqd) : '', available: m.available })) })),
  );
  const save = useMutation(trpc.ops.stores.setModifiers.mutationOptions({ ...write.handlers(t('console.stores.extras_saved', { name: item.nameAr })), onSuccess: () => (write.refresh(), onClose()) }));
  const bad = groups.some((g) => !g.nameAr.trim() || g.modifiers.length === 0 || g.modifiers.some((m) => !m.nameAr.trim() || (m.price.trim() !== '' && readPrice(m.price) === null)));
  const set = (i: number, g: Partial<Group>) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const setMod = (i: number, k: number, m: Partial<Group['modifiers'][number]>) => set(i, { modifiers: groups[i]!.modifiers.map((x, j) => (j === k ? { ...x, ...m } : x)) });
  function submit() {
    save.mutate({
      merchantOrgId: storeId,
      itemId: item.id,
      groups: groups.map((g) => ({
        nameAr: g.nameAr.trim(),
        required: g.required,
        minSelect: g.required ? 1 : 0,
        maxSelect: g.required ? 1 : Math.max(1, Math.min(g.maxSelect, g.modifiers.length)),
        modifiers: g.modifiers.map((m) => ({ nameAr: m.nameAr.trim(), priceIqd: m.price.trim() ? (readPrice(m.price) ?? 0) : 0, available: m.available })),
      })),
    });
  }
  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={t('console.stores.extras_title', { name: item.nameAr })}
      description={t('console.stores.extras_desc')}
      footer={
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>
            {t('console.stores.cancel')}
          </Button>
          <Button size="lg" variant="primary" disabled={bad} loading={save.isPending} onClick={submit}>
            {t('console.stores.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {groups.length === 0 ? <p className="text-sm text-muted">{t('console.stores.extras_none')}</p> : null}
        {groups.map((g, i) => (
          <fieldset key={i} className="space-y-2 rounded-md border border-line p-3">
            <legend className="sr-only">{g.nameAr || t('console.stores.group_name')}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={t('console.stores.group_name')} placeholder={t('console.stores.group_placeholder')} value={g.nameAr} maxLength={60} onChange={(e) => set(i, { nameAr: e.target.value })} className="h-11 flex-1" />
              <Checkbox checked={g.required} onChange={() => set(i, { required: !g.required })} label={t('console.stores.group_required')} />
              <IconButton label={t('console.stores.group_remove')} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}>
                <IconClose size={16} />
              </IconButton>
            </div>
            {g.modifiers.map((m, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 ps-3">
                <Input aria-label={t('console.stores.option_name')} placeholder={t('console.stores.option_placeholder')} value={m.nameAr} maxLength={60} onChange={(e) => setMod(i, k, { nameAr: e.target.value })} className="h-11 flex-1" />
                <PriceInput aria-label={t('console.stores.option_price')} placeholder="0" value={m.price} onChange={(e) => setMod(i, k, { price: e.target.value })} wrapClassName="w-36" />
                <IconButton label={t('console.stores.option_remove')} onClick={() => set(i, { modifiers: g.modifiers.filter((_, j) => j !== k) })}>
                  <IconClose size={16} />
                </IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<IconPlus size={14} />} onClick={() => set(i, { modifiers: [...g.modifiers, { nameAr: '', price: '', available: true }] })}>
              {t('console.stores.option_add')}
            </Button>
          </fieldset>
        ))}
        <Button size="lg" icon={<IconPlus size={18} />} onClick={() => setGroups((gs) => [...gs, { nameAr: '', required: false, maxSelect: 1, modifiers: [{ nameAr: '', price: '', available: true }] }])}>
          {t('console.stores.group_add')}
        </Button>
      </div>
    </Dialog>
  );
}

export type { AdminMenu };
