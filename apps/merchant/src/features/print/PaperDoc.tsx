import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text } from '@driver/ui';
import { color } from '@driver/design-tokens';
import type { Block, PrintDoc, PrintItem, PrintMod } from '@/print/doc';

/**
 * A printed document on screen at true proportions (print redesign «الريل»): every size is the
 * mock-up's millimetres × `pxPerMm`. 4 px/mm is the on-screen preview; the tablet build draws the same
 * component at 8 px/mm (one pixel per printer dot) to make the image the printer gets. Black on white
 * only: no grey reaches a thermal head.
 */

const INK = color.neutral[1000];
const PAPER = color.neutral[0];

type Mark = 'warn' | 'plus' | 'no' | 'dot' | 'cut' | 'check' | 'box';

function Icon({ name, size, fg = INK, bg = PAPER }: { name: Mark; size: number; fg?: string; bg?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'warn' ? (
        <>
          <Path d="M12 2.5 23 21.5H1Z" fill={fg} />
          <Path d="M12 9v6" stroke={bg} strokeWidth={2.6} strokeLinecap="round" />
          <Circle cx={12} cy={18.2} r={1.5} fill={bg} />
        </>
      ) : null}
      {name === 'plus' ? <Path d="M12 5v14M5 12h14" stroke={fg} strokeWidth={3} strokeLinecap="round" /> : null}
      {name === 'no' ? <Path d="M5 5l14 14M19 5 5 19" stroke={fg} strokeWidth={3.4} strokeLinecap="round" /> : null}
      {name === 'dot' ? <Circle cx={12} cy={12} r={4.5} fill={fg} /> : null}
      {name === 'check' ? <Path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke={fg} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'box' ? <Rect x={3} y={3} width={18} height={18} rx={2} fill="none" stroke={fg} strokeWidth={2.4} /> : null}
      {name === 'cut' ? (
        <>
          <Circle cx={6} cy={6} r={3} fill="none" stroke={fg} strokeWidth={2} />
          <Circle cx={6} cy={18} r={3} fill="none" stroke={fg} strokeWidth={2} />
          <Path d="M8.5 7.5 21 18M8.5 16.5 21 6" stroke={fg} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : null}
    </Svg>
  );
}

interface Scale {
  mm: (n: number) => number;
  spec: PrintDoc['paper'];
}

/** Paper text: fixed size (the app's text-size setting never reflows a ticket), ink colour. */
function P({ size, weight = 600, display, center, color: c = INK, children, strike, lh = 1.25 }: { size: number; weight?: 400 | 500 | 600 | 700; display?: boolean; center?: boolean; color?: string; children: ReactNode; strike?: boolean; lh?: number }) {
  return (
    <Text
      fixed
      allowFontScaling={false}
      weight={weight}
      {...(display ? { face: 'display' as const } : {})}
      {...(center ? { align: 'center' as const } : {})}
      style={{ color: c, fontSize: size, lineHeight: Math.round(size * lh), ...(strike ? { textDecorationLine: 'line-through' as const } : {}) }}
    >
      {children}
    </Text>
  );
}

function Rule({ s, w = 0.35, dashed, style }: { s: Scale; w?: number; dashed?: boolean; style?: ViewStyle }) {
  return <View style={[{ borderTopWidth: Math.max(1, s.mm(w)), borderColor: INK, borderStyle: dashed ? 'dashed' : 'solid' }, style]} />;
}

function Mod({ m, s }: { m: PrintMod; s: Scale }) {
  const size = s.mm(s.spec.mod);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s.mm(1.4) }}>
      <Icon name={m.mark === 'plus' ? 'plus' : m.mark === 'no' ? 'no' : 'dot'} size={size * (m.mark === 'note' ? 0.6 : 0.8)} />
      <P size={size} weight={m.mark === 'plus' ? 600 : 700}>
        {m.text}
      </P>
    </View>
  );
}

