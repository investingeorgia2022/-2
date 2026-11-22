import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDibburHamatchilLinks,
  splitSideAt,
  type DhHotspotLike,
} from "../talmud/utils/dibburHamatchilMatcher";
import {
  extractGazeFeaturesFromLandmarks,
  fitGazeCalibrationModel,
  getCalibrationPoints,
  loadGazeCalibration,
  OneEuroGazeFilter,
  predictNormalizedGaze,
  RollingRawGazeMedianFilter,
  saveGazeCalibration,
  type GazeCalibrationSample,
  type GazeRawSample,
  type NormalizedLandmark,
} from "../talmud/utils/gazeCalibrationEngine";
import {
  createInitialGazeFocusState,
  resolveGazeTarget,
  stepGazeTargetFocus,
  type GazeHotspotLike,
  type GazeRectBox,
} from "../talmud/utils/gazeGemaraTargetResolver";
import { parseGeorgianGazeCommand } from "../talmud/utils/voiceCommandListener";
import {
  classifyCameraError,
  isBenignMediapipeLog,
  isTrackLikelyRearCamera,
} from "../talmud/utils/useEyeTrackingEngine";
import { GazeNavigationOverlay } from "../talmud/components/GazeNavigationOverlay";

function makeSyntheticLandmarks(opts: {
  rightIrisOffsetX: number;
  rightIrisOffsetY: number;
  leftIrisOffsetX: number;
  leftIrisOffsetY: number;
  earRatio?: number;
}): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const ear = opts.earRatio ?? 0.3;

  // Right eye corners (33, 133), lids (159, 145), iris (468)
  arr[33] = { x: 0.35, y: 0.45, z: 0 };
  arr[133] = { x: 0.43, y: 0.45, z: 0 }; // width = 0.08
  arr[159] = { x: 0.39, y: 0.45 - 0.04 * ear, z: 0 };
  arr[145] = { x: 0.39, y: 0.45 + 0.04 * ear, z: 0 };
  arr[468] = {
    x: 0.39 + opts.rightIrisOffsetX,
    y: 0.45 + opts.rightIrisOffsetY,
    z: 0,
  };

  // Left eye corners (362, 263), lids (386, 374), iris (473)
  arr[362] = { x: 0.57, y: 0.45, z: 0 };
  arr[263] = { x: 0.65, y: 0.45, z: 0 }; // width = 0.08
  arr[386] = { x: 0.61, y: 0.45 - 0.04 * ear, z: 0 };
  arr[374] = { x: 0.61, y: 0.45 + 0.04 * ear, z: 0 };
  arr[473] = {
    x: 0.61 + opts.leftIrisOffsetX,
    y: 0.45 + opts.leftIrisOffsetY,
    z: 0,
  };

  return arr;
}

