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

function medianPositive(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function spotGlyphBand(s: SpotBoxLike, bodyGlyphH: number): { top: number; bottom: number } {
  if (s.inkTopPct != null && s.inkHeightPct != null) {
    return { top: s.inkTopPct, bottom: s.inkTopPct + s.inkHeightPct };
  }
  if (s.glyphH && bodyGlyphH > 0) {
    if (s.glyphH >= bodyGlyphH * 1.8) {
      return { top: s.topPct, bottom: s.topPct + s.heightPct };
    }
    if (s.glyphH >= bodyGlyphH * 1.25) {
      // Bold Tosafot DH headings (~1.47x) carry ~35% empty ascender headroom in PDF font metrics.
      return {
        top: s.topPct + s.heightPct * 0.35,
        bottom: s.topPct + s.heightPct,
      };
    }
  }
  // Standard OCR line boxes include ~22% ascender/interline headroom above the letters.
  return {
    top: s.topPct + s.heightPct * 0.22,
    bottom: s.topPct + s.heightPct,
  };
}

/**
 * Builds tight, neighbor-clamped spotlight boxes for a single commentary segment
 * so illumination covers strictly that comment's printed glyphs without bleeding
 * into lines above/below or adjacent comments on the same line.
 */
function buildCommentarySpotlightBoxes<T extends SpotBoxLike>(
  group: readonly T[],
  sectionSpots: readonly T[]
): MergedRowBox[] {
  if (group.length === 0) return [];
  const groupIds = new Set(group.map((s) => s.id));
  const bodyGlyphH = medianPositive(
    sectionSpots.map((s) => s.glyphH ?? 0).filter((v) => v > 0)
  );
  const outsiders = sectionSpots.filter((s) => !groupIds.has(s.id));

  const byRow = new Map<string, T[]>();
  for (const s of group) {
    const arr = byRow.get(s.rowId);
    if (arr) arr.push(s);
    else byRow.set(s.rowId, [s]);
  }

  interface CandidateSpotlightBox {
    rowId: string;
    left: number;
    right: number;
    top: number;
    bottom: number;
    midY: number;
    outsiderTopLimit: number;
    outsiderBottomLimit: number;
  }

  const candidates: CandidateSpotlightBox[] = [];
  for (const [rowId, rowSpots] of byRow) {
    // Split if an outsider in the same row sits horizontally between two sub-clusters.
    const sorted = [...rowSpots].sort((a, b) => (a.inkLeftPct ?? a.leftPct) - (b.inkLeftPct ?? b.leftPct));
    const sameRowOutsiders = outsiders.filter((o) => o.rowId === rowId);
    const clusters: T[][] = [];
    let curCluster: T[] = [];
    for (const s of sorted) {
      if (curCluster.length === 0) {
        curCluster.push(s);
        continue;
      }
      const prev = curCluster[curCluster.length - 1];
      if (!prev) {
        curCluster.push(s);
        continue;
      }
      const prevR = (prev.inkLeftPct ?? prev.leftPct) + (prev.inkWidthPct ?? prev.widthPct);
      const curL = s.inkLeftPct ?? s.leftPct;
      const blockedByOutsider = sameRowOutsiders.some((o) => {
        const oL = o.inkLeftPct ?? o.leftPct;
        const oR = oL + (o.inkWidthPct ?? o.widthPct);
        return oL + oR > prevR * 2 && (oL + oR) / 2 > prevR - 0.1 && (oL + oR) / 2 < curL + 0.1;
      });
      if (blockedByOutsider) {
        clusters.push(curCluster);
        curCluster = [s];
      } else {
        curCluster.push(s);
      }
    }
    if (curCluster.length > 0) clusters.push(curCluster);

    for (const cluster of clusters) {
      let minL = 100;
      let maxR = 0;
      let minT = 100;
      let maxB = 0;
      for (const s of cluster) {
        const l = s.inkLeftPct ?? s.leftPct;
        const w = s.inkWidthPct ?? s.widthPct;
        const band = spotGlyphBand(s, bodyGlyphH);
        minL = Math.min(minL, l);
        maxR = Math.max(maxR, l + w);
        minT = Math.min(minT, band.top);
        maxB = Math.max(maxB, band.bottom);
      }
      if (maxR <= minL || maxB <= minT) continue;

      const rowCenterX = (minL + maxR) / 2;
      const rowMidY = (minT + maxB) / 2;

      let leftBound = Math.max(0, minL - 0.12);
      let rightBound = Math.min(100, maxR + 0.12);

      for (const o of outsiders) {
        const oBand = spotGlyphBand(o, bodyGlyphH);
        const sameBand =
          o.rowId === rowId || Math.min(maxB, oBand.bottom) > Math.max(minT, oBand.top) - 0.03;
        if (!sameBand) continue;
        const oL = o.inkLeftPct ?? o.leftPct;
        const oW = o.inkWidthPct ?? o.widthPct;
        const oR = oL + oW;
        const oMidX = oL + oW / 2;
        if (oMidX < rowCenterX && oR <= minL + 0.15) {
          const mid = oR <= minL ? (oR + minL) / 2 : oR;
          leftBound = Math.max(leftBound, mid);
        } else if (oMidX > rowCenterX && oL >= maxR - 0.15) {
          const mid = oL >= maxR ? (maxR + oL) / 2 : oL;
          rightBound = Math.min(rightBound, mid);
        }
      }

      if (leftBound >= rightBound) {
        leftBound = minL;
        rightBound = maxR;
      }

      let topBound = Math.max(0, minT - 0.05);
      let bottomBound = Math.min(100, maxB + 0.08);
      let outsiderTopLimit = 0;
      let outsiderBottomLimit = 100;

      let prevNeighborBot = -Infinity;
      let nextNeighborTop = Infinity;
      for (const o of outsiders) {
        if (o.rowId === rowId) continue;
        const oL = o.inkLeftPct ?? o.leftPct;
        const oR = oL + (o.inkWidthPct ?? o.widthPct);
        if (oR <= leftBound - 0.12 || oL >= rightBound + 0.12) continue;
        const oBand = spotGlyphBand(o, bodyGlyphH);
        const oMidY = (oBand.top + oBand.bottom) / 2;
        if (oMidY < rowMidY - 0.35) {
          prevNeighborBot = Math.max(prevNeighborBot, oBand.bottom);
        } else if (oMidY > rowMidY + 0.35) {
          nextNeighborTop = Math.min(nextNeighborTop, oBand.top);
        }
      }

      if (Number.isFinite(prevNeighborBot)) {
        const safeTop =
          prevNeighborBot < minT
            ? (prevNeighborBot + minT) / 2
            : Math.min(rowMidY - 0.25, prevNeighborBot + 0.02);
        outsiderTopLimit = safeTop;
        topBound = Math.max(topBound, safeTop);
      }
      if (Number.isFinite(nextNeighborTop)) {
        const safeBot =
          nextNeighborTop > maxB
            ? (maxB + nextNeighborTop) / 2
            : Math.max(rowMidY + 0.25, nextNeighborTop - 0.02);
        outsiderBottomLimit = safeBot;
        bottomBound = Math.min(bottomBound, safeBot);
      }

      if (bottomBound <= topBound) {
        topBound = minT;
        bottomBound = Math.max(minT + 0.15, maxB);
      }

      candidates.push({
        rowId,
        left: leftBound,
        right: rightBound,
        top: topBound,
        bottom: bottomBound,
        midY: rowMidY,
        outsiderTopLimit,
        outsiderBottomLimit,
      });
    }
  }

  candidates.sort((a, b) => a.top - b.top || b.left - a.left);

  // Bridge vertically adjacent rows of the same commentary entry flush edge-to-edge so
  // multi-line spotlights illuminate as a single unbroken block without dark inter-line gaps.
  for (let i = 0; i < candidates.length - 1; i++) {
    const a = candidates[i];
    if (!a) continue;
    const lineSpanH = Math.max(a.bottom - a.top, 1.1);
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (!b) continue;
      if (b.midY <= a.midY + 0.35) continue;
      if (b.midY - a.midY > lineSpanH * 2.2) break;
      const overlapL = Math.max(a.left, b.left);
      const overlapR = Math.min(a.right, b.right);
      if (overlapR - overlapL <= 0.3) continue;

      const hasOutsiderBetween = outsiders.some((o) => {
        const oL = o.inkLeftPct ?? o.leftPct;
        const oR = oL + (o.inkWidthPct ?? o.widthPct);
        if (oR <= overlapL + 0.1 || oL >= overlapR - 0.1) return false;
        const oBand = spotGlyphBand(o, bodyGlyphH);
        const oMidY = (oBand.top + oBand.bottom) / 2;
        return oMidY > a.midY + 0.2 && oMidY < b.midY - 0.2;
      });
      if (hasOutsiderBetween) continue;

      const lowAllowed = Math.max(a.top + 0.2, b.outsiderTopLimit);
      const highAllowed = Math.min(b.bottom - 0.2, a.outsiderBottomLimit);
      if (lowAllowed <= highAllowed) {
        const rawMid = (a.bottom + b.top) / 2;
        const seamY = Math.max(lowAllowed, Math.min(highAllowed, rawMid));
        a.bottom = seamY;
        b.top = seamY;
      }
      break;
    }
  }

  return candidates.map((c) => ({
    rowId: c.rowId,
    leftPct: c.left,
    topPct: c.top,
    widthPct: Math.max(0.2, c.right - c.left),
    heightPct: Math.max(0.2, c.bottom - c.top),
  }));
}

