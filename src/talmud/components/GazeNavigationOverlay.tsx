import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Camera,
  Check,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { DhHotspotRole, DhLink } from "../utils/dibburHamatchilMatcher";
import {
  fitGazeCalibrationModel,
  getCalibrationPoints,
  loadGazeCalibration,
  loadGazeSettings,
  saveGazeCalibration,
  saveGazeSettings,
  type GazeCalibrationModel,
  type GazeCalibrationSample,
  type GazeSettings,
  type ScreenOrientationType,
} from "../utils/gazeCalibrationEngine";
import {
  createInitialGazeFocusState,
  resolveGazeTarget,
  stepGazeTargetFocus,
  type GazeFocusState,
  type GazeHotspotLike,
  type GazeTargetKind,
  type ResolvedGazeTarget,
} from "../utils/gazeGemaraTargetResolver";
import {
  isSpeechRecognitionSupported,
  VoiceCommandController,
  type VoiceListenerStatus,
} from "../utils/voiceCommandListener";
import { useEyeTrackingEngine } from "../utils/useEyeTrackingEngine";

export interface GazeOverlayHotspot extends GazeHotspotLike {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

interface GazeNavigationOverlayProps<T extends GazeOverlayHotspot> {
  hotspots: T[];
  dibburLinks: {
    byKey: Map<string, DhLink>;
    roles: Map<string, DhHotspotRole>;
  };
  citationHotspotIds?: Set<string>;
  pageContainerRef: React.RefObject<HTMLDivElement | null>;
  isDark: boolean;
  isFullScreen?: boolean;
  onExecuteGazeJump: (target: ResolvedGazeTarget<T>) => boolean;
}

const SAMPLES_PER_POINT = 20;
const POINT_SETTLE_DELAY_MS = 620;

const TARGET_LABEL_KA: Record<GazeTargetKind, string> = {
  rashi: "რაში",
  tosafot: "თოსაფოთი",
  "blue-marker": "ლურჯი ნიშნული",
};

const TARGET_ACCENT_HEX: Record<GazeTargetKind, string> = {
  rashi: "#059669",
  tosafot: "#9F1239",
  "blue-marker": "#1D4ED8",
};

const TARGET_FILL_RGBA: Record<GazeTargetKind, string> = {
  rashi: "rgba(5, 150, 105, 0.17)",
  tosafot: "rgba(159, 18, 57, 0.17)",
  "blue-marker": "rgba(29, 78, 216, 0.19)",
};

export function GazeNavigationOverlay<T extends GazeOverlayHotspot>({
  hotspots,
  dibburLinks,
  citationHotspotIds,
  pageContainerRef,
  isDark,
  isFullScreen = false,
  onExecuteGazeJump,
}: GazeNavigationOverlayProps<T>) {
  const [hudOpen, setHudOpen] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [settings, setSettings] = useState<GazeSettings>(() => loadGazeSettings());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [commandBanner, setCommandBanner] = useState<{ text: string; isWarning?: boolean } | null>(
    null,
  );
  const [voiceStatus, setVoiceStatus] = useState<VoiceListenerStatus>(() =>
    isSpeechRecognitionSupported() ? "off" : "unsupported",
  );

  // Per-orientation calibrated mapping model
  const [activeCalibration, setActiveCalibration] = useState<GazeCalibrationModel | null>(() =>
    typeof window !== "undefined"
      ? loadGazeCalibration(window.innerWidth > window.innerHeight ? "landscape" : "portrait")
      : null,
  );

  // Non-jumping focus lock state
  const focusRef = useRef<GazeFocusState<T>>(createInitialGazeFocusState<T>());
  const [focusState, setFocusState] = useState<GazeFocusState<T>>(() =>
    createInitialGazeFocusState<T>(),
  );
  const isNavigatingRef = useRef<boolean>(false);

  const cancelActiveFocus = useCallback(() => {
    const empty = createInitialGazeFocusState<T>();
    focusRef.current = empty;
    setFocusState(empty);
  }, []);

  const handleOrientationChange = useCallback(
    (nextOrientation: ScreenOrientationType) => {
      const saved = loadGazeCalibration(nextOrientation);
      setActiveCalibration(saved);
      cancelActiveFocus();
    },
    [cancelActiveFocus],
  );

  const {
    videoRef,
    activeStream,
    status: cameraStatus,
    errorKind: cameraErrorKind,
    errorMessage: cameraError,
    isEmbeddedFrame,
    orientation,
    receivingFrames,
    faceDetected,
    bothEyesDetected,
    liveGaze,
    latestRawSample,
    retryCamera,
  } = useEyeTrackingEngine({
    enabled,
    calibration: activeCalibration,
    sensitivity: settings.sensitivity,
    onOrientationChange: handleOrientationChange,
  });

  const [showCameraPreview, setShowCameraPreview] = useState<boolean>(true);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const previewEl = previewVideoRef.current;
    if (!previewEl) return;
    if (calibrating && showCameraPreview && activeStream) {
      if (previewEl.srcObject !== activeStream) {
        previewEl.srcObject = activeStream;
      }
      previewEl.muted = true;
      previewEl.playsInline = true;
      void previewEl.play().catch(() => {});
    } else if (previewEl.srcObject) {
      try {
        previewEl.pause();
        previewEl.srcObject = null;
      } catch {
        // ignore
      }
    }
    return () => {
      if (previewEl.srcObject) {
        try {
          previewEl.pause();
          previewEl.srcObject = null;
        } catch {
          // ignore
        }
      }
    };
  }, [calibrating, showCameraPreview, activeStream]);

  // Sync calibration when orientation initializes or changes
  useEffect(() => {
    setActiveCalibration(loadGazeCalibration(orientation));
  }, [orientation]);

  // Cache live hotspot bounding rects on scroll / zoom / resize for fast per-frame lookup
  const rectMapRef = useRef<Map<string, DOMRect>>(new Map());
  const rectsDirtyRef = useRef<boolean>(true);

  const invalidateRects = useCallback(() => {
    rectsDirtyRef.current = true;
  }, []);

  useEffect(() => {
    invalidateRects();
  }, [hotspots, isFullScreen, invalidateRects]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onGeometryChange = () => {
      rectsDirtyRef.current = true;
    };
    window.addEventListener("scroll", onGeometryChange, true);
    window.addEventListener("resize", onGeometryChange);
    window.addEventListener("talmud-zoom-state-change", onGeometryChange);
    window.addEventListener("talmud-focus-target-pct", onGeometryChange);
    return () => {
      window.removeEventListener("scroll", onGeometryChange, true);
      window.removeEventListener("resize", onGeometryChange);
      window.removeEventListener("talmud-zoom-state-change", onGeometryChange);
      window.removeEventListener("talmud-focus-target-pct", onGeometryChange);
    };
  }, [enabled]);

  const measureVisibleHotspotRects = useCallback(() => {
    const container = pageContainerRef.current;
    if (!container) return;
    const map = new Map<string, DOMRect>();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Measure both Gemara/Mishnah Rashi+Tosafot links and ALL Blue reference markers/citations.
    const nodes = container.querySelectorAll<HTMLElement>(
      '[data-dibbur-link="true"], .talmud-blue-marker',
    );
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes.item(i);
      if (!el) continue;
      const isBlue = el.classList.contains("talmud-blue-marker");
      const sec = el.dataset["section"];
      if (!isBlue && sec !== "gemara" && sec !== "mishnah") continue;
      const id = el.id.replace(/^pdf-hotspot-/, "");
      if (!id) continue;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -40 || rect.top > vh + 40 || rect.right < -40 || rect.left > vw + 40) {
        continue;
      }
      map.set(id, rect);
    }
    rectMapRef.current = map;
    rectsDirtyRef.current = false;
  }, [pageContainerRef]);

  // Execute navigation ONLY when explicitly triggered by "გადადი" voice command or manual button tap
  const executeFocusedJump = useCallback(
    (source: "voice" | "button", spokenPhrase?: string): boolean => {
      const target = focusRef.current.focusedTarget ?? focusRef.current.candidateTarget;
      if (!target) {
        setCommandBanner({
          text: "ბმულზე ფოკუსი არ არის — შეხედეთ მწვანე, ბორდო ან ლურჯ ბმულს",
          isWarning: true,
        });
        return false;
      }

      isNavigatingRef.current = true;
      const jumped = onExecuteGazeJump(target);
      if (jumped) {
        const destLabel = TARGET_LABEL_KA[target.targetKind];
        setCommandBanner({
          text:
            source === "voice" && spokenPhrase
              ? `ხმოვანი ბრძანება: „${spokenPhrase}“ → ${destLabel}`
              : `გადასვლა → ${destLabel}`,
        });
        cancelActiveFocus();
      } else {
        setCommandBanner({
          text: "არჩეულ ბმულზე გადასვლა ვერ შესრულდა",
          isWarning: true,
        });
      }

      window.setTimeout(() => {
        isNavigatingRef.current = false;
        rectsDirtyRef.current = true;
      }, 650);
      return jumped;
    },
    [cancelActiveFocus, onExecuteGazeJump],
  );

  // Voice Command Listener: listens continuously for unified "გადადი" while tracking is enabled
  const voiceControllerRef = useRef<VoiceCommandController | null>(null);
  useEffect(() => {
    if (!enabled || calibrating || !settings.voiceCommandsEnabled) {
      if (voiceControllerRef.current) {
        voiceControllerRef.current.stop();
        voiceControllerRef.current = null;
      }
      setVoiceStatus(isSpeechRecognitionSupported() ? "off" : "unsupported");
      return;
    }

    const controller = new VoiceCommandController({
      onCommand: (_cmd, transcript) => {
        executeFocusedJump("voice", transcript);
      },
      onStatusChange: (nextStatus) => {
        setVoiceStatus(nextStatus);
      },
    });
    voiceControllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      voiceControllerRef.current = null;
    };
  }, [enabled, calibrating, settings.voiceCommandsEnabled, executeFocusedJump]);

  // Clear command feedback banner after 2.8s
  useEffect(() => {
    if (!commandBanner) return;
    const t = setTimeout(() => setCommandBanner(null), 2800);
    return () => clearTimeout(t);
  }, [commandBanner]);

  // Resolve and lock gaze target on each frame — strictly ZERO automatic jumps
  useEffect(() => {
    if (!enabled || calibrating || cameraStatus !== "active" || !liveGaze) {
      if (focusRef.current.phase !== "idle") {
        cancelActiveFocus();
      }
      return;
    }

    if (rectsDirtyRef.current || rectMapRef.current.size === 0) {
      measureVisibleHotspotRects();
    }

    const maxRadius = Math.max(32, Math.min(54, Math.round(window.innerWidth * 0.09)));
    const resolved = resolveGazeTarget({
      clientX: liveGaze.clientX,
      clientY: liveGaze.clientY,
      hotspots,
      roles: dibburLinks.roles,
      linksByKey: dibburLinks.byKey,
      citationHotspotIds,
      getRect: (id) => rectMapRef.current.get(id) ?? null,
      maxRadiusPx: maxRadius,
    });

    const nextFocus = stepGazeTargetFocus(
      focusRef.current,
      {
        nowMs: liveGaze.timestamp,
        confidence: liveGaze.confidence,
        resolvedTarget: resolved,
        isExecutingNavigation: isNavigatingRef.current,
      },
      {
        stabilizationMs: settings.stabilizationMs,
        minConfidence: settings.minConfidence,
      },
    );

    focusRef.current = nextFocus;
    setFocusState(nextFocus);
  }, [
    enabled,
    calibrating,
    cameraStatus,
    liveGaze,
    hotspots,
    dibburLinks,
    citationHotspotIds,
    settings,
    measureVisibleHotspotRects,
    cancelActiveFocus,
  ]);

  // 9-Point Calibration state & sample collector
  const calibrationPoints = useMemo(() => getCalibrationPoints(), []);
  const [calibStepIdx, setCalibStepIdx] = useState<number>(0);
  const [calibProgressCount, setCalibProgressCount] = useState<number>(0);
  const [calibSummary, setCalibSummary] = useState<{
    rmsePx: number;
    accuracyPct: number;
  } | null>(null);
  const [calibError, setCalibError] = useState<string | null>(null);
  const calibSamplesRef = useRef<GazeCalibrationSample[]>([]);
  const calibStepStartedAtRef = useRef<number>(0);
  const lastSampleTsRef = useRef<number>(0);

  const calibrationReady =
    cameraStatus === "active" && receivingFrames && faceDetected && bothEyesDetected;

  const startCalibration = useCallback(() => {
    calibSamplesRef.current = [];
    calibStepStartedAtRef.current = performance.now();
    lastSampleTsRef.current = 0;
    setCalibStepIdx(0);
    setCalibProgressCount(0);
    setCalibSummary(null);
    setCalibError(null);
    setCalibrating(true);
    cancelActiveFocus();
    if (cameraStatus === "denied" || cameraStatus === "interrupted" || cameraStatus === "error") {
      retryCamera();
    }
  }, [cameraStatus, cancelActiveFocus, retryCamera]);

  const handleCloseCalibration = useCallback(() => {
    // Closing the calibration modal stops all active camera tracks immediately.
    setCalibrating(false);
    setEnabled(false);
    setHudOpen(false);
    setSettingsOpen(false);
    cancelActiveFocus();
  }, [cancelActiveFocus]);

  // Reset point settle timer cleanly whenever readiness transitions from unready -> ready
  const wasCalibReadyRef = useRef<boolean>(false);
  useEffect(() => {
    if (calibrating && calibrationReady && !wasCalibReadyRef.current) {
      calibStepStartedAtRef.current = performance.now();
    }
    wasCalibReadyRef.current = calibrating && calibrationReady;
  }, [calibrating, calibrationReady]);

  // Collect samples cleanly only after camera stream, frames, face, and both eyes are verified
  useEffect(() => {
    if (!calibrating || calibSummary || !calibrationReady || !latestRawSample) return;
    if (latestRawSample.timestamp === lastSampleTsRef.current) return;
    lastSampleTsRef.current = latestRawSample.timestamp;

    // Wait briefly after dot jumps so user's saccade lands cleanly on target point
    if (performance.now() - calibStepStartedAtRef.current < POINT_SETTLE_DELAY_MS) return;
    if (latestRawSample.confidence < 0.35) return;

    const pt = calibrationPoints[calibStepIdx];
    if (!pt) return;

    calibSamplesRef.current.push({
      targetNx: pt.nx,
      targetNy: pt.ny,
      sample: latestRawSample,
    });

    const collectedForPoint = calibSamplesRef.current.filter(
      (s) => s.targetNx === pt.nx && s.targetNy === pt.ny,
    ).length;
    setCalibProgressCount(collectedForPoint);

    if (collectedForPoint >= SAMPLES_PER_POINT) {
      if (calibStepIdx + 1 < calibrationPoints.length) {
        calibStepStartedAtRef.current = performance.now();
        setCalibStepIdx(calibStepIdx + 1);
        setCalibProgressCount(0);
      } else {
        const fitted = fitGazeCalibrationModel(
          calibSamplesRef.current,
          orientation,
          window.innerWidth,
          window.innerHeight,
        );
        if (!fitted) {
          setCalibError("კალიბრაციის მონაცემები არასაკმარისია — სცადეთ კარგ განათებაზე თავიდან.");
          return;
        }
        saveGazeCalibration(fitted);
        setActiveCalibration(fitted);
        setCalibSummary({ rmsePx: fitted.rmsePx, accuracyPct: fitted.accuracyPct });
      }
    }
  }, [
    calibrating,
    calibSummary,
    calibrationReady,
    latestRawSample,
    calibStepIdx,
    calibrationPoints,
    orientation,
  ]);

  const closeGazeHud = useCallback(() => {
    setHudOpen(false);
    setEnabled(false);
    setCalibrating(false);
    setSettingsOpen(false);
    cancelActiveFocus();
  }, [cancelActiveFocus]);

  const handleToggleEyeTracking = () => {
    if (enabled) {
      setEnabled(false);
      setCalibrating(false);
      setSettingsOpen(false);
      cancelActiveFocus();
      return;
    }
    setEnabled(true);
    const saved = loadGazeCalibration(orientation);
    setActiveCalibration(saved);
    if (!saved) {
      startCalibration();
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("talmud-gaze-hud-state", { detail: { open: hudOpen, enabled } }),
    );
  }, [hudOpen, enabled]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("talmud-gaze-hud-state", { detail: { open: false, enabled: false } }),
        );
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onToggleHud = () => {
      if (hudOpen) {
        closeGazeHud();
        return;
      }
      setHudOpen(true);
      setEnabled(true);
      const saved = loadGazeCalibration(orientation);
      setActiveCalibration(saved);
      if (!saved) {
        startCalibration();
      }
    };
    const onOtherTopDrawerState = (e: Event) => {
      if ((e as CustomEvent<{ open?: boolean }>).detail?.open) {
        closeGazeHud();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hudOpen && !calibrating) {
        closeGazeHud();
      }
    };
    window.addEventListener("talmud-toggle-gaze-hud", onToggleHud);
    window.addEventListener("talmud-daf-search-state", onOtherTopDrawerState);
    window.addEventListener("talmud-audio-sync-state", onOtherTopDrawerState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("talmud-toggle-gaze-hud", onToggleHud);
      window.removeEventListener("talmud-daf-search-state", onOtherTopDrawerState);
      window.removeEventListener("talmud-audio-sync-state", onOtherTopDrawerState);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hudOpen, calibrating, orientation, closeGazeHud, startCalibration]);

  const updateSettings = (patch: Partial<GazeSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveGazeSettings(next);
      return next;
    });
  };

  const displayTarget = focusState.focusedTarget ?? focusState.candidateTarget;
  const activeFocusTarget = focusState.focusedTarget;

  const candidateHighlightBoxes = useMemo(() => {
    if (!displayTarget || !pageContainerRef.current) return [];
    if (displayTarget.link && displayTarget.link.mainIds.length > 0) {
      const mainSet = new Set(displayTarget.link.mainIds);
      return hotspots
        .filter((h) => mainSet.has(h.id))
        .map((h) => ({
          id: h.id,
          leftPct: h.leftPct,
          topPct: h.topPct,
          widthPct: h.widthPct,
          heightPct: h.heightPct,
        }));
    }
    return [
      {
        id: displayTarget.hotspot.id,
        leftPct: displayTarget.hotspot.leftPct,
        topPct: displayTarget.hotspot.topPct,
        widthPct: displayTarget.hotspot.widthPct,
        heightPct: displayTarget.hotspot.heightPct,
      },
    ];
  }, [displayTarget, hotspots, pageContainerRef]);

  const activeAccentHex = displayTarget ? TARGET_ACCENT_HEX[displayTarget.targetKind] : "#D97706";
  const activeFillRgba = displayTarget
    ? TARGET_FILL_RGBA[displayTarget.targetKind]
    : "rgba(217, 119, 6, 0.14)";

  const statusTextKa =
    cameraStatus === "loading-model"
      ? "მოდელი იტვირთება..."
      : cameraStatus === "requesting-camera"
        ? "კამერის მოთხოვნა..."
        : cameraStatus === "paused"
          ? "დაპაუზებულია"
          : !faceDetected && cameraStatus === "active"
            ? "სახე ვერ ჩანს"
            : activeFocusTarget
              ? `ფოკუსი: ${TARGET_LABEL_KA[activeFocusTarget.targetKind]}`
              : focusState.candidateTarget
                ? `სტაბილიზაცია: ${TARGET_LABEL_KA[focusState.candidateTarget.targetKind]}`
                : "შეხედეთ ბმულს";

  const manualJumpTarget = focusState.focusedTarget ?? focusState.candidateTarget;
  const manualButtonBgClass =
    manualJumpTarget?.targetKind === "rashi"
      ? "bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-400/50"
      : manualJumpTarget?.targetKind === "tosafot"
        ? "bg-rose-800 hover:bg-rose-700 text-white border-rose-400/50"
        : manualJumpTarget?.targetKind === "blue-marker"
          ? "bg-blue-700 hover:bg-blue-600 text-white border-blue-400/50"
          : isDark
            ? "bg-[#2E1F15] text-stone-400 border-white/10"
            : "bg-[#EFE5D0] text-stone-500 border-[#8B5A2B]/20";

  const renderControlBar =
    typeof document !== "undefined" &&
    createPortal(
      <AnimatePresence>
        {hudOpen && !calibrating && (
          <motion.div
            key="gaze-hud-top-bar"
            data-gaze-hud="true"
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.85 }}
            onClick={(e) => e.stopPropagation()}
            className="fixed top-0 left-0 right-0 z-[400] w-full"
          >
            <div
              className={`w-full border-b shadow-[var(--study-shadow)] backdrop-blur-xl transition-colors ${
                isDark
                  ? "bg-[#1D140E]/95 border-[#C49A6C]/40 text-[#FAF5EB]"
                  : "bg-[#FDF9F1]/96 border-[#8B5A2B]/30 text-[#2B1B10]"
              }`}
            >
              <div className="mx-auto flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 sm:px-4 lg:px-6 max-w-6xl">
      {/* Left: Eye Tracking Power + Unified Manual "გადადი" Button */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggleEyeTracking}
          aria-pressed={enabled}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
            enabled
              ? "bg-[#B45309] text-[#FAF5EB] shadow-xs"
              : isDark
                ? "bg-[#2E1F15] hover:bg-[#3A281C] text-amber-100 border border-[#C49A6C]/35"
                : "bg-[#EFE3CA] hover:bg-[#E5D4B5] text-[#2C180B] border border-[#8B5A2B]/30"
          }`}
        >
          {enabled ? (
            <Eye className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <EyeOff className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{enabled ? "თვალით ნავიგაცია ჩართულია" : "თვალით ნავიგაცია"}</span>
        </button>

        {enabled && (
          <button
            type="button"
            onClick={() => executeFocusedJump("button")}
            disabled={!manualJumpTarget}
            title="თქვით „გადადი“ ან დააჭირეთ ღილაკს ფოკუსირებულ ბმულზე გადასასვლელად"
            className={`min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed transition-colors ${manualButtonBgClass}`}
          >
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            <span>
              {manualJumpTarget
                ? `გადადი · ${TARGET_LABEL_KA[manualJumpTarget.targetKind]}`
                : "გადადი"}
            </span>
          </button>
        )}
      </div>

      {/* Right: Status, Voice, Calibrate, Settings, Close */}
      <div className="flex flex-wrap items-center gap-1.5 relative">
      {enabled && (
        <>
          <span className="text-[11px] font-bold opacity-85 whitespace-nowrap px-1 tabular-nums">
            {statusTextKa}
            {activeCalibration ? ` · ${activeCalibration.accuracyPct}%` : " · დასაკალიბრებელი"}
          </span>

          <button
            type="button"
            onClick={() => updateSettings({ voiceCommandsEnabled: !settings.voiceCommandsEnabled })}
            aria-pressed={settings.voiceCommandsEnabled}
            disabled={voiceStatus === "unsupported"}
            title={
              voiceStatus === "unsupported"
                ? "ხმოვანი ამოცნობა ამ ბრაუზერში მიუწვდომელია — გამოიყენეთ „გადადი“ ღილაკი"
                : "ხმოვანი ბრძანება: „გადადი“"
            }
            className={`min-h-[38px] px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
              settings.voiceCommandsEnabled && voiceStatus === "listening"
                ? "bg-sky-700 text-white border-sky-400"
                : isDark
                  ? "bg-[#2E1F15] border-[#C49A6C]/35"
                  : "bg-[#EFE3CA] border-[#8B5A2B]/30"
            }`}
          >
            {settings.voiceCommandsEnabled && voiceStatus === "listening" ? (
              <Mic className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <MicOff className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{voiceStatus === "unsupported" ? "ხმა N/A" : "ხმა"}</span>
          </button>

          <button
            type="button"
            onClick={startCalibration}
            className={`min-h-[38px] px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer ${
              !activeCalibration
                ? "bg-amber-600 text-white border-amber-300"
                : isDark
                  ? "bg-[#2E1F15] hover:bg-[#3A281C] border-[#C49A6C]/35"
                  : "bg-[#EFE3CA] hover:bg-[#E5D4B5] border-[#8B5A2B]/30"
            }`}
          >
            <Crosshair className="w-3.5 h-3.5 shrink-0" />
            <span>კალიბრაცია</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-label="თვალის თვალთვალის პარამეტრები"
            className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg border flex items-center justify-center cursor-pointer ${
              isDark
                ? "bg-[#2E1F15] hover:bg-[#3A281C] border-[#C49A6C]/35"
                : "bg-[#EFE3CA] hover:bg-[#E5D4B5] border-[#8B5A2B]/30"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {settingsOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute right-0 top-11 z-[240] w-72 rounded-xl border p-3 shadow-2xl space-y-3 ${
                isDark
                  ? "bg-[#1A110B] border-[#C49A6C]/50 text-[#FAF5EB]"
                  : "bg-[#FFFDF8] border-[#8B5A2B]/40 text-[#2B1B10]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold">თვალის ნავიგაციის პარამეტრები</span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="დახურვა"
                  className="p-1 rounded-md hover:bg-black/10 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <label className="block space-y-1 text-[11px] font-bold">
                <div className="flex justify-between tabular-nums">
                  <span>ფოკუსის სტაბილიზაცია</span>
                  <span>{settings.stabilizationMs} ms</span>
                </div>
                <input
                  type="range"
                  min={140}
                  max={420}
                  step={20}
                  value={settings.stabilizationMs}
                  onChange={(e) => updateSettings({ stabilizationMs: Number(e.target.value) })}
                  className="w-full accent-amber-600 cursor-pointer"
                />
              </label>

              <label className="block space-y-1 text-[11px] font-bold">
                <div className="flex justify-between tabular-nums">
                  <span>მგრძნობელობა / სიგლუვე</span>
                  <span>{Math.round(settings.sensitivity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={Math.round(settings.sensitivity * 100)}
                  onChange={(e) => updateSettings({ sensitivity: Number(e.target.value) / 100 })}
                  className="w-full accent-amber-600 cursor-pointer"
                />
              </label>

              <div className="pt-1 border-t border-amber-500/20 text-[10.5px] opacity-80 space-y-1">
                <div>ორიენტაცია: {orientation === "portrait" ? "პორტრეტი" : "ლანდშაფტი"}</div>
                <div>
                  ფოკუსი ავტომატურად არ ხტება — გადასასვლელად თქვით „გადადი“ ან დააჭირეთ ღილაკს.
                </div>
                <div>კამერის დამუშავება მიმდინარეობს 100% ლოკალურად მოწყობილობაზე.</div>
              </div>
            </div>
          )}
        </>
      )}
        <button
          type="button"
          onClick={closeGazeHud}
          aria-label="თვალით ნავიგაციის დახურვა"
          className={`min-h-[38px] min-w-[38px] p-1.5 rounded-lg border flex items-center justify-center cursor-pointer transition-colors ${
            isDark
              ? "bg-[#2E1F15] hover:bg-[#3A281C] border-[#C49A6C]/35"
              : "bg-[#EFE3CA] hover:bg-[#E5D4B5] border-[#8B5A2B]/30"
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Camera permission / runtime warning banner */}
      {enabled && cameraError && (
        <div className="w-full pt-1.5 border-t border-rose-500/25 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-rose-600 dark:text-rose-300">
          <span className="flex-1 min-w-[200px]">{cameraError}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {(cameraStatus === "denied" ||
              cameraStatus === "interrupted" ||
              cameraStatus === "error" ||
              cameraStatus === "insecure-context") && (
              <button
                type="button"
                onClick={retryCamera}
                className="min-h-[38px] px-3 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold whitespace-nowrap cursor-pointer"
              >
                თავიდან ცდა
              </button>
            )}
            {(isEmbeddedFrame ||
              cameraStatus === "denied" ||
              cameraErrorKind === "not-allowed-iframe" ||
              cameraErrorKind === "security") &&
              typeof window !== "undefined" && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[38px] px-2.5 py-1 rounded-md border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-bold flex items-center gap-1 whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span>ახალ ჩანართში გახსნა</span>
                </a>
              )}
          </div>
        </div>
      )}

      {/* Voice / manual jump feedback */}
      {enabled && commandBanner && (
        <div
          className={`w-full text-[11px] font-bold ${
            commandBanner.isWarning
              ? "text-amber-600 dark:text-amber-300"
              : "text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {commandBanner.text}
        </div>
      )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    );

  // Subtle highlight overlay inside the Vilna PDF canvas when a target link or blue marker is focused
  const renderCandidateOverlay =
    enabled &&
    !calibrating &&
    candidateHighlightBoxes.length > 0 &&
    pageContainerRef.current &&
    createPortal(
      <div
        aria-hidden="true"
        data-gaze-candidate-highlight="true"
        data-gaze-target-kind={displayTarget?.targetKind}
        className="absolute inset-0 z-27 pointer-events-none"
      >
        {candidateHighlightBoxes.map((b) => (
          <div
            key={`gaze-cand-${b.id}`}
            style={{
              left: `${b.leftPct}%`,
              top: `${b.topPct}%`,
              width: `${b.widthPct}%`,
              height: `${b.heightPct}%`,
              backgroundColor: activeFillRgba,
              borderBottom: `2px solid ${activeAccentHex}`,
            }}
            className="absolute rounded-[2px] transition-opacity duration-150"
          />
        ))}
      </div>,
      pageContainerRef.current,
    );

  // Subtle Steady Gaze Dot — shows locked focus color without any auto-jump dwell countdown ring
  const isLockedFocus = Boolean(activeFocusTarget);
  const renderGazeDot =
    enabled &&
    !calibrating &&
    cameraStatus === "active" &&
    liveGaze &&
    liveGaze.confidence >= settings.minConfidence * 0.65 &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        aria-hidden="true"
        data-gaze-reticle="true"
        data-gaze-focused={isLockedFocus ? "true" : "false"}
        style={{
          position: "fixed",
          left: `${liveGaze.clientX}px`,
          top: `${liveGaze.clientY}px`,
          transform: "translate(-50%, -50%)",
          zIndex: 9950,
        }}
        className="pointer-events-none flex items-center justify-center"
      >
        <span
          style={{
            borderColor: isLockedFocus ? activeAccentHex : "rgba(255,255,255,0.5)",
            backgroundColor: isLockedFocus ? `${activeAccentHex}26` : "transparent",
          }}
          className={`rounded-full border-2 transition-colors duration-150 ${
            isLockedFocus ? "w-7 h-7" : "w-6 h-6"
          }`}
        />
        <span
          style={{ backgroundColor: activeAccentHex }}
          className="absolute w-2.5 h-2.5 rounded-full border border-white/85 shadow-sm transition-colors duration-150"
        />
      </div>,
      document.body,
    );

  // 9-Point Fullscreen Orientation Calibration Overlay
  const activePoint = calibrationPoints[calibStepIdx];
  const pointProgressRatio = Math.min(1, calibProgressCount / SAMPLES_PER_POINT);

  const calibrationStatusText = cameraError
    ? cameraError
    : calibSummary
      ? `კალიბრაცია დასრულდა · სიზუსტე: ${calibSummary.accuracyPct}% (~${calibSummary.rmsePx} px)`
      : cameraStatus === "loading-model"
        ? "თვალის თვალთვალის მოდელი იტვირთება..."
        : cameraStatus === "requesting-camera"
          ? "წინა კამერის ჩართვა და ნებართვის მოთხოვნა..."
          : cameraStatus === "active" && !receivingFrames
            ? "კამერის ვიდეო კადრების მოლოდინში..."
            : cameraStatus === "active" && !faceDetected
              ? "სახე ვერ ამოვიცანი. გაასწორეთ ტელეფონი სახის პირდაპირ და უზრუნველყავით საკმარისი განათება."
              : cameraStatus === "active" && !bothEyesDetected
                ? "ორივე თვალი მკაფიოდ უნდა ჩანდეს — გაასწორეთ განათება და კუთხე."
                : calibrationReady
                  ? `შეხედეთ მონიშნულ წერტილს თავის მინიმალური მოძრაობით (${calibStepIdx + 1}/9)`
                  : "მზადყოფნის შემოწმება...";

  const standaloneUrl = typeof window !== "undefined" ? window.location.href : "#";

  const renderCalibrationModal =
    calibrating &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="9-წერტილიანი თვალის კალიბრაცია"
        data-gaze-calibration-modal="true"
        style={{ zIndex: 9995 }}
        className="fixed inset-0 bg-stone-950/92 text-stone-100 backdrop-blur-md flex flex-col justify-between p-3 sm:p-4 select-none"
      >
        {/* Top bar kept compact above upper calibration dot safe line (top 25% band) */}
        <div className="max-w-2xl w-full mx-auto z-20 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-xs sm:text-sm font-extrabold leading-tight truncate">
                თვალის 9-წერტილიანი კალიბრაცია (
                {orientation === "portrait" ? "პორტრეტი" : "ლანდშაფტი"})
              </h2>
              <p className="text-[11px] sm:text-xs text-stone-300 leading-snug mt-0.5 line-clamp-2">
                {calibrationStatusText}
              </p>
              {!calibSummary && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-stone-400 mt-1 tabular-nums">
                  <span className={cameraStatus === "active" ? "text-emerald-400" : ""}>
                    კამერა {cameraStatus === "active" ? "✓" : "·"}
                  </span>
                  <span>/</span>
                  <span className={receivingFrames ? "text-emerald-400" : ""}>
                    კადრები {receivingFrames ? "✓" : "·"}
                  </span>
                  <span>/</span>
                  <span className={faceDetected ? "text-emerald-400" : ""}>
                    სახე {faceDetected ? "✓" : "·"}
                  </span>
                  <span>/</span>
                  <span className={bothEyesDetected ? "text-emerald-400" : ""}>
                    ორივე თვალი {bothEyesDetected ? "✓" : "·"}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {showCameraPreview && activeStream && !calibSummary && (
                <div
                  data-gaze-camera-preview="true"
                  className="w-14 h-11 rounded-lg overflow-hidden border border-white/25 bg-black shrink-0"
                >
                  <video
                    ref={previewVideoRef}
                    playsInline
                    muted
                    autoPlay
                    aria-label="წინა კამერის პრევიუ"
                    className="w-full h-full object-cover -scale-x-100"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowCameraPreview((v) => !v)}
                aria-pressed={showCameraPreview}
                title="კამერის მინი პრევიუ"
                className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">პრევიუ</span>
              </button>
              <button
                type="button"
                onClick={startCalibration}
                className="min-h-[44px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 shrink-0" />
                <span>თავიდან</span>
              </button>
              <button
                type="button"
                onClick={handleCloseCalibration}
                className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center justify-center cursor-pointer"
                aria-label="კალიბრაციის დახურვა"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 9 Calibration Dots across viewport */}
        {!calibSummary && activePoint && (
          <div className="fixed inset-0 pointer-events-none z-10">
            {calibrationPoints.map((pt, idx) => {
              const isDone = idx < calibStepIdx;
              const isCurrent = idx === calibStepIdx;
              const r = 18;
              const c = 2 * Math.PI * r;
              return (
                <div
                  key={pt.index}
                  style={{
                    left: `${pt.nx * 100}%`,
                    top: `${pt.ny * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className="absolute flex items-center justify-center"
                >
                  {isCurrent ? (
                    <div className="relative flex items-center justify-center">
                      <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
                        <circle
                          cx="26"
                          cy="26"
                          r={r}
                          fill={
                            calibrationReady ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.08)"
                          }
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth="3"
                        />
                        {calibrationReady && (
                          <circle
                            cx="26"
                            cy="26"
                            r={r}
                            fill="none"
                            stroke="#F59E0B"
                            strokeWidth="4"
                            strokeDasharray={c}
                            strokeDashoffset={c * (1 - pointProgressRatio)}
                            strokeLinecap="round"
                          />
                        )}
                      </svg>
                      <span
                        className={`absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow-lg ${
                          calibrationReady ? "bg-amber-400" : "bg-stone-500"
                        }`}
                      />
                    </div>
                  ) : (
                    <span
                      className={`w-3 h-3 rounded-full border ${
                        isDone
                          ? "bg-emerald-500 border-emerald-200 opacity-80"
                          : "bg-white/20 border-white/40 opacity-45"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Completion / Error & Recovery card */}
        {(calibSummary || calibError || cameraError) && (
          <div className="m-auto max-w-sm w-full rounded-2xl border border-white/15 bg-stone-900/95 p-5 text-center space-y-4 z-20">
            {calibSummary ? (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-600/20 border border-emerald-400/50 text-emerald-300 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-base font-extrabold">კალიბრაცია შენახულია</div>
                  <div className="text-xs text-stone-300 tabular-nums">
                    სიზუსტე: {calibSummary.accuracyPct}% · საშუალო ცდომილება: ~{calibSummary.rmsePx}{" "}
                    px
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCalibrating(false)}
                    className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold whitespace-nowrap cursor-pointer"
                  >
                    ნავიგაციის დაწყება
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-bold text-rose-300 leading-relaxed">
                  {calibError || cameraError}
                </div>
                {(cameraErrorKind === "not-allowed-user" ||
                  cameraErrorKind === "not-allowed-iframe") && (
                  <p className="text-[11px] text-stone-300 leading-relaxed">
                    Android Chrome-ში: მისამართის ველში დააჭირეთ საკეტის/პარამეტრების ხატულას →
                    ნებართვები → კამერა → დაშვება, შემდეგ სცადეთ თავიდან.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={retryCamera}
                    className="min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold whitespace-nowrap cursor-pointer"
                  >
                    თავიდან ცდა
                  </button>
                  {(isEmbeddedFrame ||
                    cameraStatus === "denied" ||
                    cameraErrorKind === "not-allowed-iframe" ||
                    cameraErrorKind === "security") && (
                    <a
                      href={standaloneUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-stone-100 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      <span>ახალ ჩანართში გახსნა</span>
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="text-center text-[11px] text-stone-400 z-20">
          შეხედეთ მწვანე, ბორდო ან ლურჯ ბმულს და თქვით „გადადი“ — კამერის ვიდეო არ ტოვებს
          მოწყობილობას
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      {/* Hidden inline video surface kept minimally opaque so Android Chrome decodes front camera frames reliably */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        style={{
          position: "fixed",
          width: "2px",
          height: "2px",
          bottom: 0,
          left: 0,
          opacity: 0.001,
          pointerEvents: "none",
          zIndex: -1,
        }}
      />
      {renderControlBar}
      {renderCandidateOverlay}
      {renderGazeDot}
      {renderCalibrationModal}
    </>
  );
}
