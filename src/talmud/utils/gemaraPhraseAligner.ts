import { abbreviationSpan, normalizeHebrewWord, wordsMatch } from "./dibburHamatchilMatcher";
import { tokenizeQuery } from "./dafSearch";
import {
  AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD,
  AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_GAP_WORDS,
  classifyConfidenceBand,
  type AudioSyncConfidenceBand,
  type AudioSyncMap,
  type AudioSyncReviewStatus,
  type AudioSyncSegment,
  type DafTransitionMarker,
  type SyncHotspotLike,
  type WordAnchor,
} from "./audioSyncTypes";
import { buildIndexedMainTokens, toPlainHebrew } from "./syncAnchorResolver";

export interface AlignerSegmentInput {
  id: string;
  startMs: number;
  endMs: number;
  textHe: string;
  topicKa?: string | undefined;
  dafId?: string | undefined;
}

export interface AlignerContext {
  tractateId: string;
  dafId: string;
  title?: string | undefined;
  speaker?: string | undefined;
  audioUrl?: string | undefined;
}

export interface AlignerOptions {
  /** Maximum skipped main-text words allowed inside a matched phrase. Default: 3. */
  maxGapWords?: number | undefined;
  highConfidenceThreshold?: number | undefined;
  mediumConfidenceThreshold?: number | undefined;
  /** Minimum score delta below which two candidate spans are flagged as ambiguous. */
  ambiguityDelta?: number | undefined;
  /** Initial main-text token cursor index for monotonic alignment. */
  initialCursor?: number | undefined;
  /**
   * When true, tied, slightly below-threshold, or out-of-cursor segments preserve
   * best approximate anchors instead of emitting empty `anchors: []`.
   */
  allowApproximate?: boolean | undefined;
}

export interface PhraseMatchCandidate {
  startTokenIdx: number;
  endTokenIdx: number;
  matchedTokenIndices: number[];
  hotspotIds: string[];
  matchedQueryCount: number;
  totalQueryCount: number;
  gapCount: number;
  confidence: number;
}

export interface PhraseMatchOutput {
  candidates: PhraseMatchCandidate[];
  best: PhraseMatchCandidate | null;
  isAmbiguous: boolean;
}

export type AlignedSegmentOutcome =
  "matched" | "low-confidence" | "ambiguous" | "unmatched" | "daf-transition";

export interface AlignedSegmentResult {
  segment: AudioSyncSegment;
  status: AlignedSegmentOutcome;
  confidenceBand: AudioSyncConfidenceBand;
  matchedHotspotIds: string[];
  candidateCount: number;
  dafTransitionDetected?: DafTransitionMarker | undefined;
  diagnostics: string[];
}

export interface GemaraAlignmentRun {
  map: AudioSyncMap;
  results: AlignedSegmentResult[];
  finalCursor: number;
}

type MainToken = ReturnType<typeof buildIndexedMainTokens>[number];

const AMBIGUITY_SCORE_DELTA = 0.03;

const HEBREW_ONES: Readonly<Record<string, number>> = {
  א: 1,
  ב: 2,
  ג: 3,
  ד: 4,
  ה: 5,
  ו: 6,
  ז: 7,
  ח: 8,
  ט: 9,
};
const HEBREW_TENS: Readonly<Record<string, number>> = {
  י: 10,
  כ: 20,
  ל: 30,
  מ: 40,
  נ: 50,
  ס: 60,
  ע: 70,
  פ: 80,
  צ: 90,
};
const HEBREW_HUNDREDS: Readonly<Record<string, number>> = {
  ק: 100,
  ר: 200,
  ש: 300,
  ת: 400,
};

function parseHebrewGematriaNumber(raw: string): number | null {
  const letters = raw.replace(/[^א-ת]/g, "");
  if (!letters) return null;
  let sum = 0;
  for (const ch of letters) {
    const val = HEBREW_HUNDREDS[ch] ?? HEBREW_TENS[ch] ?? HEBREW_ONES[ch];
    if (val === undefined) return null;
    sum += val;
  }
  return sum >= 2 && sum <= 200 ? sum : null;
}

