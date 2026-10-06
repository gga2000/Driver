'use client';

import { contrastRatio } from '@driver/design-tokens';
import { t } from '@driver/i18n';
import { useState, type ReactNode } from 'react';
import { palettes, type ConsoleRole } from '@/theme/palette';
import { setTheme, useTheme } from '@/lib/prefs';
import { SlaPill } from './support/sla';
import * as UI from './ui';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Combobox,
  CountBadge,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  IconMoon,
  IconPlus,
  IconRefund,
  IconSun,
  Input,
  Kbd,
  KeyboardHint,
  Meter,
  PageHeader,
  SectionHeader,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Stat,
  StatStrip,
  StatusDot,
  Tabs,
  Textarea,
  Timeline,
  ToastCard,
  Tooltip,
  useToast,
  type ChipTone,
} from './ui';

/**
 * /design — every Console component in every state, in the current theme (toggle at the top). The
 * reference the next designers build pages from (apps/console/DESIGN.md explains the rules).
 */

const SWATCHES: Array<{ role: ConsoleRole; on?: ConsoleRole; note: string }> = [
  { role: 'canvas', on: 'text', note: 'الصفحة' },
  { role: 'sidebar', on: 'text', note: 'القائمة' },
  { role: 'surface', on: 'text', note: 'الكروت' },
  { role: 'surface-2', on: 'muted', note: 'hover' },
  { role: 'surface-3', on: 'muted', note: 'مسار' },
  { role: 'line', note: 'فاصل' },
  { role: 'line-strong', note: 'حافة حقل' },
  { role: 'accent', on: 'on-accent', note: 'زر رئيسي' },
  { role: 'accent-tint', on: 'accent-text', note: 'محدد' },
  { role: 'accent-wash', on: 'text', note: 'صف محدد' },
  { role: 'ok-tint', on: 'ok', note: 'تم' },
  { role: 'warn-tint', on: 'warn', note: 'قرّب' },
  { role: 'bad-tint', on: 'bad', note: 'مشكلة' },
  { role: 'info-tint', on: 'info', note: 'بالطريق' },
  { role: 'note', on: 'warn', note: 'ملاحظة' },
  { role: 'inverse', on: 'on-inverse', note: 'تنبيه' },
];

const TONES: ChipTone[] = ['neutral', 'live', 'ready', 'done', 'warn', 'bad', 'accent'];
const TONE_LABEL: Record<ChipTone, string> = {
  neutral: 'ينتظر',
  live: 'بالطريق',
  ready: 'يحتاجك',
  done: 'وصل',
  warn: 'قرّب الموعد',
  bad: 'فات الموعد',
  accent: 'المحدد',
};

const ROWS = [
  {
    id: 'o1',
    order: '#1284',
    merchant: 'مطعم خالد',
    state: 'وصل',
    tone: 'done' as ChipTone,
    total: 12_500,
  },
  {
    id: 'o2',
    order: '#4676',
    merchant: 'مطعم الريف',
    state: 'بالطريق',
    tone: 'live' as ChipTone,
    total: 6_000,
  },
  {
    id: 'o3',
    order: '#3248',
    merchant: 'فلافل أبو علي',
    state: 'متأخر 12 د',
    tone: 'bad' as ChipTone,
    total: 3_250,
  },
];

const ICONS = Object.entries(UI).filter(
  ([k]) => k.startsWith('Icon') && k !== 'IconButton' && k !== 'IconDot',
) as Array<[string, (p: UI.IconProps) => ReactNode]>;

