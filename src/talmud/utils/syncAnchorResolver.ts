import {
  isInlineMarker,
  normalizeHebrewWord,
  readingOrder,
  stripGluedMarker,
  wordsMatch,
} from "./dibburHamatchilMatcher";
import type {
  AudioSyncSection,
  AudioSyncSegment,
  SyncHotspotLike,
  WordAnchor,
} from "./audioSyncTypes";

export type AnchorMatchStatus = "resolved" | "unresolved" | "ambiguous";
export type SegmentResolutionStatus = "resolved" | "partial" | "unresolved" | "ambiguous";

export interface SingleAnchorResolution<T extends SyncHotspotLike = SyncHotspotLike> {
  anchorIndex: number;
  anchor: WordAnchor;
  status: AnchorMatchStatus;
  matchedHotspots: T[];
  matchedHotspotIds: string[];
  candidateHotspotIds: string[];
  score: number;
  reason?: string | undefined;
}

export interface AnchorResolutionResult<T extends SyncHotspotLike = SyncHotspotLike> {
  segmentId: string;
  status: SegmentResolutionStatus;
  hotspotIds: string[];
  hotspots: T[];
  anchorResults: SingleAnchorResolution<T>[];
  resolvedCount: number;
  unresolvedCount: number;
  ambiguousCount: number;
  diagnostics: string[];
}

export interface ResolveAnchorOptions {
  /** Minimum score margin above runner-up required to declare a unique match. */
  ambiguityMargin?: number | undefined;
  /** Maximum number of neighbor words to inspect on each side. */
  contextWindow?: number | undefined;
  /**
   * When true, tied candidates pick the highest-scoring / reading-order-closest
   * candidate instead of resolving to zero hotspots.
   */
  approximate?: boolean | undefined;
  /** Optional reading-order hint to break ties near the listener's flow. */
  preferredOrderHint?: number | undefined;
}

interface IndexedMainToken<T extends SyncHotspotLike> {
  hotspots: T[];
  section: AudioSyncSection;
  surfaceWord: string;
  normalizedWord: string;
  plainWord: string;
  occurrence: number;
  readingOrderIndex: number;
  rowId: string;
  lineFingerprint: string;
  prevWords: string[];
  nextWords: string[];
}

const FINALS_MAP: Readonly<Record<string, string>> = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ",
};

const DEFAULT_AMBIGUITY_MARGIN = 8;
const DEFAULT_CONTEXT_WINDOW = 3;

