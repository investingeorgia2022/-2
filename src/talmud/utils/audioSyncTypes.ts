/**
 * Stage 1 Data Types & Constants for Talmud Audio-to-Gemara Synchronization.
 *
 * Purely structural definitions with zero runtime coupling to PDF rendering,
 * audio playback, UI components, or persistence layers.
 */

export type AudioSyncSection = "mishnah" | "gemara";

export type AudioSyncReviewStatus = "auto" | "verified" | "needs-review" | "unmatched";

export type AudioSyncConfidenceBand = "high" | "medium" | "low";

export const AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_MAX_GAP_WORDS = 3;

export function classifyConfidenceBand(confidence: number): AudioSyncConfidenceBand {
  if (!Number.isFinite(confidence) || confidence < AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD) {
    return "low";
  }
  if (confidence >= AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD) {
    return "high";
  }
  return "medium";
}

/**
 * Resolution-independent word anchor identifying a single word inside the main
 * Talmud text (Mishnah or Gemara). Never relies on transient `pdf-word-${idx}` IDs.
 */
export interface WordAnchor {
  /** Normalized Hebrew word form (nikud stripped, punctuation normalized). */
  normalizedWord: string;
  /** Original surface form (preserves geresh/gershayim such as ר' or ק"ש when present). */
  rawWord?: string | undefined;
  /** Target main-text section only; commentary/margins are never valid sync targets. */
  section: AudioSyncSection;
  /** 1-based occurrence count of this normalized word within the section on this daf. */
  occurrence: number;
  /** 0-based position in the daf's RTL main-text reading order. */
  readingOrderIndex: number;
  /** Normalized words immediately preceding this anchor in reading order (context). */
  prevWords?: string[] | undefined;
  /** Normalized words immediately following this anchor in reading order (context). */
  nextWords?: string[] | undefined;
  /** Resolution-independent normalized text fingerprint of the printed row. */
  lineFingerprint?: string | undefined;
  /** Optional legacy rowId hint (never treated as authoritative across zoom/resolutions). */
  rowIdHint?: string | undefined;
  /** Optional trailing quote mark split by PDF extraction (e.g. '"' or "'"). */
  quoteAfter?: '"' | "'" | undefined;
}

export interface DafTransitionMarker {
  fromDafId: string;
  toDafId: string;
  triggerPhrase?: string | undefined;
  atAnchorIndex?: number | undefined;
}

export interface AudioSyncSegment {
  id: string;
  startMs: number;
  endMs: number;
  textHe: string;
  topicKa?: string | undefined;
  normalizedTextHe?: string | undefined;
  confidence: number;
  reviewStatus: AudioSyncReviewStatus;
  anchors: WordAnchor[];
  dafId?: string | undefined;
  dafTransition?: DafTransitionMarker | undefined;
  diagnostics?: string[] | undefined;
}

export interface AudioSyncSourceMetadata {
  speaker?: string | undefined;
  title?: string | undefined;
  audioUrl?: string | undefined;
  durationMs?: number | undefined;
  language?: string | undefined;
  alignerVersion?: string | undefined;
}

export interface AudioSyncMap {
  version: number;
  tractateId: string;
  dafId: string;
  source?: AudioSyncSourceMetadata | undefined;
  segments: AudioSyncSegment[];
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

/**
 * Minimal structural subset of `VilnaPdfHotspot` consumed by the pure
 * anchor resolver and phrase aligner without importing viewer components.
 */
export interface SyncHotspotLike {
  id: string;
  word: string;
  cleanWord?: string;
  section: string;
  rowId: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  lineTextHe?: string;
  isSmallMarker?: boolean;
  inkTopPct?: number;
  inkHeightPct?: number;
  quoteAfter?: '"' | "'";
}
