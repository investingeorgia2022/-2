// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { buildDibburHamatchilLinks, matchTokenAt, wordsMatch, splitSideAt, pickDhFocusTargets } from '@/talmud/utils/dibburHamatchilMatcher';

// Vilna type sizes (pt): commentary body 11.2, bold Rashi 11.4, bold Tosafot 11.9, large Tosafot opening 16.4, Gemara 13.7.
const BODY = 11.2, RASHI_BOLD = 11.4, TOS_BOLD = 11.9, TOS_BIG = 16.4, GEM = 13.7;
let n = 0;
const row = (section: string, words: Array<[string, number, ('.' | ':')?]>, top: number) =>
  words.map(([word, glyphH, stopAfter], i) => ({
    id: `${section}-${n++}`,
    word,
    section,
    rowId: `${section}-${top}`,
    leftPct: 90 - i * 8,
    topPct: top,
    widthPct: 7.5,
    heightPct: 1,
    glyphH,
    stopAfter,
  }));
const gem = (words: string[], top = 10) => row('gemara', words.map((w) => [w, GEM] as [string, number]), top);
const body = (w: string): [string, number] => [w, BODY];
// Ordinary commentary prose so the page has a measurable body size.
const prose = () => [
  ...row('rashi', ['והיינו', 'דאמרינן', 'בגמרא', 'לקמן'].map(body), 80),
  ...row('tosafot', ['והיינו', 'דאמרינן', 'בגמרא', 'לקמן'].map(body), 85),
];

describe('dibbur hamatchil matching', () => {
  it('matches words ignoring prefixes and nikud', () => {
    expect(wordsMatch('וּמֵאֵימָתַי', 'מאימתי')).toBe(true);
    expect(wordsMatch('קורין', 'שמע')).toBe(false);
  });

  it('expands an abbreviation into one main word per initial', () => {
    expect(matchTokenAt('אע"פ', ['אף', 'על', 'פי', 'כן'], 0)).toBe(3);
  });

  it('only bold Rashi words form a Rashi opening; plain body words are never linked', () => {
    const g = gem(['מאימתי', 'קורין', 'את', 'שמע', 'בערבין']);
    const r = row('rashi', [['קורין', RASHI_BOLD], ['את', RASHI_BOLD], ['שמע', RASHI_BOLD, '.'], body('בערבין'), body('מאימתי')], 30);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    expect(roles.get(g[1].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g[3].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g[0].id)).toBeUndefined();
    expect(roles.get(g[4].id)).toBeUndefined();
    expect(roles.get(r[3].id)).toBeUndefined();
  });

  it('a Tosafot opening (large first word, bold continuation) is linked as Tosafot, not Rashi', () => {
    const g = gem(['מאימתי', 'קורין', 'את', 'שמע']);
    const t = row('tosafot', [['מאימתי', TOS_BIG], ['קורין', TOS_BOLD], ['וכו', TOS_BOLD], body('פירוש')], 50);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g, ...t]);
    expect(roles.get(g[0].id)).toEqual({ tosafot: 'tosafot:0' });
    expect(roles.get(g[1].id)).toEqual({ tosafot: 'tosafot:0' });
    expect(roles.get(t[2].id)).toEqual({ tosafot: 'tosafot:0' });
    expect(roles.get(t[3].id)).toBeUndefined();
  });

  it('a word quoted by both Rashi and Tosafot is split between them', () => {
    const g = gem(['מאימתי', 'קורין']);
    const r = row('rashi', [['מאימתי', RASHI_BOLD], ['קורין', RASHI_BOLD, '.'], body('x')], 30);
    const t = row('tosafot', [['מאימתי', TOS_BIG], ['קורין', TOS_BOLD, '.'], body('x')], 50);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r, ...t]);
    expect(roles.get(g[0].id)).toEqual({ rashi: 'rashi:0', tosafot: 'tosafot:0', splitWord: true });
  });

  it('two openings on one line are separated by the printed period', () => {
    const g = gem(['קורין', 'את', 'שמע', 'משעה', 'שהכהנים', 'נכנסים']);
    const r = row('rashi', [['קורין', RASHI_BOLD], ['את', RASHI_BOLD], ['שמע', RASHI_BOLD, '.'], ['פירוש', BODY, ':'], ['משעה', RASHI_BOLD], ['שהכהנים', RASHI_BOLD, '.']], 30);
    const { links } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    expect(links.map((l) => l.dhIds.length)).toEqual([3, 2]);
  });

  it('ignores blue markers inside a quotation', () => {
    const g = row('gemara', [['מאימתי', GEM], ['א', GEM], ['קורין', GEM]], 10);
    (g[1] as any).isSmallMarker = true;
    const r = row('rashi', [['מאימתי', RASHI_BOLD], ['קורין', RASHI_BOLD, '.'], body('x')], 30);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    expect(roles.get(g[2].id)?.rashi).toBe('rashi:0');
    expect(roles.get(g[1].id)).toBeUndefined();
  });

  it('a split single word: right half Rashi, left half Tosafot', () => {
    expect(splitSideAt(80, { left: 0, width: 100 })).toBe('rashi');
    expect(splitSideAt(20, { left: 0, width: 100 })).toBe('tosafot');
  });
});
import { wordsMatch as wm } from '../talmud/utils/dibburHamatchilMatcher';
describe('plural endings', () => {
  it('matches Rashi טובלים with Gemara טובלין', () => { expect(wm('טובלים', 'טובלין')).toBe(true); });
  it('does not merge unrelated words', () => { expect(wm('טובלים', 'טובלת')).toBe(false); });
});