function Item({ i, s, struck }: { i: PrintItem; s: Scale; struck?: boolean }) {
  const q = s.mm(s.spec.qty);
  const inv = i.qty >= 2;
  return (
    <View style={{ flexDirection: 'row', gap: s.mm(2.4), marginTop: s.mm(1.8), alignItems: 'flex-start' }}>
      <View style={{ width: q, height: q, borderWidth: Math.max(1, s.mm(0.6)), borderColor: INK, borderRadius: s.mm(1.3), backgroundColor: inv ? INK : PAPER, alignItems: 'center', justifyContent: 'center' }}>
        <P size={q * 0.6} display color={inv ? PAPER : INK} lh={1.1}>
          {String(i.qty)}
        </P>
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: s.mm(0.6) }}>
        <P size={s.mm(s.spec.item)} weight={700} strike={struck} lh={1.2}>
          {i.name}
        </P>
        {i.sub ? <P size={s.mm(s.spec.meta)}>{i.sub}</P> : null}
        {i.mods.map((m, k) => (
          <Mod key={k} m={m} s={s} />
        ))}
        {i.allergy ? (
          <View style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: s.mm(1.4), borderWidth: Math.max(1, s.mm(0.6)), borderColor: INK, borderRadius: s.mm(1), paddingHorizontal: s.mm(1.6), marginTop: s.mm(0.8) }}>
            <Icon name="warn" size={s.mm(s.spec.mod)} />
            <P size={s.mm(s.spec.mod)} weight={700}>
              {i.allergy}
            </P>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** An amount in a column: right edges line up (start side of an RTL row is the right). */
function Amount({ size, children }: { size: number; children: string }) {
  return (
    <View style={{ minWidth: size * 3.6, alignItems: 'flex-start' }}>
      <P size={size} display>
        {children}
      </P>
    </View>
  );
}

function Pair({ s, start, end, size, weight = 600, style }: { s: Scale; start: ReactNode; end: ReactNode; size?: number; weight?: 400 | 500 | 600 | 700; style?: ViewStyle }) {
  const z = size ?? s.mm(s.spec.meta);
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: s.mm(2) }, style]}>
      {typeof start === 'string' ? <P size={z} weight={weight}>{start}</P> : start}
      {typeof end === 'string' ? <P size={z} weight={weight}>{end}</P> : end}
    </View>
  );
}

