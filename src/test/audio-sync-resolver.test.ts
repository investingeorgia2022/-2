import { describe, expect, it } from "vitest";
import type { VilnaPdfHotspot } from "../talmud/components/VilnaPdfInteractiveViewer";
import type { TalmudSentence } from "../talmud/types/talmud";
import { resolveSyncHotspots } from "../talmud/utils/audioSyncResolver";
import type { AudioSyncSegment } from "../talmud/utils/audioSyncTypes";

/**
 * @synthetic-fixture
 * Synthetic VilnaPdfHotspot helper for testing `audioSyncResolver.resolveSyncHotspots`.
 */
function makeVilnaRow(
  words: string[],
  section: VilnaPdfHotspot["section"],
  rowIdx: number,
  rowIdOverride?: string,
): VilnaPdfHotspot[] {
  const sentence: TalmudSentence = {
    id: `sent-${section}-${rowIdx}`,
    source: section === "mishnah" ? "mishnah" : "gemara",
    hebrewText: words.join(" "),
    translationKa: "",
    explanationKa: "",
  };
  const rowId = rowIdOverride ?? `${section}-row-${rowIdx}`;
  const lineTextHe = words.join(" ");

  return words.map((word, idx) => ({
    id: `vilna-${section}-${rowIdx}-${idx}`,
    word,
    cleanWord: word.replace(/[\u0591-\u05C7]/g, ""),
    section,
    rowId,
    leftPct: 75 - idx * 7,
    topPct: 14 + rowIdx * 4,
    widthPct: 5,
    heightPct: 2.2,
    lineTextHe,
    sentence,
  }));
}

describe("audioSyncResolver.resolveSyncHotspots (synthetic VilnaPdfHotspot fixtures)", () => {
  it("maps segment word anchors to VilnaPdfHotspot elements with normalized Hebrew matching and row context", () => {
    const hotspots: VilnaPdfHotspot[] = [
      ...makeVilnaRow(["מֵאֵימָתַי", "קוֹרִין", "אֶת", "שְׁמַע", "בְּעַרְבִין"], "mishnah", 0),
      ...makeVilnaRow(["גְּמָרָא", "תַּנָּא", "הֵיכָא", "קָאֵי", "דְּקָתָנֵי", "מֵאֵימָתַי"], "gemara", 1),
      ...makeVilnaRow(["דְּתַנְיָא", "חֲכָמִים", "הֵיכָא", "אֲמַרוּ"], "gemara", 2),
    ];

    const segment: Pick<AudioSyncSegment, "id" | "anchors"> = {
      id: "seg-1",
      anchors: [
        {
          normalizedWord: "היכא",
          section: "gemara",
          occurrence: 1,
          readingOrderIndex: 7,
          prevWords: ["תנא"],
          nextWords: ["קאי", "דקתני"],
          lineFingerprint: "גמרא תנא היכא קאי דקתני מאימתי",
          rowIdHint: "stale-row-id-after-zoom",
        },
        {
          normalizedWord: "דקתני",
          section: "gemara",
          occurrence: 1,
          readingOrderIndex: 9,
          prevWords: ["היכא", "קאי"],
          nextWords: ["מאימתי"],
          lineFingerprint: "גמרא תנא היכא קאי דקתני מאימתי",
        },
      ],
    };

    const result = resolveSyncHotspots(hotspots, segment);
    expect(result.status).toBe("resolved");
    expect(result.hotspotIds).toEqual(["vilna-gemara-1-2", "vilna-gemara-1-4"]);
    expect(result.hotspots.map((h) => h.word)).toEqual(["הֵיכָא", "דְּקָתָנֵי"]);
  });

  it("ignores non-main commentary sections and isolates mishnah vs gemara", () => {
    const hotspots: VilnaPdfHotspot[] = [
      ...makeVilnaRow(["היכא", "קאי"], "rashi", 0),
      ...makeVilnaRow(["היכא", "קאי"], "mishnah", 1),
      ...makeVilnaRow(["היכא", "קאי"], "gemara", 2),
    ];

    const segment: Pick<AudioSyncSegment, "id" | "anchors"> = {
      id: "seg-2",
      anchors: [
        {
          normalizedWord: "היכא",
          section: "gemara",
          occurrence: 1,
          readingOrderIndex: 2,
          prevWords: [],
          nextWords: ["קאי"],
          lineFingerprint: "היכא קאי",
        },
      ],
    };

    const result = resolveSyncHotspots(hotspots, segment);
    expect(result.status).toBe("resolved");
    expect(result.hotspotIds).toEqual(["vilna-gemara-2-0"]);
  });
});
