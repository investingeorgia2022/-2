import { describe, expect, it } from "vitest";
import type { AudioSyncSegment, SyncHotspotLike, WordAnchor } from "../talmud/utils/audioSyncTypes";
import { resolveSyncHotspots } from "../talmud/utils/syncAnchorResolver";

/**
 * @synthetic-fixture
 * Synthetic Vilna PDF hotspot builder mimicking RTL row/word layout without
 * using real pre-extracted PDF page artifacts (none exist in repo yet).
 */
function makeSyntheticRowHotspots(
  words: string[],
  section: string,
  rowIdx: number,
  options: {
    idPrefix?: string;
    rowIdPrefix?: string;
    topPct?: number;
    startRightPct?: number;
    stepPct?: number;
    lineTextHe?: string;
    isSmallMarker?: boolean;
  } = {},
): SyncHotspotLike[] {
  const idPrefix = options.idPrefix ?? "pdf-word";
  const rowIdPrefix = options.rowIdPrefix ?? `${section}-row-${rowIdx}`;
  const topPct = options.topPct ?? 12 + rowIdx * 4;
  const startRightPct = options.startRightPct ?? 75;
  const stepPct = options.stepPct ?? 6;
  const widthPct = Math.max(2, stepPct - 1);
  const lineTextHe = options.lineTextHe ?? words.join(" ");

  return words.map((word, idx) => ({
    id: `${idPrefix}-${rowIdx}-${idx}`,
    word,
    cleanWord: word,
    section,
    rowId: rowIdPrefix,
    leftPct: startRightPct - idx * stepPct - widthPct,
    topPct,
    widthPct,
    heightPct: 2.2,
    lineTextHe,
    ...(options.isSmallMarker !== undefined ? { isSmallMarker: options.isSmallMarker } : {}),
  }));
}

function makeSegment(id: string, anchors: WordAnchor[]): Pick<AudioSyncSegment, "id" | "anchors"> {
  return { id, anchors };
}

