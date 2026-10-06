import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ZonePlacementView } from '@driver/contracts';
import { closedEditor, editorReducer } from '@/lib/zone-editor';
import { ZonesBoard, type ZonesBoardProps } from './zones-page';

/** Zones page smoke test: the board renders the list, progress and toolbar from realistic data (no API, no map). */

const RING = [
  { lat: 32.9, lng: 45.05 },
  { lat: 32.9, lng: 45.07 },
  { lat: 32.91, lng: 45.06 },
];
const zone = (key: string, name_ar: string, over: Partial<ZonePlacementView> = {}): ZonePlacementView => ({
  key,
  name_ar,
  name_en: key,
  tier: 'centre',
  group: 'centre',
  placement: 'draft',
  ring: RING,
  centre: { lat: 32.903, lng: 45.06 },
  areaM2: 1_234_000,
  placedBy: null,
  placedAt: null,
  ...over,
});
const ZONES = [zone('centre', 'العزيزية (مركز)', { placement: 'placed', placedBy: 'علي', placedAt: new Date('2026-10-05T10:00:00Z') }), zone('street_30', 'شارع 30')];

const board = (over: Partial<ZonesBoardProps> = {}): string =>
  renderToString(
    <ZonesBoard
      zones={ZONES}
      loading={false}
      error={null}
      editor={closedEditor}
      canEdit
      problem={null}
      problemText={null}
      dirty={false}
      saving={false}
      saveError={null}
      onPick={() => undefined}
      onUndo={() => undefined}
      onReset={() => undefined}
      onRemoveCorner={() => undefined}
      onSave={() => undefined}
      map={null}
      {...over}
    />,
  );

describe('Zones page', () => {
  it('lists every zone with its state and the placement progress', () => {
    const html = board();
    expect(html).toContain('1 من 2 محطوطة');
    expect(html).toContain('العزيزية (مركز)');
    expect(html).toContain('شارع 30');
    expect(html).toContain('محطوطة');
    expect(html).toContain('تخمين');
    expect(html).toContain('اختار منطقة من القائمة');
  });

  it('an open zone shows its area, who placed it, the problem and the edit buttons', () => {
    const editor = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 } });
    const html = board({ editor, problemText: 'الحدود متقاطعة ويا نفسها' });
    expect(html).toContain('1.2 كم²');
    expect(html).toContain('حطّها علي');
    expect(html).toContain('الحدود متقاطعة ويا نفسها');
    expect(html).toContain('احفظ الحدود');
  });

  it('read-only roles get no edit buttons', () => {
    const editor = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 } });
    const html = board({ editor, canEdit: false });
    expect(html).toContain('للقراءة بس');
    expect(html).not.toContain('احفظ الحدود');
  });

  it('drivers\' checks: the count toward confirmed on the open zone, and a flag after a "no"', () => {
    const editor = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 } });
    const counting = board({ editor, zones: [zone('centre', 'العزيزية (مركز)', { placement: 'placed', placedAt: new Date('2026-10-05T10:00:00Z'), checks: { yes: 2, no: 0, drivers: 1, flaggedAt: null } })] });
    expect(counting).toContain('2/3 تأكيد');
    expect(counting).not.toContain('سايق قال لا');
    const flagged = board({ editor, zones: [zone('centre', 'العزيزية (مركز)', { placement: 'placed', placedAt: new Date('2026-10-05T10:00:00Z'), checks: { yes: 1, no: 1, drivers: 1, flaggedAt: new Date('2026-10-06T08:00:00Z') } })] });
    expect(flagged).toContain('سايق قال لا');
  });

  it('«تم الفحص» shows on a flagged open zone for editors only, at 44 px', () => {
    // The button whose label is «تم الفحص» (the flag chip's hint also names it, inside a title).
    const markButton = /<button[^>]*class="([^"]*)"[^>]*>(?:<[^>]*>)*تم الفحص(?:<[^>]*>)*<\/button>/;
    const editor = editorReducer(closedEditor, { type: 'open', key: 'centre', ring: RING, centre: { lat: 32.903, lng: 45.06 } });
    const placedAt = new Date('2026-10-05T10:00:00Z');
    const flaggedZones = [zone('centre', 'العزيزية (مركز)', { placement: 'placed', placedAt, checks: { yes: 2, no: 1, drivers: 2, flaggedAt: new Date('2026-10-06T08:00:00Z') } })];
    const flagged = board({ editor, zones: flaggedZones, onMarkChecked: () => undefined });
    expect(flagged.match(markButton)?.[1]).toMatch(/\bh-11\b/);
    expect(board({ editor, zones: flaggedZones, onMarkChecked: () => undefined, canEdit: false })).not.toMatch(markButton);
    // After the check: no flag, no button, the count toward confirmation shows.
    const checked = board({ editor, zones: [zone('centre', 'العزيزية (مركز)', { placement: 'placed', placedAt, checks: { yes: 2, no: 0, drivers: 2, flaggedAt: null } })], onMarkChecked: () => undefined });
    expect(checked).not.toMatch(markButton);
    expect(checked).not.toContain('سايق قال لا');
    expect(checked).toContain('2/3 تأكيد');
  });
});
