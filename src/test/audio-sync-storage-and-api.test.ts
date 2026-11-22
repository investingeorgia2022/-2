import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafePublicAudioUrl,
  buildTimedSegmentsFromTranscript,
  handleAudioSyncSourceProxyRequest,
  handleAudioSyncTranscribeRequest,
  parseStructuredAiSegments,
} from "../routes/api/talmud/audio-sync-transcribe";
import type { AudioSyncMap, SyncHotspotLike } from "../talmud/utils/audioSyncTypes";
import { validateAudioSyncMap } from "../talmud/utils/audioSyncValidation";
import {
  buildHotspotToSegmentMap,
  deleteAudioSyncMap,
  exportSyncMapJson,
  findActiveSyncSegment,
  findContinuousActiveSyncSegment,
  formatMsToTimestamp,
  importSyncMapJson,
  loadAudioSourceConfig,
  loadAudioSyncMap,
  parseTimestampToMs,
  parseTranscriptToSegments,
  resolveAllSegmentsToHotspots,
  resolveAudioSourceUrl,
  resolveSegmentsWithApproximateFallback,
  saveAudioSourceConfig,
  saveAudioSyncMap,
} from "../talmud/utils/audioSyncStorage";

/**
 * @synthetic-fixture
 * Synthetic Gemara hotspots and transcripts for Stage 2 storage, parser, and API verification.
 */
function makeSyntheticHotspots(): SyncHotspotLike[] {
  const words = ["מאימתי", "קורין", "את", "שמע", "בערבית"];
  return words.map((word, idx) => ({
    id: `spot-${idx}`,
    word,
    cleanWord: word,
    section: "mishnah",
    rowId: "mishnah-row-0",
    leftPct: 80 - idx * 8,
    topPct: 14,
    widthPct: 6,
    heightPct: 2.4,
    lineTextHe: words.join(" "),
  }));
}