export interface SearchHitHighlightBoxes {
  passiveBoxes: MergedRowBox[];
  activeBoxes: MergedRowBox[];
}

export function buildSearchHitRowBoxes<T extends SpotBoxLike>(
  spots: readonly T[],
  hits: readonly { ids: string[] }[],
  activeIds: ReadonlySet<string>
): SearchHitHighlightBoxes {
  if (spots.length === 0 || (hits.length === 0 && activeIds.size === 0)) {
    return { passiveBoxes: [], activeBoxes: [] };
  }
  const byId = new Map<string, T>();
  for (const s of spots) byId.set(s.id, s);

  const activeSpots: T[] = [];
  for (const id of activeIds) {
    const s = byId.get(id);
    if (s) activeSpots.push(s);
  }
  const activeBoxes = mergeSpotsIntoRowBoxes(activeSpots);

  const passiveBoxes: MergedRowBox[] = [];
  for (const hit of hits) {
    const hitSpots: T[] = [];
    for (const id of hit.ids) {
      if (activeIds.has(id)) continue;
      const s = byId.get(id);
      if (s) hitSpots.push(s);
    }
    if (hitSpots.length > 0) {
      passiveBoxes.push(...mergeSpotsIntoRowBoxes(hitSpots));
    }
  }

  return { passiveBoxes, activeBoxes };
}

