import { describe, expect, it } from "vitest";
import type { SyncHotspotLike } from "../talmud/utils/audioSyncTypes";
import { validateAudioSyncMap } from "../talmud/utils/audioSyncValidation";
import {
  alignGemaraSegments,
  detectDafTransition,
  findApproximatePhraseMatch,
  matchGemaraPhrase,
  type AlignerSegmentInput,
} from "../talmud/utils/gemaraPhraseAligner";

/**
 * @synthetic-fixture
 * Builds synthetic Vilna PDF word hotspots in RTL layout for Stage 1 aligner verification.
 */
function makeWords(
  entries: Array<{ word: string; quoteAfter?: '"' | "'"; isSmallMarker?: boolean } | string>,
  section: string,
  rowIdx = 0,
  idPrefix = "w",
): SyncHotspotLike[] {
  const topPct = 15 + rowIdx * 4;
  return entries.map((entry, idx) => {
    const obj = typeof entry === "string" ? { word: entry } : entry;
    return {
      id: `${idPrefix}-${rowIdx}-${idx}`,
      word: obj.word,
      cleanWord: obj.word,
      section,
      rowId: `${section}-row-${rowIdx}`,
      leftPct: 80 - idx * 6,
      topPct,
      widthPct: 5,
      heightPct: 2.2,
      lineTextHe: entries.map((e) => (typeof e === "string" ? e : e.word)).join(" "),
      ...(obj.quoteAfter !== undefined ? { quoteAfter: obj.quoteAfter } : {}),
      ...(obj.isSmallMarker !== undefined ? { isSmallMarker: obj.isSmallMarker } : {}),
    };
  });
}