describe('repeated identical quotations', () => {
  it('two identical Rashi openings bind to the first and second occurrences in order', () => {
    const g1 = gem(['אמר', 'מר', 'קורין'], 10);
    const g2 = gem(['אמר', 'מר', 'בערבין'], 20);
    const r1 = row('rashi', [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], ['פירוש', BODY, ':']], 40);
    const r2 = row('rashi', [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], body('היינו')], 60);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...r1, ...r2]);
    expect(roles.get(g1[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g2[0].id)).toEqual({ rashi: 'rashi:1' });
  });
});

describe('structural opening rule (scan letter sizes ignored)', () => {
  it('a Rashi-column opening is green even when OCR reports a Tosafot-like height', () => {
    const g = gem(['קשיא', 'דרבי', 'מאיר']);
    const r = row('rashi', [['קשיא', 18.6], ['דרבי', 18.6], ['מאיר', 18.6, '.'], ['לעיל', 18.6]], 30);
    const { roles } = buildDibburHamatchilLinks([...g, ...r]);
    expect(roles.get(g[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(r[3].id)).toBeUndefined();
  });
  it('words with no closing period are never an opening', () => {
    const r = row('rashi', ['א1','ב1','ג1','ד1','ה1','ו1','ז1'].map((w) => ['מילה' + w.length + w, BODY] as [string, number]), 30);
    const { roles } = buildDibburHamatchilLinks(r);
    expect(roles.size).toBe(0);
  });
});

describe('plene and defective spelling (optional internal י or ו)', () => {
  it('links Rashi מיטרא ניחא. to Gemara מטרא ניחא לפירי (Taanit 3b)', () => {
    const g = gem(['מטרא', 'ניחא', 'לפירי'], 42);
    const r = row(
      'rashi',
      [
        ['מיטרא', RASHI_BOLD],
        ['ניחא', RASHI_BOLD, '.'],
        body('כח'),
        body('ולא'),
        body('גרסינן'),
      ],
      60
    );
    const { links, roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    expect(links).toHaveLength(1);
    expect(links[0]?.mainIds).toEqual([g[0].id, g[1].id]);
    expect(roles.get(g[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g[1].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g[2].id)).toBeUndefined();
  });

  it('matches optional internal י or ו across both directions and with prefixes', () => {
    expect(wordsMatch('מיטרא', 'מטרא')).toBe(true);
    expect(wordsMatch('למיטרא', 'מטרא')).toBe(true);
    expect(wordsMatch('לישנא', 'לשנא')).toBe(true);
    expect(wordsMatch('מוציאין', 'מוצאין')).toBe(true);
    expect(wordsMatch('מציאין', 'מוצאין')).toBe(true);
    expect(wordsMatch('בייתא', 'ביתא')).toBe(true);
    expect(wordsMatch('קושיא', 'קשיא')).toBe(true);
  });

  it('never swaps י for ו, drops outer prefixes/suffixes, or matches 2-letter cores', () => {
    expect(wordsMatch('שיר', 'שור')).toBe(false);
    expect(wordsMatch('דובר', 'דיבר')).toBe(false);
    expect(wordsMatch('טוב', 'טיב')).toBe(false);
    expect(wordsMatch('יום', 'ים')).toBe(false);
    expect(wordsMatch('בית', 'בת')).toBe(false);
    expect(wordsMatch('אמר', 'יאמר')).toBe(false);
    expect(wordsMatch('אמר', 'אמרו')).toBe(false);
  });
});

describe('הכי גרסינן / ה"ג matching & purple roles', () => {
  it('matches הכי גרסינן DH to Gemara even with inserted/differing words (לא קשיא, מישאל, פסיק)', () => {
    const g = gem(
      [
        'שיעבור', 'ניסן', 'אמר', 'רב', 'חסדא', 'לא', 'קשיא', 'כאן', 'לשאול',
        'כאן', 'להזכיר', 'מישאל', 'שאיל', 'ואזיל', 'להזכיר', 'ביו"ט', 'הראשון', 'פסיק', 'אמר', 'עולא',
      ],
      10
    );
    const r = [
      ...row('rashi', [['שיעבור', RASHI_BOLD], ['ניסן', RASHI_BOLD, '.'], ['טעמא', BODY, ':']], 30),
      ...row(
        'rashi',
        [
          ['הכי', RASHI_BOLD], ['גרסינן', RASHI_BOLD], ['אמר', RASHI_BOLD], ['רב', RASHI_BOLD],
          ['חסדא', RASHI_BOLD], ['כאן', RASHI_BOLD], ['לשאול', RASHI_BOLD], ['כאן', RASHI_BOLD],
          ['להזכיר', RASHI_BOLD], ['משאל', RASHI_BOLD], ['שאיל', RASHI_BOLD], ['ואזיל', RASHI_BOLD],
          ['והזכרה', RASHI_BOLD], ['ביו"ט', RASHI_BOLD], ['ראשון', RASHI_BOLD, '.'], ['לשאול', BODY, ':'],
        ],
        40
      ),
      ...row('rashi', [['אמר', RASHI_BOLD], ['עולא', RASHI_BOLD, '.'], body('תנא')], 50),
    ];
    const { links, roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    const hgLink = links.find((l) => l.hachiGarsinan);
    expect(hgLink).toBeDefined();
    expect(hgLink?.commentator).toBe('rashi');
    // Normal neighboring openings remain non-purple
    expect(roles.get(g[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g[18].id)).toEqual({ rashi: 'rashi:2' });
    // Hachi Garsinan words in both Rashi and Gemara carry hachiGarsinan: true
    expect(roles.get(r[3].id)?.hachiGarsinan).toBe(true); // הכי
    expect(roles.get(g[2].id)?.hachiGarsinan).toBe(true); // אמר
    expect(roles.get(g[7].id)?.hachiGarsinan).toBe(true); // כאן
    expect(roles.get(g[16].id)?.hachiGarsinan).toBe(true); // הראשון
  });

  it('recognizes ה"ג abbreviation (single token or split quoteAfter) and marks both sides purple', () => {
    const g = gem(['ולא', 'עלתה', 'על', 'לבי', 'דכתיב'], 10);
    const r = row(
      'rashi',
      [
        ['ה', RASHI_BOLD], ['ג', RASHI_BOLD], ['ולא', RASHI_BOLD], ['עלתה', RASHI_BOLD],
        ['על', RASHI_BOLD], ['לבי', RASHI_BOLD], ['זה', RASHI_BOLD], ['יצחק', RASHI_BOLD, '.'],
      ],
      30
    );
    Object.assign(r[0], { quoteAfter: '"' });
    const { links, roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    expect(links).toHaveLength(1);
    expect(links[0].hachiGarsinan).toBe(true);
    expect(links[0].mainIds).toEqual([g[0].id, g[1].id, g[2].id, g[3].id]);
    expect(roles.get(r[0].id)?.hachiGarsinan).toBe(true);
    expect(roles.get(g[0].id)?.hachiGarsinan).toBe(true);
    expect(roles.get(g[4].id)).toBeUndefined();
  });

  it('anchors הכי גרסינן inside contextual window when opening starts with editorial words', () => {
    const g = gem(['תנא', 'היכא', 'ר', 'יהושע', 'היא', 'דאמר', 'רבה'], 10);
    Object.assign(g[2], { quoteAfter: "'" });
    const r = [
      ...row('rashi', [['תנא', RASHI_BOLD], ['היכא', RASHI_BOLD, '.'], ['פירוש', BODY, ':']], 30),
      ...row(
        'rashi',
        [
          ['הכי', RASHI_BOLD], ['גרסינן', RASHI_BOLD], ['ואיכא', RASHI_BOLD], ['דאמרי', RASHI_BOLD],
          ['לימא', RASHI_BOLD], ["ר'", RASHI_BOLD], ['יהושע', RASHI_BOLD], ['היא', RASHI_BOLD, '.'],
          ['פירוש', BODY, ':'],
        ],
        40
      ),
      ...row('rashi', [['דאמר', RASHI_BOLD], ['רבה', RASHI_BOLD, '.'], body('הכי')], 50),
    ];
    const { links, roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r]);
    const hgLink = links.find((l) => l.hachiGarsinan);
    expect(hgLink).toBeDefined();
    expect(roles.get(g[2].id)?.hachiGarsinan).toBe(true); // ר'
    expect(roles.get(g[4].id)?.hachiGarsinan).toBe(true); // היא
  });

  it('preserves splitWord coexistence when Rashi is הכי גרסינן and Tosafot is standard', () => {
    const g = gem(['אמר', 'רב', 'חסדא'], 10);
    const r = row('rashi', [['ה"ג', RASHI_BOLD], ['אמר', RASHI_BOLD], ['רב', RASHI_BOLD], ['חסדא', RASHI_BOLD, '.']], 30);
    const t = row('tosafot', [['אמר', TOS_BIG], ['רב', TOS_BOLD], ['חסדא', TOS_BOLD, '.']], 50);
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g, ...r, ...t]);
    expect(roles.get(g[0].id)).toMatchObject({
      rashi: 'rashi:0',
      tosafot: 'tosafot:0',
      splitWord: true,
      hachiGarsinan: true,
      rashiHachi: true,
    });
    expect(roles.get(g[0].id)?.tosafotHachi).toBeUndefined();
  });
});

describe('multi-line wrapped DH focus targets', () => {
  it('picks wrapped second-line hotspots when jumping from main text to a multi-line DH', () => {
    const line1Word = { id: 'dh-1', topPct: 40, heightPct: 1.4, leftPct: 68, widthPct: 3 };
    const line2WordA = { id: 'dh-2', topPct: 42.5, heightPct: 1.4, leftPct: 88, widthPct: 6 };
    const line2WordB = { id: 'dh-3', topPct: 42.5, heightPct: 1.4, leftPct: 81, widthPct: 5 };
    const focused = pickDhFocusTargets([line1Word, line2WordB, line2WordA], true);
    expect(focused.map((x) => x.id)).toEqual(['dh-2', 'dh-3']);
    // When jumping back to main text, returns full target list
    expect(pickDhFocusTargets([line1Word, line2WordA], false)).toHaveLength(2);
  });
});

describe('context-first duplicate DH resolution and carrot-orange Gemara markers', () => {
  it('picks the contextually matching Gemara occurrence and marks only remaining unclaimed Gemara duplicate orange', () => {
    const g1 = gem(['אמר', 'מר', 'למעלה', 'בקודש'], 10);
    const g2 = gem(['אמר', 'מר', 'מאימתי', 'בערבין'], 25);
    const r = row(
      'rashi',
      [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], body('כלומר'), body('בערבין'), ['שחרית', BODY, ':']],
      45
    );
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...r]);
    // Second occurrence matched contextually via "בערבין"
    expect(roles.get(g2[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g2[1].id)).toEqual({ rashi: 'rashi:0' });
    // First occurrence remains unclaimed -> marked carrot/orange duplicateGemara
    expect(roles.get(g1[0].id)).toEqual({ duplicateGemara: true });
    expect(roles.get(g1[1].id)).toEqual({ duplicateGemara: true });
    // Commentary DH itself stays normal Rashi, never orange
    expect(roles.get(r[0].id)).toEqual({ rashi: 'rashi:0' });
  });

  it('falls back to chronological order when context is inconclusive and never re-links already claimed Gemara quotes', () => {
    const g1 = gem(['אמר', 'מר', 'קמייתא', 'תנא'], 10);
    const g2 = gem(['אמר', 'מר', 'מציעתא', 'שמעינן'], 20);
    const g3 = gem(['אמר', 'מר', 'בתרייתא', 'דרב'], 30);
    // First DH contextually matches g2 ("מציעתא"). Second DH later matches g3 ("בתרייתא").
    // g1 remains unclaimed -> carrot/orange. Already-claimed g2 is never re-linked.
    const r1 = row(
      'rashi',
      [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], body('מציעתא'), ['שמעינן', BODY, ':']],
      40
    );
    const r2 = row(
      'rashi',
      [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], body('בתרייתא'), ['דרב', BODY, ':']],
      55
    );
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...g3, ...r1, ...r2]);
    expect(roles.get(g2[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g3[0].id)).toEqual({ rashi: 'rashi:1' });
    expect(roles.get(g1[0].id)).toEqual({ duplicateGemara: true });
    expect(roles.get(g1[1].id)).toEqual({ duplicateGemara: true });

    // If a later Rashi DH has no contextual words, chronological order picks the remaining unclaimed g1 without re-linking g2/g3
    const r3 = row(
      'rashi',
      [['אמר', RASHI_BOLD], ['מר', RASHI_BOLD, '.'], ['סתם', BODY, ':']],
      70
    );
    const res3 = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...g3, ...r1, ...r2, ...r3]);
    expect(res3.roles.get(g2[0].id)).toEqual({ rashi: 'rashi:0' });
    expect(res3.roles.get(g3[0].id)).toEqual({ rashi: 'rashi:1' });
    expect(res3.roles.get(g1[0].id)).toEqual({ rashi: 'rashi:2' });
  });

  it('re-evaluates context first and chronology second when Tosafot quotes a duplicate DH', () => {
    const g1 = gem(['אמר', 'מר', 'ראשון', 'בקודש'], 10);
    const g2 = gem(['אמר', 'מר', 'שני', 'בערבין'], 25);
    const t = row(
      'tosafot',
      [['אמר', TOS_BIG], ['מר', TOS_BOLD, '.'], body('בערבין'), ['פירוש', BODY, ':']],
      50
    );
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...t]);
    expect(roles.get(g2[0].id)).toEqual({ tosafot: 'tosafot:0' });
    expect(roles.get(g1[0].id)).toEqual({ duplicateGemara: true });
  });

  it('picks the first chronological occurrence (Berakhot 2a משעת צאת הכוכבים) when only distant words outside immediate clause overlap', () => {
    const g1 = gem(['מכדי', 'כהנים', 'אימת', 'אכלי', 'תרומה', 'משעת', 'צאת', 'הכוכבים', 'לתני'], 10);
    const g2 = row('gemara', [['משעת', GEM], ['צאת', GEM], ['הכוכבים', GEM, '.']], 20);
    const g3 = gem(
      [
        'מלתא', 'אגב', 'אורחיה', 'קמשמע', 'לן', 'כהנים', 'אימת', 'אכלי', 'בתרומה',
        'משעת', 'צאת', 'הכוכבים',
        'והא', 'קמשמע', 'לן', 'דכפרה', 'לא', 'מעכבא', 'כדתניא', 'ובא', 'השמש', 'וטהר', 'ביאת', 'שמשו',
      ],
      30
    );
    const r = row(
      'rashi',
      [
        ['משעת', RASHI_BOLD], ['צאת', RASHI_BOLD], ['הכוכבים', RASHI_BOLD, '.'],
        body('ההוא'), body('גמר'), body('ביאת'), body('השמש'), body('כדכתיב'), body('לקמן'), ['עמוד', BODY, ':'],
      ],
      55
    );
    const { roles } = buildDibburHamatchilLinks([...prose(), ...g1, ...g2, ...g3, ...r]);
    // Occurrence #1 (g1[5..7]) must be linked; occurrences #2 (g2[0..2]) and #3 (g3[9..11]) remain duplicateGemara
    expect(roles.get(g1[5].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g1[6].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g1[7].id)).toEqual({ rashi: 'rashi:0' });
    expect(roles.get(g2[0].id)).toEqual({ duplicateGemara: true });
    expect(roles.get(g3[9].id)).toEqual({ duplicateGemara: true });
  });
});



