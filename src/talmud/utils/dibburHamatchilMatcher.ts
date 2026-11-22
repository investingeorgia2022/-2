// @ts-nocheck
// Links Rashi / Tosafot "dibbur hamatchil" openings on a Vilna PDF scan to the
// Gemara/Mishnah words they quote. Pure logic: works on hotspot-like boxes.
//
// How an opening is recognised (Vilna typesetting, every tractate): see extractDibburim —
// punctuation bounds the opening, its own typeface names the commentator. Small reference
// markers (א, 1, 2 …) are skipped.

export type DhCommentator = 'rashi' | 'tosafot';

export interface DhHotspotLike {
  id: string;
  word: string;
  section: string;
  rowId: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  inkTopPct?: number;
  inkHeightPct?: number;
  isSmallMarker?: boolean;
  /** Printed glyph height (pt) of the PDF run this word came from. */
  glyphH?: number;
  /** A "." or ":" is printed right after the word. */
  stopAfter?: '.' | ':';
  /** PDF font resource of the printed run. */
  font?: string;
  /** A separate geresh / gershayim printed right after the word (ר' / ק"ש). */
  quoteAfter?: '"' | "'";
}

export interface DhLink {
  key: string;
  commentator: DhCommentator;
  /** Hotspot ids of the opening words inside Rashi/Tosafot. */
  dhIds: string[];
  /** Hotspot ids of the quoted words in the main text. */
  mainIds: string[];
  /** True when the opening begins with הכי גרסינן or ה"ג (highlighted in purple). */
  hachiGarsinan?: boolean;
}

/** Per-hotspot interactive role. A shared main-text word carries both sides. */
export interface DhHotspotRole {
  rashi?: string; // link key
  tosafot?: string;
  /** Word quoted by both: right half Rashi (green), left half Tosafot (bordeaux). */
  splitWord?: boolean;
  /** True when either linked commentary opening is הכי גרסינן / ה"ג (purple). */
  hachiGarsinan?: boolean;
  rashiHachi?: boolean;
  tosafotHachi?: boolean;
  /** Unclaimed duplicate occurrence remaining in the Gemara text (carrot/orange). */
  duplicateGemara?: boolean;
}

