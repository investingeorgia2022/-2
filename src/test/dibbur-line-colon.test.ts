import { describe, it, expect } from 'vitest';
import { buildDibburHamatchilLinks, extractDibburim } from '@/talmud/utils/dibburHamatchilMatcher';

const w = (id: string, word: string, row: number, left: number, extra: Record<string, unknown> = {}) => ({
  id, word, section: 'rashi', rowId: `r${row}`, leftPct: left, topPct: 10 + row * 2, widthPct: 3, heightPct: 1.5, ...extra,
});

describe('dibbur hamatchil after a line-end colon', () => {
  it('opens a new entry on the next line when the previous line ended with ":"', () => {
    const hs = [
      w('a', 'פירוש', 0, 75), w('b', 'בתרומתן', 0, 70, { stopAfter: ':' }),
      w('c', 'עד', 1, 75), w('d', 'חצות', 1, 70, { stopAfter: '.' }), w('e', 'כדי', 1, 65),
    ];
    const dh = extractDibburim(hs);
    expect(dh.map((p) => p.words.map((x) => x.word).join(' '))).toContain('עד חצות');
  });

  it('keeps an enlarged baseline-aligned opening word (אמר) after ":" even when a padded small marker sits above', () => {
    // Reproduces Berakhot 2b Tosafot: "בשעורי זמן שכיבה [ב] דכל זמנים הללו / אית ביה: אמר ליה ר' יהודה..."
    const hs = [
      { id: 'g1', word: 'אמר', section: 'gemara', rowId: 'g0', leftPct: 45, topPct: 50, widthPct: 3, heightPct: 1.4 },
      { id: 'g2', word: 'ליה', section: 'gemara', rowId: 'g0', leftPct: 41, topPct: 50, widthPct: 3, heightPct: 1.4 },
      { id: 'g3', word: 'רבי', section: 'gemara', rowId: 'g0', leftPct: 37, topPct: 50, widthPct: 3, heightPct: 1.4 },
      { id: 'g4', word: 'יהודה', section: 'gemara', rowId: 'g0', leftPct: 32, topPct: 50, widthPct: 4, heightPct: 1.4 },
      { id: 't1', word: 'שכיבה', section: 'tosafot', rowId: 't0', leftPct: 76.41, topPct: 58.485, widthPct: 3.31, heightPct: 1.148 },
      // Deliberately interleaved in broken row-bucket order with a padded small marker box
      { id: 't-amar', word: 'אמר', section: 'tosafot', rowId: 't0', leftPct: 76.4, topPct: 59.164, widthPct: 3.38, heightPct: 1.685, glyphH: 16.38 },
      { id: 't-mark', word: 'ב', section: 'tosafot', rowId: 't0', leftPct: 75.1, topPct: 58.577, widthPct: 2.4, heightPct: 2.2, inkTopPct: 58.827, inkHeightPct: 0.655, isSmallMarker: true },
      { id: 't2', word: 'דכל', section: 'tosafot', rowId: 't0', leftPct: 73.37, topPct: 58.485, widthPct: 2.02, heightPct: 1.148 },
      { id: 't3', word: 'אית', section: 'tosafot', rowId: 't1', leftPct: 82.95, topPct: 59.543, widthPct: 2.26, heightPct: 1.148 },
      { id: 't4', word: 'ביה:', section: 'tosafot', rowId: 't1', leftPct: 80.54, topPct: 59.543, widthPct: 2.41, heightPct: 1.148, stopAfter: ':' as const },
      { id: 't5', word: 'ליה', section: 'tosafot', rowId: 't1', leftPct: 73.24, topPct: 59.468, widthPct: 2.34, heightPct: 1.228 },
      { id: 't6', word: "ר'", section: 'tosafot', rowId: 't1', leftPct: 71.5, topPct: 59.468, widthPct: 1.6, heightPct: 1.228 },
      { id: 't7', word: 'יהודה', section: 'tosafot', rowId: 't1', leftPct: 68.04, topPct: 59.468, widthPct: 3.08, heightPct: 1.228, stopAfter: '.' as const },
    ];
    const { links, roles } = buildDibburHamatchilLinks(hs);
    expect(links).toHaveLength(1);
    expect(links[0]?.dhIds).toEqual(['t-amar', 't5', 't6', 't7']);
    expect(links[0]?.mainIds).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(roles.get('t-amar')?.tosafot).toBe('tosafot:0');
    expect(roles.get('g1')?.tosafot).toBe('tosafot:0');
  });
});