describe("syncAnchorResolver (synthetic fixtures)", () => {
  it("1. resolves an exact unique word anchor", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["תנא", "היכא", "קאי", "דקתני", "מאימתי"], "gemara", 0),
    ];

    const seg = makeSegment("s1", [
      {
        normalizedWord: "דקתני",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 3,
        prevWords: ["היכא", "קאי"],
        nextWords: ["מאימתי"],
        lineFingerprint: "תנא היכא קאי דקתני מאימתי",
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg);
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["pdf-word-0-3"]);
    expect(res.resolvedCount).toBe(1);
    expect(res.diagnostics).toHaveLength(0);
  });

  it("2. succeeds even when unstable pdf-word-* IDs shift after re-extraction", () => {
    const baseWords = ["תנא", "היכא", "קאי", "דקתני", "מאימתי"];
    const shiftedHotspots = makeSyntheticRowHotspots(baseWords, "gemara", 0, {
      idPrefix: "reextracted-shifted-900",
    });

    const seg = makeSegment("s2", [
      {
        normalizedWord: "היכא",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 1,
        prevWords: ["תנא"],
        nextWords: ["קאי"],
        rowIdHint: "old-obsolete-row-id",
      },
    ]);

    const res = resolveSyncHotspots(shiftedHotspots, seg);
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["reextracted-shifted-900-0-1"]);
  });

  it("3. disambiguates repeated words using neighbor context and occurrence index", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["אמר", "רב", "הונא", "חייב"], "gemara", 0),
      ...makeSyntheticRowHotspots(["אמר", "רבה", "פטור", "לגמרי"], "gemara", 1),
    ];

    const segSecondOccurrence = makeSegment("s3", [
      {
        normalizedWord: "אמר",
        section: "gemara",
        occurrence: 2,
        readingOrderIndex: 4,
        nextWords: ["רבה", "פטור"],
        lineFingerprint: "אמר רבה פטור לגמרי",
      },
    ]);

    const res = resolveSyncHotspots(hotspots, segSecondOccurrence);
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["pdf-word-1-0"]);
  });

  it("4. returns unresolved with diagnostics when the target PDF word is missing", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["תנא", "היכא", "קאי"], "gemara", 0),
    ];

    const seg = makeSegment("s4", [
      {
        normalizedWord: "בראשית",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 0,
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg);
    expect(res.status).toBe("unresolved");
    expect(res.hotspotIds).toEqual([]);
    expect(res.unresolvedCount).toBe(1);
    expect(res.diagnostics[0]).toContain("no-matching-word-in-section");
  });

  it("5. returns partial status when some segment anchors resolve and another is missing", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["אמר", "רבה", "שמע", "מינה"], "gemara", 0),
    ];

    const seg = makeSegment("s5", [
      {
        normalizedWord: "אמר",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 0,
        nextWords: ["רבה"],
      },
      {
        normalizedWord: "חסרה",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 1,
      },
      {
        normalizedWord: "שמע",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 2,
        prevWords: ["רבה"],
        nextWords: ["מינה"],
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg);
    expect(res.status).toBe("partial");
    expect(res.resolvedCount).toBe(2);
    expect(res.unresolvedCount).toBe(1);
    expect(res.hotspotIds).toEqual(["pdf-word-0-0", "pdf-word-0-2"]);
  });

  it("6. detects tied ambiguity and never silently picks the first candidate", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["אמר", "מר", "הלכה"], "gemara", 0),
      ...makeSyntheticRowHotspots(["אמר", "מר", "הלכה"], "gemara", 1),
    ];

    // Anchor has identical context & out-of-range occurrence, leaving both rows tied
    const seg = makeSegment("s6", [
      {
        normalizedWord: "אמר",
        section: "gemara",
        occurrence: 99,
        readingOrderIndex: 99,
        nextWords: ["מר", "הלכה"],
        lineFingerprint: "אמר מר הלכה",
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg);
    expect(res.status).toBe("ambiguous");
    expect(res.hotspotIds).toEqual([]);
    expect(res.ambiguousCount).toBe(1);
    expect(res.anchorResults[0]?.candidateHotspotIds).toEqual(["pdf-word-0-0", "pdf-word-1-0"]);
    expect(res.anchorResults[0]?.reason).toBe("tied-candidate-scores");
  });

  it("7. survives cross-resolution rowId drift by prioritizing text context & reading order", () => {
    const mobileResHotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["אמר", "רב", "יוסף"], "gemara", 0, {
        rowIdPrefix: "gemara-row-160-80",
      }),
      ...makeSyntheticRowHotspots(["אמר", "רב", "אשי"], "gemara", 1, {
        rowIdPrefix: "gemara-row-390-75",
      }),
    ];

    // Anchor recorded on desktop viewport had a totally different pixel rowIdHint
    const seg = makeSegment("s7", [
      {
        normalizedWord: "רב",
        section: "gemara",
        occurrence: 2,
        readingOrderIndex: 4,
        prevWords: ["אמר"],
        nextWords: ["אשי"],
        lineFingerprint: "אמר רב אשי",
        rowIdHint: "gemara-row-999-desktop",
      },
    ]);

    const res = resolveSyncHotspots(mobileResHotspots, seg);
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["pdf-word-1-1"]);
  });

  it("8. strictly excludes Rashi, Tosafot, margin, header, and small markers", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["פירש", "רשי", "בדבור"], "rashi", 0),
      ...makeSyntheticRowHotspots(["ואם", "תאמר", "בתוספות"], "tosafot", 1),
      ...makeSyntheticRowHotspots(["עין", "משפט"], "margin", 2),
      ...makeSyntheticRowHotspots(["ברכות"], "header", 3),
      ...makeSyntheticRowHotspots(["א"], "gemara", 4, { isSmallMarker: true }),
      ...makeSyntheticRowHotspots(["גמרא", "פשוטה"], "gemara", 5),
    ];

    const seg = makeSegment("s8", [
      {
        normalizedWord: "רשי",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 0,
      },
      {
        normalizedWord: "בתוספות",
        section: "gemara",
        occurrence: 1,
        readingOrderIndex: 1,
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg);
    expect(res.status).toBe("unresolved");
    expect(res.hotspotIds).toEqual([]);
  });

  it("9. resolves a multi-line RTL reading-order span across wrapped rows cleanly without mutating inputs", () => {
    // Deliberately supply hotspots shuffled out of RTL order to confirm deterministic readingOrder sorting
    const row0 = makeSyntheticRowHotspots(["מאימתי", "קורין", "את"], "mishnah", 0);
    const row1 = makeSyntheticRowHotspots(["שמע", "בערבית"], "mishnah", 1);
    const shuffledHotspots = Object.freeze([row1[1]!, row0[2]!, row0[0]!, row1[0]!, row0[1]!]);

    const seg = Object.freeze(
      makeSegment("s9", [
        {
          normalizedWord: "את",
          section: "mishnah",
          occurrence: 1,
          readingOrderIndex: 2,
          prevWords: ["מאימתי", "קורין"],
          nextWords: ["שמע"],
        },
        {
          normalizedWord: "שמע",
          section: "mishnah",
          occurrence: 1,
          readingOrderIndex: 3,
          prevWords: ["קורין", "את"],
          nextWords: ["בערבית"],
        },
      ]),
    );

    const res = resolveSyncHotspots(shuffledHotspots, seg);
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["pdf-word-0-2", "pdf-word-1-0"]);
  });

  it("10. breaks tied candidate scores using preferredOrderHint when approximate mode is enabled", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticRowHotspots(["אמר", "מר", "הלכה"], "gemara", 0),
      ...makeSyntheticRowHotspots(["אמר", "מר", "הלכה"], "gemara", 1),
    ];

    const seg = makeSegment("s10", [
      {
        normalizedWord: "אמר",
        section: "gemara",
        occurrence: 99,
        readingOrderIndex: 99,
        nextWords: ["מר", "הלכה"],
        lineFingerprint: "אמר מר הלכה",
      },
    ]);

    const res = resolveSyncHotspots(hotspots, seg, {
      approximate: true,
      preferredOrderHint: 3,
    });
    expect(res.status).toBe("resolved");
    expect(res.hotspotIds).toEqual(["pdf-word-1-0"]);
  });
});