describe("audioSyncStorage & API handler", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("parses and formats timestamps accurately", () => {
    expect(parseTimestampToMs("[01:23]")).toBe(83_000);
    expect(parseTimestampToMs("00:01:05,250")).toBe(65_250);
    expect(parseTimestampToMs("99:99")).toBeNull();
    expect(formatMsToTimestamp(83_000)).toBe("01:23");
    expect(formatMsToTimestamp(3_665_000)).toBe("1:01:05");
  });

  it("resolves storage URL templates and per-daf overrides and persists config", () => {
    const emptyCfg = loadAudioSourceConfig();
    expect(resolveAudioSourceUrl("Berakhot", "2a", emptyCfg)).toBeNull();

    saveAudioSourceConfig({
      urlTemplate: "https://cdn.example.com/shiurim/{tractate_lower}/{dafNum}{amud}.mp3",
      dafOverrides: {
        "Shabbat:21b": "https://cdn.example.com/custom/shabbat-chanukah.mp3",
      },
    });
    const loaded = loadAudioSourceConfig();
    expect(resolveAudioSourceUrl("Berakhot", "2a", loaded)).toBe(
      "https://cdn.example.com/shiurim/berakhot/2a.mp3",
    );
    expect(resolveAudioSourceUrl("Shabbat", "21b", loaded)).toBe(
      "https://cdn.example.com/custom/shabbat-chanukah.mp3",
    );

    expect(
      resolveAudioSourceUrl("Pesachim", "10b", {
        urlTemplate: "https://storage.example.com/daf/",
        dafOverrides: {},
      }),
    ).toBe("https://storage.example.com/daf/Pesachim/10b.mp3");
  });

  it("parses SRT, bracketed [MM:SS], and plain Hebrew transcripts", () => {
    const srt = `1
00:00:00,000 --> 00:00:03,500
מאימתי קורין את שמע

2
00:00:03,500 --> 00:00:07,000
תנא היכא קאי`;
    const srtSegs = parseTranscriptToSegments(srt);
    expect(srtSegs).toHaveLength(2);
    expect(srtSegs[0]?.startMs).toBe(0);
    expect(srtSegs[1]?.endMs).toBe(7000);

    const bracketed = `[00:00] מאימתי קורין\n[00:04] את שמע בערבית`;
    const brSegs = parseTranscriptToSegments(bracketed, 9000);
    expect(brSegs).toHaveLength(2);
    expect(brSegs[0]?.endMs).toBe(4000);
    expect(brSegs[1]?.endMs).toBe(9000);

    const plain = `מאימתי קורין את שמע\nתנא היכא קאי דקתני מאימתי`;
    const plainSegs = parseTranscriptToSegments(plain, 10_000);
    expect(plainSegs).toHaveLength(2);
    expect(plainSegs[0]?.startMs).toBe(0);
    expect(plainSegs[1]?.endMs).toBe(10_000);
  });

  it("exports, imports, persists, and resolves AudioSyncMap anchors to live hotspots", async () => {
    const map: AudioSyncMap = {
      version: 1,
      tractateId: "Berakhot",
      dafId: "2a",
      segments: [
        {
          id: "seg-1",
          startMs: 0,
          endMs: 3000,
          textHe: "מאימתי קורין את שמע",
          confidence: 0.96,
          reviewStatus: "auto",
          anchors: [
            {
              normalizedWord: "מאימתי",
              section: "mishnah",
              occurrence: 1,
              readingOrderIndex: 0,
              nextWords: ["קורין"],
            },
            {
              normalizedWord: "קורין",
              section: "mishnah",
              occurrence: 1,
              readingOrderIndex: 1,
              prevWords: ["מאימתי"],
            },
          ],
        },
      ],
    };

    const json = exportSyncMapJson(map);
    const reimported = importSyncMapJson(json);
    expect(reimported.tractateId).toBe("Berakhot");

    await saveAudioSyncMap(reimported);
    const loaded = await loadAudioSyncMap("Berakhot", "2a");
    expect(loaded?.segments).toHaveLength(1);

    const active = findActiveSyncSegment(loaded!.segments, 1200);
    expect(active?.id).toBe("seg-1");

    const resolvedMap = resolveAllSegmentsToHotspots(loaded!, makeSyntheticHotspots());
    expect(resolvedMap.get("seg-1")).toEqual(["spot-0", "spot-1"]);

    const wordLookup = buildHotspotToSegmentMap(loaded!, resolvedMap);
    expect(wordLookup.get("spot-1")?.id).toBe("seg-1");

    await deleteAudioSyncMap("Berakhot", "2a");
    expect(await loadAudioSyncMap("Berakhot", "2a")).toBeNull();
  });

  it("builds timed segments from AI transcript and rejects invalid audio requests", async () => {
    const segs = buildTimedSegmentsFromTranscript("מאימתי קורין.\nתנא היכא קאי.", 6000);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.startMs).toBe(0);
    expect(segs[1]?.endMs).toBe(6000);

    const badReq = new Request("http://localhost/api/talmud/audio-sync-transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: "" }),
    });
    const res = await handleAudioSyncTranscribeRequest(badReq);
    expect(res.status).toBe(400);
  });

  it("enforces SSRF protection and proxies safe public audio source checks", async () => {
    expect(() => assertSafePublicAudioUrl("http://cdn.example.com/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://localhost/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://127.0.0.1/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://10.0.0.5/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://192.168.1.2/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://[::1]/2a.mp3")).toThrow();
    expect(() => assertSafePublicAudioUrl("https://user:pass@cdn.example.com/2a.mp3")).toThrow();

    const unsafeProxyRes = await handleAudioSyncSourceProxyRequest(
      new Request(
        "http://localhost/api/talmud/audio-sync-transcribe?mode=check&url=https%3A%2F%2F169.254.169.254%2Fsecret",
      ),
    );
    expect(unsafeProxyRes.status).toBe(400);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { "content-type": "audio/mpeg", "content-length": "12345" },
      }),
    );
    const okRes = await handleAudioSyncSourceProxyRequest(
      new Request(
        "http://localhost/api/talmud/audio-sync-transcribe?mode=check&url=https%3A%2F%2Fcdn.example.com%2FBerakhot%2F2a.mp3",
      ),
    );
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { exists: boolean; sizeBytes: number };
    expect(okBody.exists).toBe(true);
    expect(okBody.sizeBytes).toBe(12345);

    fetchSpy.mockResolvedValueOnce(
      new Response("<html>404</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const htmlRes = await handleAudioSyncSourceProxyRequest(
      new Request(
        "http://localhost/api/talmud/audio-sync-transcribe?mode=check&url=https%3A%2F%2Fcdn.example.com%2FBerakhot%2F99a.mp3",
      ),
    );
    expect(htmlRes.status).toBe(404);
  });

  it("parses structured bilingual AI JSON segments, bridges gaps across Georgian explanations, and validates topicKa", () => {
    const fencedJson = `\`\`\`json
    [
      {
        "startMs": 0,
        "endMs": 2800,
        "textHe": "מאימתי קורין את שמע בערבית",
        "topicKa": "მიშნის კითხვა: საღამოს შემაც კითხვის დრო"
      },
      {
        "startMs": 7500,
        "endMs": 12000,
        "textHe": "תנא היכא קאי",
        "topicKa": "გემარის კითხვა მიშნის საწყისზე"
      }
    ]
    \`\`\``;

    const structured = parseStructuredAiSegments(fencedJson, 15_000);
    expect(structured).toHaveLength(2);
    // Gap between 2800ms and 7500ms is bridged so highlight never flickers blank
    expect(structured[0]?.endMs).toBe(7500);
    expect(structured[0]?.topicKa).toContain("მიშნის კითხვა");
    expect(structured[1]?.endMs).toBe(15_000);

    // Continuous lookup also bridges manual SRT/plain gaps across pauses
    const manualSegs = [
      {
        id: "m-1",
        startMs: 0,
        endMs: 2500,
        textHe: "מאימתי קורין",
        topicKa: "შესავალი",
        confidence: 0.95,
        reviewStatus: "auto" as const,
        anchors: [],
      },
      {
        id: "m-2",
        startMs: 8000,
        endMs: 12_000,
        textHe: "תנא היכא קאי",
        confidence: 0.95,
        reviewStatus: "auto" as const,
        anchors: [],
      },
    ];
    expect(findActiveSyncSegment(manualSegs, 5000)).toBeNull();
    expect(findContinuousActiveSyncSegment(manualSegs, 5000)?.id).toBe("m-1");

    const invalidTopicRes = validateAudioSyncMap({
      version: 1,
      tractateId: "Berakhot",
      dafId: "2a",
      segments: [
        {
          id: "seg-bad",
          startMs: 0,
          endMs: 1000,
          textHe: "מאימתי",
          topicKa: 123,
          confidence: 0.9,
          reviewStatus: "auto",
          anchors: [],
        },
      ],
    });
    expect(invalidTopicRes.valid).toBe(false);
    expect(invalidTopicRes.issues.some((iss) => iss.code === "INVALID_TOPIC_KA")).toBe(true);
  });

  it("rescues cached segments with empty anchors via approximate phrase matching strictly in Mishnah/Gemara", () => {
    const hotspots: SyncHotspotLike[] = [
      ...makeSyntheticHotspots(),
      {
        id: "rashi-0",
        word: "פירוש",
        cleanWord: "פירוש",
        section: "rashi",
        rowId: "rashi-row-0",
        leftPct: 12,
        topPct: 14,
        widthPct: 5,
        heightPct: 2,
      },
    ];

    const map: AudioSyncMap = {
      version: 1,
      tractateId: "Berakhot",
      dafId: "2a",
      segments: [
        {
          id: "seg-empty-anchors",
          startMs: 0,
          endMs: 4000,
          textHe: "קורין את שמע בערבית עכשיו",
          confidence: 0.4,
          reviewStatus: "needs-review",
          anchors: [],
        },
        {
          id: "seg-rashi-only",
          startMs: 4000,
          endMs: 6000,
          textHe: "פירוש",
          confidence: 0,
          reviewStatus: "unmatched",
          anchors: [],
        },
      ],
    };

    const summary = resolveSegmentsWithApproximateFallback(map, hotspots);
    expect(summary.bySegment.get("seg-empty-anchors")).toEqual(["spot-1", "spot-2", "spot-3", "spot-4"]);
    expect(summary.matchKindBySegment.get("seg-empty-anchors")).toBe("approximate");
    expect(summary.bySegment.get("seg-rashi-only")).toEqual([]);
    expect(summary.matchKindBySegment.get("seg-rashi-only")).toBe("unmatched");
    expect(summary.matchedSegmentCount).toBe(1);
    expect(summary.approximateSegmentCount).toBe(1);
  });
});
