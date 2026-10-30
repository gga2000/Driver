import type { Block, PrintDoc, PrintItem, PrintJob, PrintMod } from './doc';

/**
 * A print job as one standalone HTML page, drawn in real millimetres from the approved mock-up's CSS
 * (`/merchant-redesign/print/print.html`): the browser's print dialog on the computer, the true-size
 * preview, and the screenshot script. The page carries its own fonts when given (`fontCss`), so the
 * computer prints in IBM Plex Sans Arabic and Alexandria, not whatever it has installed.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const SVG = {
  warn: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 23 21.5H1Z" fill="currentColor"/><path d="M12 9v6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="18.2" r="1.5" fill="#fff"/></svg>',
  plus: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  no: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
  dot: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>',
  cut: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 7.5 21 18M8.5 16.5 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  box: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
};

/** Leading digits in bold Alexandria («<b>9</b> أصناف بالكيس»). */
const boldCount = (s: string) => esc(s).replace(/^(\d[\d,]*)/, '<b>$1</b>');

function mod(m: PrintMod): string {
  const mark = m.mark === 'plus' ? SVG.plus : m.mark === 'no' ? SVG.no : SVG.dot;
  return `<li class="${m.mark}">${mark}${m.mark === 'plus' ? esc(m.text) : `<b>${esc(m.text)}</b>`}</li>`;
}

function item(i: PrintItem, struck = false): string {
  return `<div class="it"><span class="qy${i.qty >= 2 ? ' inv' : ''}">${i.qty}</span><div class="nm${struck ? ' struck' : ''}"><b>${esc(i.name)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ''}${
    i.mods.length ? `<ul>${i.mods.map(mod).join('')}</ul>` : ''
  }${i.allergy ? `<div class="al-inline">${SVG.warn}<b>${esc(i.allergy)}</b></div>` : ''}</div></div>`;
}

