interface MarkerBox {
  id: string; isSmallMarker?: boolean; rowId?: string; leftPct: number; topPct: number; widthPct: number; heightPct: number;
  inkLeftPct?: number; inkTopPct?: number; inkWidthPct?: number; inkHeightPct?: number;
}

/** Partition padded touch areas so markers stay independent from adjacent markers and never encroach on nearby words. */
export function getIndependentMarkerBoxes<T extends MarkerBox>(spots: T[]): T[] {
  return spots.map(spot => {
    if (!spot.isSmallMarker) return spot;
    const x = spot.inkLeftPct ?? spot.leftPct;
    const w = spot.inkWidthPct ?? spot.widthPct;
    const y = spot.inkTopPct ?? spot.topPct;
    const h = spot.inkHeightPct ?? spot.heightPct;
    const xR = x + w;
    const yB = y + h;
    const center = x + w / 2;
    let left = spot.leftPct;
    let right = spot.leftPct + spot.widthPct;
    let top = spot.topPct;
    let bottom = spot.topPct + spot.heightPct;

    // 1. Horizontal partition against same-row markers and same-row non-marker words.
    for (const other of spots) {
      if (other.id === spot.id) continue;
      const ox = other.inkLeftPct ?? other.leftPct;
      const ow = other.inkWidthPct ?? other.widthPct;
      const oxR = ox + ow;
      const oy = other.inkTopPct ?? (other.isSmallMarker ? other.topPct : other.topPct + other.heightPct * 0.15);
      const oh = other.inkHeightPct ?? (other.isSmallMarker ? other.heightPct : other.heightPct * 0.85);
      const oyB = oy + oh;

      if (other.isSmallMarker) {
        if (Math.abs(oy - y) > Math.max(spot.inkHeightPct ?? 0.6, other.inkHeightPct ?? 0.6) * 0.65) continue;
        const oc = ox + ow / 2;
        if (oc < center) left = Math.max(left, (oxR + x) / 2);
        if (oc > center) right = Math.min(right, (xR + ox) / 2);
      } else {
        const sameRow =
          (spot.rowId && other.rowId && spot.rowId === other.rowId) ||
          Math.min(yB, oyB) > Math.max(y, oy) - 0.05;
        if (!sameRow) continue;
        const oc = ox + ow / 2;
        if (oxR <= x + 0.08 && oc < center) {
          left = Math.max(left, oxR <= x ? (oxR + x) / 2 : Math.min(xR - 0.1, oxR));
        } else if (ox >= xR - 0.08 && oc > center) {
          right = Math.min(right, ox >= xR ? (xR + ox) / 2 : Math.max(x + 0.1, ox));
        }
      }
    }

    // 2. Vertical clip against non-marker words on adjacent rows whose horizontal span overlaps [left, right].
    for (const other of spots) {
      if (other.id === spot.id || other.isSmallMarker) continue;
      if (spot.rowId && other.rowId && other.rowId === spot.rowId) continue;
      const ox = other.inkLeftPct ?? other.leftPct;
      const ow = other.inkWidthPct ?? other.widthPct;
      const oxR = ox + ow;
      if (oxR <= left || ox >= right) continue;
      const otherTop = other.topPct;
      const otherBot = other.topPct + other.heightPct;
      if (otherTop >= yB - 0.06) {
        bottom = Math.min(bottom, Math.max(yB, otherTop));
      } else if (otherBot <= y + 0.06) {
        top = Math.max(top, Math.min(y, otherBot));
      }
    }

    const finalLeft = Math.min(left, x);
    const finalRight = Math.max(finalLeft + 0.1, right);
    const finalTop = Math.min(top, y);
    const finalBottom = Math.max(finalTop + 0.1, bottom);
    return {
      ...spot,
      leftPct: finalLeft,
      topPct: finalTop,
      widthPct: Math.max(0.1, finalRight - finalLeft),
      heightPct: Math.max(0.1, finalBottom - finalTop),
    };
  });
}

interface MarginSpot {
  section: string; marginCommType?: string; marginEntryKey?: string; word: string; topPct: number; leftPct: number;
}

/** Highlight the entire verified entry, including continuation rows, but not neighboring entries. */
export function getExactMarginEntry<T extends MarginSpot>(spots: T[], type: string, key: string, side: 'left' | 'right'): T[] {
  return spots.filter(s => s.section === 'margin' && s.marginCommType === type && s.marginEntryKey === key &&
    (side === 'left' ? s.leftPct < 40 : s.leftPct > 60)).sort((a,b) => a.topPct - b.topPct || b.leftPct - a.leftPct);
}

/** Gilyon contains separate notes on Mishnah, Gemara and Tosafot, not one nearest row. */
export function getGilyonNote<T extends MarginSpot>(spots: T[], sourceSection: string, side: 'left' | 'right'): T[] {
  const column = spots.filter(s => s.section === 'margin' && s.marginCommType === 'gilyon-hashas' &&
    (side === 'left' ? s.leftPct < 40 : s.leftPct > 60)).sort((a,b) => a.topPct - b.topPct || b.leftPct - a.leftPct);
  const leads = column.filter(s => /^(?:ב?מתני|ב?משנה|ב?גמ|ב?תוס|ב?רש)/.test(s.word));
  const pattern = sourceSection === 'mishnah' ? /^(?:ב?מתני|ב?משנה)/ : sourceSection === 'tosafot' ? /^ב?תוס/ : sourceSection === 'rashi' ? /^ב?רש/ : /^ב?גמ/;
  const lead = leads.find(s => pattern.test(s.word));
  // No section heading printed for this source: fall back to the whole Gilyon column.
  if (!lead) return column.filter(s => !/^גליון/.test(s.word));
  const next = leads.find(s => s.topPct > lead.topPct + 0.4);
  return column.filter(s => s.topPct >= lead.topPct - 0.35 && (!next || s.topPct < next.topPct - 0.35));
}

/**
 * Splits the Gilyon column into its notes: every note ends with ":". The n-th Gilyon marker on the
 * daf (reading order) points to the n-th note; returns [] when the column has no such note.
 */
export function getGilyonNoteByOrder<T extends MarginSpot & { stopAfter?: string }>(
  spots: T[], index: number, side: 'left' | 'right',
): T[] {
  const column = spots.filter(s => s.section === 'margin' && s.marginCommType === 'gilyon-hashas' &&
    (side === 'left' ? s.leftPct < 40 : s.leftPct > 60) && !/^גליון/.test(s.word) && !/^הש["״]?ס$/.test(s.word))
    .sort((a, b) => a.topPct - b.topPct || b.leftPct - a.leftPct);
  const notes: T[][] = [];
  let cur: T[] = [];
  for (const s of column) {
    cur.push(s);
    if (s.stopAfter === ':' || /:["'״׳]?$/.test(s.word.trim())) { notes.push(cur); cur = []; }
  }
  if (cur.length) notes.push(cur);
  return index >= 0 && index < notes.length && notes.length > 1 ? (notes[index] ?? []) : [];
}
