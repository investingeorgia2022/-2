import { extractDibburim, readingOrder, type DhHotspotLike } from './dibburHamatchilMatcher';

export type PdfHighlightColor = 'amber' | 'emerald' | 'sky';

export interface PdfProgressHighlight {
  id: string;
  startSpotId: string;
  endSpotId: string;
  startIdx: number;
  endIdx: number;
  section: string;
  snippetHe: string;
  color: PdfHighlightColor;
  createdAt: number;
}

export interface MergedRowBox {
  rowId: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export interface RashiFocusSegment {
  segmentId: string;
  spotIds: Set<string>;
  lineBoxes: MergedRowBox[];
  labelHe: string;
}

export const GEMARA_BOLD_STORAGE_KEY = 'talmud_pdf_gemara_bold_v1';

export function getPdfHighlightsStorageKey(tractateId: string, dafId: string): string {
  return `talmud_pdf_highlights_v1_${tractateId}_${dafId}`;
}

export function loadPdfHighlights(tractateId: string, dafId: string): PdfProgressHighlight[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getPdfHighlightsStorageKey(tractateId, dafId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PdfProgressHighlight =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.startSpotId === 'string' &&
        typeof item.endSpotId === 'string' &&
        typeof item.startIdx === 'number' &&
        typeof item.endIdx === 'number'
    );
  } catch {
    return [];
  }
}

export function savePdfHighlights(
  tractateId: string,
  dafId: string,
  highlights: PdfProgressHighlight[]
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const key = getPdfHighlightsStorageKey(tractateId, dafId);
    if (highlights.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(highlights.slice(0, 120)));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function loadGemaraBoldActive(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(GEMARA_BOLD_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveGemaraBoldActive(active: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(GEMARA_BOLD_STORAGE_KEY, active ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export interface SpotBoxLike extends DhHotspotLike {
  inkLeftPct?: number;
  inkWidthPct?: number;
}

export function resolveHighlightRangeIndices(
  highlight: PdfProgressHighlight,
  hotspots: readonly { id: string; section: string }[]
): [number, number] | null {
  if (hotspots.length === 0) return null;
  const byStart = hotspots.findIndex((h) => h.id === highlight.startSpotId);
  const byEnd = hotspots.findIndex((h) => h.id === highlight.endSpotId);
  if (byStart >= 0 && byEnd >= 0) {
    return [Math.min(byStart, byEnd), Math.max(byStart, byEnd)];
  }
  const s = Math.max(0, Math.min(hotspots.length - 1, highlight.startIdx));
  const e = Math.max(0, Math.min(hotspots.length - 1, highlight.endIdx));
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  if (hotspots[lo]?.section !== highlight.section && hotspots[hi]?.section !== highlight.section) {
    return null;
  }
  return [lo, hi];
}

export function mergeSpotsIntoRowBoxes(spots: readonly SpotBoxLike[]): MergedRowBox[] {
  if (spots.length === 0) return [];
  const byRow = new Map<string, SpotBoxLike[]>();
  for (const s of spots) {
    const arr = byRow.get(s.rowId);
    if (arr) arr.push(s);
    else byRow.set(s.rowId, [s]);
  }
  const out: MergedRowBox[] = [];
  for (const [rowId, rowSpots] of byRow) {
    let minL = 100;
    let maxR = 0;
    let minT = 100;
    let maxB = 0;
    for (const s of rowSpots) {
      const l = s.inkLeftPct ?? s.leftPct;
      const w = s.inkWidthPct ?? s.widthPct;
      const t = s.inkTopPct ?? s.topPct;
      const h = s.inkHeightPct ?? s.heightPct;
      minL = Math.min(minL, l);
      maxR = Math.max(maxR, l + w);
      minT = Math.min(minT, t);
      maxB = Math.max(maxB, t + h);
    }
    if (maxR > minL && maxB > minT) {
      out.push({
        rowId,
        leftPct: Math.max(0, minL - 0.15),
        topPct: Math.max(0, minT - 0.08),
        widthPct: Math.min(100, maxR - minL + 0.3),
        heightPct: Math.min(100, maxB - minT + 0.16),
      });
    }
  }
  out.sort((a, b) => a.topPct - b.topPct || b.leftPct - a.leftPct);
  return out;
}

/**
 * Partitions Rashi hotspots into individual Rashi commentary entries using Vilna
 * dibbur-hamatchil boundaries (starting at each Rashi DH opening and running until
 * the next Rashi DH opening). Falls back to colon/period punctuation boundaries
 * when a page has Rashi runs without a matched DH opening.
 */
export function segmentRashiHotspots<T extends SpotBoxLike>(hotspots: readonly T[]): RashiFocusSegment[] {
  const rashiRaw = hotspots.filter((h) => h.section === 'rashi' && !h.isSmallMarker);
  if (rashiRaw.length === 0) return [];
  const ordered = readingOrder(rashiRaw);
  const dhs = extractDibburim(hotspots as unknown as DhHotspotLike[]).filter(
    (d) => d.commentator === 'rashi'
  );

  const startIds = new Set<string>();
  for (const dh of dhs) {
    const first = dh.words[0];
    if (first?.id) startIds.add(first.id);
  }

  // Fallback / supplementary punctuation boundaries if DH extractor yields fewer than 2 entries
  if (startIds.size < 2) {
    let openNext = false;
    for (let i = 0; i < ordered.length; i++) {
      const cur = ordered[i];
      if (!cur) continue;
      if (i === 0 || openNext) {
        startIds.add(cur.id);
        openNext = false;
      }
      if (cur.stopAfter === ':' || /:\s*$/.test(cur.word)) {
        openNext = true;
      }
    }
  }

  const groups: T[][] = [];
  let current: T[] = [];
  for (const spot of ordered) {
    if (startIds.has(spot.id) && current.length > 0) {
      groups.push(current);
      current = [spot];
    } else {
      current.push(spot);
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((group, idx) => {
    const first = group[0];
    const labelHe = group
      .slice(0, 5)
      .map((s) => s.word)
      .join(' ')
      .trim();
    return {
      segmentId: `rashi-seg-${first?.id ?? idx}`,
      spotIds: new Set(group.map((s) => s.id)),
      lineBoxes: mergeSpotsIntoRowBoxes(group),
      labelHe,
    };
  });
}

export function findRashiSegmentForHotspot<T extends SpotBoxLike>(
  spotId: string,
  hotspots: readonly T[]
): RashiFocusSegment | null {
  const segments = segmentRashiHotspots(hotspots);
  return segments.find((seg) => seg.spotIds.has(spotId)) ?? null;
}