function BlockView({ b, s }: { b: Block; s: Scale }) {
  const { spec, mm } = s;
  const meta = mm(spec.meta);
  const modSize = mm(spec.mod);
  const itemSize = mm(spec.item);
  switch (b.t) {
    case 'band':
      return (
        <View style={{ backgroundColor: INK, borderRadius: mm(1.2), paddingVertical: mm(1.6), paddingHorizontal: mm(2.4), marginBottom: mm(2.4), alignItems: 'center' }}>
          <P size={mm(spec.band)} weight={700} color={PAPER} center>
            {b.title}
          </P>
          {b.sub ? (
            <P size={meta} color={PAPER} center>
              {b.sub}
            </P>
          ) : null}
        </View>
      );
    case 'head':
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: mm(2), borderBottomWidth: Math.max(1, mm(0.7)), borderColor: INK, paddingBottom: mm(1.5) }}>
          <View>
            <P size={meta}>{b.label}</P>
            <P size={mm(spec.num)} display lh={1}>
              {b.number}
            </P>
          </View>
          {b.code ? (
            <View style={{ backgroundColor: INK, borderRadius: mm(1.4), paddingHorizontal: mm(2.2), paddingVertical: mm(1.2), alignItems: 'center' }}>
              <P size={meta} color={PAPER}>
                {b.code.label}
              </P>
              <P size={mm(spec.num * 0.4)} display color={PAPER} lh={1.1}>
                {b.code.value}
              </P>
            </View>
          ) : b.ready ? (
            <View style={{ borderWidth: Math.max(1, mm(0.6)), borderColor: INK, borderRadius: mm(1.6), paddingHorizontal: mm(2.2), paddingVertical: mm(1), alignItems: 'center' }}>
              <P size={meta} lh={1.1}>
                {b.ready.label}
              </P>
              <P size={mm(spec.num * 0.4)} display lh={1.1}>
                {b.ready.time}
              </P>
              {b.ready.period ? (
                <P size={meta} lh={1.1}>
                  {b.ready.period}
                </P>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    case 'facts':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: mm(3.5), marginTop: mm(1.6), marginBottom: mm(2.2) }}>
          {b.parts.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: mm(3.5) }}>
              {i > 0 && spec.paperMm === 80 ? <View style={{ width: mm(1), height: mm(1), borderRadius: mm(0.5), backgroundColor: INK }} /> : null}
              <P size={meta}>{p}</P>
            </View>
          ))}
        </View>
      );
    case 'alert': {
      const size = b.small ? modSize : itemSize * 1.02;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(2.2), backgroundColor: INK, borderRadius: mm(1.2), paddingVertical: mm(1.8), paddingHorizontal: mm(2.6), marginVertical: mm(2) }}>
          <Icon name="warn" size={size * 1.25} fg={PAPER} bg={INK} />
          <View style={{ flex: 1 }}>
            <P size={size} weight={700} color={PAPER} lh={1.15}>
              {b.title}
            </P>
            {b.sub ? (
              <P size={meta} color={PAPER} lh={1.15}>
                {b.sub}
              </P>
            ) : null}
          </View>
        </View>
      );
    }
    case 'note':
      return (
        <View style={{ borderWidth: Math.max(1, mm(0.45)), borderStyle: 'dashed', borderColor: INK, borderRadius: mm(1.2), paddingVertical: mm(1.4), paddingHorizontal: mm(2.2), marginVertical: mm(2) }}>
          <P size={meta}>{b.label}</P>
          <P size={modSize} weight={700}>
            {b.text}
          </P>
        </View>
      );
    case 'who':
      return (
        <View style={{ marginTop: mm(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(2) }}>
            <P size={meta} weight={700}>
              {b.label}
            </P>
            <Rule s={s} style={{ flex: 1 }} />
            {b.count != null ? (
              <View style={{ borderWidth: Math.max(1, mm(0.35)), borderColor: INK, borderRadius: 99, paddingHorizontal: mm(1.6) }}>
                <P size={meta} display lh={1.35}>
                  {String(b.count)}
                </P>
              </View>
            ) : null}
          </View>
          {b.note ? (
            <P size={modSize} weight={700}>
              {b.note}
            </P>
          ) : null}
        </View>
      );
    case 'item':
      return <Item i={b} s={s} />;
    case 'box':
      return (
        <View style={{ borderWidth: Math.max(1, mm(0.7)), borderColor: INK, borderRadius: mm(1.6), padding: mm(2.2), marginTop: mm(2.4) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(1.6) }}>
            <Icon name={b.tone === 'out' ? 'no' : 'plus'} size={itemSize} />
            <P size={itemSize} weight={700}>
              {b.title}
            </P>
          </View>
          {b.items.map((i, k) => (
            <Item key={k} i={i} s={s} struck={b.tone === 'out'} />
          ))}
        </View>
      );
    case 'count':
      return (
        <View style={{ marginTop: mm(3), borderTopWidth: Math.max(1, mm(0.35)), borderColor: INK, paddingTop: mm(1.4) }}>
          <P size={modSize}>{b.text}</P>
        </View>
      );
    case 'tear':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(1.5), marginTop: mm(4), marginBottom: mm(2.5) }}>
          <Rule s={s} w={0.45} dashed style={{ flex: 1 }} />
          <Icon name="cut" size={meta * 1.2} />
          <P size={meta}>{b.text}</P>
          <Rule s={s} w={0.45} dashed style={{ flex: 1 }} />
        </View>
      );
    case 'stub':
      return (
        <View style={{ borderWidth: Math.max(1, mm(0.7)), borderColor: INK, borderRadius: mm(2), paddingVertical: mm(2), paddingHorizontal: mm(2.4), gap: mm(1.6) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: mm(2) }}>
            <View>
              <P size={meta}>{b.numberLabel}</P>
              <P size={mm(spec.num * 0.62)} display lh={1}>
                {b.number}
              </P>
            </View>
            <View style={{ backgroundColor: b.code.value != null ? INK : PAPER, borderWidth: b.code.value != null ? 0 : Math.max(1, mm(0.6)), borderColor: INK, borderRadius: mm(1.4), paddingHorizontal: mm(2.2), paddingVertical: mm(1.2), alignItems: 'center' }}>
              <P size={meta} color={b.code.value != null ? PAPER : INK}>
                {b.code.label}
              </P>
              {b.code.value != null ? (
                <P size={mm(spec.num * 0.4)} display color={PAPER} lh={1.1}>
                  {b.code.value}
                </P>
              ) : (
                <P size={meta}>{b.code.blank}</P>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(2), borderTopWidth: Math.max(1, mm(0.35)), borderColor: INK, paddingTop: mm(1.4) }}>
            {b.money.kind === 'cash' ? (
              <>
                <P size={modSize} weight={700}>
                  {b.money.label}
                </P>
                <P size={itemSize * 1.25} display lh={1}>
                  {b.money.amount}
                </P>
                <P size={modSize} weight={700}>
                  {b.money.unit}
                </P>
              </>
            ) : (
              <>
                <Icon name="check" size={modSize} />
                <P size={modSize} weight={700}>
                  {b.money.text}
                </P>
              </>
            )}
          </View>
          <Pair s={s} start={b.items} end={b.bag} />
          {b.courier ? <P size={meta}>{b.courier}</P> : null}
        </View>
      );
    case 'foot':
      return (
        <Pair
          s={s}
          style={{ marginTop: mm(3) }}
          start={b.start}
          end={
            b.wordmark ? (
              <P size={meta} display>
                {b.end}
              </P>
            ) : (
              b.end
            )
          }
        />
      );
    case 'store':
      return (
        <P size={itemSize * 1.4} display center lh={1.2}>
          {b.text}
        </P>
      );
    case 'hello':
      return (
        <P size={modSize} center>
          {b.text}
        </P>
      );
    case 'meta':
      return (
        <Pair
          s={s}
          style={{ marginTop: mm(2.4) }}
          start={
            <P size={meta}>
              {b.label}{' '}
              <Text fixed face="display" style={{ fontSize: meta, color: INK }}>
                {b.number}
              </Text>
            </P>
          }
          end={b.when}
        />
      );
    case 'double':
      return <View style={{ borderTopWidth: Math.max(1, mm(0.4)), borderBottomWidth: Math.max(1, mm(0.4)), borderColor: INK, height: mm(1.3), marginVertical: mm(2) }} />;
    case 'row':
      return (
        <View style={{ flexDirection: 'row', gap: mm(1.6), marginTop: mm(1), alignItems: 'flex-start' }}>
          <View style={{ width: mm(5) }}>
            <P size={modSize} display>
              {String(b.qty)}
            </P>
          </View>
          <View style={{ flex: 1 }}>
            <P size={modSize}>{b.name}</P>
            {b.sub ? (
              <P size={meta} weight={500}>
                {b.sub}
              </P>
            ) : null}
          </View>
          {b.price != null ? <Amount size={modSize}>{b.price}</Amount> : null}
        </View>
      );
    case 'sum':
      return (
        <View style={{ borderTopWidth: Math.max(1, mm(0.35)), borderStyle: 'dashed', borderColor: INK, marginTop: mm(2), paddingTop: mm(1.2) }}>
          {b.rows.map((r, i) => (
            <Pair key={i} s={s} size={modSize} start={r.label} end={<Amount size={modSize}>{r.value}</Amount>} />
          ))}
        </View>
      );
    case 'total':
      return (
        <Pair
          s={s}
          style={{ borderTopWidth: Math.max(1, mm(0.6)), borderColor: INK, marginTop: mm(1.4), paddingTop: mm(1.2) }}
          start={
            <P size={itemSize} weight={700}>
              {b.label}
            </P>
          }
          end={
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: mm(1) }}>
              <P size={itemSize * 1.15} display>
                {b.amount}
              </P>
              <P size={meta}>{b.unit}</P>
            </View>
          }
        />
      );
    case 'stamp':
      return b.kind === 'cash' ? (
        <View style={{ alignSelf: 'center', marginTop: mm(3), marginBottom: mm(1), width: mm(spec.num * 2), height: mm(spec.num * 2), borderRadius: 999, borderWidth: Math.max(1, mm(0.8)), borderColor: INK, padding: mm(0.8), transform: [{ rotate: '-5deg' }] }}>
          <View style={{ flex: 1, borderRadius: 999, borderWidth: Math.max(1, mm(0.4)), borderColor: INK, alignItems: 'center', justifyContent: 'center' }}>
            <P size={meta} weight={700} center lh={1.1}>
              {b.top}
            </P>
            <P size={itemSize * 0.95} display center lh={1.1}>
              {b.amount}
            </P>
            <P size={meta} weight={700} center lh={1.1}>
              {b.unit}
            </P>
          </View>
        </View>
      ) : (
        <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: mm(1.6), borderWidth: Math.max(1, mm(0.8)), borderColor: INK, borderRadius: mm(2), paddingVertical: mm(1.6), paddingHorizontal: mm(3), marginTop: mm(3), marginBottom: mm(1) }}>
          <Icon name="check" size={modSize} />
          <P size={modSize} weight={700}>
            {b.text}
          </P>
        </View>
      );
    case 'help':
      return (
        <View style={{ marginTop: mm(2.4) }}>
          <P size={meta} weight={500} center>
            {b.text}
          </P>
        </View>
      );
    case 'gift':
      return (
        <View>
          <P size={itemSize * 1.6} display center lh={1.15}>
            {b.title}
          </P>
          {b.line ? (
            <P size={itemSize * 1.05} weight={700} center>
              {b.line}
            </P>
          ) : null}
          <P size={meta} weight={500} center>
            {b.from}
          </P>
        </View>
      );
    case 'station':
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: INK, borderRadius: mm(1.2), paddingVertical: mm(1.4), paddingHorizontal: mm(2.4), marginBottom: mm(2) }}>
          <P size={mm(spec.band)} display color={PAPER}>
            {b.name}
          </P>
          <P size={meta} display color={PAPER}>
            {b.part}
          </P>
        </View>
      );
    case 'pack':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: mm(1.8), marginTop: mm(1.2) }}>
          <Icon name="box" size={modSize * 1.15} />
          <View style={{ width: mm(5) }}>
            <P size={modSize} display>
              {String(b.qty)}
            </P>
          </View>
          <View style={{ flex: 1 }}>
            <P size={modSize}>{b.name}</P>
          </View>
          <View style={{ borderWidth: Math.max(1, mm(0.35)), borderColor: INK, borderRadius: 99, paddingHorizontal: mm(1.4) }}>
            <P size={meta}>{b.station}</P>
          </View>
        </View>
      );
    case 'cup':
      return (
        <View style={{ borderBottomWidth: Math.max(1, mm(0.45)), borderStyle: 'dashed', borderColor: INK, paddingTop: mm(2), paddingBottom: mm(2.6) }}>
          <Pair s={s} start={<P size={mm(spec.num * 0.55)} display lh={1}>{b.number}</P>} end={<P size={meta} display>{b.part}</P>} />
          <P size={itemSize} weight={700}>
            {b.name}
          </P>
          <P size={meta}>{b.mods || ' '}</P>
        </View>
      );
    case 'ruler':
      return (
        <View style={{ direction: 'ltr', gap: mm(2), marginVertical: mm(3), alignItems: 'flex-start' }}>
          {b.bars.map((r, i) => (
            <View key={i} style={{ width: mm(r.mm), height: mm(8), backgroundColor: INK, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: mm(2) }}>
              <P size={mm(4.4)} display color={PAPER}>
                {r.label}
              </P>
            </View>
          ))}
        </View>
      );
    case 'text':
      return (
        <View style={{ marginVertical: mm(1.6) }}>
          <P size={modSize} weight={b.strong ? 700 : 500} {...(b.center ? { center: true } : {})} lh={1.35}>
            {b.text}
          </P>
        </View>
      );
  }
}

/** One document's paper. `pxPerMm` 4 on screen (an 80 mm roll is 320 px), 8 for the printer image. */
export function PaperDoc({ doc, pxPerMm = 4, testID }: { doc: PrintDoc; pxPerMm?: number; testID?: string }) {
  const s: Scale = { mm: (n) => n * pxPerMm, spec: doc.paper };
  const pad = doc.paper.paperMm === 58 ? 5 : 4;
  return (
    <View testID={testID} style={{ width: s.mm(doc.paper.contentMm + pad * 2), backgroundColor: PAPER, paddingHorizontal: s.mm(pad), paddingTop: s.mm(doc.kind === 'cups' ? 2 : 5), paddingBottom: s.mm(6) }}>
      {doc.blocks.map((b, i) => (
        <BlockView key={i} b={b} s={s} />
      ))}
    </View>
  );
}
