import { describe, expect, it } from 'vitest';
import type { AdminMenu, AdminMenuItem } from '@driver/contracts';
import { POT_UNTIL_CHOICES, potCandidates, potNote, potNoteLeft, sameStory, storyDraftFrom, storyLeft, storyProblems, toStoryInput } from './logic';

const item = (id: string, nameAr: string, onSale = true): AdminMenuItem => ({ id, nameAr, nameEn: null, description: null, priceIqd: 5000, photoUrl: null, categoryAr: null, sortOrder: 0, prepTimeMin: 10, available: onSale, soldOutUntil: null, onSale, modifierGroups: [], servesMin: null, servesMax: null, labels: [] });
const MENU: AdminMenu = { merchantOrgId: 'm', categories: [{ nameAr: 'تمن ومرق', items: [item('a', 'تمن وبامية'), item('b', 'تمن وفاصوليا', false), item('c', 'دولمة')] }] };

describe('pot', () => {
  it('only dishes on sale, filtered by the search (folded Arabic)', () => {
    expect(potCandidates(MENU, '').map((i) => i.id)).toEqual(['a', 'c']);
    expect(potCandidates(MENU, 'باميه').map((i) => i.id)).toEqual(['a']);
    expect(potCandidates(undefined, '')).toEqual([]);
  });
  it('«لحد» starts with «لحد ما يخلص»', () => {
    expect(POT_UNTIL_CHOICES[0]).toBeNull();
  });
  it('the note stops at 60 characters', () => {
    expect(potNote('ا'.repeat(70))).toHaveLength(60);
    expect(potNoteLeft(' ويا لحم ')).toBe(53);
  });
});

describe('story', () => {
  const base = storyDraftFrom({ text: null, sinceYear: null, shown: false });
  it('starts empty and knows when nothing changed', () => {
    expect(base).toEqual({ text: '', year: '', shown: false });
    expect(sameStory(base, { ...base, text: '  ' })).toBe(true);
    expect(sameStory(base, { ...base, shown: true })).toBe(false);
  });
  it('checks length, lines, the year and that something is shown', () => {
    expect(storyProblems({ text: 'ا'.repeat(181), year: '', shown: false }, 2026)).toEqual(['too_long']);
    expect(storyProblems({ text: 'أ\nب\nج\nد', year: '', shown: false }, 2026)).toEqual(['too_many_lines']);
    expect(storyProblems({ text: 'قصة', year: '2030', shown: true }, 2026)).toEqual(['year']);
    expect(storyProblems({ text: 'قصة', year: '٢٠٠٩', shown: true }, 2026)).toEqual([]);
    expect(storyProblems({ text: '', year: '', shown: true }, 2026)).toEqual(['nothing_to_show']);
    expect(storyLeft({ text: 'abc', year: '', shown: false })).toBe(177);
  });
  it('the save call reads Eastern digits and never shows an empty story', () => {
    expect(toStoryInput('m', { text: ' من أيام أبوي ', year: '٢٠٠٩', shown: true })).toEqual({ merchantOrgId: 'm', text: 'من أيام أبوي', sinceYear: 2009, shown: true });
    expect(toStoryInput('m', { text: '', year: '', shown: true })).toEqual({ merchantOrgId: 'm', text: null, sinceYear: null, shown: false });
  });
});
