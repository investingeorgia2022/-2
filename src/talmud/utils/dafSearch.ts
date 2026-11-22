// @ts-nocheck
import { abbreviationSpan, normalizeHebrewWord, wordsMatch, isInlineMarker, readingOrder } from './dibburHamatchilMatcher';

export interface SearchableSpot {
  id: string;
  word: string;
  section: string;
  rowId?: string;
  topPct: number;
  leftPct: number;
  heightPct: number;
  widthPct: number;
  isSmallMarker?: boolean;
  quoteAfter?: string;
}

export interface DafSearchHit {
  ids: string[];
  section: string;
  score: number;
  contextBefore: string;
  match: string;
  contextAfter: string;
}

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const finalNorm = (w: string) => w.replace(/[ךםןףץ]/g, (c) => FINALS[c]);
const plain = (w: string) => normalizeHebrewWord(w).replace(/[^א-ת"'״׳]/g, '');
const letters = (w: string) => plain(w).replace(/[^א-ת]/g, '');

const isShortened = (w: string) => /^[א-ת]+['\u05F3\u2019]$/.test(String(w || '').replace(/[\u0591-\u05C7]/g, '').replace(/[.:,;]+$/, '').trim());

/** Splits a query into words; quote marks inside a word are kept (ק"ש). */
export function tokenizeQuery(q: string): string[] {
  return q.replace(/[\u0591-\u05C7]/g, '').split(/[\s,.:;!?()[\]\-\u2013\u2014\u05BE]+/).map((t) => t.trim()).filter((t) => letters(t));
}

/** How many daf words starting at pos the query word covers (0 = no match), with a quality 0..1. */
function matchWord(q: string, words: string[], pos: number, isLast: boolean, minPrefixLen = 2): { used: number; quality: number } {
  const w = words[pos];
  if (!w) return { used: 0, quality: 0 };
  const lq = letters(q), lw = letters(w);
  const flq = finalNorm(lq), flw = finalNorm(lw);
  if (lq === lw || flq === flw) return { used: 1, quality: 1 };
  // A geresh-shortened daf word (ר', כלומ') stands only for its known expansions, never for any word
  // that merely begins with the same letter: רבא is not ר'.
  if (isShortened(w) && !isShortened(q)) {
    if (isLast && lq.length >= minPrefixLen && flw.startsWith(flq)) return { used: 1, quality: 0.6 };
    const ok = lw === 'ר' ? ['רבי', 'רב', 'רבן'].includes(lq) : lw.length >= 3 && flq.startsWith(flw);
    return ok ? { used: 1, quality: 0.8 } : { used: 0, quality: 0 };
  }
  if (wordsMatch(q, w)) return { used: 1, quality: 0.85 };
  const span = abbreviationSpan(q, words, pos);
  if (span) return { used: span, quality: 0.8 };
  if (abbreviationSpan(w, [q], 0)) return { used: 1, quality: 0.8 };
  // The word being typed: a prefix of a daf word still counts (from 1 letter after an earlier word, 2+ otherwise).
  if (isLast && lq.length >= minPrefixLen && flw.startsWith(flq)) return { used: 1, quality: 0.6 };
  // Daf word written with a prefix letter (ו/ה/ב/ל/מ/ש/כ/ד) before the searched word (exact or prefix while typing).
  if (lq.length >= 2 && lw.length > lq.length && 'והבלמשכד'.includes(lw[0])) {
    const stem = flw.slice(1);
    if (stem === flq) return { used: 1, quality: 0.75 };
    if (isLast && stem.startsWith(flq)) return { used: 1, quality: 0.55 };
  }
  return { used: 0, quality: 0 };
}

function sameSearchRow(a: SearchableSpot, b: SearchableSpot): boolean {
  if (a.rowId && b.rowId) return a.rowId === b.rowId;
  const aBase = a.topPct + a.heightPct;
  const bBase = b.topPct + b.heightPct;
  return Math.abs(aBase - bBase) <= Math.max(a.heightPct, b.heightPct, 1) * 0.6;
}

/** Finds a phrase anywhere on the daf, in every section, tolerating abbreviations, prefixes and line breaks. */
export function searchDaf<T extends SearchableSpot>(spots: T[], query: string, limit = 60): DafSearchHit[] {
  const q = tokenizeQuery(query);
  if (!q.length) return [];
  const hits: DafSearchHit[] = [];
  const streams: T[][] = [];
  const mainSpots = spots.filter((s) => s.section === 'mishnah' || s.section === 'gemara');
  if (mainSpots.length) streams.push(mainSpots);
  const otherSections = [...new Set(spots.map((s) => s.section))].filter(
    (s) => s !== 'header' && s !== 'mishnah' && s !== 'gemara'
  );
  for (const section of otherSections) {
    streams.push(spots.filter((s) => s.section === section));
  }

  const minPrefixLen = q.length >= 2 ? 1 : 2;
  for (const bucket of streams) {
    const list = readingOrder(
      bucket.filter((s) => !s.isSmallMarker && !isInlineMarker(s.word) && letters(s.word))
    );
    const tokens: Array<{ text: string; ids: string[]; section: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const next = list[i + 1];
      if (cur.quoteAfter === '"' && next && sameSearchRow(cur, next) && letters(next.word).length <= 2) {
        tokens.push({
          text: `${normalizeHebrewWord(cur.word)}"${normalizeHebrewWord(next.word)}`,
          ids: [cur.id, next.id],
          section: cur.section,
        });
        i++;
        continue;
      }
      tokens.push({
        text: cur.quoteAfter ? `${cur.word}${cur.quoteAfter}` : cur.word,
        ids: [cur.id],
        section: cur.section,
      });
    }
    const words = tokens.map((t) => t.text);
    for (let s = 0; s < words.length; s++) {
      let p = s;
      let quality = 0;
      let ok = true;
      for (let i = 0; i < q.length; i++) {
        const m = matchWord(q[i], words, p, i === q.length - 1, minPrefixLen);
        if (!m.used) { ok = false; break; }
        quality += m.quality;
        p += m.used;
      }
      if (!ok) continue;
      const ctx = (a: number, b: number) => words.slice(Math.max(0, a), Math.max(0, b)).join(' ');
      hits.push({
        ids: tokens.slice(s, p).flatMap((x) => x.ids),
        section: tokens[s].section,
        score: quality / q.length,
        contextBefore: ctx(s - 4, s),
        match: ctx(s, p),
        contextAfter: ctx(p, p + 4),
      });
      s = p - 1;
    }
  }
  const order = ['mishnah', 'gemara', 'rashi', 'tosafot', 'margin'];
  return hits
    .sort((a, b) => b.score - a.score || order.indexOf(a.section) - order.indexOf(b.section))
    .slice(0, limit);
}