export function DesignPage() {
  const theme = useTheme();
  const toast = useToast();
  const [seg, setSeg] = useState<'all' | 'mine' | 'late'>('all');
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [check, setCheck] = useState(true);
  const [pick, setPick] = useState<string | null>('مطعم خالد');
  const [selected, setSelected] = useState<Set<string>>(new Set(['o2']));
  const now = new Date('2026-10-04T18:30:00Z');
  const p = palettes[theme];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('console.design_title')} subtitle={t('console.design_subtitle')}>
        <Segmented
          label="theme"
          value={theme}
          onChange={(v) => setTheme(v)}
          options={[
            {
              value: 'light',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <IconSun size={15} />
                  {t('console.theme_light')}
                </span>
              ),
            },
            {
              value: 'dark',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <IconMoon size={15} />
                  {t('console.theme_dark')}
                </span>
              ),
            },
          ]}
        />
      </PageHeader>

      <div className="space-y-6">
        <Block
          title="الألوان"
          hint="أدوار من @driver/design-tokens. الرقم = التباين مع النص اللي فوقه (لازم ≥ 4.5)."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {SWATCHES.map((s) => (
              <div key={s.role} className="overflow-hidden rounded-lg border border-line">
                <div
                  className="flex h-16 items-end justify-between p-2"
                  style={{
                    background: `rgb(var(--c-${s.role}))`,
                    color: s.on ? `rgb(var(--c-${s.on}))` : undefined,
                  }}
                >
                  <span className="text-xs font-semibold">{s.on ? 'نص' : ''}</span>
                  {s.on ? (
                    <span className="num text-xs">
                      {contrastRatio(p[s.on], p[s.role]).toFixed(1)}
                    </span>
                  ) : null}
                </div>
                <div className="bg-surface px-2 py-1.5">
                  <p className="truncate text-xs font-semibold" dir="ltr">
                    {s.role}
                  </p>
                  <p className="text-xs text-muted">
                    {s.note} ·{' '}
                    <span className="num" dir="ltr">
                      {p[s.role]}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block title="الخط" hint="IBM Plex Sans Arabic، أرقام غربية جدولية، سطور أطول للعربي.">
          <div className="space-y-3">
            {[
              ['text-3xl font-bold', '28 / 40 · عنوان الشاشة الكبير'],
              ['text-2xl font-bold', '24 / 36 · عنوان الصفحة'],
              ['text-lg font-semibold', '17 / 28 · عنوان التذكرة'],
              ['text-[15px] font-semibold', '15 / 24 · عنوان القسم'],
              ['text-base', '15 / 25 · نص المحادثة: الطلب وصل بعد ساعة وبارد'],
              ['text-sm', '14 / 22 · نص الواجهة الأساسي'],
              ['text-dense', '13 / 21 · الجداول والقوائم'],
              ['text-xs text-muted', '12 / 20 · الوقت والتفاصيل الصغيرة'],
            ].map(([cls, label]) => (
              <p key={cls} className={cls}>
                {label}
              </p>
            ))}
            <p className="num text-[26px] font-semibold">
              12,500 <span className="text-sm font-normal text-muted">دينار</span> · #1284 · 0770
              •••• 4567
            </p>
          </div>
        </Block>

        <Block title="الأزرار">
          <div className="space-y-4">
            {(['primary', 'secondary', 'ghost', 'danger', 'danger-soft'] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-xs text-muted" dir="ltr">
                  {v}
                </span>
                <Button variant={v} size="sm">
                  صغير
                </Button>
                <Button variant={v}>عادي</Button>
                <Button variant={v} size="lg" icon={<IconRefund size={16} />}>
                  كبير مع أيقونة
                </Button>
                <Button variant={v} kbd="E">
                  مع اختصار
                </Button>
                <Button variant={v} loading>
                  يحمّل
                </Button>
                <Button variant={v} disabled>
                  معطّل
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-xs text-muted">مضغوط/مختار</span>
              <Button aria-pressed>مختار</Button>
              <Button aria-pressed={false}>مو مختار</Button>
              <IconButton label="أضف">
                <IconPlus size={18} />
              </IconButton>
              <IconButton label="أضف" variant="secondary">
                <IconPlus size={18} />
              </IconButton>
              <IconButton label="مختار" aria-pressed>
                <IconPlus size={18} />
              </IconButton>
            </div>
          </div>
        </Block>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="الحالات (Chip / Badge)">
            <div className="flex flex-wrap gap-2">
              {TONES.map((tone) => (
                <Chip key={tone} tone={tone}>
                  {TONE_LABEL[tone]}
                </Chip>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone} dot size="sm">
                  {TONE_LABEL[tone]}
                </Badge>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-2">
                <CountBadge n={4} /> عدد
              </span>
              <span className="inline-flex items-center gap-2">
                <CountBadge n={2} alert /> عاجل
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="ok" pulse /> متصل
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="warn" /> قديم
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="bad" /> مقطوع
              </span>
            </div>
          </Block>

          <Block title="فتيل الموعد (SLA)" hint="العلامة الخاصة بالدعم: الحلقة تحترگ مع الوقت.">
            <div className="flex flex-wrap gap-2">
              <SlaPill
                now={now}
                row={{
                  status: 'open',
                  slaState: 'ok',
                  openedAt: new Date('2026-10-04T15:00:00Z'),
                  slaDueAt: new Date('2026-10-04T21:00:00Z'),
                }}
              />
              <SlaPill
                now={now}
                row={{
                  status: 'open',
                  slaState: 'due_soon',
                  openedAt: new Date('2026-10-04T15:00:00Z'),
                  slaDueAt: new Date('2026-10-04T19:10:00Z'),
                }}
              />
              <SlaPill
                now={now}
                row={{
                  status: 'open',
                  slaState: 'breached',
                  openedAt: new Date('2026-10-03T15:00:00Z'),
                  slaDueAt: new Date('2026-10-03T21:00:00Z'),
                }}
              />
              <SlaPill
                now={now}
                row={{
                  status: 'resolved',
                  slaState: 'met',
                  openedAt: new Date('2026-10-04T15:00:00Z'),
                  slaDueAt: new Date('2026-10-04T21:00:00Z'),
                }}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <KeyboardHint label="البحث" keys={['Ctrl', 'K']} />
              <KeyboardHint label="حلّها" keys={['E']} />
              <Kbd>?</Kbd>
            </div>
          </Block>
        </div>

        <Block title="أرقام (Stat tiles)">
          <StatStrip>
            <Stat
              label="طلبات بالساعة"
              value="44"
              delta={{ value: 6, text: '+6 من أمس', goodWhen: 'up' }}
              spark={[22, 30, 28, 35, 41, 38, 44]}
            />
            <Stat
              label="متأخرة"
              value="3"
              tone="bad"
              delta={{ value: 2, text: '+2', goodWhen: 'down' }}
              spark={[0, 1, 1, 0, 2, 1, 3]}
            />
            <Stat label="وقت القبول" value="0:21" tone="ok" hint="الهدف أقل من 0:30" />
            <Stat label="كاش بالميدان" value="280,500" tone="accent" hint="دينار" />
          </StatStrip>
          <div className="mt-4 max-w-sm space-y-3">
            <Meter value={4000} max={10000} label="حدّك اليوم" />
            <Meter value={8500} max={10000} label="قرّب" />
            <Meter value={10000} max={10000} label="خلص" />
          </div>
        </Block>

        <Block title="جدول (DataTable)" hint="رأس ثابت، hover، تحديد، أرقام على الطرف.">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-3">
              <DataTable
                rows={ROWS}
                rowKey={(r) => r.id}
                selected={selected}
                onToggle={(k) =>
                  setSelected((s) =>
                    s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k]),
                  )
                }
                columns={[
                  {
                    key: 'order',
                    header: 'الطلب',
                    cell: (r) => <span className="num font-semibold">{r.order}</span>,
                  },
                  { key: 'merchant', header: 'المطعم', cell: (r) => r.merchant },
                  {
                    key: 'state',
                    header: 'الحالة',
                    cell: (r) => <Chip tone={r.tone}>{r.state}</Chip>,
                  },
                  {
                    key: 'total',
                    header: 'المجموع',
                    numeric: true,
                    cell: (r) => r.total.toLocaleString('en-US'),
                  },
                ]}
              />
            </div>
            <DataTable
              rows={[]}
              loading
              rowKey={() => ''}
              columns={[
                { key: 'a', header: 'يحمّل', cell: () => null },
                { key: 'b', header: 'المبلغ', numeric: true, cell: () => null },
              ]}
            />
            <div className="lg:col-span-2">
              <DataTable
                rows={[]}
                rowKey={() => ''}
                empty={{
                  title: 'ماكو طلبات بهالفلتر',
                  hint: 'وسّع التاريخ أو امسح البحث.',
                  action: <Button size="sm">امسح الفلاتر</Button>,
                }}
                columns={[{ key: 'a', header: 'الطلب', cell: () => null }]}
              />
            </div>
          </div>
        </Block>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="تبويب و Segmented">
            <Tabs
              label="tabs"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'a', label: 'المحادثة' },
                { value: 'b', label: 'الزبون ↔ الدليفري', count: 3 },
                { value: 'c', label: 'معطّل', disabled: true },
              ]}
            />
            <div className="mt-4">
              <Segmented
                label="seg"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: 'all', label: 'الكل', count: 12 },
                  { value: 'mine', label: 'لي', count: 3 },
                  { value: 'late', label: 'متأخرة', count: 1 },
                ]}
              />
            </div>
          </Block>

          <Block title="حقول">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عادي" hint="تلميح تحت الحقل">
                <Input placeholder="اكتب هنا" />
              </Field>
              <Field label="فيه خطأ" error="المبلغ لازم يكون بالـ250">
                <Input defaultValue="1,100" aria-invalid />
              </Field>
              <Field label="معطّل">
                <Input disabled defaultValue="ما يتغيّر" />
              </Field>
              <Field label="اختيار">
                <Select defaultValue="b">
                  <option value="a">رصيد بالمحفظة</option>
                  <option value="b">نقاط</option>
                </Select>
              </Field>
              <Field label="Combobox">
                <Combobox
                  items={['مطعم خالد', 'مطعم الريف', 'فلافل أبو علي', 'مشويات الحاج']}
                  value={pick}
                  onChange={setPick}
                  itemKey={(x) => x}
                  itemLabel={(x) => x}
                  label="مطعم"
                  emptyText="ماكو"
                />
              </Field>
              <Field label="نص طويل">
                <Textarea rows={2} placeholder="ملاحظة…" />
              </Field>
            </div>
            <div className="mt-3">
              <Checkbox
                label="ملاحظة داخلية"
                hint="ما توصل للزبون"
                checked={check}
                onChange={setCheck}
              />
            </div>
          </Block>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Block title="نوافذ">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialog(true)}>افتح Dialog</Button>
              <Button onClick={() => setSheet(true)}>افتح Sheet</Button>
              <Button
                onClick={() =>
                  toast({
                    title: 'انرسل الرد',
                    tone: 'ok',
                    action: { label: 'تراجع', onClick: () => undefined },
                  })
                }
              >
                Toast
              </Button>
            </div>
            <div className="mt-4">
              <ToastCard
                item={{
                  title: 'تعوّض 2,000 دينار',
                  body: 'رصيد بمحفظة زينب، على حساب الدليفري.',
                  tone: 'ok',
                }}
              />
            </div>
            <div className="mt-2">
              <ToastCard
                item={{ title: 'ما گدرنا نرسل', body: 'النت مقطوع. نحاول نرجع…', tone: 'bad' }}
              />
            </div>
          </Block>
          <Block title="Tooltip و Avatar">
            <div className="flex items-center gap-3">
              <Tooltip content="انسخ رقم الطلب">
                <Button size="sm">مرّر هنا</Button>
              </Tooltip>
              <Avatar name="زينب" id="c1" size="sm" />
              <Avatar name="علي" id="p1" />
              <Avatar name="حيدر" id="d7" size="lg" />
              <Avatar name="مرتضى" id="x9" size="lg" />
            </div>
          </Block>
          <Block title="Timeline">
            <Timeline
              items={[
                { id: '1', title: 'انطلب', time: '9:34 م' },
                { id: '2', title: 'المطعم قبل', time: '9:35 م' },
                { id: '3', title: 'الدليفري استلم', time: '9:52 م', tone: 'ok' },
                { id: '4', title: 'انفتحت شكوى', time: '10:20 م', current: true },
              ]}
            />
          </Block>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="فارغ و تحميل">
            <EmptyState title="كل التذاكر انردّت" hint="النزاعات من التطبيق تفتح تذكرة وحدها.">
              <Button size="sm" variant="primary">
                تذكرة جديدة
              </Button>
            </EmptyState>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          </Block>
          <Block title="أيقونات" hint="20 px، خط 1.6، مرسومة للوحة.">
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {ICONS.map(([name, Icon]) => (
                <div
                  key={name}
                  title={name}
                  className="flex h-11 items-center justify-center rounded-md bg-surface-2 text-text"
                >
                  <Icon size={20} />
                </div>
              ))}
            </div>
          </Block>
        </div>

        <Card
          title="Card مع إجراءات"
          actions={<Button size="sm">إجراء</Button>}
          hint="عنوان + تلميح + إجراء على الطرف"
        >
          <SectionHeader
            title="قسم داخلي"
            count={12}
            hint="الأقسام داخل الكارت تنفصل بخط، مو بكارت ثاني."
          />
        </Card>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        labelledBy="demo-dialog"
        title="حلّ التذكرة"
        description="عند الحل يوصل للزبون «هل انحلّت مشكلتك؟»"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              تراجع
            </Button>
            <Button variant="primary">حلّها</Button>
          </>
        }
      >
        <Field label="شنو كان الحل؟">
          <Textarea rows={3} />
        </Field>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="الزبون">
        <p className="text-sm text-muted">لوحة جانبية تطلع من الحافة اليسرى.</p>
      </Sheet>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
      <SectionHeader title={title} hint={hint} className="mb-4" />
      {children}
    </section>
  );
}