export function toPlainHebrew(raw: string): string {
  return normalizeHebrewWord(raw)
    .replace(/["'\u05F3\u05F4]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS_MAP[c] ?? c);
}

export function normalizeLineFingerprint(rawLine: string): string {
  return rawLine
    .split(/\s+/)
    .map((tok) => toPlainHebrew(stripGluedMarker(tok)))
    .filter((w) => w.length > 0)
    .join(" ");
}

function isMainSection(section: string): section is AudioSyncSection {
  return section === "mishnah" || section === "gemara";
}

function hotspotSurfaceWord(h: SyncHotspotLike): string {
  const cleaned = stripGluedMarker(h.word).trim();
  const base = cleaned || h.word.trim();
  if (h.quoteAfter && !base.endsWith(h.quoteAfter)) {
    return `${base}${h.quoteAfter}`;
  }
  return base;
}

/**
 * Builds deterministic, section-isolated reading-order tokens from extracted hotspots
 * without mutating the input array and without relying on `pdf-word-${idx}` IDs.
 */
export function buildIndexedMainTokens<T extends SyncHotspotLike>(
  hotspots: readonly T[],
  contextWindow = DEFAULT_CONTEXT_WINDOW,
): IndexedMainToken<T>[] {
  const sections: AudioSyncSection[] = ["mishnah", "gemara"];
  const tokens: IndexedMainToken<T>[] = [];
  let globalMainOrder = 0;

  for (const section of sections) {
    const rawSectionSpots = hotspots.filter(
      (h) =>
        isMainSection(h.section) &&
        h.section === section &&
        !h.isSmallMarker &&
        !isInlineMarker(h.word) &&
        toPlainHebrew(stripGluedMarker(h.word)).length > 0,
    );

    const ordered = readingOrder([...rawSectionSpots]);
    const sectionTokens: Array<{
      hotspots: T[];
      section: AudioSyncSection;
      surfaceWord: string;
      normalizedWord: string;
      plainWord: string;
      rowId: string;
      rawLineText: string | undefined;
    }> = [];

    for (let i = 0; i < ordered.length; i++) {
      const h = ordered[i];
      if (!h) continue;
      const next = ordered[i + 1];

      // Merge split quote runs printed as separate adjacent hotspots (ק + " + ש -> ק"ש)
      if (
        h.quoteAfter === '"' &&
        next &&
        next.rowId === h.rowId &&
        toPlainHebrew(stripGluedMarker(next.word)).length <= 2
      ) {
        const leftNorm = normalizeHebrewWord(stripGluedMarker(h.word));
        const rightNorm = normalizeHebrewWord(stripGluedMarker(next.word));
        const combinedSurface = `${leftNorm}"${rightNorm}`;
        const combinedPlain = toPlainHebrew(combinedSurface);
        if (combinedPlain.length > 0) {
          sectionTokens.push({
            hotspots: [h, next],
            section,
            surfaceWord: combinedSurface,
            normalizedWord: normalizeHebrewWord(combinedSurface),
            plainWord: combinedPlain,
            rowId: h.rowId,
            rawLineText: h.lineTextHe,
          });
          i++;
          continue;
        }
      }

      const surfaceWord = hotspotSurfaceWord(h);
      const normalizedWord = normalizeHebrewWord(surfaceWord);
      const plain = toPlainHebrew(surfaceWord);
      if (plain.length === 0) continue;

      sectionTokens.push({
        hotspots: [h],
        section,
        surfaceWord,
        normalizedWord: normalizedWord || plain,
        plainWord: plain,
        rowId: h.rowId,
        rawLineText: h.lineTextHe,
      });
    }

    // Group row tokens so we can fall back cleanly when lineTextHe is omitted
    const rowWordsMap = new Map<string, string[]>();
    for (const tok of sectionTokens) {
      const arr = rowWordsMap.get(tok.rowId);
      if (arr) {
        arr.push(tok.plainWord);
      } else {
        rowWordsMap.set(tok.rowId, [tok.plainWord]);
      }
    }

    const occurrenceCounter = new Map<string, number>();

    for (let idx = 0; idx < sectionTokens.length; idx++) {
      const tok = sectionTokens[idx];
      if (!tok) continue;
      const occ = (occurrenceCounter.get(tok.plainWord) ?? 0) + 1;
      occurrenceCounter.set(tok.plainWord, occ);

      const prevWords: string[] = [];
      for (let k = Math.max(0, idx - contextWindow); k < idx; k++) {
        const pTok = sectionTokens[k];
        if (pTok) prevWords.push(pTok.plainWord);
      }

      const nextWords: string[] = [];
      for (let k = idx + 1; k < Math.min(sectionTokens.length, idx + 1 + contextWindow); k++) {
        const nTok = sectionTokens[k];
        if (nTok) nextWords.push(nTok.plainWord);
      }

      const rowFallback = (rowWordsMap.get(tok.rowId) ?? []).join(" ");
      const lineFingerprint = tok.rawLineText
        ? normalizeLineFingerprint(tok.rawLineText) || rowFallback
        : rowFallback;

      tokens.push({
        hotspots: tok.hotspots,
        section: tok.section,
        surfaceWord: tok.surfaceWord,
        normalizedWord: tok.normalizedWord,
        plainWord: tok.plainWord,
        occurrence: occ,
        readingOrderIndex: globalMainOrder++,
        rowId: tok.rowId,
        lineFingerprint,
        prevWords,
        nextWords,
      });
    }
  }

  return tokens;
}

function lineSimilarityScore(expected: string | undefined, actual: string): number {
  if (!expected) return 0;
  const normExpected = normalizeLineFingerprint(expected);
  if (!normExpected || !actual) return 0;
  if (normExpected === actual) return 40;

  const expectedWords = new Set(normExpected.split(" "));
  const actualWords = actual.split(" ");
  let overlap = 0;
  for (const w of actualWords) {
    if (expectedWords.has(w)) overlap++;
  }
  const denom = Math.max(expectedWords.size, actualWords.length, 1);
  const ratio = overlap / denom;
  return ratio >= 0.5 ? Math.round(ratio * 30) : 0;
}

function scoreCandidate<T extends SyncHotspotLike>(
  anchor: WordAnchor,
  candidate: IndexedMainToken<T>,
  preferredOrderHint?: number,
): { score: number; hasDisambiguatingEvidence: boolean } {
  const anchorPlain = toPlainHebrew(anchor.rawWord ?? anchor.normalizedWord);
  const exactPlain = candidate.plainWord === anchorPlain;

  let score = exactPlain ? 100 : 65;
  let hasDisambiguatingEvidence = false;

  // 1. Text neighbor context (highest priority over pixel coordinates/rowId)
  const anchorPrev = anchor.prevWords ?? [];
  if (anchorPrev.length > 0) {
    let matchedPrev = 0;
    for (let d = 1; d <= anchorPrev.length; d++) {
      const expRaw = anchorPrev[anchorPrev.length - d];
      const actRaw = candidate.prevWords[candidate.prevWords.length - d];
      if (!expRaw || !actRaw) continue;
      const expPlain = toPlainHebrew(expRaw);
      const weight = d === 1 ? 50 : d === 2 ? 30 : 15;
      if (expPlain === actRaw) {
        score += weight;
        matchedPrev++;
      } else if (wordsMatch(expRaw, actRaw)) {
        score += Math.round(weight * 0.65);
        matchedPrev++;
      } else if (d === 1) {
        score -= 18;
      }
    }
    if (matchedPrev > 0) hasDisambiguatingEvidence = true;
  }

  const anchorNext = anchor.nextWords ?? [];
  if (anchorNext.length > 0) {
    let matchedNext = 0;
    for (let d = 0; d < anchorNext.length; d++) {
      const expRaw = anchorNext[d];
      const actRaw = candidate.nextWords[d];
      if (!expRaw || !actRaw) continue;
      const expPlain = toPlainHebrew(expRaw);
      const weight = d === 0 ? 50 : d === 1 ? 30 : 15;
      if (expPlain === actRaw) {
        score += weight;
        matchedNext++;
      } else if (wordsMatch(expRaw, actRaw)) {
        score += Math.round(weight * 0.65);
        matchedNext++;
      } else if (d === 0) {
        score -= 18;
      }
    }
    if (matchedNext > 0) hasDisambiguatingEvidence = true;
  }

  // 2. Resolution-independent line fingerprint
  const lineSim = lineSimilarityScore(anchor.lineFingerprint, candidate.lineFingerprint);
  if (lineSim > 0) {
    score += lineSim;
    hasDisambiguatingEvidence = true;
  }

  // 3. Occurrence & reading order
  if (anchor.occurrence >= 1 && candidate.occurrence === anchor.occurrence) {
    score += 28;
    hasDisambiguatingEvidence = true;
  }

  if (anchor.readingOrderIndex >= 0) {
    const distance = Math.abs(candidate.readingOrderIndex - anchor.readingOrderIndex);
    score += Math.max(0, 22 - distance * 2);
  }

  if (preferredOrderHint !== undefined && preferredOrderHint >= 0) {
    const flowDistance = Math.abs(candidate.readingOrderIndex - preferredOrderHint);
    score += Math.max(0, 14 - Math.min(14, Math.floor(flowDistance / 2)));
  }

  // 4. Legacy rowId is strictly a minor tie hint (never overrides text context)
  if (anchor.rowIdHint && candidate.rowId === anchor.rowIdHint) {
    score += 4;
  }

  return { score, hasDisambiguatingEvidence };
}

function hasAnyContextOrValidOccurrence<T extends SyncHotspotLike>(
  anchor: WordAnchor,
  candidates: readonly IndexedMainToken<T>[],
): boolean {
  const hasNeighbors =
    (anchor.prevWords !== undefined && anchor.prevWords.length > 0) ||
    (anchor.nextWords !== undefined && anchor.nextWords.length > 0);
  const hasLine = anchor.lineFingerprint !== undefined && anchor.lineFingerprint.trim().length > 0;
  const occurrenceMatchesCandidate =
    anchor.occurrence >= 1 && candidates.some((c) => c.occurrence === anchor.occurrence);
  return hasNeighbors || hasLine || occurrenceMatchesCandidate;
}

/**
 * Resolves `segment.anchors` onto live PDF hotspots using stable content, section,
 * context, occurrence, and reading-order signals. Never mutates inputs, never crosses
 * sections, never trusts `pdf-word-*` IDs, and never silently resolves ties.
 */
export function resolveSyncHotspots<T extends SyncHotspotLike>(
  hotspots: readonly T[],
  segment: Pick<AudioSyncSegment, "id" | "anchors">,
  options: ResolveAnchorOptions = {},
): AnchorResolutionResult<T> {
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  if (segment.anchors.length === 0) {
    return {
      segmentId: segment.id,
      status: "unresolved",
      hotspotIds: [],
      hotspots: [],
      anchorResults: [],
      resolvedCount: 0,
      unresolvedCount: 0,
      ambiguousCount: 0,
      diagnostics: ["segment-has-no-anchors"],
    };
  }

  const tokens = buildIndexedMainTokens(hotspots, contextWindow);
  const anchorResults: SingleAnchorResolution<T>[] = [];
  const diagnostics: string[] = [];

  for (let i = 0; i < segment.anchors.length; i++) {
    const anchor = segment.anchors[i];
    if (!anchor) continue;

    const anchorWordForMatch = anchor.rawWord ?? anchor.normalizedWord;
    const anchorPlain = toPlainHebrew(anchorWordForMatch);

    const matchingCandidates = tokens.filter((tok) => {
      if (tok.section !== anchor.section) return false;
      if (anchorPlain.length === 0) return false;
      if (tok.plainWord === anchorPlain) return true;
      return wordsMatch(anchorWordForMatch, tok.surfaceWord);
    });

    if (matchingCandidates.length === 0) {
      diagnostics.push(
        `anchor[${i}](${anchor.normalizedWord}@${anchor.section}):no-matching-word-in-section`,
      );
      anchorResults.push({
        anchorIndex: i,
        anchor,
        status: "unresolved",
        matchedHotspots: [],
        matchedHotspotIds: [],
        candidateHotspotIds: [],
        score: 0,
        reason: "no-matching-word-in-section",
      });
      continue;
    }

    const scored = matchingCandidates
      .map((candidate) => {
        const res = scoreCandidate(anchor, candidate, options.preferredOrderHint);
        return {
          candidate,
          score: res.score,
          hasDisambiguatingEvidence: res.hasDisambiguatingEvidence,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (options.preferredOrderHint !== undefined && options.preferredOrderHint >= 0) {
          const distDiff =
            Math.abs(a.candidate.readingOrderIndex - options.preferredOrderHint) -
            Math.abs(b.candidate.readingOrderIndex - options.preferredOrderHint);
          if (distDiff !== 0) return distDiff;
        }
        return a.candidate.readingOrderIndex - b.candidate.readingOrderIndex;
      });

    const best = scored[0];
    if (!best) continue;

    if (scored.length === 1) {
      anchorResults.push({
        anchorIndex: i,
        anchor,
        status: "resolved",
        matchedHotspots: [...best.candidate.hotspots],
        matchedHotspotIds: best.candidate.hotspots.map((h) => h.id),
        candidateHotspotIds: best.candidate.hotspots.map((h) => h.id),
        score: best.score,
      });
      continue;
    }

    const runnerUp = scored[1];
    const scoreGap = runnerUp ? best.score - runnerUp.score : Infinity;
    const hasDisambiguator = hasAnyContextOrValidOccurrence(anchor, matchingCandidates);

    if ((scoreGap <= ambiguityMargin || !hasDisambiguator) && !options.approximate) {
      const candidateIds = scored.flatMap((s) => s.candidate.hotspots.map((h) => h.id));
      const reason = !hasDisambiguator
        ? "multiple-occurrences-without-disambiguating-context"
        : "tied-candidate-scores";
      diagnostics.push(`anchor[${i}](${anchor.normalizedWord}):${reason}`);
      anchorResults.push({
        anchorIndex: i,
        anchor,
        status: "ambiguous",
        matchedHotspots: [],
        matchedHotspotIds: [],
        candidateHotspotIds: candidateIds,
        score: best.score,
        reason,
      });
      continue;
    }

    anchorResults.push({
      anchorIndex: i,
      anchor,
      status: "resolved",
      matchedHotspots: [...best.candidate.hotspots],
      matchedHotspotIds: best.candidate.hotspots.map((h) => h.id),
      candidateHotspotIds: scored.flatMap((s) => s.candidate.hotspots.map((h) => h.id)),
      score: best.score,
    });
  }

  const seenIds = new Set<string>();
  const resolvedHotspots: T[] = [];
  const resolvedIds: string[] = [];

  for (const ar of anchorResults) {
    if (ar.status !== "resolved") continue;
    for (const h of ar.matchedHotspots) {
      if (!seenIds.has(h.id)) {
        seenIds.add(h.id);
        resolvedHotspots.push(h);
        resolvedIds.push(h.id);
      }
    }
  }

  const resolvedCount = anchorResults.filter((r) => r.status === "resolved").length;
  const unresolvedCount = anchorResults.filter((r) => r.status === "unresolved").length;
  const ambiguousCount = anchorResults.filter((r) => r.status === "ambiguous").length;

  let status: SegmentResolutionStatus;
  if (resolvedCount === anchorResults.length) {
    status = "resolved";
  } else if (ambiguousCount > 0 && resolvedCount === 0) {
    status = "ambiguous";
  } else if (ambiguousCount > 0 && resolvedCount > 0) {
    status = "partial";
  } else if (resolvedCount > 0) {
    status = "partial";
  } else {
    status = "unresolved";
  }

  return {
    segmentId: segment.id,
    status,
    hotspotIds: resolvedIds,
    hotspots: resolvedHotspots,
    anchorResults,
    resolvedCount,
    unresolvedCount,
    ambiguousCount,
    diagnostics,
  };
}
