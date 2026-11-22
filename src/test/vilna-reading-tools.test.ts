import { beforeEach, describe, expect, it } from "vitest";
import { loadAppSettings } from "../talmud/utils/appPreferences";
import {
  buildSearchHitRowBoxes,
  findCommentarySegmentForHotspot,
  findRashiSegmentForHotspot,
  loadGemaraBoldActive,
  loadPdfHighlights,
  mergeSpotsIntoRowBoxes,
  resolveHighlightRangeIndices,
  saveGemaraBoldActive,
  savePdfHighlights,
  segmentCommentaryHotspots,
  segmentRashiHotspots,
  type PdfProgressHighlight,
} from "../talmud/utils/vilnaPdfReadingTools";
import { DUPLICATE_GEMARA_INK } from "../talmud/utils/pdfCitationTint";

describe("Vilna PDF reading tools and settings defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults all Vilna PDF reading feature switches to false", () => {
    const settings = loadAppSettings();
    expect(settings.enablePdfProgressHighlight).toBe(false);
    expect(settings.enableGemaraBoldToggle).toBe(false);
    expect(settings.enableRashiFocusMode).toBe(false);
    expect(settings.enableCommentaryJumpSpotlight).toBe(false);
  });

  it("persists and resolves Vilna PDF progress highlights per daf in localStorage", () => {
    const sample: PdfProgressHighlight[] = [
      {
        id: "hl-1",
        startSpotId: "g2",
        endSpotId: "g3",
        startIdx: 1,
        endIdx: 2,
        section: "gemara",
        snippetHe: "אמר רב",
        color: "amber",
        createdAt: 1700000000000,
      },
    ];
    savePdfHighlights("Berakhot", "2a", sample);

    const loaded = loadPdfHighlights("Berakhot", "2a");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.snippetHe).toBe("אמר רב");
    expect(loadPdfHighlights("Berakhot", "2b")).toEqual([]);

    const hotspots = [
      { id: "g1", section: "gemara" },
      { id: "g2", section: "gemara" },
      { id: "g3", section: "gemara" },
      { id: "r1", section: "rashi" },
    ];
    expect(resolveHighlightRangeIndices(loaded[0]!, hotspots)).toEqual([1, 2]);

    savePdfHighlights("Berakhot", "2a", []);
    expect(loadPdfHighlights("Berakhot", "2a")).toEqual([]);
  });

  it("merges spots on the same row into bounding boxes and separates rows", () => {
    const boxes = mergeSpotsIntoRowBoxes([
      {
        id: "w1",
        word: "מאימתי",
        section: "mishnah",
        rowId: "row-1",
        leftPct: 60,
        topPct: 20,
        widthPct: 5,
        heightPct: 2,
      },
      {
        id: "w2",
        word: "קורין",
        section: "mishnah",
        rowId: "row-1",
        leftPct: 54,
        topPct: 20.1,
        widthPct: 5,
        heightPct: 1.9,
      },
      {
        id: "w3",
        word: "בערבין",
        section: "mishnah",
        rowId: "row-2",
        leftPct: 61,
        topPct: 23,
        widthPct: 5,
        heightPct: 2,
      },
    ]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.rowId).toBe("row-1");
    expect(boxes[0]!.widthPct).toBeGreaterThan(10);
    expect(boxes[1]?.rowId).toBe("row-2");
  });

  it("persists Gemara bold toggle state", () => {
    expect(loadGemaraBoldActive()).toBe(false);
    saveGemaraBoldActive(true);
    expect(loadGemaraBoldActive()).toBe(true);
    saveGemaraBoldActive(false);
    expect(loadGemaraBoldActive()).toBe(false);
  });

  it("isolates individual Rashi commentary segments for Focus Mode", () => {
    const hotspots = [
      {
        id: "g1",
        word: "מאימתי",
        section: "gemara",
        rowId: "g-row-1",
        leftPct: 48,
        topPct: 20,
        widthPct: 5,
        heightPct: 1.8,
      },
      {
        id: "r1",
        word: "מאימתי",
        section: "rashi",
        rowId: "r-row-1",
        leftPct: 80,
        topPct: 20,
        widthPct: 4,
        heightPct: 1.3,
      },
      {
        id: "r2",
        word: "קורין",
        section: "rashi",
        rowId: "r-row-1",
        leftPct: 75,
        topPct: 20,
        widthPct: 4,
        heightPct: 1.3,
        stopAfter: "." as const,
      },
      {
        id: "r3",
        word: "פירוש",
        section: "rashi",
        rowId: "r-row-1",
        leftPct: 70,
        topPct: 20,
        widthPct: 4,
        heightPct: 1.3,
      },
      {
        id: "r4",
        word: "השכבה",
        section: "rashi",
        rowId: "r-row-2",
        leftPct: 80,
        topPct: 22,
        widthPct: 4,
        heightPct: 1.3,
        stopAfter: ":" as const,
      },
      {
        id: "r5",
        word: "ערבית",
        section: "rashi",
        rowId: "r-row-2",
        leftPct: 75,
        topPct: 22,
        widthPct: 4,
        heightPct: 1.3,
        stopAfter: "." as const,
      },
      {
        id: "r6",
        word: "תפלה",
        section: "rashi",
        rowId: "r-row-3",
        leftPct: 80,
        topPct: 24,
        widthPct: 4,
        heightPct: 1.3,
        stopAfter: ":" as const,
      },
    ];

    const segments = segmentRashiHotspots(hotspots);
    expect(segments.length).toBeGreaterThanOrEqual(2);

    const firstSeg = findRashiSegmentForHotspot("r3", hotspots);
    const secondSeg = findRashiSegmentForHotspot("r6", hotspots);
    expect(firstSeg).not.toBeNull();
    expect(secondSeg).not.toBeNull();
    expect(firstSeg!.segmentId).not.toBe(secondSeg!.segmentId);
    expect(firstSeg!.spotIds.has("r6")).toBe(false);
    expect(firstSeg!.spotIds.has("g1")).toBe(false);
  });

  it("isolates Tosafot commentary segments up to ':' for Gemara-to-Tosafot spotlighting", () => {
    const hotspots = [
      { id: "t1", word: "מאימתי", section: "tosafot", rowId: "t-r1", leftPct: 22, topPct: 15, widthPct: 5, heightPct: 1.4 },
      { id: "t2", word: "קורין", section: "tosafot", rowId: "t-r1", leftPct: 16, topPct: 15, widthPct: 5, heightPct: 1.4, stopAfter: "." as const },
      { id: "t3", word: "והיינו", section: "tosafot", rowId: "t-r2", leftPct: 22, topPct: 17, widthPct: 5, heightPct: 1.4 },
      { id: "t4", word: "טעמא", section: "tosafot", rowId: "t-r2", leftPct: 16, topPct: 17, widthPct: 5, heightPct: 1.4, stopAfter: ":" as const },
      { id: "t5", word: "בערבין", section: "tosafot", rowId: "t-r3", leftPct: 22, topPct: 19, widthPct: 5, heightPct: 1.4, stopAfter: "." as const },
      { id: "t6", word: "ערבית", section: "tosafot", rowId: "t-r3", leftPct: 16, topPct: 19, widthPct: 5, heightPct: 1.4, stopAfter: ":" as const },
    ];

    const segments = segmentCommentaryHotspots(hotspots, "tosafot");
    expect(segments).toHaveLength(2);
    const first = findCommentarySegmentForHotspot("t1", hotspots, "tosafot");
    expect(first?.segmentId).toMatch(/^tosafot-seg-/);
    expect(first?.spotIds.has("t4")).toBe(true);
    expect(first?.spotIds.has("t5")).toBe(false);
    expect(DUPLICATE_GEMARA_INK).toEqual([234, 88, 12]);
  });

  it("clamps spotlight boxes tightly to printed glyph bands without bleeding onto adjacent rows or sibling comments", () => {
    // Models dense ~1.05% Rashi line pitch from Taanit 4a with 1.17% OCR box heights
    const hotspots = [
      { id: "r0", word: "השיבוהו", section: "rashi", rowId: "row-9", leftPct: 68.0, topPct: 30.38, widthPct: 7.0, heightPct: 1.18, glyphH: 11.4 },
      { id: "r1", word: "כהוגן.", section: "rashi", rowId: "row-10", leftPct: 74.0, topPct: 31.44, widthPct: 4.5, heightPct: 1.17, stopAfter: "." as const, glyphH: 11.4 },
      { id: "r2", word: "וזימנו", section: "rashi", rowId: "row-10", leftPct: 70.0, topPct: 31.44, widthPct: 3.6, heightPct: 1.17, glyphH: 11.4 },
      { id: "r3", word: "רבקה:", section: "rashi", rowId: "row-10", leftPct: 65.5, topPct: 31.44, widthPct: 4.0, heightPct: 1.17, stopAfter: ":" as const, glyphH: 11.4 },
      { id: "r4", word: "דבר", section: "rashi", rowId: "row-10", leftPct: 61.5, topPct: 31.44, widthPct: 3.4, heightPct: 1.17, glyphH: 11.4 },
      { id: "r5", word: "טמא.", section: "rashi", rowId: "row-10", leftPct: 57.5, topPct: 31.44, widthPct: 3.5, heightPct: 1.17, stopAfter: "." as const, glyphH: 11.4 },
      { id: "r6", word: "כלב", section: "rashi", rowId: "row-11", leftPct: 74.0, topPct: 32.51, widthPct: 3.2, heightPct: 1.15, glyphH: 11.4 },
      { id: "r7", word: "או", section: "rashi", rowId: "row-11", leftPct: 71.0, topPct: 32.51, widthPct: 2.2, heightPct: 1.15, glyphH: 11.4 },
      { id: "r8", word: "חזיר:", section: "rashi", rowId: "row-11", leftPct: 66.5, topPct: 32.51, widthPct: 4.0, heightPct: 1.15, stopAfter: ":" as const, glyphH: 11.4 },
      { id: "r9", word: "והיינו", section: "rashi", rowId: "row-11", leftPct: 61.0, topPct: 32.51, widthPct: 4.8, heightPct: 1.15, glyphH: 11.4 },
    ];

    const seg = findCommentarySegmentForHotspot("r4", hotspots, "rashi");
    expect(seg).not.toBeNull();
    expect(Array.from(seg!.spotIds)).toEqual(["r4", "r5", "r6", "r7", "r8"]);
    expect(seg!.lineBoxes).toHaveLength(2);

    const [topBox, botBox] = seg!.lineBoxes;
    // Printed glyph band of row-9 (השיבוהו) ends around 30.38 + 1.18 * 0.98 = 31.5364;
    // topBox of דבר טמא (row-10 glyph top = 31.44 + 1.17 * 0.22 = 31.6974) must stay cleanly below row-9 glyphs and strictly to the left of רבקה:
    expect(topBox!.topPct).toBeGreaterThan(31.55);
    expect(topBox!.leftPct + topBox!.widthPct).toBeLessThanOrEqual(65.5);

    // Bottom row (כלב או חזיר:) must not extend right into רבקה's sibling column or left into והיינו
    expect(botBox!.leftPct).toBeGreaterThanOrEqual(65.5);
    expect(botBox!.topPct).toBeGreaterThan(topBox!.topPct + topBox!.heightPct - 0.05);
  });

  it("preserves full height for enlarged commentary initials while trimming standard body lines", () => {
    const hotspots = [
      { id: "t-init", word: "א", section: "tosafot", rowId: "t-r1", leftPct: 24.0, topPct: 10.0, widthPct: 2.8, heightPct: 2.9, glyphH: 26 },
      { id: "t-rest", word: "מר", section: "tosafot", rowId: "t-r1", leftPct: 21.0, topPct: 11.4, widthPct: 2.5, heightPct: 1.2, glyphH: 11.4 },
      { id: "t-end", word: "רבא:", section: "tosafot", rowId: "t-r1", leftPct: 17.0, topPct: 11.4, widthPct: 3.5, heightPct: 1.2, stopAfter: ":" as const, glyphH: 11.4 },
    ];
    const seg = findCommentarySegmentForHotspot("t-init", hotspots, "tosafot");
    expect(seg).not.toBeNull();
    expect(seg!.lineBoxes[0]!.topPct).toBeLessThan(10.1);
    expect(seg!.lineBoxes[0]!.heightPct).toBeGreaterThan(2.5);
  });

  it("prevents single-line 16.38pt Tosafot DH headings from bleeding upward onto the preceding Tosafot line", () => {
    // Models Berakhot 2a Tosafot: previous row ends at 64.82% while enlarged DH word מברך (16.38pt vs 11.16pt body) has topPct 64.37%
    const hotspots = [
      { id: "t-prev-1", word: "אלא", section: "tosafot", rowId: "t-r1", leftPct: 22.0, topPct: 63.71, widthPct: 4.5, heightPct: 1.13, glyphH: 11.16 },
      { id: "t-prev-2", word: "אק\"ש:", section: "tosafot", rowId: "t-r1", leftPct: 16.0, topPct: 63.71, widthPct: 5.0, heightPct: 1.13, stopAfter: ":" as const, glyphH: 11.16 },
      { id: "t-dh-1", word: "מברך", section: "tosafot", rowId: "t-r2", leftPct: 21.0, topPct: 64.37, widthPct: 5.5, heightPct: 1.65, glyphH: 16.38 },
      { id: "t-dh-2", word: "שתים", section: "tosafot", rowId: "t-r2", leftPct: 15.0, topPct: 64.69, widthPct: 5.0, heightPct: 1.2, glyphH: 11.94 },
      { id: "t-dh-3", word: "לפניה:", section: "tosafot", rowId: "t-r2", leftPct: 9.0, topPct: 64.69, widthPct: 5.0, heightPct: 1.2, stopAfter: ":" as const, glyphH: 11.94 },
    ];
    const seg = findCommentarySegmentForHotspot("t-dh-1", hotspots, "tosafot");
    expect(seg).not.toBeNull();
    expect(seg!.lineBoxes).toHaveLength(1);
    const prevBot = 63.71 + 1.13 * 0.98;
    expect(seg!.lineBoxes[0]!.topPct).toBeGreaterThanOrEqual(prevBot - 0.01);
  });

  it("bridges multi-line commentary entries flush edge-to-edge without inter-line dark gaps or sibling bleed", () => {
    const hotspots = [
      // Row 1 right side: previous entry ending with ":"
      { id: "t-prev", word: "דקתני:", section: "tosafot", rowId: "t-r1", leftPct: 65.0, topPct: 64.6, widthPct: 28.0, heightPct: 1.2, stopAfter: ":" as const, glyphH: 11.2 },
      // Target multi-line entry: line 1 left -> line 2 full -> line 3 right
      { id: "t-a1", word: "מברך", section: "tosafot", rowId: "t-r1", leftPct: 54.0, topPct: 64.4, widthPct: 8.0, heightPct: 1.5, glyphH: 16.2 },
      { id: "t-a2", word: "שתים", section: "tosafot", rowId: "t-r1", leftPct: 6.0, topPct: 64.6, widthPct: 45.0, heightPct: 1.2, glyphH: 11.2 },
      { id: "t-a3", word: "להסיח", section: "tosafot", rowId: "t-r2", leftPct: 6.0, topPct: 66.2, widthPct: 87.0, heightPct: 1.2, glyphH: 11.2 },
      { id: "t-a4", word: "אבל", section: "tosafot", rowId: "t-r3", leftPct: 45.0, topPct: 67.8, widthPct: 48.0, heightPct: 1.2, stopAfter: ":" as const, glyphH: 11.2 },
      // Row 3 left side: next entry after ":"
      { id: "t-next", word: "והא", section: "tosafot", rowId: "t-r3", leftPct: 6.0, topPct: 67.8, widthPct: 36.0, heightPct: 1.2, glyphH: 11.2 },
    ];

    const seg = findCommentarySegmentForHotspot("t-a3", hotspots, "tosafot");
    expect(seg).not.toBeNull();
    expect(seg!.lineBoxes).toHaveLength(3);
    const [b1, b2, b3] = seg!.lineBoxes;
    // Zero vertical gap and zero overlap between consecutive lines of the same entry
    expect(b1!.topPct + b1!.heightPct).toBeCloseTo(b2!.topPct, 5);
    expect(b2!.topPct + b2!.heightPct).toBeCloseTo(b3!.topPct, 5);
    // Sibling entries stay strictly outside the illuminated boxes
    expect(b2!.topPct).toBeGreaterThan(64.6 + 1.2 - 0.01);
    expect(b2!.topPct + b2!.heightPct).toBeLessThan(67.8 + 1.2 * 0.22);
    expect(b1!.leftPct + b1!.widthPct).toBeLessThan(65.0);
    expect(b3!.leftPct).toBeGreaterThan(42.0);
  });

  it("separates active jumped-to search hit boxes from passive matching hit boxes", () => {
    const spots = [
      { id: "s1", word: "אמר", section: "gemara", rowId: "r1", leftPct: 70, topPct: 20, widthPct: 4, heightPct: 1.4 },
      { id: "s2", word: "רב", section: "gemara", rowId: "r1", leftPct: 64, topPct: 20, widthPct: 4, heightPct: 1.4 },
      { id: "s3", word: "דבר", section: "gemara", rowId: "r1", leftPct: 40, topPct: 20, widthPct: 4, heightPct: 1.4 },
      { id: "s4", word: "אחר", section: "gemara", rowId: "r1", leftPct: 34, topPct: 20, widthPct: 4, heightPct: 1.4 },
    ];
    const hits = [{ ids: ["s1", "s2"] }, { ids: ["s3", "s4"] }];
    const { passiveBoxes, activeBoxes } = buildSearchHitRowBoxes(spots, hits, new Set(["s1", "s2"]));
    expect(activeBoxes).toHaveLength(1);
    expect(activeBoxes[0]!.leftPct).toBeCloseTo(64 - 0.15, 4);
    expect(passiveBoxes).toHaveLength(1);
    expect(passiveBoxes[0]!.leftPct).toBeCloseTo(34 - 0.15, 4);
  });

  it("never halves a Tosafot line above an enlarged 16.38pt DH heading on the following row", () => {
    // Models Berakhot 2a exact coordinates: Line 2 (11.16pt) above Line 3 starting with bold והא (16.38pt at topPct 66.48, h 1.65)
    const hotspots = [
      { id: "r1-dh", word: "מברך", section: "tosafot", rowId: "r1", leftPct: 74.6, topPct: 64.37, widthPct: 4.2, heightPct: 1.65, glyphH: 16.38 },
      { id: "r1-w", word: "שתים", section: "tosafot", rowId: "r1", leftPct: 64.7, topPct: 64.69, widthPct: 9.2, heightPct: 1.20, glyphH: 11.94 },
      { id: "r1-l", word: "עינינו", section: "tosafot", rowId: "r1", leftPct: 20.0, topPct: 64.77, widthPct: 12.5, heightPct: 1.12, glyphH: 11.16 },
      { id: "r2-a", word: "דההיא", section: "tosafot", rowId: "r2", leftPct: 73.9, topPct: 65.82, widthPct: 11.3, heightPct: 1.12, glyphH: 11.16 },
      { id: "r2-b", word: "המזיקים", section: "tosafot", rowId: "r2", leftPct: 20.0, topPct: 65.82, widthPct: 18.5, heightPct: 1.12, glyphH: 11.16 },
      { id: "r3-end", word: "בלילה:", section: "tosafot", rowId: "r3", leftPct: 56.0, topPct: 66.87, widthPct: 29.2, heightPct: 1.12, stopAfter: ":" as const, glyphH: 11.16 },
      { id: "r3-next-dh", word: "והא", section: "tosafot", rowId: "r3", leftPct: 52.7, topPct: 66.48, widthPct: 3.0, heightPct: 1.65, glyphH: 16.38 },
      { id: "r3-next-body", word: "מעכבא", section: "tosafot", rowId: "r3", leftPct: 20.0, topPct: 66.80, widthPct: 30.0, heightPct: 1.20, glyphH: 11.94 },
    ];
    const seg = findCommentarySegmentForHotspot("r2-b", hotspots, "tosafot");
    expect(seg).not.toBeNull();
    expect(seg!.lineBoxes).toHaveLength(3);
    const [b1, b2, b3] = seg!.lineBoxes;
    expect(b2!.topPct + b2!.heightPct).toBeGreaterThanOrEqual(66.95);
    expect(b1!.topPct + b1!.heightPct).toBeCloseTo(b2!.topPct, 5);
    expect(b2!.topPct + b2!.heightPct).toBeCloseTo(b3!.topPct, 5);
  });
});
