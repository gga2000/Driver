import { describe, expect, it } from 'vitest';
import { splitFare } from './home-card';

describe('the home ride card: place in the words, fare on the road', () => {
  it('takes the fare after the last « · » and keeps it on one line', () => {
    expect(splitFare('تكسي من شارع المستشفى · 2,500 دينار')).toEqual(['تكسي من شارع المستشفى', '2,500 دينار']);
    expect(splitFare('من سوق العزيزية للبيت · 3,000 دينار')).toEqual(['من سوق العزيزية للبيت', '3,000 دينار']);
    expect(splitFare('Taxi from Souq · 2,500 IQD')).toEqual(['Taxi from Souq', '2,500 IQD']);
  });
  it('a line with no price stays whole and has no fare', () => {
    expect(splitFare('تكسي من مكانك هسة للبيت')).toEqual(['تكسي من مكانك هسة للبيت', null]);
    expect(splitFare('من سوق العزيزية للبيت')).toEqual(['من سوق العزيزية للبيت', null]);
  });
});