describe("Gaze Estimation, Outlier-Trimmed 9-Point Calibration & Jitter Stabilization", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("extracts iris direction and rejects blink / low-confidence frames", () => {
    const rightGaze = extractGazeFeaturesFromLandmarks(
      makeSyntheticLandmarks({
        rightIrisOffsetX: -0.015, // front camera image-left => screen-right (+irisX)
        rightIrisOffsetY: 0.008,
        leftIrisOffsetX: -0.015,
        leftIrisOffsetY: 0.008,
        earRatio: 0.3,
      }),
      null,
      null,
      100,
    );
    expect(rightGaze).not.toBeNull();
    expect(rightGaze!.bothEyesDetected).toBe(true);
    expect(rightGaze!.irisX).toBeGreaterThan(0.2);
    expect(rightGaze!.irisY).toBeGreaterThan(0.2);
    expect(rightGaze!.confidence).toBeGreaterThan(0.6);

    const blink = extractGazeFeaturesFromLandmarks(
      makeSyntheticLandmarks({
        rightIrisOffsetX: 0,
        rightIrisOffsetY: 0,
        leftIrisOffsetX: 0,
        leftIrisOffsetY: 0,
        earRatio: 0.06,
      }),
      null,
      [{ categoryName: "eyeBlinkLeft", score: 0.85 }],
      200,
    );
    expect(blink).not.toBeNull();
    expect(blink!.confidence).toBeLessThan(0.2);
  });

  it("achieves high (>85%) calibration accuracy even with handheld noise & outlier frames and stores per orientation", () => {
    const pts = getCalibrationPoints();
    expect(pts).toHaveLength(9);
    expect(Math.min(...pts.map((p) => p.ny))).toBeGreaterThanOrEqual(0.23);

    const samples: GazeCalibrationSample[] = [];
    for (const pt of pts) {
      for (let k = 0; k < 18; k++) {
        const yaw = ((k % 4) - 1.5) * 0.04;
        const pitch = (k % 2 === 0 ? 1 : -1) * 0.025;
        // Inject 2 strong saccade outliers per calibration point + realistic frame jitter
        const isOutlier = k === 0 || k === 1;
        const noiseX = isOutlier ? 0.35 : ((k % 5) - 2) * 0.012;
        const noiseY = isOutlier ? -0.32 : ((k % 3) - 1) * 0.014;
        const irisX = (pt.nx - 0.5) * 0.7 + yaw * 0.35 + noiseX;
        const irisY = (pt.ny - 0.5) * 0.65 - pitch * 0.25 + noiseY;
        samples.push({
          targetNx: pt.nx,
          targetNy: pt.ny,
          sample: {
            irisX,
            irisY,
            eyeOpenness: 0.95,
            bothEyesDetected: true,
            yaw,
            pitch,
            roll: 0,
            confidence: 0.92,
            timestamp: 1000 + samples.length * 50,
          },
        });
      }
    }

    const portraitModel = fitGazeCalibrationModel(samples, "portrait", 390, 844);
    expect(portraitModel).not.toBeNull();
    expect(portraitModel!.version).toBe(2);
    expect(portraitModel!.rmsePx).toBeLessThan(26);
    expect(portraitModel!.accuracyPct).toBeGreaterThanOrEqual(85);

    saveGazeCalibration(portraitModel!);
    expect(loadGazeCalibration("portrait")).toMatchObject({
      version: 2,
      orientation: "portrait",
      accuracyPct: portraitModel!.accuracyPct,
    });
    expect(loadGazeCalibration("landscape")).toBeNull();

    const predictedCorner = predictNormalizedGaze(portraitModel!, {
      irisX: (0.86 - 0.5) * 0.7,
      irisY: (0.25 - 0.5) * 0.65,
      yaw: 0,
      pitch: 0,
    });
    expect(predictedCorner.nx).toBeGreaterThan(0.76);
    expect(predictedCorner.ny).toBeLessThan(0.33);
  });

  it("suppresses single-frame spikes via RollingRawGazeMedianFilter and holds steady inside OneEuro deadband", () => {
    const medianFilter = new RollingRawGazeMedianFilter(3);
    const base: GazeRawSample = {
      irisX: 0.1,
      irisY: 0.2,
      eyeOpenness: 0.95,
      bothEyesDetected: true,
      yaw: 0,
      pitch: 0,
      roll: 0,
      confidence: 0.95,
      timestamp: 100,
    };
    medianFilter.push(base);
    // Single huge outlier spike on frame 2 should not dominate frame 3
    medianFilter.push({ ...base, irisX: 0.85, irisY: -0.75, timestamp: 155 });
    const f3 = medianFilter.push({ ...base, irisX: 0.11, irisY: 0.19, timestamp: 210 });
    expect(f3.irisX).toBeCloseTo(0.11, 2);
    expect(f3.irisY).toBeCloseTo(0.19, 2);

    const euro = new OneEuroGazeFilter();
    const p0 = euro.filter(200, 300, 1000, 0.5);
    expect(p0).toEqual({ x: 200, y: 300 });
    // Micro-jitter inside fixation deadband (~4px) leaves cursor stationary
    const p1 = euro.filter(203, 302, 1055, 0.5);
    expect(p1).toEqual({ x: 200, y: 300 });
    // Deliberate eye shift moves smoothly toward the new target
    const p2 = euro.filter(320, 420, 1110, 0.5);
    expect(p2.x).toBeGreaterThan(205);
    expect(p2.y).toBeGreaterThan(305);
  });
});