function advanceDafId(dafId: string): string | null {
  const m = /^(\d+)([ab])$/.exec(dafId);
  if (!m) return null;
  const num = Number(m[1]);
  const side = m[2];
  if (!Number.isInteger(num) || num < 2) return null;
  if (side === "a") return `${num}b`;
  return `${num + 1}a`;
}

/**
 * Detects explicit page/daf transition markers in spoken Gemara segments
 * (e.g. "עמוד ב", "דף ב עמוד ב", "ע\"ב", or explicit segment.dafId change).
 */
export function detectDafTransition(
  segment: AlignerSegmentInput,
  currentDafId: string,
): DafTransitionMarker | null {
  if (segment.dafId && segment.dafId !== currentDafId) {
    return {
      fromDafId: currentDafId,
      toDafId: segment.dafId,
      triggerPhrase: "explicit-segment-daf",
    };
  }

  const normalized = segment.textHe.replace(/[\u0591-\u05C7]/g, "").trim();
  if (!normalized) return null;

  // Pattern: "דף <hebrew|digits> עמוד א/ב" or "עמוד ב" / 'ע"ב' / 'ע"א'
  const explicitDafAmud =
    /(?:^|\s)(דף\s+([א-ת"'״׳]{1,5}|\d{1,3})\s+עמוד\s+([אב]|א'|ב'))(?:\s|$)/.exec(normalized);
  if (explicitDafAmud) {
    const rawNum = explicitDafAmud[2] ?? "";
    const rawSide = (explicitDafAmud[3] ?? "").replace(/['"׳״]/g, "");
    const dafNum = /^\d+$/.test(rawNum) ? Number(rawNum) : parseHebrewGematriaNumber(rawNum);
    const side = rawSide === "א" ? "a" : rawSide === "ב" ? "b" : null;
    if (dafNum && side) {
      const target = `${dafNum}${side}`;
      if (target !== currentDafId) {
        return {
          fromDafId: currentDafId,
          toDafId: target,
          triggerPhrase: explicitDafAmud[1]?.trim(),
        };
      }
    }
  }

  const amudOnly = /(?:^|\s)(עמוד\s+([אב])|ע["״]([אב])|נעבור\s+לדף\s+הבא|בדף\s+הבא)(?:\s|$)/.exec(
    normalized,
  );
  if (amudOnly) {
    const sideLetter = amudOnly[2] ?? amudOnly[3];
    if (sideLetter) {
      const currentNumMatch = /^(\d+)([ab])$/.exec(currentDafId);
      if (currentNumMatch) {
        const curNum = Number(currentNumMatch[1]);
        const curSide = currentNumMatch[2];
        const targetSide = sideLetter === "א" ? "a" : "b";
        const targetNum = curSide === "b" && targetSide === "a" ? curNum + 1 : curNum;
        const target = `${targetNum}${targetSide}`;
        if (target !== currentDafId) {
          return {
            fromDafId: currentDafId,
            toDafId: target,
            triggerPhrase: amudOnly[1]?.trim(),
          };
        }
      }
    } else {
      const next = advanceDafId(currentDafId);
      if (next) {
        return {
          fromDafId: currentDafId,
          toDafId: next,
          triggerPhrase: amudOnly[1]?.trim(),
        };
      }
    }
  }

  return null;
}

interface TokenStepMatch {
  queryConsumed: number;
  mainConsumed: number;
  quality: number;
}

function matchSingleStep(
  queryTokens: readonly string[],
  qIdx: number,
  mainTokens: readonly MainToken[],
  mIdx: number,
): TokenStepMatch | null {
  const qTok = queryTokens[qIdx];
  const mTok = mainTokens[mIdx];
  if (!qTok || !mTok) return null;

  const qPlain = toPlainHebrew(qTok);
  if (!qPlain) return null;

  // 1. Direct consonantal / normalized match
  if (qPlain === mTok.plainWord) {
    const rawExact = normalizeHebrewWord(qTok) === mTok.normalizedWord ? 1 : 0.96;
    return { queryConsumed: 1, mainConsumed: 1, quality: rawExact };
  }

  // 2. Prefix / final-letter / geresh / Aramaic plural / mater matching via DH matcher
  if (wordsMatch(qTok, mTok.surfaceWord)) {
    return { queryConsumed: 1, mainConsumed: 1, quality: 0.9 };
  }

  // 3. Abbreviation in spoken query matching multiple main PDF words (ק"ש -> קריאת שמע)
  const mainSurfaceSlice = mainTokens.slice(mIdx, mIdx + 6).map((t) => t.surfaceWord);
  const abbrUsedMain = abbreviationSpan(qTok, mainSurfaceSlice, 0);
  if (abbrUsedMain > 0) {
    return { queryConsumed: 1, mainConsumed: abbrUsedMain, quality: 0.9 };
  }

  // 4. Abbreviation in PDF main text matching multiple spoken words (אדר"מ -> אדר' מאיר)
  const querySlice = queryTokens.slice(qIdx, qIdx + 6);
  const abbrUsedQuery = abbreviationSpan(mTok.surfaceWord, [...querySlice], 0);
  if (abbrUsedQuery > 0) {
    return { queryConsumed: abbrUsedQuery, mainConsumed: 1, quality: 0.9 };
  }

  return null;
}

function alignSpanFromStart(
  queryTokens: readonly string[],
  mainTokens: readonly MainToken[],
  startIdx: number,
  maxGapWords: number,
): PhraseMatchCandidate | null {
  const firstStep = matchSingleStep(queryTokens, 0, mainTokens, startIdx);
  if (!firstStep) return null;

  const matchedTokenIndices: number[] = [];
  for (let k = 0; k < firstStep.mainConsumed; k++) {
    matchedTokenIndices.push(startIdx + k);
  }

  let qIdx = firstStep.queryConsumed;
  let mIdx = startIdx + firstStep.mainConsumed;
  let totalQuality = firstStep.quality * firstStep.queryConsumed;
  let matchedQueryCount = firstStep.queryConsumed;
  let gapCount = 0;

  while (qIdx < queryTokens.length && mIdx < mainTokens.length) {
    let matchedInWindow = false;
    const maxLookahead = Math.min(maxGapWords, mainTokens.length - 1 - mIdx);

    for (let skip = 0; skip <= maxLookahead; skip++) {
      if (gapCount + skip > maxGapWords) break;
      const step = matchSingleStep(queryTokens, qIdx, mainTokens, mIdx + skip);
      if (step) {
        gapCount += skip;
        for (let k = 0; k < step.mainConsumed; k++) {
          matchedTokenIndices.push(mIdx + skip + k);
        }
        totalQuality += step.quality * step.queryConsumed;
        matchedQueryCount += step.queryConsumed;
        qIdx += step.queryConsumed;
        mIdx = mIdx + skip + step.mainConsumed;
        matchedInWindow = true;
        break;
      }
    }

    if (!matchedInWindow) {
      // Allow skipping one unmatched spoken filler/ASR token if later spoken words match nearby
      const remainingQuery = queryTokens.length - qIdx - 1;
      if (remainingQuery > 0) {
        let canRecoverQuerySkip = false;
        for (let skip = 0; skip <= maxLookahead; skip++) {
          if (gapCount + skip > maxGapWords) break;
          if (matchSingleStep(queryTokens, qIdx + 1, mainTokens, mIdx + skip)) {
            canRecoverQuerySkip = true;
            break;
          }
        }
        if (canRecoverQuerySkip) {
          qIdx += 1;
          continue;
        }
      }
      break;
    }
  }

  if (matchedTokenIndices.length === 0 || matchedQueryCount === 0) {
    return null;
  }

  const coverage = matchedQueryCount / queryTokens.length;
  const avgWordQuality = totalQuality / matchedQueryCount;
  const gapPenalty = Math.min(0.24, gapCount * 0.05);
  const rawConfidence = coverage * avgWordQuality - gapPenalty;
  const confidence = Math.max(0, Math.min(1, Number(rawConfidence.toFixed(4))));

  const hotspotIds: string[] = [];
  const seenHotspots = new Set<string>();
  for (const idx of matchedTokenIndices) {
    const tok = mainTokens[idx];
    if (!tok) continue;
    for (const h of tok.hotspots) {
      if (!seenHotspots.has(h.id)) {
        seenHotspots.add(h.id);
        hotspotIds.push(h.id);
      }
    }
  }

  const endTokenIdx = matchedTokenIndices[matchedTokenIndices.length - 1] ?? startIdx;

  return {
    startTokenIdx: startIdx,
    endTokenIdx,
    matchedTokenIndices,
    hotspotIds,
    matchedQueryCount,
    totalQueryCount: queryTokens.length,
    gapCount,
    confidence,
  };
}

/**
 * Searches main-text tokens monotonically from `startCursor` for candidate spans
 * matching `phraseText`, respecting `maxGapWords`. Does not mutate inputs.
 */
export function matchGemaraPhrase(
  hotspots: readonly SyncHotspotLike[],
  phraseText: string,
  startCursor = 0,
  options: { maxGapWords?: number | undefined; ambiguityDelta?: number | undefined } = {},
): PhraseMatchOutput {
  const queryTokens = tokenizeQuery(phraseText);
  if (queryTokens.length === 0) {
    return { candidates: [], best: null, isAmbiguous: false };
  }

  const mainTokens = buildIndexedMainTokens(hotspots);
  if (mainTokens.length === 0 || startCursor >= mainTokens.length) {
    return { candidates: [], best: null, isAmbiguous: false };
  }

  const maxGapWords = options.maxGapWords ?? DEFAULT_MAX_GAP_WORDS;
  const ambiguityDelta = options.ambiguityDelta ?? AMBIGUITY_SCORE_DELTA;
  const rawCandidates: PhraseMatchCandidate[] = [];

  for (let i = Math.max(0, startCursor); i < mainTokens.length; i++) {
    const cand = alignSpanFromStart(queryTokens, mainTokens, i, maxGapWords);
    if (cand) {
      rawCandidates.push(cand);
    }
  }

  if (rawCandidates.length === 0) {
    return { candidates: [], best: null, isAmbiguous: false };
  }

  // Deduplicate overlapping sub-matches sharing the same anchor start or exact end with lower score
  const sorted = [...rawCandidates].sort(
    (a, b) =>
      b.confidence - a.confidence || a.gapCount - b.gapCount || a.startTokenIdx - b.startTokenIdx,
  );

  const distinctCandidates: PhraseMatchCandidate[] = [];
  for (const cand of sorted) {
    const overlapsExisting = distinctCandidates.some(
      (kept) => cand.startTokenIdx <= kept.endTokenIdx && cand.endTokenIdx >= kept.startTokenIdx,
    );
    if (!overlapsExisting) {
      distinctCandidates.push(cand);
    }
  }

  const best = distinctCandidates[0] ?? null;
  const runnerUp = distinctCandidates[1];
  const isAmbiguous =
    best !== null &&
    runnerUp !== undefined &&
    best.confidence - runnerUp.confidence <= ambiguityDelta;

  return {
    candidates: distinctCandidates,
    best,
    isAmbiguous,
  };
}

/**
 * Searches all main-text tokens (Mishnah & Gemara) for the closest approximate
 * phrase span using sliding query starts and proximity to `preferredCursor`.
 */
export function findApproximatePhraseMatch(
  hotspots: readonly SyncHotspotLike[],
  phraseText: string,
  preferredCursor = 0,
  maxGapWords = DEFAULT_MAX_GAP_WORDS + 2,
): PhraseMatchCandidate | null {
  const queryTokens = tokenizeQuery(phraseText);
  if (queryTokens.length === 0) return null;

  const mainTokens = buildIndexedMainTokens(hotspots);
  if (mainTokens.length === 0) return null;

  const candidates: PhraseMatchCandidate[] = [];
  const maxQStart = Math.min(queryTokens.length - 1, 4);

  for (let qStart = 0; qStart <= maxQStart; qStart++) {
    const subQuery = queryTokens.slice(qStart);
    if (subQuery.length === 0) continue;

    for (let i = 0; i < mainTokens.length; i++) {
      const cand = alignSpanFromStart(subQuery, mainTokens, i, maxGapWords);
      if (!cand || cand.matchedQueryCount === 0) continue;

      const fullCoverage = cand.matchedQueryCount / queryTokens.length;
      const weightedConfidence = Number(
        Math.max(
          0,
          Math.min(1, fullCoverage * (cand.confidence / Math.max(0.01, cand.matchedQueryCount / subQuery.length))),
        ).toFixed(4),
      );

      candidates.push({
        ...cand,
        totalQueryCount: queryTokens.length,
        confidence: weightedConfidence,
      });
    }
  }

  if (candidates.length === 0) return null;

  const meaningfulMatches = candidates.filter((c) => {
    if (c.matchedQueryCount >= 2) return true;
    if (queryTokens.length === 1) return c.matchedQueryCount === 1;
    const singleTok = mainTokens[c.startTokenIdx];
    return Boolean(singleTok && singleTok.plainWord.length >= 2);
  });

  const pool = meaningfulMatches.length > 0 ? meaningfulMatches : candidates;

  pool.sort((a, b) => {
    const coverageDiff = b.matchedQueryCount - a.matchedQueryCount;
    if (coverageDiff !== 0) return coverageDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.05) return confDiff;

    const aForwardBias =
      a.startTokenIdx >= preferredCursor && a.startTokenIdx - preferredCursor <= 160 ? 0 : 1;
    const bForwardBias =
      b.startTokenIdx >= preferredCursor && b.startTokenIdx - preferredCursor <= 160 ? 0 : 1;
    if (aForwardBias !== bForwardBias) return aForwardBias - bForwardBias;

    return Math.abs(a.startTokenIdx - preferredCursor) - Math.abs(b.startTokenIdx - preferredCursor);
  });

  return pool[0] ?? null;
}

function toWordAnchors(
  mainTokens: readonly MainToken[],
  matchedTokenIndices: readonly number[],
): WordAnchor[] {
  const anchors: WordAnchor[] = [];
  for (const idx of matchedTokenIndices) {
    const tok = mainTokens[idx];
    if (!tok) continue;
    const primaryHotspot = tok.hotspots[0];
    anchors.push({
      normalizedWord: tok.normalizedWord,
      rawWord: tok.surfaceWord,
      section: tok.section,
      occurrence: tok.occurrence,
      readingOrderIndex: tok.readingOrderIndex,
      prevWords: [...tok.prevWords],
      nextWords: [...tok.nextWords],
      lineFingerprint: tok.lineFingerprint,
      rowIdHint: tok.rowId,
      ...(primaryHotspot?.quoteAfter !== undefined
        ? { quoteAfter: primaryHotspot.quoteAfter }
        : {}),
    });
  }
  return anchors;
}

function canSubsequentSegmentMatchAfter(
  nextSegment: AlignerSegmentInput | undefined,
  mainTokens: readonly MainToken[],
  afterCursor: number,
  maxGapWords: number,
): boolean {
  if (!nextSegment) return false;
  const queryTokens = tokenizeQuery(nextSegment.textHe);
  if (queryTokens.length === 0) return false;
  for (let i = Math.max(0, afterCursor); i < mainTokens.length; i++) {
    const cand = alignSpanFromStart(queryTokens, mainTokens, i, maxGapWords);
    if (cand && cand.confidence >= AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD) {
      return true;
    }
  }
  return false;
}

/**
 * Aligns a chronological list of spoken Gemara segments monotonically against a
 * daf's extracted PDF hotspots, enforcing strict section isolation, gap tolerance,
 * confidence thresholds, daf transition detection, and "needs-review" with empty
 * anchors for low-confidence or ambiguous segments.
 */
export function alignGemaraSegments(
  hotspots: readonly SyncHotspotLike[],
  segments: readonly AlignerSegmentInput[],
  context: AlignerContext,
  options: AlignerOptions = {},
): GemaraAlignmentRun {
  const allowApproximate = options.allowApproximate === true;
  const maxGapWords = options.maxGapWords ?? DEFAULT_MAX_GAP_WORDS;
  const highThreshold = options.highConfidenceThreshold ?? AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD;
  const mediumThreshold =
    options.mediumConfidenceThreshold ?? AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD;
  const ambiguityDelta = options.ambiguityDelta ?? AMBIGUITY_SCORE_DELTA;

  const mainTokens = buildIndexedMainTokens(hotspots);
  let cursor = Math.max(0, options.initialCursor ?? 0);
  let activeDafId = context.dafId;

  const results: AlignedSegmentResult[] = [];
  const alignedSegments: AudioSyncSegment[] = [];

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const inputSeg = segments[sIdx];
    if (!inputSeg) continue;

    const topicKa = inputSeg.topicKa?.trim() || undefined;
    const transition = detectDafTransition(inputSeg, activeDafId);
    const queryTokens = tokenizeQuery(inputSeg.textHe);

    if (transition) {
      activeDafId = transition.toDafId;
      const seg: AudioSyncSegment = {
        id: inputSeg.id,
        startMs: inputSeg.startMs,
        endMs: inputSeg.endMs,
        textHe: inputSeg.textHe,
        ...(topicKa ? { topicKa } : {}),
        normalizedTextHe: queryTokens.join(" "),
        confidence: 1,
        reviewStatus: "needs-review",
        anchors: [],
        dafId: transition.toDafId,
        dafTransition: transition,
        diagnostics: [`daf-transition:${transition.fromDafId}->${transition.toDafId}`],
      };
      alignedSegments.push(seg);
      results.push({
        segment: seg,
        status: "daf-transition",
        confidenceBand: "high",
        matchedHotspotIds: [],
        candidateCount: 0,
        dafTransitionDetected: transition,
        diagnostics: [...(seg.diagnostics ?? [])],
      });
      continue;
    }

    if (queryTokens.length === 0) {
      const seg: AudioSyncSegment = {
        id: inputSeg.id,
        startMs: inputSeg.startMs,
        endMs: inputSeg.endMs,
        textHe: inputSeg.textHe,
        ...(topicKa ? { topicKa } : {}),
        normalizedTextHe: "",
        confidence: 0,
        reviewStatus: "unmatched",
        anchors: [],
        ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
        diagnostics: ["empty-or-non-hebrew-segment"],
      };
      alignedSegments.push(seg);
      results.push({
        segment: seg,
        status: "unmatched",
        confidenceBand: "low",
        matchedHotspotIds: [],
        candidateCount: 0,
        diagnostics: ["empty-or-non-hebrew-segment"],
      });
      continue;
    }

    // Collect forward candidates strictly starting from monotonic cursor
    const forwardCandidates: PhraseMatchCandidate[] = [];
    for (let i = cursor; i < mainTokens.length; i++) {
      const cand = alignSpanFromStart(queryTokens, mainTokens, i, maxGapWords);
      if (cand) {
        forwardCandidates.push(cand);
      }
    }

    const sorted = [...forwardCandidates].sort(
      (a, b) =>
        b.confidence - a.confidence || a.gapCount - b.gapCount || a.startTokenIdx - b.startTokenIdx,
    );

    const distinctCandidates: PhraseMatchCandidate[] = [];
    for (const cand of sorted) {
      const overlaps = distinctCandidates.some(
        (k) => cand.startTokenIdx <= k.endTokenIdx && cand.endTokenIdx >= k.startTokenIdx,
      );
      if (!overlaps) {
        distinctCandidates.push(cand);
      }
    }

    if (distinctCandidates.length === 0) {
      if (allowApproximate) {
        const approxCand = findApproximatePhraseMatch(hotspots, inputSeg.textHe, cursor);
        if (approxCand && approxCand.matchedQueryCount >= 1) {
          const anchors = toWordAnchors(mainTokens, approxCand.matchedTokenIndices);
          const diag = `approximate-fallback:${approxCand.matchedQueryCount}/${approxCand.totalQueryCount}`;
          const seg: AudioSyncSegment = {
            id: inputSeg.id,
            startMs: inputSeg.startMs,
            endMs: inputSeg.endMs,
            textHe: inputSeg.textHe,
            ...(topicKa ? { topicKa } : {}),
            normalizedTextHe: queryTokens.join(" "),
            confidence: approxCand.confidence,
            reviewStatus: "needs-review",
            anchors,
            ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
            diagnostics: [diag],
          };
          // Advance softly only when recovery stays near the current forward region
          if (
            approxCand.confidence >= mediumThreshold &&
            approxCand.startTokenIdx >= cursor &&
            approxCand.startTokenIdx - cursor <= 160
          ) {
            cursor = approxCand.endTokenIdx + 1;
          }
          alignedSegments.push(seg);
          results.push({
            segment: seg,
            status: "low-confidence",
            confidenceBand: classifyConfidenceBand(approxCand.confidence),
            matchedHotspotIds: [...approxCand.hotspotIds],
            candidateCount: 1,
            diagnostics: [diag],
          });
          continue;
        }
      }

      const seg: AudioSyncSegment = {
        id: inputSeg.id,
        startMs: inputSeg.startMs,
        endMs: inputSeg.endMs,
        textHe: inputSeg.textHe,
        ...(topicKa ? { topicKa } : {}),
        normalizedTextHe: queryTokens.join(" "),
        confidence: 0,
        reviewStatus: "unmatched",
        anchors: [],
        ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
        diagnostics: ["no-candidate-found-in-main-text"],
      };
      alignedSegments.push(seg);
      results.push({
        segment: seg,
        status: "unmatched",
        confidenceBand: "low",
        matchedHotspotIds: [],
        candidateCount: 0,
        diagnostics: ["no-candidate-found-in-main-text"],
      });
      continue;
    }

    const best = distinctCandidates[0];
    if (!best) continue;
    const runnerUp = distinctCandidates[1];

    const isScoreTied =
      runnerUp !== undefined &&
      best.confidence >= mediumThreshold &&
      best.confidence - runnerUp.confidence <= ambiguityDelta;

    // Lookahead: if earliest tied span leaves room for subsequent segment(s) while runner-up does not,
    // monotonic sequence order uniquely disambiguates without flagging ambiguity.
    let resolvedByLookahead = false;
    if (isScoreTied && runnerUp) {
      const orderedPair = [best, runnerUp].sort((a, b) => a.startTokenIdx - b.startTokenIdx);
      const earlier = orderedPair[0];
      const later = orderedPair[1];
      if (earlier && later) {
        const nextSeg = segments[sIdx + 1];
        const nextOkAfterEarlier = canSubsequentSegmentMatchAfter(
          nextSeg,
          mainTokens,
          earlier.endTokenIdx + 1,
          maxGapWords,
        );
        const nextOkAfterLater = canSubsequentSegmentMatchAfter(
          nextSeg,
          mainTokens,
          later.endTokenIdx + 1,
          maxGapWords,
        );
        if (nextOkAfterEarlier && !nextOkAfterLater) {
          resolvedByLookahead = true;
        }
      }
    }

    const chosen =
      resolvedByLookahead && runnerUp && runnerUp.startTokenIdx < best.startTokenIdx
        ? runnerUp
        : best;

    if (isScoreTied && !resolvedByLookahead) {
      if (allowApproximate && runnerUp) {
        const earliestTied =
          best.startTokenIdx <= runnerUp.startTokenIdx ? best : runnerUp;
        const anchors = toWordAnchors(mainTokens, earliestTied.matchedTokenIndices);
        const diag = `approximate-tie-break:${distinctCandidates.length}:top=${earliestTied.confidence.toFixed(2)}`;
        cursor = earliestTied.endTokenIdx + 1;
        const seg: AudioSyncSegment = {
          id: inputSeg.id,
          startMs: inputSeg.startMs,
          endMs: inputSeg.endMs,
          textHe: inputSeg.textHe,
          ...(topicKa ? { topicKa } : {}),
          normalizedTextHe: queryTokens.join(" "),
          confidence: earliestTied.confidence,
          reviewStatus: "needs-review",
          anchors,
          ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
          diagnostics: [diag],
        };
        alignedSegments.push(seg);
        results.push({
          segment: seg,
          status: "ambiguous",
          confidenceBand: classifyConfidenceBand(earliestTied.confidence),
          matchedHotspotIds: [...earliestTied.hotspotIds],
          candidateCount: distinctCandidates.length,
          diagnostics: [diag],
        });
        continue;
      }

      const diag = `ambiguous-candidates:${distinctCandidates.length}:top=${best.confidence.toFixed(2)}`;
      const seg: AudioSyncSegment = {
        id: inputSeg.id,
        startMs: inputSeg.startMs,
        endMs: inputSeg.endMs,
        textHe: inputSeg.textHe,
        ...(topicKa ? { topicKa } : {}),
        normalizedTextHe: queryTokens.join(" "),
        confidence: best.confidence,
        reviewStatus: "needs-review",
        anchors: [],
        ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
        diagnostics: [diag],
      };
      alignedSegments.push(seg);
      results.push({
        segment: seg,
        status: "ambiguous",
        confidenceBand: classifyConfidenceBand(best.confidence),
        matchedHotspotIds: [],
        candidateCount: distinctCandidates.length,
        diagnostics: [diag],
      });
      continue;
    }

    if (chosen.confidence < mediumThreshold) {
      if (allowApproximate) {
        const approxBetter =
          findApproximatePhraseMatch(hotspots, inputSeg.textHe, cursor) ?? chosen;
        const picked =
          approxBetter.matchedQueryCount >= chosen.matchedQueryCount ? approxBetter : chosen;
        if (picked.matchedQueryCount >= 1) {
          const anchors = toWordAnchors(mainTokens, picked.matchedTokenIndices);
          const diag = `approximate-low-confidence:${picked.confidence.toFixed(2)}`;
          const seg: AudioSyncSegment = {
            id: inputSeg.id,
            startMs: inputSeg.startMs,
            endMs: inputSeg.endMs,
            textHe: inputSeg.textHe,
            ...(topicKa ? { topicKa } : {}),
            normalizedTextHe: queryTokens.join(" "),
            confidence: picked.confidence,
            reviewStatus: "needs-review",
            anchors,
            ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
            diagnostics: [diag],
          };
          alignedSegments.push(seg);
          results.push({
            segment: seg,
            status: "low-confidence",
            confidenceBand: "low",
            matchedHotspotIds: [...picked.hotspotIds],
            candidateCount: distinctCandidates.length,
            diagnostics: [diag],
          });
          continue;
        }
      }

      const diag = `low-confidence:${chosen.confidence.toFixed(2)}`;
      const seg: AudioSyncSegment = {
        id: inputSeg.id,
        startMs: inputSeg.startMs,
        endMs: inputSeg.endMs,
        textHe: inputSeg.textHe,
        ...(topicKa ? { topicKa } : {}),
        normalizedTextHe: queryTokens.join(" "),
        confidence: chosen.confidence,
        reviewStatus: "needs-review",
        anchors: [],
        ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
        diagnostics: [diag],
      };
      alignedSegments.push(seg);
      results.push({
        segment: seg,
        status: "low-confidence",
        confidenceBand: "low",
        matchedHotspotIds: [],
        candidateCount: distinctCandidates.length,
        diagnostics: [diag],
      });
      continue;
    }

    const reviewStatus: AudioSyncReviewStatus =
      chosen.confidence >= highThreshold ? "auto" : "needs-review";
    const band: AudioSyncConfidenceBand = chosen.confidence >= highThreshold ? "high" : "medium";
    const anchors = toWordAnchors(mainTokens, chosen.matchedTokenIndices);
    const diagnostics = [
      `matched-tokens:${chosen.matchedQueryCount}/${chosen.totalQueryCount}`,
      ...(chosen.gapCount > 0 ? [`gaps:${chosen.gapCount}`] : []),
    ];

    if (!allowApproximate || chosen.startTokenIdx - cursor <= 180) {
      cursor = chosen.endTokenIdx + 1;
    }

    const seg: AudioSyncSegment = {
      id: inputSeg.id,
      startMs: inputSeg.startMs,
      endMs: inputSeg.endMs,
      textHe: inputSeg.textHe,
      ...(topicKa ? { topicKa } : {}),
      normalizedTextHe: queryTokens.join(" "),
      confidence: chosen.confidence,
      reviewStatus,
      anchors,
      ...(activeDafId !== context.dafId ? { dafId: activeDafId } : {}),
      diagnostics,
    };

    alignedSegments.push(seg);
    results.push({
      segment: seg,
      status: "matched",
      confidenceBand: band,
      matchedHotspotIds: [...chosen.hotspotIds],
      candidateCount: distinctCandidates.length,
      diagnostics,
    });
  }

  const hasSourceMeta =
    context.title !== undefined || context.speaker !== undefined || context.audioUrl !== undefined;

  const map: AudioSyncMap = {
    version: 1,
    tractateId: context.tractateId,
    dafId: context.dafId,
    ...(hasSourceMeta
      ? {
          source: {
            ...(context.title !== undefined ? { title: context.title } : {}),
            ...(context.speaker !== undefined ? { speaker: context.speaker } : {}),
            ...(context.audioUrl !== undefined ? { audioUrl: context.audioUrl } : {}),
            alignerVersion: "stage1-v1",
          },
        }
      : {}),
    segments: alignedSegments,
  };

  return {
    map,
    results,
    finalCursor: cursor,
  };
}