describe("gemaraPhraseAligner (synthetic fixtures)", () => {
  it("1. matches an exact Gemara phrase with high confidence (>= 0.85) and auto reviewStatus", () => {
    const hotspots = makeWords(
      ["תנא", "היכא", "קאי", "דקתני", "מאימתי", "תנא", "אקרא", "קאי"],
      "gemara",
    );
    const segments: AlignerSegmentInput[] = [
      { id: "seg-1", startMs: 0, endMs: 2500, textHe: "תנא היכא קאי דקתני מאימתי" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.confidenceBand).toBe("high");
    expect(run.results[0]?.segment.reviewStatus).toBe("auto");
    expect(run.results[0]?.segment.confidence).toBeGreaterThanOrEqual(0.85);
    expect(run.results[0]?.matchedHotspotIds).toEqual([
      "w-0-0",
      "w-0-1",
      "w-0-2",
      "w-0-3",
      "w-0-4",
    ]);
    expect(validateAudioSyncMap(run.map).valid).toBe(true);
  });

  it("2. tolerates nikud and final-letter differences cleanly", () => {
    const hotspots = makeWords(["מֵאֵימָתַי", "קוֹרִין", "אֶת", "שְׁמַע", "בְּעַרְבִית"], "mishnah");
    const segments: AlignerSegmentInput[] = [
      { id: "seg-nikud", startMs: 0, endMs: 2000, textHe: "מאימתי קורין את שמע בערבית" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.matchedHotspotIds).toEqual([
      "w-0-0",
      "w-0-1",
      "w-0-2",
      "w-0-3",
      "w-0-4",
    ]);
  });

  it("3. matches Hebrew prefix variations (ו/ב/ל/מ/ש/ה/ד)", () => {
    const hotspots = makeWords(["אמר", "רבא", "מילתא", "אחריתי", "היא"], "gemara");
    const segments: AlignerSegmentInput[] = [
      { id: "seg-prefix", startMs: 0, endMs: 2200, textHe: "ואמר רבא דמילתא אחריתי היא" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.segment.anchors).toHaveLength(5);
  });

  it("4. aligns Vilna abbreviations in both directions including split quoteAfter runs", () => {
    const hotspots = makeWords(
      [
        { word: "אמר" },
        { word: "ר", quoteAfter: "'" },
        { word: "יוחנן" },
        { word: "ק", quoteAfter: '"' },
        { word: "ש" },
        { word: 'אדר"מ' },
      ],
      "gemara",
    );

    const segments: AlignerSegmentInput[] = [
      {
        id: "seg-abbr",
        startMs: 0,
        endMs: 3500,
        textHe: "אמר רבי יוחנן קריאת שמע אדר מאיר",
      },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.matchedHotspotIds).toEqual([
      "w-0-0",
      "w-0-1",
      "w-0-2",
      "w-0-3",
      "w-0-4",
      "w-0-5",
    ]);
  });

  it("5. respects configurable maxGapWords (<= 3 succeeds, > 3 rejected)", () => {
    // 2 skipped tokens between 'אמר' and 'מילתא'
    const twoGapHotspots = makeWords(["אמר", "רב", "הונא", "מילתא", "חדתא"], "gemara");
    const withinDefaultGap = matchGemaraPhrase(twoGapHotspots, "אמר מילתא חדתא");
    expect(withinDefaultGap.best).not.toBeNull();
    expect(withinDefaultGap.best?.gapCount).toBe(2);

    // 4 skipped tokens between 'אמר' and 'מילתא' exceeds default maxGapWords = 3
    const fourGapHotspots = makeWords(
      ["אמר", "רבי", "יצחק", "בר", "נחמני", "מילתא", "חדתא"],
      "gemara",
    );
    const rejectedDefault = matchGemaraPhrase(fourGapHotspots, "אמר מילתא חדתא");
    expect(rejectedDefault.best?.matchedQueryCount ?? 0).toBeLessThan(3);

    // Explicit maxGapWords: 4 unlocks matching across the 4-token gap
    const allowedCustom = matchGemaraPhrase(fourGapHotspots, "אמר מילתא חדתא", 0, {
      maxGapWords: 4,
    });
    expect(allowedCustom.best?.matchedQueryCount).toBe(3);
    expect(allowedCustom.best?.gapCount).toBe(4);
  });

  it("6. resolves repeated phrases monotonically in chronological audio order", () => {
    const hotspots = [
      ...makeWords(["אמר", "מר", "משעת", "הכשר"], "gemara", 0),
      ...makeWords(["הדר", "בעי", "אמר", "מר", "משעת", "הכשר"], "gemara", 1),
    ];

    const segments: AlignerSegmentInput[] = [
      { id: "seg-first", startMs: 0, endMs: 2000, textHe: "אמר מר משעת הכשר" },
      { id: "seg-second", startMs: 2000, endMs: 4200, textHe: "אמר מר משעת הכשר" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.matchedHotspotIds).toEqual(["w-0-0", "w-0-1", "w-0-2", "w-0-3"]);
    expect(run.results[1]?.status).toBe("matched");
    expect(run.results[1]?.matchedHotspotIds).toEqual(["w-1-2", "w-1-3", "w-1-4", "w-1-5"]);
  });

  it("7. transparently skips inline reference markers without counting them as gaps", () => {
    const hotspots = makeWords(
      ["אמר", { word: "(א)", isSmallMarker: true }, "רבא", "1", "*", "שמע", "מינה"],
      "gemara",
    );

    const run = alignGemaraSegments(
      hotspots,
      [{ id: "seg-markers", startMs: 0, endMs: 2000, textHe: "אמר רבא שמע מינה" }],
      { tractateId: "Berakhot", dafId: "2a" },
    );

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.matchedHotspotIds).toEqual(["w-0-0", "w-0-2", "w-0-5", "w-0-6"]);
    expect(run.results[0]?.diagnostics).not.toContain("gaps:1");
  });

  it("8. never matches phrases appearing only in Rashi, Tosafot, margin, or header", () => {
    const hotspots = [
      ...makeWords(["פירוש", "משעת", "שיוצאים"], "rashi", 0, "r"),
      ...makeWords(["ואם", "תאמר", "מאימתי"], "tosafot", 1, "t"),
      ...makeWords(["אורח", "חיים"], "margin", 2, "m"),
      ...makeWords(["פרק", "ראשון"], "header", 3, "h"),
    ];

    const run = alignGemaraSegments(
      hotspots,
      [{ id: "seg-comm", startMs: 0, endMs: 1800, textHe: "פירוש משעת שיוצאים" }],
      { tractateId: "Berakhot", dafId: "2a" },
    );

    expect(run.results[0]?.status).toBe("unmatched");
    expect(run.results[0]?.segment.anchors).toEqual([]);
    expect(run.results[0]?.matchedHotspotIds).toEqual([]);
  });

  it("9. flags low-confidence (< 0.60) matches as needs-review with empty anchors", () => {
    const hotspots = makeWords(["מאימתי", "מתחילין", "לברך", "בשחרית"], "gemara");
    // Only 1 out of 4 spoken words matches -> confidence ~0.25 (< 0.60)
    const segments: AlignerSegmentInput[] = [
      {
        id: "seg-low",
        startMs: 0,
        endMs: 2000,
        textHe: "מאימתי אומרים קריאה זו",
      },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("low-confidence");
    expect(run.results[0]?.confidenceBand).toBe("low");
    expect(run.results[0]?.segment.reviewStatus).toBe("needs-review");
    expect(run.results[0]?.segment.confidence).toBeLessThan(0.6);
    expect(run.results[0]?.segment.anchors).toEqual([]);
    expect(run.results[0]?.matchedHotspotIds).toEqual([]);
  });

  it("10. flags ambiguous standalone matches as needs-review with empty anchors", () => {
    const hotspots = [
      ...makeWords(["איתמר", "היכא", "דאמר"], "gemara", 0),
      ...makeWords(["ועוד", "איתמר", "היכא", "דאמר"], "gemara", 1),
    ];

    const segments: AlignerSegmentInput[] = [
      { id: "seg-ambig", startMs: 0, endMs: 1800, textHe: "איתמר היכא דאמר" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("ambiguous");
    expect(run.results[0]?.segment.reviewStatus).toBe("needs-review");
    expect(run.results[0]?.segment.anchors).toEqual([]);
    expect(run.results[0]?.matchedHotspotIds).toEqual([]);
    expect(run.results[0]?.candidateCount).toBe(2);
  });

  it("11. classifies medium confidence (0.60 - 0.84) with needs-review and populated anchors", () => {
    // Query of 4 words where first 3 match and 4th diverges -> coverage = 0.75 (medium band)
    const hotspots = makeWords(["שנינו", "במשנה", "מאימתי", "קורין"], "gemara");
    const segments: AlignerSegmentInput[] = [
      { id: "seg-med", startMs: 0, endMs: 2500, textHe: "שנינו במשנה מאימתי עכשיו" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(run.results[0]?.confidenceBand).toBe("medium");
    expect(run.results[0]?.segment.confidence).toBeGreaterThanOrEqual(0.6);
    expect(run.results[0]?.segment.confidence).toBeLessThan(0.85);
    expect(run.results[0]?.segment.reviewStatus).toBe("needs-review");
    expect(run.results[0]?.segment.anchors.length).toBe(3);
  });

  it("12. detects page/daf transitions without misaligning downstream phrases", () => {
    const trans = detectDafTransition(
      { id: "t1", startMs: 1000, endMs: 2000, textHe: "נעבור כעת לדף ב עמוד ב" },
      "2a",
    );
    expect(trans?.fromDafId).toBe("2a");
    expect(trans?.toDafId).toBe("2b");

    const hotspots = makeWords(["תנו", "רבנן", "היכן", "משביעין"], "gemara");
    const segments: AlignerSegmentInput[] = [
      { id: "seg-turn", startMs: 0, endMs: 1500, textHe: "עמוד ב" },
      { id: "seg-next", startMs: 1500, endMs: 3500, textHe: "תנו רבנן היכן משביעין" },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("daf-transition");
    expect(run.results[0]?.dafTransitionDetected?.toDafId).toBe("2b");
    expect(run.results[1]?.status).toBe("matched");
    expect(run.results[1]?.segment.dafId).toBe("2b");
    expect(validateAudioSyncMap(run.map).valid).toBe(true);
  });

  it("13. handles empty, whitespace, or punctuation-only segments cleanly", () => {
    const hotspots = makeWords(["מאימתי", "קורין"], "gemara");
    const segments: AlignerSegmentInput[] = [
      { id: "seg-empty", startMs: 0, endMs: 500, textHe: "   ... , ! [] " },
    ];

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("unmatched");
    expect(run.results[0]?.segment.confidence).toBe(0);
    expect(run.results[0]?.segment.reviewStatus).toBe("unmatched");
    expect(run.results[0]?.segment.anchors).toEqual([]);
  });

  it("14. never mutates input hotspots or input segment arrays", () => {
    const hotspots = Object.freeze(makeWords(["מאימתי", "קורין", "את", "שמע"], "mishnah"));
    const segments = Object.freeze([
      Object.freeze({
        id: "seg-immut",
        startMs: 0,
        endMs: 2000,
        textHe: "מאימתי קורין את שמע",
      }),
    ]);

    const run = alignGemaraSegments(hotspots, segments, {
      tractateId: "Berakhot",
      dafId: "2a",
    });

    expect(run.results[0]?.status).toBe("matched");
    expect(hotspots).toHaveLength(4);
    expect(segments).toHaveLength(1);
  });

  it("15. recovers tied, low-confidence, and drifted spans when allowApproximate is enabled", () => {
    const hotspots = [
      ...makeWords(["איתמר", "היכא", "דאמר"], "gemara", 0),
      ...makeWords(["מאימתי", "קורין", "את", "שמע", "בערבית"], "mishnah", 1),
      ...makeWords(["איתמר", "היכא", "דאמר"], "gemara", 2),
    ];

    const segs: AlignerSegmentInput[] = [
      { id: "seg-tied", startMs: 0, endMs: 2000, textHe: "איתמר היכא דאמר" },
      { id: "seg-noisy", startMs: 2000, endMs: 4000, textHe: "ברכות קורין את היום לילה ובוקר" },
    ];

    const approxRun = alignGemaraSegments(
      hotspots,
      segs,
      { tractateId: "Berakhot", dafId: "2a" },
      { allowApproximate: true },
    );

    expect(approxRun.results[0]?.matchedHotspotIds.length).toBeGreaterThan(0);
    expect(approxRun.results[0]?.segment.anchors.length).toBeGreaterThan(0);
    expect(approxRun.results[1]?.matchedHotspotIds).toEqual(["w-1-1", "w-1-2"]);

    const rescued = findApproximatePhraseMatch(
      hotspots,
      "גמרא שמע בערבית עכשיו",
      0,
    );
    expect(rescued?.hotspotIds).toEqual(["w-1-3", "w-1-4"]);
  });
});