function block(b: Block): string {
  switch (b.t) {
    case 'band':
      return `<div class="band">${esc(b.title)}${b.sub ? ` <span>${esc(b.sub)}</span>` : ''}</div>`;
    case 'head': {
      const side = b.code
        ? `<div class="s-code"><small>${esc(b.code.label)}</small><b>${esc(b.code.value)}</b></div>`
        : b.ready
          ? `<div class="r-ready"><small>${esc(b.ready.label)}</small><b>${esc(b.ready.time)}</b>${b.ready.period ? `<small>${esc(b.ready.period)}</small>` : ''}</div>`
          : '';
      return `<div class="r-head"><div class="r-num"><small>${esc(b.label)}</small><b>${esc(b.number)}</b></div>${side}</div>`;
    }
    case 'facts':
      return `<div class="r-sub">${b.parts.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`;
    case 'alert':
      return `<div class="alert${b.small ? ' sm' : ''}">${SVG.warn}<div><b>${esc(b.title)}</b>${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</div></div>`;
    case 'note':
      return `<div class="note"><small>${esc(b.label)}</small>${esc(b.text)}</div>`;
    case 'who':
      return `<div class="who"><span>${esc(b.label)}</span>${b.count != null ? `<i>${b.count}</i>` : ''}</div>${b.note ? `<div class="who-note">${esc(b.note)}</div>` : ''}`;
    case 'item':
      return item(b);
    case 'box':
      return `<div class="out ${b.tone}"><div class="out-h">${b.tone === 'out' ? SVG.no : SVG.plus}<b>${esc(b.title)}</b></div>${b.items.map((i) => item(i, b.tone === 'out')).join('')}</div>`;
    case 'count':
      return `<div class="count">${boldCount(b.text)}</div>`;
    case 'tear':
      return `<div class="tear">${SVG.cut}<span>${esc(b.text)}</span></div>`;
    case 'stub': {
      const code =
        b.code.value != null
          ? `<div class="s-code"><small>${esc(b.code.label)}</small><b>${esc(b.code.value)}</b></div>`
          : `<div class="s-code blank"><small>${esc(b.code.label)}</small><b>${esc(b.code.blank)}</b></div>`;
      const money =
        b.money.kind === 'cash'
          ? `<div class="s-cash"><span>${esc(b.money.label)}</span><b>${esc(b.money.amount)}</b><span>${esc(b.money.unit)}</span></div>`
          : `<div class="s-cash paid">${SVG.check}<span>${esc(b.money.text)}</span></div>`;
      return `<div class="stub"><div class="s-top"><div class="s-num"><small>${esc(b.numberLabel)}</small><b>${esc(b.number)}</b></div>${code}</div>${money}<div class="s-row"><span>${esc(b.items)}</span><span>${esc(b.bag)}</span></div>${
        b.courier ? `<div class="s-row"><span>${esc(b.courier)}</span></div>` : ''
      }</div>`;
    }
    case 'foot':
      return `<div class="foot"><span>${esc(b.start)}</span><span${b.wordmark ? ' class="wm"' : ''}>${esc(b.end)}</span></div>`;
    case 'store':
      return `<div class="c-store">${esc(b.text)}</div>`;
    case 'hello':
      return `<div class="c-hi">${esc(b.text)}</div>`;
    case 'meta':
      return `<div class="c-meta"><span>${esc(b.label)} <b>${esc(b.number)}</b></span><span>${esc(b.when)}</span></div>`;
    case 'double':
      return '<div class="dbl"></div>';
    case 'row':
      return `<div class="row${b.price == null ? ' np' : ''}"><span class="rq">${b.qty}</span><span class="rn">${esc(b.name)}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</span>${b.price != null ? `<span class="pr">${esc(b.price)}</span>` : ''}</div>`;
    case 'sum':
      return `<div class="sum">${b.rows.map((r) => `<div><span>${esc(r.label)}</span><span>${esc(r.value)}</span></div>`).join('')}</div>`;
    case 'total':
      return `<div class="tot"><span>${esc(b.label)}</span><b>${esc(b.amount)} <small>${esc(b.unit)}</small></b></div>`;
    case 'stamp':
      return b.kind === 'cash'
        ? `<div class="seal"><small>${esc(b.top)}</small><b>${esc(b.amount)}</b><small>${esc(b.unit)}</small></div>`
        : `<div class="seal paid">${SVG.check}<b>${esc(b.text)}</b></div>`;
    case 'help':
      return `<div class="c-help">${esc(b.text)}</div>`;
    case 'gift':
      return `<div class="g-top">${esc(b.title)}</div>${b.line ? `<div class="g-line">${esc(b.line)}</div>` : ''}<div class="g-from">${esc(b.from)}</div>`;
    case 'station':
      return `<div class="st-band"><b>${esc(b.name)}</b><span>${esc(b.part)}</span></div>`;
    case 'pack':
      return `<div class="pk">${SVG.box}<b>${b.qty}</b><span>${esc(b.name)}</span><small>${esc(b.station)}</small></div>`;
    case 'cup':
      return `<div class="cup"><div class="cup-h"><b>${esc(b.number)}</b><span>${esc(b.part)}</span></div><div class="cup-n">${esc(b.name)}</div><div class="cup-m">${esc(b.mods)}</div></div>`;
    case 'ruler':
      return `<div class="ruler">${b.bars.map((r) => `<div class="bar" style="width:${r.mm}mm"><span>${esc(r.label)}</span></div>`).join('')}</div>`;
    case 'text':
      return `<p class="txt${b.strong ? ' strong' : ''}${b.center ? ' center' : ''}">${esc(b.text)}</p>`;
  }
}

/** One document's paper, sized for its printer (the image is exactly `dots` wide). */
export function docPaperHtml(d: PrintDoc): string {
  const p = d.paper;
  const pad = p.paperMm === 58 ? 5 : 4;
  const vars = `--w:${p.contentMm + pad * 2}mm;--pad:${pad}mm;--num:${p.num}mm;--item:${p.item}mm;--mod:${p.mod}mm;--meta:${p.meta}mm;--qty:${p.qty}mm;--band:${p.band}mm`;
  return `<div class="paper ${d.kind}" data-mm="${p.paperMm}" dir="rtl" lang="ar" style="${vars}">${d.blocks.map(block).join('')}</div>`;
}

