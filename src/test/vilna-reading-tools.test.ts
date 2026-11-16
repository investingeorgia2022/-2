import { beforeEach, describe, expect, it } from "vitest";
import { loadAppSettings } from "../talmud/utils/appPreferences";
import {
  findRashiSegmentForHotspot,
  loadGemaraBoldActive,
  loadPdfHighlights,
  mergeSpotsIntoRowBoxes,
  resolveHighlightRangeIndices,
  saveGemaraBoldActive,
  savePdfHighlights,
  segmentRashiHotspots,
  type PdfProgressHighlight,
} from "../talmud/utils/vilnaPdfReadingTools";

describe("Vilna PDF reading tools and settings defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults all three Vilna PDF reading feature switches to false", () => {
    const settings = loadAppSettings();
    expect(settings.enablePdfProgressHighlight).toBe(false);
    expect(settings.enableGemaraBoldToggle).toBe(false);
    expect(settings.enableRashiFocusMode).toBe(false);
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
});
