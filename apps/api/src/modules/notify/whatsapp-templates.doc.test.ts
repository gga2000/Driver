import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTIFY_TEMPLATES, type NotifyTemplateDef, type WhatsAppTemplateDef } from '@driver/contracts';
import { locales } from '@driver/i18n';
import { OTP_WHATSAPP_TEMPLATE } from '../identity/index.js';

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/whatsapp-templates.md');

function text(key: string, locale: 'ar-IQ' | 'en'): string {
  return (locales[locale] as Record<string, string>)[key] ?? '';
}

/** Every WhatsApp template the API can send, by Meta name (one notify template per name). */
function templates(): Array<{ wa: WhatsAppTemplateDef; def: NotifyTemplateDef }> {
  return Object.values(NOTIFY_TEMPLATES)
    .filter((def): def is NotifyTemplateDef & { whatsapp: WhatsAppTemplateDef } => !!def.whatsapp)
    .map((def) => ({ wa: def.whatsapp, def }))
    .sort((a, b) => a.wa.name.localeCompare(b.wa.name));
}

/** docs/whatsapp-templates.md, written from `NOTIFY_TEMPLATES` and the `wa.*` strings. */
function renderDoc(): string {
  const rows = templates();
  const out: string[] = [];
  out.push(`# WhatsApp Business templates (to submit for approval)

Generated from \`NOTIFY_TEMPLATES\` in \`packages/contracts/src/notify-io.ts\` (name, Meta category,
parameter order, samples) and the \`wa.*\` strings in \`packages/i18n/src/locales/{ar-IQ,en}.json\` (text)
by \`apps/api/src/modules/notify/whatsapp-templates.doc.test.ts\`, which fails when this page is out of
date. To refresh it after changing a template: \`UPDATE_DOCS=1 pnpm --filter @driver/api exec vitest run whatsapp-templates.doc\`.
A text or parameter order that changes after approval is submitted again under a **new name** (the
order of \`{{n}}\` is part of the contract, voice spec §6).

How to submit (WhatsApp Manager → Message templates → Create):

- One template per name below, with **two languages**: Arabic (\`ar\`) and English (\`en\`). The API sends
  \`ar\` unless the person chose English.
- Body only (no header, no buttons). Paste the text exactly, including Western digits and \`دينار\`.
  Fill the samples with the values given (Meta needs one sample per variable).
- Category as listed. Receipts and safety are UTILITY; never mark them MARKETING (they must reach
  people who did not opt in to offers).
- \`${OTP_WHATSAPP_TEMPLATE}\` is the sign-in code («ما وصلك؟ دزلي على واتساب», \`docs/api/otp-guard.md\`). It is
  AUTHENTICATION with a copy-code button: Meta writes its body, so only the name and languages matter.

Runtime (\`apps/api/src/modules/notify\`): \`WHATSAPP_PROVIDER=meta\` (or just \`WHATSAPP_TOKEN\` set) sends
through the Cloud API (\`POST graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages\`,
\`type: template\`, body parameters as text). Statuses (sent / delivered / read / failed) come back on
\`/webhooks/whatsapp\` (verify token \`WHATSAPP_WEBHOOK_VERIFY_TOKEN\`, signature \`WHATSAPP_APP_SECRET\`);
a message not delivered 60 s after sending gets its SMS twin (domain §8).

${rows.length + 1} templates.

| Template | Meta category | Sent as notify template (category) |
|---|---|---|
| \`${OTP_WHATSAPP_TEMPLATE}\` | AUTHENTICATION | the sign-in code (identity, not a notify template) |`);
  for (const { wa, def } of rows) out.push(`| \`${wa.name}\` | ${wa.metaCategory} | \`${def.id}\` (${def.category}) |`);
  out.push('', '## Templates');
  for (const { wa, def } of rows) {
    const params = wa.params.map((p, i) => `\`{{${i + 1}}}\` ${p}`).join(', ');
    const samples = wa.examples.map((e, i) => `\`{{${i + 1}}}\` = ${e}`).join(' · ');
    out.push(
      '',
      `### \`${wa.name}\``,
      '',
      `- Category: **${wa.metaCategory}** · languages: \`ar\`, \`en\` · i18n key: \`${wa.key}\` · notify template \`${def.id}\``,
      `- Body parameters, in order: ${params || 'none'}`,
      '',
      'Arabic (`ar`):',
      '',
      '```text',
      text(wa.key, 'ar-IQ'),
      '```',
      '',
      'English (`en`):',
      '',
      '```text',
      text(wa.key, 'en'),
      '```',
    );
    if (samples) out.push('', `Sample values for the submission: ${samples}`);
  }
  return `${out.join('\n')}\n`;
}

/** The WhatsApp templates we submit to Meta: complete, consistent, and the page that lists them current. */
describe('WhatsApp templates', () => {
  it.each(templates().map((r) => [r.wa.name, r] as const))('%s: both texts exist and use exactly its parameters, with one sample each', (_, { wa }) => {
    expect(wa.name).toMatch(/^[a-z0-9_]+$/);
    expect(wa.examples).toHaveLength(wa.params.length);
    for (const locale of ['ar-IQ', 'en'] as const) {
      const body = text(wa.key, locale);
      expect(body, `${wa.key} (${locale})`).not.toBe('');
      const used = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
      expect(used, `${wa.key} (${locale})`).toEqual(wa.params.map((_, i) => i + 1));
      expect(body, `${wa.key} (${locale}) has a named {param} Meta would not fill`).not.toMatch(/(^|[^{])\{\w+\}(?!\})/);
    }
  });

  it('every Meta name is used by one notify template', () => {
    const names = templates().map((r) => r.wa.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    expect(names).not.toContain(OTP_WHATSAPP_TEMPLATE);
  });

  it('docs/whatsapp-templates.md is up to date (UPDATE_DOCS=1 rewrites it)', () => {
    const want = renderDoc();
    if (process.env['UPDATE_DOCS'] === '1') writeFileSync(DOC, want);
    expect(readFileSync(DOC, 'utf8')).toBe(want);
  });
});