/**
 * Partitions Rashi or Tosafot hotspots into individual commentary entries up to ":"
 * using Vilna dibbur-hamatchil boundaries (and ":" entry terminators).
 */
export function segmentCommentaryHotspots<T extends SpotBoxLike>(
  hotspots: readonly T[],
  section: 'rashi' | 'tosafot'
): RashiFocusSegment[] {
  const sectionRaw = hotspots.filter((h) => h.section === section && !h.isSmallMarker);
  if (sectionRaw.length === 0) return [];
  const ordered = readingOrder(sectionRaw);
  const dhs = extractDibburim(hotspots as unknown as DhHotspotLike[]).filter(
    (d) => d.commentator === section
  );

  const startIds = new Set<string>();
  for (const dh of dhs) {
    const first = dh.words[0];
    if (first?.id) startIds.add(first.id);
  }

  // Every ":" closes a commentary entry so the next word begins a fresh entry.
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
      segmentId: `${section}-seg-${first?.id ?? idx}`,
      spotIds: new Set(group.map((s) => s.id)),
      lineBoxes: buildCommentarySpotlightBoxes(group, sectionRaw),
      labelHe,
    };
  });
}

export function findCommentarySegmentForHotspot<T extends SpotBoxLike>(
  spotId: string,
  hotspots: readonly T[],
  section?: 'rashi' | 'tosafot'
): RashiFocusSegment | null {
  if (section) {
    const segments = segmentCommentaryHotspots(hotspots, section);
    return segments.find((seg) => seg.spotIds.has(spotId)) ?? null;
  }
  return (
    segmentCommentaryHotspots(hotspots, 'rashi').find((seg) => seg.spotIds.has(spotId)) ??
    segmentCommentaryHotspots(hotspots, 'tosafot').find((seg) => seg.spotIds.has(spotId)) ??
    null
  );
}

/**
 * Partitions Rashi hotspots into individual Rashi commentary entries using Vilna
 * dibbur-hamatchil boundaries (starting at each Rashi DH opening and running until
 * the next Rashi DH opening / ":").
 */
export function segmentRashiHotspots<T extends SpotBoxLike>(hotspots: readonly T[]): RashiFocusSegment[] {
  return segmentCommentaryHotspots(hotspots, 'rashi');
}

export function findRashiSegmentForHotspot<T extends SpotBoxLike>(
  spotId: string,
  hotspots: readonly T[]
): RashiFocusSegment | null {
  return findCommentarySegmentForHotspot(spotId, hotspots, 'rashi');
}