describe('Unified Georgian Voice Command Recognition ("გადადი")', () => {
  it("recognizes გადადი variants and ignores ordinary reading speech", () => {
    expect(parseGeorgianGazeCommand("გადადი")).toBe("go");
    expect(parseGeorgianGazeCommand("გადადით")).toBe("go");
    expect(parseGeorgianGazeCommand("გადადი აქ")).toBe("go");
    expect(parseGeorgianGazeCommand("ახლა გადადი მანდ")).toBe("go");
    expect(parseGeorgianGazeCommand("სად არის მისი წყარო")).toBeNull();
    expect(parseGeorgianGazeCommand("რაში ამბობს")).toBeNull();
  });
});

describe("Unified Green, Burgundy, splitWord & Blue-Marker Focus Lock (No Auto-Jump)", () => {
  const spot = (
    id: string,
    word: string,
    section: DhHotspotLike["section"],
    rowId: string,
    x: number,
    topPct = 20,
    isSmallMarker = false,
  ): DhHotspotLike & GazeHotspotLike => ({
    id,
    word,
    section,
    rowId,
    leftPct: x,
    topPct,
    widthPct: 5,
    heightPct: 2,
    glyphH: section === "gemara" ? 12 : 8,
    isSmallMarker,
  });

  const hotspots = [
    // g1: Rashi only (green), g2: dual splitWord (Rashi right + Tosafot left), g5: Tosafot only (burgundy)
    spot("g1", "מאימתי", "gemara", "rg1", 60, 20),
    spot("g2", "קורין", "gemara", "rg1", 53, 20),
    spot("g3", "שמע", "gemara", "rg1", 46, 20),
    spot("g4", "בערבית", "gemara", "rg1", 39, 20),
    spot("g5", "תניא", "gemara", "rg2", 60, 25),
    spot("g6", "נמי", "gemara", "rg2", 53, 25),
    spot("gPlain", "סתם", "gemara", "rg3", 60, 35),
    // Blue markers: small margin marker + citation hotspot inside Rashi
    spot("m1", "(א)", "gemara", "rg1", 67, 20, true),
    spot("cit1", "ברכות", "rashi", "rr2", 80, 30, false),
    // Rashi DH: מאימתי קורין. -> claims g1, g2
    spot("r1", "מאימתי", "rashi", "rr1", 82, 20),
    spot("r2", "קורין.", "rashi", "rr1", 76, 20),
    // Tosafot DH: קורין שמע בערבית. -> claims g2, g3, g4
    spot("t1", "קורין", "tosafot", "rt1", 26, 20),
    spot("t2", "שמע", "tosafot", "rt1", 20, 20),
    spot("t3", "בערבית.", "tosafot", "rt1", 14, 20),
    spot("t3b", "פירוש:", "tosafot", "rt1", 8, 20),
    // Second Tosafot DH: תניא נמי. -> claims g5, g6
    spot("t4", "תניא", "tosafot", "rt2", 20, 25),
    spot("t5", "נמי.", "tosafot", "rt2", 14, 25),
  ];

  const { links, roles } = buildDibburHamatchilLinks(hotspots);
  const linksByKey = new Map(links.map((l) => [l.key, l]));
  const citationHotspotIds = new Set<string>(["m1", "cit1"]);

  const rectMap = new Map<string, GazeRectBox>([
    ["g1", { left: 260, top: 200, right: 320, bottom: 230, width: 60, height: 30 }],
    ["g2", { left: 190, top: 200, right: 250, bottom: 230, width: 60, height: 30 }],
    ["g5", { left: 260, top: 250, right: 320, bottom: 280, width: 60, height: 30 }],
    ["gPlain", { left: 260, top: 350, right: 320, bottom: 380, width: 60, height: 30 }],
    ["m1", { left: 340, top: 202, right: 358, bottom: 224, width: 18, height: 22 }],
    ["cit1", { left: 420, top: 300, right: 475, bottom: 324, width: 55, height: 24 }],
  ]);

  it("resolves green Rashi, burgundy Tosafot, right=Rashi / left=Tosafot splitWord, and all blue markers", () => {
    // 1. Green-only Gemara word
    const hitGreen = resolveGazeTarget({
      clientX: 290,
      clientY: 215,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitGreen?.hotspot.id).toBe("g1");
    expect(hitGreen?.targetKind).toBe("rashi");

    // 2. Burgundy-only Gemara word
    const hitBurgundy = resolveGazeTarget({
      clientX: 290,
      clientY: 265,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitBurgundy?.hotspot.id).toBe("g5");
    expect(hitBurgundy?.targetKind).toBe("tosafot");

    // 3. Dual splitWord (g2: left=190, width=60 -> mid=220):
    // Right half (>= 220) => Rashi; Left half (< 220) => Tosafot
    const hitSplitRight = resolveGazeTarget({
      clientX: 238,
      clientY: 215,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitSplitRight?.hotspot.id).toBe("g2");
    expect(hitSplitRight?.targetKind).toBe("rashi");
    expect(splitSideAt(hitSplitRight!.splitClientX, hitSplitRight!.rect)).toBe("rashi");

    const hitSplitLeft = resolveGazeTarget({
      clientX: 202,
      clientY: 215,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitSplitLeft?.hotspot.id).toBe("g2");
    expect(hitSplitLeft?.targetKind).toBe("tosafot");
    expect(splitSideAt(hitSplitLeft!.splitClientX, hitSplitLeft!.rect)).toBe("tosafot");

    // 4. Small blue marker & blue Daf citation hotspot anywhere on page
    const hitSmallMarker = resolveGazeTarget({
      clientX: 348,
      clientY: 212,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitSmallMarker?.hotspot.id).toBe("m1");
    expect(hitSmallMarker?.targetKind).toBe("blue-marker");

    const hitCitation = resolveGazeTarget({
      clientX: 445,
      clientY: 312,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    });
    expect(hitCitation?.hotspot.id).toBe("cit1");
    expect(hitCitation?.targetKind).toBe("blue-marker");

    // 5. Plain unlinked text far from links returns null
    const hitPlain = resolveGazeTarget({
      clientX: 290,
      clientY: 365,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
      maxRadiusPx: 25,
    });
    expect(hitPlain).toBeNull();
  });

  it("locks focus cleanly without ever auto-jumping and retains focus across blinks", () => {
    const targetGreen = resolveGazeTarget({
      clientX: 290,
      clientY: 215,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    })!;
    const targetBlue = resolveGazeTarget({
      clientX: 348,
      clientY: 212,
      hotspots,
      roles,
      linksByKey,
      citationHotspotIds,
      getRect: (id) => rectMap.get(id) ?? null,
    })!;

    const cfg = { stabilizationMs: 200, minConfidence: 0.45, lockRetentionMs: 1200 };
    let state = createInitialGazeFocusState();

    // Stabilize onto green link
    state = stepGazeTargetFocus(
      state,
      { nowMs: 1000, confidence: 0.9, resolvedTarget: targetGreen },
      cfg,
    );
    expect(state.phase).toBe("stabilizing");
    expect(state.focusedTarget).toBeNull();

    state = stepGazeTargetFocus(
      state,
      { nowMs: 1250, confidence: 0.9, resolvedTarget: targetGreen },
      cfg,
    );
    expect(state.phase).toBe("focused");
    expect(state.focusedTarget?.targetKey).toBe(targetGreen.targetKey);

    // Even looking steadily for several seconds never drops or auto-jumps
    state = stepGazeTargetFocus(
      state,
      { nowMs: 5250, confidence: 0.9, resolvedTarget: targetGreen },
      cfg,
    );
    expect(state.phase).toBe("focused");
    expect(state.focusedTarget?.targetKey).toBe(targetGreen.targetKey);

    // Blink / momentary loss while speaking "გადადი" retains focus up to lockRetentionMs
    state = stepGazeTargetFocus(state, { nowMs: 5850, confidence: 0.1, resolvedTarget: null }, cfg);
    expect(state.phase).toBe("focused");
    expect(state.focusedTarget?.targetKey).toBe(targetGreen.targetKey);

    // Looking to blue marker switches lock once held past stabilizationMs
    state = stepGazeTargetFocus(
      state,
      { nowMs: 5900, confidence: 0.9, resolvedTarget: targetBlue },
      cfg,
    );
    expect(state.focusedTarget?.targetKey).toBe(targetGreen.targetKey); // hysteresis!
    state = stepGazeTargetFocus(
      state,
      { nowMs: 6150, confidence: 0.9, resolvedTarget: targetBlue },
      cfg,
    );
    expect(state.focusedTarget?.targetKey).toBe(targetBlue.targetKey);
  });
});

describe("GazeNavigationOverlay Unified Command & Camera Lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("removes separate Rashi/Tosafot toggles, uses unified გადადი trigger without restarting camera, and stops tracks on disable", async () => {
    const stopTrackSpy = vi.fn();
    const getUserMediaSpy = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrackSpy, onended: null }],
      getVideoTracks: () => [{ stop: stopTrackSpy, onended: null }],
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaSpy },
    });

    type MockRecInstance = {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult:
        | ((ev: { resultIndex: number; results: Array<Array<{ transcript: string }>> }) => void)
        | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    };

    let activeRecognition: MockRecInstance | null = null;
    const captureRecognition = (inst: MockRecInstance) => {
      activeRecognition = inst;
    };
    class MockSpeechRecognition implements MockRecInstance {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: MockRecInstance["onresult"] = null;
      onerror: MockRecInstance["onerror"] = null;
      onend: MockRecInstance["onend"] = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        captureRecognition(this);
      }
    }
    (window as unknown as { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    // Pre-save v2 calibration for current orientation so HUD activates immediately
    const ori = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    saveGazeCalibration({
      version: 2,
      orientation: ori,
      weightsX: Array(7).fill(0),
      weightsY: Array(7).fill(0),
      rmsePx: 8,
      accuracyPct: 95,
      sampleCount: 36,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      calibratedAt: Date.now(),
    });

    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const containerRef = { current: document.createElement("div") };
    const { links, roles } = buildDibburHamatchilLinks([]);

    render(
      <GazeNavigationOverlay
        hotspots={[]}
        dibburLinks={{ byKey: new Map(links.map((l) => [l.key, l])), roles }}
        citationHotspotIds={new Set()}
        pageContainerRef={containerRef}
        isDark={false}
        onExecuteGazeJump={vi.fn(() => true)}
      />,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("talmud-toggle-gaze-hud"));
    });

    await waitFor(() => {
      expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
      expect(activeRecognition).not.toBeNull();
    });

    // Legacy separate Rashi & Tosafot toggles are gone; unified manual "გადადი" button is present
    expect(screen.queryByRole("button", { name: "რაში" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "თოსაფოთი" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /გადადი/ })).toBeInTheDocument();

    // Speak "გადადი" when no target is focused yet -> shows Georgian focus hint, never restarts camera
    act(() => {
      activeRecognition?.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: "გადადი" }]],
      });
    });
    expect(
      screen.getByText(/ბმულზე ფოკუსი არ არის — შეხედეთ მწვანე, ბორდო ან ლურჯ ბმულს/),
    ).toBeInTheDocument();
    expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

    // Disable eye tracking -> stops camera tracks cleanly
    fireEvent.click(screen.getByRole("button", { name: /თვალით ნავიგაცია ჩართულია/ }));
    expect(stopTrackSpy).toHaveBeenCalled();

    delete (window as unknown as { SpeechRecognition?: typeof MockSpeechRecognition })
      .SpeechRecognition;
  });

  it("classifies camera error taxonomy and distinguishes front vs rear tracks cleanly", () => {
    expect(
      classifyCameraError(
        Object.assign(new Error("Permissions policy"), { name: "NotAllowedError" }),
        {
          inIframe: true,
          policyAllowsCamera: false,
        },
      ).kind,
    ).toBe("not-allowed-iframe");

    expect(
      classifyCameraError(Object.assign(new Error("Denied by user"), { name: "NotAllowedError" }), {
        inIframe: false,
        policyAllowsCamera: true,
      }).kind,
    ).toBe("not-allowed-user");

    expect(
      classifyCameraError(Object.assign(new Error("None"), { name: "NotFoundError" }), {
        inIframe: false,
        policyAllowsCamera: true,
      }).kind,
    ).toBe("not-found");

    expect(
      classifyCameraError(Object.assign(new Error("In use"), { name: "NotReadableError" }), {
        inIframe: false,
        policyAllowsCamera: true,
      }).kind,
    ).toBe("not-readable");

    expect(
      classifyCameraError(
        Object.assign(new Error("Bad constraints"), { name: "OverconstrainedError" }),
        {
          inIframe: false,
          policyAllowsCamera: true,
        },
      ).kind,
    ).toBe("overconstrained");

    expect(
      classifyCameraError(Object.assign(new Error("Insecure"), { name: "SecurityError" }), {
        inIframe: false,
        policyAllowsCamera: true,
      }).kind,
    ).toBe("security");

    expect(
      isTrackLikelyRearCamera({
        label: "camera2 0, facing back",
        getSettings: () => ({ facingMode: "environment" }),
      } as unknown as MediaStreamTrack),
    ).toBe(true);

    expect(
      isTrackLikelyRearCamera({
        label: "camera2 1, facing front",
        getSettings: () => ({ facingMode: "user" }),
      } as unknown as MediaStreamTrack),
    ).toBe(false);

    expect(isBenignMediapipeLog(["INFO: Created TensorFlow Lite XNNPACK delegate for CPU."])).toBe(
      true,
    );
    expect(
      isBenignMediapipeLog([
        "WARNING: All log messages before absl::InitializeLog() is called are written to STDERR",
      ]),
    ).toBe(true);
    expect(isBenignMediapipeLog(["[vilna-pdf] Failed to fetch PDF: 400"])).toBe(false);
    expect(isBenignMediapipeLog([new Error("Real error")])).toBe(false);
  });

  it("shows Retry and standalone-tab recovery on NotAllowedError, retries cleanly without looping, and stops camera on calibration close", async () => {
    const stopTrackSpy = vi.fn();
    const deniedErr = Object.assign(new Error("Permission dismissed"), {
      name: "NotAllowedError",
    });

    const getUserMediaSpy = vi
      .fn()
      .mockRejectedValueOnce(deniedErr)
      .mockResolvedValue({
        getTracks: () => [
          {
            stop: stopTrackSpy,
            onended: null,
            readyState: "live",
            label: "camera2 1, facing front",
            getSettings: () => ({ facingMode: "user" }),
          },
        ],
        getVideoTracks: () => [
          {
            stop: stopTrackSpy,
            onended: null,
            readyState: "live",
            label: "camera2 1, facing front",
            getSettings: () => ({ facingMode: "user" }),
          },
        ],
      });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaSpy },
    });

    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const containerRef = { current: document.createElement("div") };
    const { links, roles } = buildDibburHamatchilLinks([]);

    render(
      <GazeNavigationOverlay
        hotspots={[]}
        dibburLinks={{ byKey: new Map(links.map((l) => [l.key, l])), roles }}
        citationHotspotIds={new Set()}
        pageContainerRef={containerRef}
        isDark={false}
        onExecuteGazeJump={vi.fn(() => true)}
      />,
    );

    // Enabling without saved calibration opens the 9-point calibration dialog
    act(() => {
      window.dispatchEvent(new CustomEvent("talmud-toggle-gaze-hud"));
    });

    await waitFor(() => {
      expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog", { name: /კალიბრაცია/ })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "თავიდან ცდა" }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /ახალ ჩანართში გახსნა/ }).length).toBeGreaterThan(
        0,
      );
    });

    // Must NOT loop getUserMedia automatically after denial
    expect(getUserMediaSpy).toHaveBeenCalledTimes(1);

    // User grants permission and taps Retry inside modal
    const retryButtons = screen.getAllByRole("button", { name: "თავიდან ცდა" });
    fireEvent.click(retryButtons[retryButtons.length - 1]!);

    await waitFor(() => {
      expect(getUserMediaSpy).toHaveBeenCalledTimes(2);
    });

    // Closing calibration dialog stops active camera tracks immediately
    fireEvent.click(screen.getByRole("button", { name: "კალიბრაციის დახურვა" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /კალიბრაცია/ })).not.toBeInTheDocument();
    });
    expect(stopTrackSpy).toHaveBeenCalled();
  });
});
