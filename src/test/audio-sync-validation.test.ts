import { describe, expect, it } from "vitest";
import {
  AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD,
  AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD,
  classifyConfidenceBand,
  type AudioSyncMap,
} from "../talmud/utils/audioSyncTypes";
import {
  assertValidAudioSyncMap,
  isValidDafIdForTractate,
  validateAudioSyncMap,
} from "../talmud/utils/audioSyncValidation";

/**
 * @synthetic-fixture
 * Valid and invalid AudioSyncMap payloads synthesized for Stage 1 schema verification.
 */
function makeValidSyncMap(): AudioSyncMap {
  return {
    version: 1,
    tractateId: "Berakhot",
    dafId: "2a",
    source: {
      speaker: "Rav Test",
      title: "Berakhot 2a Shiur",
      durationMs: 120_000,
      language: "he",
      alignerVersion: "stage1-v1",
    },
    segments: [
      {
        id: "seg-1",
        startMs: 0,
        endMs: 4200,
        textHe: "מאימתי קורין את שמע בערבית",
        confidence: 0.96,
        reviewStatus: "auto",
        anchors: [
          {
            normalizedWord: "מאימתי",
            rawWord: "מֵאֵימָתַי",
            section: "mishnah",
            occurrence: 1,
            readingOrderIndex: 0,
            prevWords: [],
            nextWords: ["קורין", "את"],
            lineFingerprint: "מאימתי קורין את שמע בערבית",
          },
          {
            normalizedWord: "קורין",
            section: "mishnah",
            occurrence: 1,
            readingOrderIndex: 1,
            prevWords: ["מאימתי"],
            nextWords: ["את", "שמע"],
          },
        ],
      },
      {
        id: "seg-2",
        startMs: 4200,
        endMs: 8500,
        textHe: "תנא היכא קאי דקתני מאימתי",
        confidence: 0.78,
        reviewStatus: "needs-review",
        anchors: [
          {
            normalizedWord: "תנא",
            section: "gemara",
            occurrence: 1,
            readingOrderIndex: 10,
          },
        ],
      },
    ],
  };
}

describe("audioSyncTypes & validation", () => {
  it("classifies confidence bands according to Stage 1 thresholds", () => {
    expect(AUDIO_SYNC_HIGH_CONFIDENCE_THRESHOLD).toBe(0.85);
    expect(AUDIO_SYNC_MEDIUM_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(classifyConfidenceBand(0.92)).toBe("high");
    expect(classifyConfidenceBand(0.85)).toBe("high");
    expect(classifyConfidenceBand(0.84)).toBe("medium");
    expect(classifyConfidenceBand(0.6)).toBe("medium");
    expect(classifyConfidenceBand(0.59)).toBe("low");
    expect(classifyConfidenceBand(Number.NaN)).toBe("low");
  });

  it("validates tractate daf ranges using the canonical TRACTATES catalog", () => {
    expect(isValidDafIdForTractate("Berakhot", "2a")).toBe(true);
    expect(isValidDafIdForTractate("Berakhot", "64b")).toBe(true);
    expect(isValidDafIdForTractate("Berakhot", "1a")).toBe(false);
    expect(isValidDafIdForTractate("Berakhot", "65a")).toBe(false);
    expect(isValidDafIdForTractate("Berakhot", "2c")).toBe(false);
    expect(isValidDafIdForTractate("NonExistentTractate", "2a")).toBe(false);
  });

  it("accepts a valid AudioSyncMap", () => {
    const map = makeValidSyncMap();
    const res = validateAudioSyncMap(map);
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
    expect(assertValidAudioSyncMap(map)).toEqual(map);
  });

  it("rejects unknown tractateId and out-of-range dafId", () => {
    const badTractate = { ...makeValidSyncMap(), tractateId: "InvalidTractate" };
    const r1 = validateAudioSyncMap(badTractate);
    expect(r1.valid).toBe(false);
    expect(r1.issues.some((i) => i.code === "UNKNOWN_TRACTATE")).toBe(true);

    const outOfRangeDaf = { ...makeValidSyncMap(), dafId: "99a" };
    const r2 = validateAudioSyncMap(outOfRangeDaf);
    expect(r2.valid).toBe(false);
    expect(r2.issues.some((i) => i.code === "DAF_OUT_OF_RANGE")).toBe(true);
  });

  it("rejects negative startMs, inverted endMs <= startMs, and non-chronological segments", () => {
    const base = makeValidSyncMap();
    const invalidTiming: AudioSyncMap = {
      ...base,
      segments: [
        { ...base.segments[0]!, startMs: -10, endMs: 100 },
        { ...base.segments[1]!, startMs: 500, endMs: 500 },
        {
          id: "seg-3",
          startMs: 300,
          endMs: 900,
          textHe: "אמר מר",
          confidence: 0.9,
          reviewStatus: "auto",
          anchors: [],
        },
      ],
    };

    const res = validateAudioSyncMap(invalidTiming);
    expect(res.valid).toBe(false);
    const codes = new Set(res.issues.map((i) => i.code));
    expect(codes.has("INVALID_START_MS")).toBe(true);
    expect(codes.has("INVALID_END_MS")).toBe(true);
    expect(codes.has("NON_CHRONOLOGICAL_SEGMENT")).toBe(true);
  });

  it("rejects invalid confidence bounds, reviewStatus, duplicate anchors, and commentary sections", () => {
    const base = makeValidSyncMap();
    const malformed = {
      ...base,
      segments: [
        {
          id: "seg-bad",
          startMs: 0,
          endMs: 1000,
          textHe: "אמר רבא",
          confidence: 1.25,
          reviewStatus: "guessed",
          anchors: [
            {
              normalizedWord: "אמר",
              section: "rashi",
              occurrence: 1,
              readingOrderIndex: 0,
            },
            {
              normalizedWord: "רבא",
              section: "gemara",
              occurrence: 1,
              readingOrderIndex: 2,
            },
            {
              normalizedWord: "רבא",
              section: "gemara",
              occurrence: 1,
              readingOrderIndex: 2,
            },
          ],
        },
      ],
    };

    const res = validateAudioSyncMap(malformed);
    expect(res.valid).toBe(false);
    const codes = new Set(res.issues.map((i) => i.code));
    expect(codes.has("INVALID_CONFIDENCE")).toBe(true);
    expect(codes.has("INVALID_REVIEW_STATUS")).toBe(true);
    expect(codes.has("INVALID_ANCHOR_SECTION")).toBe(true);
    expect(codes.has("DUPLICATE_ANCHOR")).toBe(true);
    expect(() => assertValidAudioSyncMap(malformed)).toThrow(/Invalid AudioSyncMap/);
  });
});
