// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { searchDaf } from '../talmud/utils/dafSearch';
import { decodeLatinVerseText, decodeLegacyHebrewItems } from '../talmud/utils/legacyHebrewFont';

const spot = (id: string, word: string, section: string, i: number, quoteAfter?: string) => ({
  id, word, section, topPct: 10, leftPct: 90 - i * 5, heightPct: 1, widthPct: 4, quoteAfter,
});

describe('daf search', () => {
  const spots = [
    ...['דאמר', 'ר', 'יוחנן', 'איזהו', 'בן', 'העולם', 'הבא'].map((w, i) => spot(`g${i}`, w, 'mishnah', i, w === 'ר' ? "'" : undefined)),
    ...['קריאת', 'שמע', 'של', 'ערבית'].map((w, i) => spot(`t${i}`, w, 'tosafot', i)),
  ];
  it('finds רבי for the printed ר׳', () => {
    expect(searchDaf(spots, 'רבי יוחנן איזהו')[0].ids).toEqual(['g1', 'g2', 'g3']);
  });
  it('expands an abbreviation in the query: ק"ש finds קריאת שמע', () => {
    expect(searchDaf(spots, 'ק"ש')[0].ids).toEqual(['t0', 't1']);
  });
  it('keeps matching immediately after typing a space and 1 letter of the next word', () => {
    const line = ['משעת', 'צאת', 'הכוכבים'].map((w, i) => spot(`m${i}`, w, 'gemara', i));
    expect(searchDaf(line, 'משעת צ')[0].ids).toEqual(['m0', 'm1']);
  });
  it('matches a prefix-attached trailing word when typing a multi-word phrase', () => {
    const line = ['בשכבך', 'ובקומך'].map((w, i) => spot(`p${i}`, w, 'gemara', i));
    expect(searchDaf(line, 'בשכבך בק')[0].ids).toEqual(['p0', 'p1']);
  });
  it('joins split quoteAfter abbreviations and matches seamlessly across mishnah and gemara sections', () => {
    const cross = [
      { id: 'c0', word: 'עמוד', section: 'mishnah', rowId: 'r1', topPct: 31, leftPct: 70, heightPct: 1, widthPct: 4 },
      { id: 'c1', word: 'השחר', section: 'mishnah', rowId: 'r1', topPct: 31, leftPct: 65, heightPct: 1, widthPct: 4 },
      { id: 'c2', word: 'א', section: 'mishnah', rowId: 'r1', topPct: 31, leftPct: 62, heightPct: 1, widthPct: 1.5, quoteAfter: '"' },
      { id: 'c3', word: 'כ', section: 'mishnah', rowId: 'r1', topPct: 31, leftPct: 60, heightPct: 1, widthPct: 1.5 },
      { id: 'c4', word: 'למה', section: 'gemara', rowId: 'r2', topPct: 32.2, leftPct: 70, heightPct: 1, widthPct: 4 },
    ];
    expect(searchDaf(cross, 'עמוד השחר א"כ למה')[0].ids).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });
});

describe('scan text repair', () => {
  it('turns a control-code נ inside Unicode Hebrew into נ', () => {
    expect(decodeLegacyHebrewItems([{ str: 'יוח\u0015ן' }])[0].str).toBe('יוחנן');
  });
  it('decodes the Latin-encoded vowelled Torah Or verse font', () => {
    expect(decodeLatinVerseText('YxAce Lipal mYpPWe§')).toBe('ושננתם לבניך ודברת');
  });
});