const NIKUD = /[\u0591-\u05C7]/g;
const ABBREV_MARK = /["'\u05F3\u05F4\u201C\u201D\u2019]/;
const PREFIXES = ['ו', 'ש', 'ב', 'כ', 'ל', 'מ', 'ה', 'ד'];

export function normalizeHebrewWord(raw: string): string {
  return String(raw || '')
    .replace(NIKUD, '')
    .replace(/[^\u05D0-\u05EA"'\u05F3\u05F4]/g, '')
    .replace(/^["'\u05F3\u05F4]+|["'\u05F3\u05F4]+$/g, '');
}

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const plain = (w: string) => w.replace(/["'\u05F3\u05F4]/g, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);
const plainWord = (w: string) => plain(normalizeHebrewWord(w));

/** Filler words that end a quotation ("etc.") and are not looked up in the Gemara. */
const ETC = new Set(['וכו', 'וגו', 'כו', 'וגומר', 'וכולי']);
/** Section headings inside the commentary that are never quoted text. */
const HEADINGS = new Set(['גמ', 'מתני', 'גמרא', 'משנה']);
/** Generic commentary meta-terms excluded when scoring contextual overlap against Gemara. */
const META_BODY_WORDS = new Set([
  'פירוש', 'כלומר', 'היינו', 'גרסינן', 'והיינו', 'דכתיב', 'שנאמר',
  'בגמרא', 'מתני', 'מתניתין', 'גמרא', 'וכו', 'וגו', 'כו', 'את',
  'של', 'על', 'אל', 'מן', 'אם', 'כי', 'או', 'לא', 'כל', 'זה', 'זאת',
  'מה', 'מי', 'הכי', 'הא', 'הני',
]);

export function isAbbreviation(word: string): boolean {
  const w = normalizeHebrewWord(word);
  return ABBREV_MARK.test(w.slice(0, -1)) && plain(w).length >= 2;
}

function stripPrefixes(w: string): string[] {
  const out = [w];
  let cur = w;
  for (let i = 0; i < 2 && cur.length > 3 && PREFIXES.includes(cur[0]); i++) {
    cur = cur.slice(1);
    out.push(cur);
  }
  return out;
}

/** A word cut short with a geresh: ר' (רבי), דר' (דרבי), כלומ' (כלומר). */
function isTruncated(raw: string): boolean {
  const s = String(raw || '').replace(NIKUD, '').replace(/[.:,;]+$/, '').trim();
  return /['\u05F3\u2019]$/.test(s) && !ABBREV_MARK.test(s.slice(0, -1));
}

const isInternalMater = (s: string, idx: number): boolean =>
  idx > 0 && idx < s.length - 1 && (s[idx] === 'י' || s[idx] === 'ו');

/**
 * Matches two words differing only by omitted/added internal י or ו (plene vs. defective
 * spelling / כתיב מלא וחסר, e.g. מיטרא ↔ מטרא, לישנא ↔ לשנא, מוציאין ↔ מוצאין).
 * Restricts skips to one side per consonant gap and requires >= 3 matched characters so
 * distinct words (שיר ≠ שור, דובר ≠ דיבר, יום ≠ ים, אמר ≠ יאמר/אמרו) never collide.
 */
function matchInternalMatres(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  let i = 0;
  let j = 0;
  let matched = 0;
  let gapSide: 'none' | 'a' | 'b' = 'none';

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      matched++;
      gapSide = 'none';
      continue;
    }
    if ((gapSide === 'none' || gapSide === 'a') && isInternalMater(a, i)) {
      gapSide = 'a';
      i++;
      continue;
    }
    if ((gapSide === 'none' || gapSide === 'b') && isInternalMater(b, j)) {
      gapSide = 'b';
      j++;
      continue;
    }
    return false;
  }

  while (i < a.length && isInternalMater(a, i)) i++;
  while (j < b.length && isInternalMater(b, j)) j++;
  return i === a.length && j === b.length && matched >= 3;
}

/** Do two single words match, ignoring nikud, final letters, up to two prefixes, and optional internal י/ו? */
export function wordsMatch(a: string, b: string): boolean {
  const pa = plainWord(a);
  const pb = plainWord(b);
  if (!pa || !pb) return false;
  if (pa === pb) return true;
  // ר' = רבי, דר' = דרבי: a geresh-shortened word matches the full word it begins.
  if (isTruncated(a) && !isTruncated(b) && !isAbbreviation(b) && pb.length > pa.length && pb.startsWith(pa)) return true;
  if (isTruncated(b) && !isTruncated(a) && !isAbbreviation(a) && pa.length > pb.length && pa.startsWith(pb)) return true;
  // Hebrew plural -ים and Aramaic plural -ין are the same word (טובלים / טובלין).
  const plur = (w: string) => (w.length >= 4 && /י[מנ]$/.test(w) ? w.slice(0, -1) : w);
  if (plur(pa) === plur(pb) && plur(pa) !== pa) return true;
  const va = stripPrefixes(pa);
  const vb = stripPrefixes(pb);
  // Words of two letters or more never match by substituting letters (ודומו ≠ ואומר).
  if (va.some((x) => x.length >= 3 && vb.includes(x))) return true;
  return va.some((x) => x.length >= 3 && vb.some((y) => y.length >= 3 && matchInternalMatres(x, y)));
}

/** Collapses letters the scans' OCR confuses (ש/ס, א/ל, ב/כ, ה/ח/ת, ד/ר/ו, י/ז/נ, מ/ם, ע/צ). */
export function toOCRSkeleton(word: string): string {
  return plain(String(word || ''))
    .replace(/[^א-ת]/g, '')
    .replace(/[שס]/g, 'S')
    .replace(/[אל]/g, 'A')
    .replace(/[בכ]/g, 'B')
    .replace(/[החת]/g, 'H')
    .replace(/[דרו]/g, 'D')
    .replace(/[יזנ]/g, 'V')
    .replace(/[מ]/g, 'M')
    .replace(/[עצ]/g, 'E');
}

/** Equal skeletons (≥3 letters) match; long words (≥5) tolerate one differing letter. */
export function isSkeletonMatch(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  // No letter may differ: a one-letter tolerance confused distinct words (ודומו ↔ ואומר).
  return a === b;
}

/**
 * Tries to match one DH token at main[pos]. Returns how many main words it
 * consumed (0 = no match). Abbreviations (ראשי תיבות) like אע"פ / ק"ש consume one
 * full main word per initial letter.
 */
export function matchTokenAt(token: string, main: string[], pos: number): number {
  if (pos >= main.length) return 0;
  if (wordsMatch(token, main[pos])) return 1;
  return abbreviationSpan(token, main, pos);
}

/**
 * How many full words at words[pos…] an abbreviation stands for (0 = none). The abbreviation's
 * letters are split into consecutive pieces, each beginning one of the words: אע"פ = אף על פי,
 * ק"ש = קריאת שמע, אדר"מ = אדר' מאיר (piece "אדר" begins the shortened אדר').
 */
export function abbreviationSpan(abbr: string, words: string[], pos: number): number {
  const norm = normalizeHebrewWord(abbr);
  if (!isAbbreviation(norm)) return 0;
  const full = plain(norm);
  // Pieces begin the words themselves; prefixes are written inside the abbreviation (וק"ש).
  const variants = (w: string) => {
    const p = plainWord(w);
    return p ? [p] : [];
  };
  const fits = (letters: string, start: number, n: number): boolean => {
    const split = (idx: number, j: number): boolean => {
      if (j === n) return idx === letters.length;
      const remainingWords = n - j - 1;
      for (let len = 1; idx + len + remainingWords <= letters.length; len++) {
        const piece = letters.slice(idx, idx + len);
        if (variants(words[start + j]).some((v) => v.startsWith(piece)) && split(idx + len, j + 1)) return true;
      }
      return false;
    };
    return split(0, 0);
  };
  // An attached prefix (ואע"פ) may stand outside the expanded words.
  const options = PREFIXES.includes(full[0]) && full.length > 2 ? [full, full.slice(1)] : [full];
  for (const letters of options) {
    for (let n = 2; n <= letters.length && pos + n <= words.length; n++) {
      if (fits(letters, pos, n)) return n;
    }
  }
  return 0;
}

/**
 * Aligns a quotation with the main text starting at main[pos]. Abbreviations may appear on either
 * side (Rashi אדר' מאיר ↔ Gemara אדר"מ). Returns the index after the last main word, or -1.
 */
function alignAt(tokens: string[], main: string[], pos: number): number {
  let i = 0;
  let p = pos;
  while (i < tokens.length) {
    if (p >= main.length) return -1;
    if (wordsMatch(tokens[i], main[p])) { i++; p++; continue; }
    const mainUsed = abbreviationSpan(tokens[i], main, p);
    if (mainUsed) { i++; p += mainUsed; continue; }
    const tokUsed = abbreviationSpan(main[p], tokens, i);
    if (tokUsed) { i += tokUsed; p++; continue; }
    return -1;
  }
  return p;
}

interface Token<T> { text: string; hs: T[]; endsClause?: boolean }

/** A printed reference marker of any kind: (א) א) [א] 1 ⊙ * … — never quoted text. */
const MARKER_ONLY = /^[\(\[]?(?:[\u05D0-\u05EA]{1,2}|\d{1,3}|[⊙◉◎⊛●○*•°†])[\)\]][.:]?$|^[\(\[](?:[\u05D0-\u05EA]{1,2}|\d{1,3})[.:]?$|^\d{1,3}[.:]?$|^[⊙◉◎⊛●○*•°†]$/;
export function isInlineMarker(raw: string): boolean {
  return MARKER_ONLY.test(String(raw || '').replace(NIKUD, '').replace(/[\u200e\u200f\u202a-\u202e\s]/g, ''));
}
/** Removes a marker glued to a word (ב)איזהו → איזהו, איזהו1 → איזהו). */
export function stripGluedMarker(raw: string): string {
  return String(raw || '')
    .replace(/^[\(\[]?(?:[\u05D0-\u05EA]{1,2}|\d{1,3}|[⊙◉◎⊛●○*•°†])[\)\]]/, '')
    .replace(/^\d{1,3}|\d{1,3}$/g, '')
    .replace(/[\(\[](?:[\u05D0-\u05EA]{1,2}|\d{1,3})[\)\]]$/, '');
}

/**
 * Joins words the scan printed apart around a separate quote mark: ק + " + ש → ק"ש, ר + ' → ר'.
 * Hotspots must be in reading order.
 */
function toTokens<T extends DhHotspotLike>(all: T[]): Token<T>[] {
  // Markers anywhere inside a quotation are transparent.
  const hs = all.filter((h) => !h.isSmallMarker && !isInlineMarker(h.word) && plainWord(stripGluedMarker(h.word)));
  const out: Token<T>[] = [];
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    const next = hs[i + 1];
    if (h.quoteAfter === '"' && next && next.rowId === h.rowId && plainWord(next.word).length <= 2) {
      const endsClause =
        next.stopAfter === '.' ||
        next.stopAfter === ':' ||
        /[.:]\s*$/.test(String(next.word || '').trim());
      out.push({ text: `${normalizeHebrewWord(h.word)}"${normalizeHebrewWord(next.word)}`, hs: [h, next], endsClause });
      i++;
      continue;
    }
    const w = stripGluedMarker(h.word);
    const endsClause =
      h.stopAfter === '.' ||
      h.stopAfter === ':' ||
      /[.:]\s*$/.test(String(h.word || '').trim());
    out.push({ text: h.quoteAfter ? `${normalizeHebrewWord(w)}'` : w, hs: [h], endsClause });
  }
  return out;
}

/** Orders hotspots of one section in reading order (rows top→bottom by baseline, words right→left). */
export function readingOrder<
  T extends Pick<DhHotspotLike, 'topPct' | 'heightPct' | 'leftPct' | 'widthPct' | 'inkTopPct' | 'inkHeightPct'>,
>(hotspots: T[]): T[] {
  if (hotspots.length <= 1) return [...hotspots];
  const inkHeight = (h: T) => h.inkHeightPct ?? h.heightPct;
  const baseline = (h: T) => (h.inkTopPct ?? h.topPct) + inkHeight(h);
  const byBaseline = [...hotspots].sort((a, b) => baseline(a) - baseline(b));
  const rows: Array<{ baseline: number; avgH: number; items: T[] }> = [];
  for (const h of byBaseline) {
    const b = baseline(h);
    const ht = inkHeight(h);
    const cur = rows[rows.length - 1];
    if (cur) {
      const tol = Math.min(Math.max(cur.avgH, ht), Math.min(cur.avgH, ht) * 1.4) * 0.5;
      if (Math.abs(b - cur.baseline) <= tol) {
        const n = cur.items.length;
        cur.baseline = (cur.baseline * n + b) / (n + 1);
        cur.avgH = (cur.avgH * n + ht) / (n + 1);
        cur.items.push(h);
        continue;
      }
    }
    rows.push({ baseline: b, avgH: ht, items: [h] });
  }
  return rows.flatMap((r) =>
    r.items.sort((a, b) => b.leftPct + b.widthPct - (a.leftPct + a.widthPct))
  );
}

/**
 * Groups targets by printed baseline rows and, when jumping from main text to a multi-line
 * wrapped commentary opening, returns the wrapped second-line words so zoomed focus lands
 * directly on the continuation line rather than straddling both margins.
 */
export function pickDhFocusTargets<
  T extends Pick<DhHotspotLike, 'topPct' | 'heightPct' | 'leftPct' | 'widthPct' | 'inkTopPct' | 'inkHeightPct'>,
>(targets: T[], fromMain: boolean): T[] {
  if (!fromMain || targets.length <= 1) return targets;
  const inkHeight = (h: T) => h.inkHeightPct ?? h.heightPct;
  const baseline = (h: T) => (h.inkTopPct ?? h.topPct) + inkHeight(h);
  const byBaseline = [...targets].sort((a, b) => baseline(a) - baseline(b));
  const lines: Array<{ baseline: number; avgH: number; items: T[] }> = [];
  for (const h of byBaseline) {
    const b = baseline(h);
    const ht = inkHeight(h);
    const cur = lines[lines.length - 1];
    if (cur) {
      const tol = Math.min(Math.max(cur.avgH, ht), Math.min(cur.avgH, ht) * 1.4) * 0.5;
      if (Math.abs(b - cur.baseline) <= tol) {
        const n = cur.items.length;
        cur.baseline = (cur.baseline * n + b) / (n + 1);
        cur.avgH = (cur.avgH * n + ht) / (n + 1);
        cur.items.push(h);
        continue;
      }
    }
    lines.push({ baseline: b, avgH: ht, items: [h] });
  }
  if (lines.length < 2) return targets;
  return lines[1].items.sort((a, b) => b.leftPct + b.widthPct - (a.leftPct + a.widthPct));
}

/** Most common glyph height among the given words, weighted by letters. */
function modeHeight(words: DhHotspotLike[]): number {
  const count = new Map<number, number>();
  for (const h of words) {
    if (!h.glyphH) continue;
    const k = Math.round(h.glyphH * 10);
    count.set(k, (count.get(k) || 0) + Math.max(1, plainWord(h.word).length));
  }
  let best = 0;
  let bestN = 0;
  for (const [k, n] of count) if (n > bestN) { best = k; bestN = n; }
  return best / 10;
}


interface Piece<T> { commentator: DhCommentator; words: T[]; bodyWords?: string[] }

/** Longest opening (in words); a run cut at a line end continues on the commentator's next line. */
export const MAX_DH_WORDS = 15;

const endsWith = (w: string, ch: string) => String(w || '').trim().endsWith(ch);

/**
 * Finds every opening. Vilna typesetting rules:
 * - An entry starts at the commentator's first word or right after its previous entry's ":";
 *   its opening ends at the first "." (or וכו׳ / MAX_DH_WORDS).
 * - The commentator of every word was decided upstream from the scan's text streams and
 *   typefaces (vilnaCommentaryStreams), never from where on the page it sits.
 */
function extractDibburimInternal<T extends DhHotspotLike>(hotspots: T[], includeBody: boolean): Piece<T>[] {
  const raw: Array<Piece<T>> = [];
  for (const sec of ['rashi', 'tosafot'] as const) {
    // Punctuation alone bounds an opening.
    const words = readingOrder(
      hotspots.filter((h) => (h.isSmallMarker || plainWord(h.word)) && h.section === sec)
    );
    let open = true;
    let cur: Piece<T> | null = null;
    let lastClosed: Piece<T> | null = null;
    // An opening is only real once its closing "." (or וכו׳) is printed.
    const drop = () => {
      if (cur) {
        if (lastClosed === cur) lastClosed = null;
        raw.splice(raw.indexOf(cur), 1);
      }
      cur = null;
    };
    for (const w of words) {
      const colonMark = w.stopAfter === ':' || endsWith(w.word, ':');
      if (w.isSmallMarker || isInlineMarker(w.word)) {
        // A marker before ":" still closes the entry; the next word opens a new one.
        if (colonMark) { drop(); lastClosed = null; open = true; }
        continue;
      }
      const p = plainWord(w.word);
      const colon = colonMark;
      const dot = w.stopAfter === '.' || endsWith(w.word, '.');
      if (open && !HEADINGS.has(p)) {
        if (!cur) {
          cur = includeBody ? { commentator: sec, words: [], bodyWords: [] } : { commentator: sec, words: [] };
          raw.push(cur);
        }
        cur.words.push(w);
        if (dot || ETC.has(p)) {
          open = false;
          lastClosed = cur;
          cur = null;
        } else if (cur.words.length >= MAX_DH_WORDS) {
          drop();
          open = false;
        }
      } else if (includeBody && !open && lastClosed && !colon) {
        const bw = plainWord(stripGluedMarker(w.word));
        if (bw.length >= 2 && !HEADINGS.has(bw) && !META_BODY_WORDS.has(bw)) {
          lastClosed.bodyWords!.push(w.word);
        }
      }
      if (colon) {
        if (includeBody && !open && lastClosed) {
          const bw = plainWord(stripGluedMarker(w.word));
          if (bw.length >= 2 && !HEADINGS.has(bw) && !META_BODY_WORDS.has(bw)) {
            lastClosed.bodyWords!.push(w.word);
          }
        }
        drop();
        lastClosed = null;
        open = true;
      }
    }
    drop();
  }

  return raw;
}

export function extractDibburim<T extends DhHotspotLike>(hotspots: T[]): Piece<T>[] {
  return extractDibburimInternal(hotspots, false);
}

function free(a: number, b: number, set: Set<number>): boolean {
  for (let i = a; i <= b; i++) if (set.has(i)) return false;
  return true;
}

function findAllInMain(
  tokens: string[],
  main: string[],
  claimed: Set<number>,
  enforceFree = true
): Array<{ start: number; end: number }> {
  if (tokens.length === 0) return [];
  const out: Array<{ start: number; end: number }> = [];
  for (let s = 0; s < main.length; s++) {
    if (enforceFree && claimed.has(s)) continue;
    const p = alignAt(tokens, main, s);
    if (p > s && (!enforceFree || free(s, p - 1, claimed))) {
      out.push({ start: s, end: p - 1 });
      s = p - 1;
    }
  }
  return out;
}

function pickCandidateByContextOrChronology<T>(
  candidates: Array<{ start: number; end: number }>,
  bodyWords: string[],
  mainTokens: Token<T>[],
  cursor: number,
  prevBound: number,
  nextBound: number
): { start: number; end: number } {
  if (candidates.length === 1) return candidates[0];

  // Deduplicate commentary body content tokens so repeated filler doesn't dominate.
  const uniqueBody: string[] = [];
  const seenBody = new Set<string>();
  for (const w of bodyWords) {
    const pw = plainWord(w);
    if (pw.length >= 2 && !seenBody.has(pw)) {
      seenBody.add(pw);
      uniqueBody.push(w);
    }
  }

  const hasValidBracket =
    (prevBound >= 0 || nextBound < mainTokens.length) && prevBound < nextBound;
  const bracketSplits =
    hasValidBracket &&
    candidates.some((c) => (prevBound < 0 || c.start > prevBound) && (nextBound >= mainTokens.length || c.end < nextBound)) &&
    candidates.some((c) => !((prevBound < 0 || c.start > prevBound) && (nextBound >= mainTokens.length || c.end < nextBound)));

  // Immediate-phrase context only: +/-5 tokens, never crossing "." or ":" sentence boundaries.
  const IMMEDIATE_RADIUS = 5;
  const MIN_CONTEXT_SCORE = 1.5;

  const lexicalScores = candidates.map((c, cIdx) => {
    if (uniqueBody.length === 0) return 0;
    const prevCandEnd = cIdx > 0 ? candidates[cIdx - 1].end : -1;
    const nextCandStart = cIdx + 1 < candidates.length ? candidates[cIdx + 1].start : mainTokens.length;
    const immediatePositions: number[] = [];

    const bMin = Math.max(0, prevCandEnd + 1, c.start - IMMEDIATE_RADIUS);
    for (let p = c.start - 1; p >= bMin; p--) {
      if (mainTokens[p]?.endsClause) break;
      immediatePositions.push(p);
    }

    if (!mainTokens[c.end]?.endsClause) {
      const fMax = Math.min(mainTokens.length - 1, nextCandStart - 1, c.end + IMMEDIATE_RADIUS);
      for (let p = c.end + 1; p <= fMax; p++) {
        immediatePositions.push(p);
        if (mainTokens[p]?.endsClause) break;
      }
    }

    let lexical = 0;
    for (const bw of uniqueBody) {
      const len = plainWord(bw).length;
      let bestW = 0;
      for (const p of immediatePositions) {
        if (wordsMatch(bw, mainTokens[p].text)) {
          const dist = p > c.end ? p - c.end : c.start - p;
          const base = len >= 3 ? 3 : 1.5;
          const weight = base / (1 + dist * 0.08);
          if (weight > bestW) bestW = weight;
        }
      }
      lexical += bestW;
    }
    return lexical;
  });

  const bestLexical = Math.max(...lexicalScores);
  if (bestLexical >= MIN_CONTEXT_SCORE) {
    const combinedScores = lexicalScores.map((lexical, idx) => {
      const c = candidates[idx];
      const insideBracket =
        bracketSplits &&
        (prevBound < 0 || c.start > prevBound) &&
        (nextBound >= mainTokens.length || c.end < nextBound);
      return lexical + (insideBracket ? 0.5 : 0);
    });
    const bestCombined = Math.max(...combinedScores);
    const topCandidates = candidates.filter((_, idx) => Math.abs(combinedScores[idx] - bestCombined) < 0.01);
    if (topCandidates.length === 1) return topCandidates[0];
    // Multiple candidates tied on contextual score -> chronological order among tied winners.
    const fromCursor = Math.max(0, cursor - 3);
    return topCandidates.find((c) => c.start >= fromCursor) || topCandidates[0];
  }

  // Context inconclusive -> chronological fallback from current cursor (first free occurrence).
  const fromCursor = Math.max(0, cursor - 3);
  return candidates.find((c) => c.start >= fromCursor) || candidates[0];
}

/**
 * Strips internal matres lectionis (י/ו) from a Hebrew word after optional leading prefix
 * so closely related variant spellings (e.g. פוסק ↔ פסיק) can extend an already-anchored
 * הכי גרסינן span without ever triggering standalone false positives.
 */
function consonantSkeletonNoMatres(raw: string): string {
  const p = plainWord(raw);
  if (p.length < 3) return p;
  return p[0] + p.slice(1, -1).replace(/[יו]/g, '') + p[p.length - 1];
}

function sameTailVariant(a: string, b: string): boolean {
  const sa = consonantSkeletonNoMatres(a);
  const sb = consonantSkeletonNoMatres(b);
  return sa.length >= 3 && sb.length >= 3 && sa === sb;
}

/**
 * Extracts הכי גרסינן / ה"ג prefix and splits before ולא גרסינן (if present).
 */
function extractHachiGarsinan<T extends Pick<DhHotspotLike, 'quoteAfter'>>(toks: Token<T>[]): {
  isHg: boolean;
  positive: Token<T>[];
  negative: Token<T>[];
} {
  if (toks.length === 0) return { isHg: false, positive: toks, negative: [] };
  let prefixLen = 0;
  const p0 = plainWord(toks[0].text);
  const p1 = toks.length > 1 ? plainWord(toks[1].text) : '';
  const garsinanNorm = plainWord('גרסינן');
  if (p0 === 'הכי' && p1 === garsinanNorm) {
    prefixLen = 2;
  } else if (
    p0 === 'הג' &&
    (/["'״׳]/.test(toks[0].text) || toks[0].hs.some((h) => Boolean(h?.quoteAfter)) || toks.length >= 3)
  ) {
    prefixLen = 1;
  } else if (
    p0 === 'ה' &&
    p1 === 'ג' &&
    (/["'״׳]/.test(toks[0].text + toks[1].text) || toks[0].hs.some((h) => Boolean(h?.quoteAfter)))
  ) {
    prefixLen = 2;
  }
  if (!prefixLen) return { isHg: false, positive: toks, negative: [] };

  const rest = toks.slice(prefixLen);
  for (let i = 0; i + 1 < rest.length; i++) {
    if (plainWord(rest[i].text) === 'ולא' && plainWord(rest[i + 1].text) === garsinanNorm) {
      return {
        isHg: true,
        positive: rest.slice(0, i),
        negative: rest.slice(i + 2),
      };
    }
  }
  return { isHg: true, positive: rest, negative: [] };
}

/**
 * Contextual, emendation-aware matcher for הכי גרסינן / ה"ג openings inside a Gemara window
 * [winLo, winHi]. Bridges short textual differences (extra words like לא קשיא or substituted
 * emendations like והזכרה ↔ להזכיר / פוסק ↔ פסיק) once strong verbatim anchors align.
 */
function findHachiGarsinanInWindow(
  quoteTokens: string[],
  mainWords: string[],
  winLo: number,
  winHi: number,
  claimed: Set<number>
): { start: number; end: number; matched: number; consecutive: number; q0: number; score: number } | null {
  const qLen = quoteTokens.length;
  if (qLen === 0 || mainWords.length === 0) return null;
  const lo = Math.max(0, winLo);
  const hi = Math.min(mainWords.length - 1, winHi);
  if (lo > hi) return null;

  const isClaimedRange = (a: number, b: number) => {
    for (let x = a; x <= b; x++) if (claimed.has(x)) return true;
    return false;
  };

  let best: { start: number; end: number; matched: number; consecutive: number; q0: number; score: number } | null = null;
  const maxQ0 = qLen >= 4 ? Math.min(4, qLen - 2) : 0;

  for (let q0 = 0; q0 <= maxQ0; q0++) {
    if (qLen - q0 === 1 && plainWord(quoteTokens[q0]).length < 2) continue;

    for (let s = lo; s <= hi; s++) {
      if (claimed.has(s)) continue;
      // Anchor check at (q0, s)
      let i = q0;
      let p = s;
      let firstUsedP = 0;
      if (wordsMatch(quoteTokens[i], mainWords[p])) {
        firstUsedP = 1;
        i++;
        p++;
      } else {
        const mUsed = abbreviationSpan(quoteTokens[i], mainWords, p);
        if (mUsed > 0 && p + mUsed - 1 <= hi) {
          firstUsedP = mUsed;
          i++;
          p += mUsed;
        } else {
          const tUsed = abbreviationSpan(mainWords[p], quoteTokens, i);
          if (tUsed > 0) {
            firstUsedP = 1;
            i += tUsed;
            p++;
          } else {
            continue;
          }
        }
      }
      if (!firstUsedP) continue;

      let matched = 1;
      let curRun = 1;
      let maxConsecutive = 1;
      let lastMatchedEnd = p - 1;
      let gapPenalty = 0;
      let usedBridges = 0;
      const maxSpan = Math.max(qLen * 2 + 4, 20);

      while (i < qLen && p <= hi && p - s < maxSpan) {
        if (claimed.has(p)) break;
        if (wordsMatch(quoteTokens[i], mainWords[p])) {
          matched++;
          curRun++;
          if (curRun > maxConsecutive) maxConsecutive = curRun;
          lastMatchedEnd = p;
          i++;
          p++;
          continue;
        }
        const mUsed = abbreviationSpan(quoteTokens[i], mainWords, p);
        if (mUsed > 0 && p + mUsed - 1 <= hi && !isClaimedRange(p, p + mUsed - 1)) {
          matched++;
          curRun++;
          if (curRun > maxConsecutive) maxConsecutive = curRun;
          lastMatchedEnd = p + mUsed - 1;
          i++;
          p += mUsed;
          continue;
        }
        const tUsed = abbreviationSpan(mainWords[p], quoteTokens, i);
        if (tUsed > 0) {
          matched += tUsed;
          curRun += tUsed;
          if (curRun > maxConsecutive) maxConsecutive = curRun;
          lastMatchedEnd = p;
          i += tUsed;
          p++;
          continue;
        }

        // Look ahead across small differences in Gemara (0..4 words) and DH (0..3 words) to re-sync.
        let resynced: { dq: number; dm: number; cost: number } | null = null;
        for (let totalSkip = 1; totalSkip <= 5 && !resynced; totalSkip++) {
          for (let dq = 0; dq <= Math.min(3, totalSkip); dq++) {
            const dm = totalSkip - dq;
            if (dm > 4) continue;
            const ni = i + dq;
            const np = p + dm;
            if (ni >= qLen || np > hi || np - s >= maxSpan) continue;
            if (isClaimedRange(p, np)) continue;
            const hitDirect =
              wordsMatch(quoteTokens[ni], mainWords[np]) ||
              abbreviationSpan(quoteTokens[ni], mainWords, np) > 0 ||
              abbreviationSpan(mainWords[np], quoteTokens, ni) > 0;
            if (!hitDirect) continue;
            // Require either a 2-word follow-up match or >= 3 letter word to prevent jumping on single 1-2 letter particles.
            const strongHit =
              plainWord(quoteTokens[ni]).length >= 3 ||
              (ni + 1 < qLen &&
                np + 1 <= hi &&
                (wordsMatch(quoteTokens[ni + 1], mainWords[np + 1]) ||
                  abbreviationSpan(quoteTokens[ni + 1], mainWords, np + 1) > 0));
            if (strongHit) {
              resynced = { dq, dm, cost: dm * 0.45 + dq * 0.5 };
              break;
            }
          }
        }
        if (resynced) {
          i += resynced.dq;
          p += resynced.dm;
          gapPenalty += resynced.cost;
          usedBridges++;
          curRun = 0;
          continue;
        }

        // Tail variant match right after an already-matched span (e.g. פוסק ↔ פסיק).
        if (matched >= 2 && i === qLen - 1 && sameTailVariant(quoteTokens[i], mainWords[p])) {
          matched++;
          lastMatchedEnd = p;
          i++;
          p++;
        }
        break;
      }

      if (isClaimedRange(s, lastMatchedEnd)) continue;

      const isSingleExact = qLen === 1 && matched === 1 && plainWord(quoteTokens[0]).length >= 2;
      const isCleanPrefix = q0 === 0 && usedBridges === 0 && matched >= 2;
      const isStrongBridged = matched >= 3 && maxConsecutive >= 2;
      if (!isSingleExact && !isCleanPrefix && !isStrongBridged) continue;

      const score =
        matched * 3 +
        maxConsecutive * 1.5 -
        (q0 > 0 ? q0 * 0.8 : 0) -
        gapPenalty;
      if (
        !best ||
        score > best.score ||
        (score === best.score && matched > best.matched)
      ) {
        best = {
          start: s,
          end: lastMatchedEnd,
          matched,
          consecutive: maxConsecutive,
          q0,
          score,
        };
      }
    }
  }
  return best;
}

/** Builds Rashi/Tosafot ↔ main-text links for one page. */
export function buildDibburHamatchilLinks<T extends DhHotspotLike>(hotspots: T[]): {
  links: DhLink[];
  roles: Map<string, DhHotspotRole>;
} {
  const mainAll = hotspots.filter(
    (h) => (h.section === 'gemara' || h.section === 'mishnah') && !h.isSmallMarker && plainWord(h.word)
  );
  // Small inline citations such as (דף ג.) are not part of the quoted text.
  const mainH = modeHeight(mainAll);
  const main = toTokens(readingOrder(mainAll.filter((h) => !mainH || !h.glyphH || h.glyphH >= mainH * 0.8)));
  const mainWords = main.map((t) => t.text);
  const links: DhLink[] = [];
  const roles = new Map<string, DhHotspotRole>();

  // Word-level state: each commentator claims main words independently. Rashi links first,
  // so Tosafot can join (split half/half) but never steal its own earlier claims.
  const claimed: Record<DhCommentator, Set<number>> = { rashi: new Set(), tosafot: new Set() };
  const spans: Array<{ key: string; start: number; end: number }> = [];
  const duplicateCandidateSpans: Array<{ start: number; end: number }> = [];
  const pieces = extractDibburimInternal(hotspots, true);
  const emptyClaimed = new Set<number>();

  for (const commentator of ['rashi', 'tosafot'] as const) {
    const compPieces = pieces.filter((p) => p.commentator === commentator);
    interface PreparedPiece {
      piece: Piece<T>;
      key: string;
      hasEtc: boolean;
      toks: Token<T>[];
      hg: { isHg: boolean; positive: Token<T>[]; negative: Token<T>[] };
      uniqueAnchorStart: number | null;
      found: { start: number; end: number } | null;
    }
    const prepared: PreparedPiece[] = [];
    let counter = 0;

    for (const piece of compPieces) {
      const hasEtc = piece.words.some((h) => ETC.has(plainWord(h.word)));
      const words = piece.words.filter((h) => {
        const p = plainWord(h.word);
        return p && !ETC.has(p) && !HEADINGS.has(p);
      });
      if (words.length === 0) continue;
      const toks = toTokens(words);
      const hg = extractHachiGarsinan(toks);
      // Pre-compute read-only unique anchor landmark for contextual bracketing.
      let uniqueAnchorStart: number | null = null;
      if (!hg.isHg) {
        const minK = toks.length === 1 ? 1 : 2;
        for (let k = toks.length; k >= minK; k--) {
          if (k === 1 && plainWord(toks[0].text).length < 2) break;
          const allHits = findAllInMain(toks.slice(0, k).map((t) => t.text), mainWords, emptyClaimed, false);
          if (allHits.length > 0) {
            if (allHits.length === 1) uniqueAnchorStart = allHits[0].start;
            break;
          }
        }
      }
      prepared.push({
        piece,
        key: `${commentator}:${counter++}`,
        hasEtc,
        toks,
        hg,
        uniqueAnchorStart,
        found: null,
      });
    }

    // Pass 1: Resolve all standard (non-הכי גרסינן) openings.
    // When multiple free occurrences exist in Gemara, apply contextual matching first, then chronological fallback.
    let cursor = 0;
    for (let idx = 0; idx < prepared.length; idx++) {
      const item = prepared[idx];
      if (item.hg.isHg) continue;
      const { piece, key, hasEtc, toks } = item;
      const bodyWords = piece.bodyWords || [];

      let candidates: Array<{ start: number; end: number }> = [];
      let matchedTokens: string[] = [];

      // The quotation always begins with the opening's first word — never from its middle or end.
      // One-word openings quote one word; longer ones need at least two matching words.
      const minK = toks.length === 1 ? 1 : 2;
      for (let k = toks.length; k >= minK; k--) {
        if (k === 1 && plainWord(toks[0].text).length < 2) break;
        const slice = toks.slice(0, k).map((t) => t.text);
        const hits = findAllInMain(slice, mainWords, claimed[commentator], true);
        if (hits.length > 0) {
          candidates = hits;
          matchedTokens = slice;
          break;
        }
      }
      // An abbreviation at the opening's start (קמ״ל ↔ קא משמע לן) may not align with the main text:
      // set it aside and match the words that follow it.
      if (candidates.length === 0) {
        const abbr = toks.findIndex((t) => /["'״׳]/.test(t.text));
        const rest = abbr >= 0 && abbr < 2 ? toks.slice(abbr + 1).map((t) => t.text) : [];
        for (let k = rest.length; k >= 2 && candidates.length === 0; k--) {
          const slice = rest.slice(0, k);
          const hits = findAllInMain(slice, mainWords, claimed[commentator], true);
          if (hits.length > 0) {
            candidates = hits;
            matchedTokens = slice;
          }
        }
      }
      if (candidates.length === 0) continue;

      let prevBound = -1;
      for (let j = idx - 1; j >= 0; j--) {
        if (prepared[j].found) {
          prevBound = prepared[j].found!.end;
          break;
        }
      }
      let nextBound = mainWords.length;
      for (let j = idx + 1; j < prepared.length; j++) {
        if (prepared[j].uniqueAnchorStart !== null) {
          nextBound = prepared[j].uniqueAnchorStart!;
          break;
        }
      }

      let found = pickCandidateByContextOrChronology(
        candidates,
        bodyWords,
        main,
        cursor,
        prevBound,
        nextBound
      );

      if (matchedTokens.length > 0) {
        const totalOccurrences = findAllInMain(matchedTokens, mainWords, emptyClaimed, false);
        if (totalOccurrences.length >= 2) {
          for (const occ of totalOccurrences) duplicateCandidateSpans.push(occ);
        }
      }

      cursor = found.start + 1;
      // וכו׳: a Tosafot opening that starts where a longer Rashi quotation starts quotes all of it.
      if (commentator === 'tosafot' && hasEtc) {
        const r = spans.find((x) => x.start === found.start && x.end > found.end);
        if (r && free(found.start, r.end, claimed.tosafot)) found = { start: found.start, end: r.end };
      }
      for (let i = found.start; i <= found.end; i++) claimed[commentator].add(i);
      if (commentator === 'rashi') spans.push({ key, start: found.start, end: found.end });
      item.found = found;
    }

    // Pass 2: Resolve הכי גרסינן / ה"ג openings using contextual brackets between resolved anchors.
    for (let idx = 0; idx < prepared.length; idx++) {
      const item = prepared[idx];
      if (!item.hg.isHg) continue;
      let prevEnd = -1;
      let prevStart = -1;
      for (let j = idx - 1; j >= 0; j--) {
        if (prepared[j].found) {
          prevEnd = prepared[j].found!.end;
          prevStart = prepared[j].found!.start;
          break;
        }
      }
      let nextStart = mainWords.length;
      let nextEnd = mainWords.length - 1;
      for (let j = idx + 1; j < prepared.length; j++) {
        if (prepared[j].found) {
          nextStart = prepared[j].found!.start;
          nextEnd = prepared[j].found!.end;
          break;
        }
      }

      const trySearch = (qToks: Token<T>[]) => {
        const qWords = qToks.map((t) => t.text);
        if (qWords.length === 0) return null;
        // 1) Strict bracketed window between previous and next linked DH
        if (prevEnd + 1 <= nextStart - 1) {
          const hit = findHachiGarsinanInWindow(qWords, mainWords, prevEnd + 1, nextStart - 1, claimed[commentator]);
          if (hit) return hit;
        }
        // 2) Slightly relaxed boundary window
        const relLo = Math.max(0, prevStart + 1);
        const relHi = Math.min(mainWords.length - 1, nextEnd);
        if (relLo <= relHi) {
          const hit = findHachiGarsinanInWindow(qWords, mainWords, relLo, relHi, claimed[commentator]);
          if (hit) return hit;
        }
        // 3) Full page fallback for strong matches (>= 3 matched words or >= 2 clean verbatim words)
        const hit = findHachiGarsinanInWindow(qWords, mainWords, 0, mainWords.length - 1, claimed[commentator]);
        if (hit && (hit.matched >= 3 || (hit.q0 === 0 && hit.consecutive >= 2))) return hit;
        return null;
      };

      const hit = trySearch(item.hg.positive) || (item.hg.negative.length >= 2 ? trySearch(item.hg.negative) : null);
      if (hit) {
        let found: { start: number; end: number } = { start: hit.start, end: hit.end };
        if (commentator === 'tosafot' && item.hasEtc) {
          const r = spans.find((x) => x.start === found.start && x.end > found.end);
          if (r && free(found.start, r.end, claimed.tosafot)) found = { start: found.start, end: r.end };
        }
        for (let i = found.start; i <= found.end; i++) claimed[commentator].add(i);
        if (commentator === 'rashi') spans.push({ key: item.key, start: found.start, end: found.end });
        item.found = found;
      }
    }

    // Emit links and commentary-side roles in original reading order.
    for (const item of prepared) {
      const { piece, key, hg, found } = item;
      const isHg = hg.isHg;
      if (!found) {
        // Still an opening: colour it in its column even when the quotation is not on this page.
        for (const h of piece.words) {
          if (h.section === 'rashi' || h.section === 'tosafot') {
            const role: DhHotspotRole = { [commentator]: key };
            if (isHg) {
              role.hachiGarsinan = true;
              if (commentator === 'rashi') role.rashiHachi = true;
              else role.tosafotHachi = true;
            }
            roles.set(h.id, role);
          }
        }
        continue;
      }
      const link: DhLink = {
        key,
        commentator,
        dhIds: piece.words.map((h) => h.id),
        mainIds: main.slice(found.start, found.end + 1).flatMap((t) => t.hs.map((h) => h.id)),
        ...(isHg ? { hachiGarsinan: true } : {}),
      };
      links.push(link);
      for (const id of link.dhIds) {
        const role: DhHotspotRole = { [commentator]: key };
        if (isHg) {
          role.hachiGarsinan = true;
          if (commentator === 'rashi') role.rashiHachi = true;
          else role.tosafotHachi = true;
        }
        roles.set(id, role);
      }
    }
  }

  // Main-text roles: Rashi green, Tosafot bordeaux, הכי גרסינן / ה"ג purple, shared words split in half.
  for (const l of links) {
    for (const id of l.mainIds) {
      const r: DhHotspotRole = { ...(roles.get(id) || {}) };
      if (!r[l.commentator]) r[l.commentator] = l.key;
      if (l.hachiGarsinan) {
        r.hachiGarsinan = true;
        if (l.commentator === 'rashi') r.rashiHachi = true;
        else r.tosafotHachi = true;
      }
      if (r.rashi && r.tosafot) r.splitWord = true;
      roles.set(id, r);
    }
  }

  // Mark remaining unclaimed duplicate DH occurrences in the Gemara text in carrot/orange.
  for (const span of duplicateCandidateSpans) {
    const spanHotspots = main.slice(span.start, span.end + 1).flatMap((t) => t.hs);
    if (spanHotspots.length === 0) continue;
    const anyClaimed = spanHotspots.some((h) => {
      const r = roles.get(h.id);
      return Boolean(r?.rashi || r?.tosafot || r?.hachiGarsinan);
    });
    if (anyClaimed) continue;
    for (const h of spanHotspots) {
      roles.set(h.id, { ...(roles.get(h.id) || {}), duplicateGemara: true });
    }
  }

  return { links, roles };
}

/** For a split word, which side was tapped? RTL: right half = Rashi. */
export function splitSideAt(clientX: number, rect: { left: number; width: number }): DhCommentator {
  return clientX >= rect.left + rect.width / 2 ? 'rashi' : 'tosafot';
}
