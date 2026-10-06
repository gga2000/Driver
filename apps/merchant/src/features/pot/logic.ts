import { KITCHEN_STORY_RULES, POT_RULES, storyLines, type AdminMenu, type AdminMenuItem, type KitchenStoryView, type SetKitchenStoryInput } from '@driver/contracts';
import { itemMatches, westernDigits } from '@/features/menu/logic';

/**
 * «قدر اليوم» and «مطاعمنا» in the Merchant app (joy h2/h5) as plain data: which dishes can be today's
 * pot, the «لحد» choices, the note limit, and the story draft with its checks. Pure, so the rules are
 * tested without a screen.
 */

/** «لحد ما يخلص» (null) or until lunch is over, the afternoon, the night. */
export const POT_UNTIL_CHOICES: readonly (string | null)[] = [null, '15:00', '17:00', '22:00'];

/** Dishes that can be today's pot: on sale now, matching the search, in menu order. */
export function potCandidates(menu: AdminMenu | undefined, query: string): AdminMenuItem[] {
  return (menu?.categories ?? []).flatMap((c) => c.items).filter((i) => i.onSale && itemMatches(i, query));
}

/** The note cut to what the API accepts, so typing past the limit simply stops. */
export function potNote(text: string): string {
  return text.slice(0, POT_RULES.noteMaxChars);
}

export function potNoteLeft(text: string): number {
  return Math.max(0, POT_RULES.noteMaxChars - text.trim().length);
}

export interface StoryDraft {
  text: string;
  /** As typed; Eastern digits are read too. */
  year: string;
  shown: boolean;
}

export function storyDraftFrom(view: Pick<KitchenStoryView, 'text' | 'sinceYear' | 'shown'>): StoryDraft {
  return { text: view.text ?? '', year: view.sinceYear !== null ? String(view.sinceYear) : '', shown: view.shown };
}

export function sameStory(a: StoryDraft, b: StoryDraft): boolean {
  return a.text.trim() === b.text.trim() && a.year.trim() === b.year.trim() && a.shown === b.shown;
}

export type StoryProblem = 'too_long' | 'too_many_lines' | 'year' | 'nothing_to_show';

/** What stops the save, in the order the screen says it. */
export function storyProblems(d: StoryDraft, thisYear: number): StoryProblem[] {
  const out: StoryProblem[] = [];
  const text = d.text.trim();
  if (text.length > KITCHEN_STORY_RULES.textMaxChars) out.push('too_long');
  if (storyLines(text) > KITCHEN_STORY_RULES.maxLines) out.push('too_many_lines');
  const year = d.year.trim();
  if (year) {
    const n = Number(westernDigits(year));
    if (!Number.isInteger(n) || n < KITCHEN_STORY_RULES.minYear || n > thisYear) out.push('year');
  }
  if (d.shown && !text) out.push('nothing_to_show');
  return out;
}

export function storyLeft(d: StoryDraft): number {
  return Math.max(0, KITCHEN_STORY_RULES.textMaxChars - d.text.trim().length);
}

/** The save call: a blank story is none (and then nothing shows). */
export function toStoryInput(merchantOrgId: string, d: StoryDraft): SetKitchenStoryInput {
  const text = d.text.trim();
  const year = d.year.trim();
  return { merchantOrgId, text: text || null, sinceYear: year ? Number(westernDigits(year)) : null, shown: d.shown && Boolean(text) };
}