/** The CSS of the paper (black on white; there is no grey on a thermal head). */
export const PAPER_CSS = `
.paper{--ink:#000;background:#fff;color:var(--ink);font-family:'IBM Plex Sans Arabic','Noto Naskh Arabic',sans-serif;direction:rtl;text-align:right;width:var(--w);padding:5mm var(--pad) 6mm;line-height:1.28;font-size:var(--meta);box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.paper *{box-sizing:border-box}
.paper .mk{width:1em;height:1em;flex:none;vertical-align:-.12em}
.paper b{font-weight:700}
.paper small{font-size:.78em}
.paper .wm{font-family:'Alexandria',sans-serif;font-weight:700;letter-spacing:-.01em}
.r-head{display:flex;justify-content:space-between;align-items:flex-end;gap:2mm;border-bottom:.7mm solid var(--ink);padding-bottom:1.5mm}
.r-num{display:grid;line-height:.9}
.r-num small{font-size:var(--meta);font-weight:600}
.r-num b{font:700 var(--num)/.95 'Alexandria',sans-serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.r-ready{display:grid;justify-items:center;border:.6mm solid var(--ink);border-radius:1.6mm;padding:1mm 2.2mm 1.2mm;line-height:1}
.r-ready small{font-size:var(--meta);font-weight:600}
.r-ready b{font:700 calc(var(--num)*.4)/1.05 'Alexandria',sans-serif;font-variant-numeric:tabular-nums}
.r-sub{display:flex;flex-wrap:wrap;gap:1mm 3.5mm;font-weight:600;margin:1.6mm 0 2.2mm;font-size:var(--meta)}
.paper[data-mm="58"] .r-sub span+span::before{display:none}
.r-sub span+span::before{content:"";display:inline-block;width:1mm;height:1mm;background:var(--ink);border-radius:50%;margin-inline-end:3.5mm;vertical-align:.25em}
.alert{display:flex;gap:2.2mm;align-items:center;background:var(--ink);color:#fff;padding:1.8mm 2.6mm;border-radius:1.2mm;margin:2mm 0;font-size:calc(var(--item)*1.02)}
.alert .mk{width:1.25em;height:1.25em}
.alert .mk path:first-child{fill:#fff}.alert .mk path+path{stroke:var(--ink)}.alert .mk circle{fill:var(--ink)}
.alert div{display:grid;line-height:1.15}
.alert small{font-size:var(--meta);font-weight:600}
.alert.sm{font-size:var(--mod)}
.note{border:.45mm dashed var(--ink);border-radius:1.2mm;padding:1.4mm 2.2mm;font-weight:700;font-size:var(--mod);margin:2mm 0;display:grid}
.note small{font-weight:600;font-size:var(--meta)}
.who{display:flex;align-items:center;gap:2mm;margin:3mm 0 .6mm;font-weight:700;font-size:var(--meta)}
.who::after{content:"";flex:1;border-top:.35mm solid var(--ink)}
.who i{font-style:normal;font-family:'Alexandria',sans-serif;order:3;border:.35mm solid var(--ink);border-radius:99px;padding:0 1.6mm;line-height:1.35}
.who-note{font-weight:700;font-size:var(--mod)}
.it{display:grid;grid-template-columns:var(--qty) minmax(0,1fr);gap:2.4mm;align-items:start;margin-top:1.8mm}
.qy{display:grid;place-items:center;width:var(--qty);height:var(--qty);border:.6mm solid var(--ink);border-radius:1.3mm;font:700 calc(var(--qty)*.6)/1 'Alexandria',sans-serif;padding-bottom:.14em}
.qy.inv{background:var(--ink);color:#fff}
.nm{display:grid;line-height:1.2;padding-top:.6mm;min-width:0;overflow-wrap:anywhere}
.nm>b{font-size:var(--item)}
.nm>small{font-size:var(--meta);font-weight:600}
.nm ul{list-style:none;margin:.6mm 0 0;padding:0;display:grid;gap:.2mm;font-size:var(--mod);font-weight:600}
.nm li{display:flex;gap:1.4mm;align-items:center}
.nm li .mk{width:.8em;height:.8em}
.nm li.note .mk{width:.6em;height:.6em;margin-inline:.1em}
.nm.struck>b{text-decoration:line-through;text-decoration-thickness:.6mm}
.al-inline{display:inline-flex;gap:1.4mm;align-items:center;font-size:var(--mod);border:.6mm solid var(--ink);border-radius:1mm;padding:.3mm 1.6mm;margin-top:.8mm;width:fit-content}
.count{margin-top:3mm;border-top:.35mm solid var(--ink);padding-top:1.4mm;font-weight:600;font-size:var(--mod)}
.count b{font-family:'Alexandria',sans-serif}
.tear{display:flex;align-items:center;gap:1.5mm;margin:4mm 0 2.5mm;font-size:var(--meta);font-weight:600;white-space:nowrap}
.tear::before,.tear::after{content:"";flex:1;border-top:.45mm dashed var(--ink)}
.tear .mk{width:1.2em;height:1.2em}
.stub{border:.7mm solid var(--ink);border-radius:2mm;padding:2mm 2.4mm;display:grid;gap:1.6mm}
.s-top{display:flex;justify-content:space-between;align-items:flex-end;gap:2mm}
.s-num{display:grid;line-height:.95}
.s-num small,.s-code small{font-size:var(--meta);font-weight:600}
.s-num b{font:700 calc(var(--num)*.62)/1 'Alexandria',sans-serif;letter-spacing:-.02em}
.s-code{display:grid;justify-items:center;line-height:1;background:var(--ink);color:#fff;border-radius:1.4mm;padding:1.2mm 2.2mm 1.6mm}
.s-code b{font:700 calc(var(--num)*.4)/1.1 'Alexandria',sans-serif;letter-spacing:.06em}
.s-code.blank{background:#fff;color:var(--ink);border:.6mm solid var(--ink)}
.s-code.blank b{white-space:nowrap;font:600 calc(var(--meta)*.85)/1.4 'IBM Plex Sans Arabic',sans-serif;letter-spacing:0;border-bottom:.45mm dashed var(--ink);min-width:16mm;text-align:center;padding:1.2mm 0 .9mm;margin-top:.4mm}
.s-cash{display:flex;align-items:baseline;gap:2mm;font-weight:700;font-size:var(--mod);border-top:.35mm solid var(--ink);padding-top:1.4mm}
.s-cash b{font:700 calc(var(--item)*1.25)/1 'Alexandria',sans-serif}
.s-cash.paid{align-items:center}
.s-row{display:flex;justify-content:space-between;font-weight:600}
.foot{display:flex;justify-content:space-between;align-items:baseline;gap:2mm;margin-top:3mm;font-size:var(--meta)}
.band{background:var(--ink);color:#fff;font:700 var(--band)/1.2 'Alexandria','IBM Plex Sans Arabic',sans-serif;padding:1.6mm 2.4mm;border-radius:1.2mm;margin-bottom:2.4mm;display:grid;text-align:center}
.band span{font:600 var(--meta) 'IBM Plex Sans Arabic',sans-serif}
.out{border:.7mm solid var(--ink);border-radius:1.6mm;padding:2mm 2.4mm;margin-top:2.4mm}
.out.add{border-style:solid;border-width:.7mm}
.out-h{display:flex;gap:1.6mm;align-items:center;font-size:var(--item)}
.c-store{font:700 calc(var(--item)*1.4)/1.15 'Alexandria','IBM Plex Sans Arabic',sans-serif;text-align:center}
.c-hi{text-align:center;font-weight:600;font-size:var(--mod);margin-top:.6mm}
.c-meta{display:flex;justify-content:space-between;margin-top:2.4mm;font-weight:600}
.c-meta b{font-family:'Alexandria',sans-serif}
.dbl{border-top:.4mm solid var(--ink);border-bottom:.4mm solid var(--ink);height:1.3mm;margin:2mm 0}
.row{display:grid;grid-template-columns:5mm minmax(0,1fr) auto;gap:1.6mm;align-items:baseline;margin-top:1mm;font-size:var(--mod)}
.row.np{grid-template-columns:5mm minmax(0,1fr)}
.rq{font-family:'Alexandria',sans-serif;font-weight:700}
.rn{display:grid;font-weight:600;line-height:1.2}
.rn small{font-weight:500;font-size:var(--meta)}
.pr,.sum span:last-child{font-family:'Alexandria',sans-serif;font-weight:700;font-variant-numeric:tabular-nums;direction:ltr;text-align:right;min-width:3.6em}
.sum{border-top:.35mm dashed var(--ink);margin-top:2mm;padding-top:1.2mm;display:grid;gap:.4mm;font-size:var(--mod)}
.sum div{display:flex;justify-content:space-between}
.tot{display:flex;flex-wrap:wrap;gap:0 2mm;justify-content:space-between;align-items:baseline;border-top:.6mm solid var(--ink);margin-top:1.4mm;padding-top:1.2mm;font-weight:700;font-size:var(--item)}
.tot b{font:700 calc(var(--item)*1.15) 'Alexandria',sans-serif}
.tot small{font:600 var(--meta) 'IBM Plex Sans Arabic',sans-serif}
.seal{display:grid;justify-items:center;width:fit-content;margin:3mm auto 1mm;border:.8mm solid var(--ink);border-radius:50%;aspect-ratio:1;align-content:center;padding:3mm;min-width:calc(var(--num)*1.55);transform:rotate(-5deg);line-height:1.05;box-shadow:inset 0 0 0 .8mm #fff,inset 0 0 0 1.2mm var(--ink)}
.seal small{font-weight:700;font-size:var(--meta)}
.seal b{font:700 calc(var(--item)*1.1) 'Alexandria',sans-serif}
.seal.paid{border-radius:2mm;aspect-ratio:auto;display:flex;gap:1.6mm;align-items:center;padding:1.6mm 3mm;font-size:var(--mod);min-width:0;transform:none;box-shadow:none}
.seal.paid b{font:700 var(--mod) 'IBM Plex Sans Arabic',sans-serif}
.c-help{text-align:center;font-weight:500;margin-top:2.4mm;font-size:var(--meta);text-wrap:balance}
.paper.slip .foot,.paper.gift .foot{border-top:.35mm solid var(--ink);padding-top:1.2mm;margin-top:2.4mm}
.g-top{font:700 calc(var(--item)*1.6)/1.1 'Alexandria','IBM Plex Sans Arabic',sans-serif;text-align:center}
.g-line{font-weight:700;font-size:calc(var(--item)*1.05);text-align:center;margin-top:2mm;text-wrap:balance}
.g-from{text-align:center;font-weight:500;margin-top:1mm}
.st-band{display:flex;justify-content:space-between;align-items:center;background:var(--ink);color:#fff;border-radius:1.2mm;padding:1.4mm 2.4mm;margin-bottom:2mm}
.st-band b{font:700 var(--band) 'Alexandria','IBM Plex Sans Arabic',sans-serif}
.st-band span{font-weight:600;font-family:'Alexandria',sans-serif}
.pk{display:grid;grid-template-columns:auto 5mm minmax(0,1fr) auto;gap:1.8mm;align-items:center;font-size:var(--mod);margin-top:1.2mm;font-weight:600}
.pk .mk{width:1.15em;height:1.15em}
.pk b{font-family:'Alexandria',sans-serif}
.pk small{border:.35mm solid var(--ink);border-radius:99px;padding:0 1.4mm;font-size:var(--meta)}
.paper.cups{padding-top:2mm}
.cup{border-bottom:.45mm dashed var(--ink);padding:2mm 0 2.6mm}
.cup-h{display:flex;justify-content:space-between;align-items:baseline}
.cup-h b{font:700 calc(var(--num)*.55)/1 'Alexandria',sans-serif}
.cup-h span{font-family:'Alexandria',sans-serif;font-weight:700}
.cup-n{font-weight:700;font-size:var(--item);margin-top:.6mm}
.cup-m{font-weight:600;font-size:var(--meta);min-height:1em}
.ruler{direction:ltr;display:grid;justify-items:start;gap:2mm;margin:3mm 0}
.ruler .bar{background:var(--ink);color:#fff;height:8mm;display:flex;align-items:center;justify-content:flex-end;padding-inline:2mm;font:700 4.4mm 'Alexandria','IBM Plex Sans Arabic',sans-serif}
.txt{margin:1.6mm 0;font-size:var(--mod);font-weight:500;line-height:1.35}
.txt.strong{font-weight:700}
.txt.center{text-align:center;text-wrap:balance}
`;

export interface DocHtmlOptions {
  /** `@font-face` rules for IBM Plex Sans Arabic and Alexandria (the app's bundled files). */
  fontCss?: string;
  /** Screen preview: papers on a desk with gaps; print: one paper per page. */
  mode?: 'print' | 'screen';
}

export function jobHtml(job: PrintJob, opts: DocHtmlOptions = {}): string {
  const width = Math.max(...job.docs.map((d) => d.paper.paperMm));
  const screen = opts.mode === 'screen';
  const page = screen
    ? 'body{margin:0;background:#E9DFD2;display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm 0}.paper{box-shadow:0 2px 10px rgba(50,30,10,.25)}'
    : `@page{size:${width}mm auto;margin:0}body{margin:0;background:#fff}.paper{${job.cut ? 'break-after:page;' : ''}}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${esc(job.number || 'print')}</title><style>${opts.fontCss ?? ''}${PAPER_CSS}${page}</style></head><body>${job.docs.map(docPaperHtml).join('')}</body></html>`;
}
