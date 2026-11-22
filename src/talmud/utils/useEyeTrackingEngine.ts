import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import {
  extractGazeFeaturesFromLandmarks,
  getCurrentOrientation,
  OneEuroGazeFilter,
  predictNormalizedGaze,
  RollingRawGazeMedianFilter,
  type GazeCalibrationModel,
  type GazeRawSample,
  type ScreenOrientationType,
} from "./gazeCalibrationEngine";

export type CameraTrackingStatus =
  | "off"
  | "loading-model"
  | "requesting-camera"
  | "active"
  | "paused"
  | "denied"
  | "insecure-context"
  | "unsupported"
  | "interrupted"
  | "error";

export type CameraErrorKind =
  | "not-allowed-iframe"
  | "not-allowed-user"
  | "not-found"
  | "front-unavailable"
  | "not-readable"
  | "overconstrained"
  | "security"
  | "insecure-context"
  | "unsupported"
  | "interrupted"
  | "unknown";

export interface LiveGazeEstimate {
  clientX: number;
  clientY: number;
  nx: number;
  ny: number;
  confidence: number;
  rawSample: GazeRawSample;
  timestamp: number;
}

interface UseEyeTrackingEngineOptions {
  enabled: boolean;
  calibration: GazeCalibrationModel | null;
  sensitivity: number;
  onOrientationChange?: (orientation: ScreenOrientationType) => void;
}

interface DocumentWithPolicy extends Document {
  permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
  featurePolicy?: { allowsFeature?: (feature: string) => boolean };
}

const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const BENIGN_MEDIAPIPE_STDERR_RE =
  /^(?:INFO:\s+Created TensorFlow Lite|WARNING:\s+All log messages before absl::InitializeLog|[IW]\d{4}\s+.*(?:inference_feedback_manager|gl_context|xnnpack|tflite)|Created TensorFlow Lite XNNPACK delegate|Feedback manager requires a model with a single signature)/i;

export function isBenignMediapipeLog(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === "string" && BENIGN_MEDIAPIPE_STDERR_RE.test(first.trimStart());
}

let mediapipeFilterRefCount = 0;
let baseConsoleError: ((...args: unknown[]) => void) | null = null;

function acquireMediapipeStderrFilter(): void {
  if (typeof console === "undefined") return;
  if (mediapipeFilterRefCount === 0) {
    const capturedBase = console.error.bind(console);
    baseConsoleError = capturedBase;
    console.error = (...args: unknown[]) => {
      if (isBenignMediapipeLog(args)) return;
      capturedBase(...args);
    };
  }
  mediapipeFilterRefCount += 1;
}

function releaseMediapipeStderrFilter(): void {
  if (typeof console === "undefined" || mediapipeFilterRefCount <= 0) return;
  mediapipeFilterRefCount -= 1;
  if (mediapipeFilterRefCount === 0 && baseConsoleError) {
    console.error = baseConsoleError;
    baseConsoleError = null;
  }
}

export function detectEmbeddedIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isCameraAllowedByPermissionsPolicy(): boolean {
  if (typeof document === "undefined") return true;
  const doc = document as DocumentWithPolicy;
  const allows =
    doc.permissionsPolicy?.allowsFeature?.("camera") ??
    doc.featurePolicy?.allowsFeature?.("camera");
  return allows !== false;
}

export function isTrackLikelyRearCamera(track: MediaStreamTrack): boolean {
  const settings = track.getSettings?.();
  const facing = settings?.facingMode;
  if (facing === "environment" || facing === "left" || facing === "right") {
    return true;
  }
  if (facing === "user") {
    return false;
  }
  const label = (track.label ?? "").toLowerCase();
  if (!label) return false;
  const mentionsBack = /\b(back|rear|environment)\b/.test(label);
  const mentionsFront = /\b(front|user|selfie|facing front)\b/.test(label);
  return mentionsBack && !mentionsFront;
}

export function classifyCameraError(
  err: unknown,
  opts: { inIframe: boolean; policyAllowsCamera: boolean },
): { status: CameraTrackingStatus; kind: CameraErrorKind; message: string } {
  const errObj = err as { name?: unknown; message?: unknown } | null;
  const name = err instanceof Error ? err.name : String(errObj?.name ?? "");
  const rawMsg = (err instanceof Error ? err.message : String(errObj?.message ?? "")).toLowerCase();

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    const blockedByPolicy =
      !opts.policyAllowsCamera ||
      rawMsg.includes("permissions policy") ||
      rawMsg.includes("feature policy") ||
      rawMsg.includes("not allowed in this document");
    if (blockedByPolicy || opts.inIframe) {
      return {
        status: "denied",
        kind: blockedByPolicy ? "not-allowed-iframe" : "not-allowed-user",
        message: blockedByPolicy
          ? "წინა კამერა დაბლოკილია ჩაშენებული ფანჯრის (iframe) პოლიტიკით. გახსენით აპლიკაცია ცალკე ჩანართში."
          : "წინა კამერის ნებართვა უარყოფილია. ჩართეთ კამერა Chrome-ის პარამეტრებში (საიტის პარამეტრები → კამერა) ან გახსენით ცალკე ჩანართში.",
      };
    }
    return {
      status: "denied",
      kind: "not-allowed-user",
      message:
        "წინა კამერის ნებართვა უარყოფილია. ჩართეთ კამერა Android Chrome-ის პარამეტრებში (საკეტის ხატულა → ნებართვები → კამერა → დაშვება) და დააჭირეთ „თავიდან ცდა“.",
    };
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      status: "unsupported",
      kind: "not-found",
      message: "მოწყობილობაზე წინა კამერა ვერ მოიძებნა.",
    };
  }

  if (name === "FrontCameraUnavailableError") {
    return {
      status: "unsupported",
      kind: "front-unavailable",
      message: "წინა კამერა მიუწვდომელია — უკანა კამერაზე ავტომატური გადართვა გამორთულია.",
    };
  }

  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return {
      status: "interrupted",
      kind: "not-readable",
      message:
        "წინა კამერა დაკავებულია სხვა აპლიკაციით ან აპარატურულად მიუწვდომელია. დახურეთ სხვა კამერის აპები და სცადეთ თავიდან.",
    };
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      status: "error",
      kind: "overconstrained",
      message:
        "მოწყობილობის წინა კამერა არ აკმაყოფილებს მოთხოვნილ პარამეტრებს. სცადეთ თავიდან ან შეამოწმეთ კამერის მხარდაჭერა.",
    };
  }

  if (name === "SecurityError") {
    return {
      status: "insecure-context",
      kind: "security",
      message: "ბრაუზერის უსაფრთხოების პოლიტიკამ (SecurityError / HTTPS) დაბლოკა კამერაზე წვდომა.",
    };
  }

  return {
    status: "error",
    kind: "unknown",
    message: "წინა კამერის ან თვალის თვალთვალის მოდელის გაშვება ვერ მოხერხდა.",
  };
}

function waitForVideoMetadata(video: HTMLVideoElement, isCancelled: () => boolean): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", finish);
      video.removeEventListener("canplay", finish);
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
    // Bounded fallback so synthetic test video elements that mock play() never hang indefinitely.
    const timer = setTimeout(() => {
      if (!isCancelled()) finish();
      else finish();
    }, 500);
  });
}

export function useEyeTrackingEngine({
  enabled,
  calibration,
  sensitivity,
  onOrientationChange,
}: UseEyeTrackingEngineOptions) {
  const [status, setStatus] = useState<CameraTrackingStatus>("off");
  const [errorKind, setErrorKind] = useState<CameraErrorKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<ScreenOrientationType>(() =>
    getCurrentOrientation(),
  );
  const [receivingFrames, setReceivingFrames] = useState<boolean>(false);
  const [faceDetected, setFaceDetected] = useState<boolean>(false);
  const [bothEyesDetected, setBothEyesDetected] = useState<boolean>(false);
  const [liveGaze, setLiveGaze] = useState<LiveGazeEstimate | null>(null);
  const [latestRawSample, setLatestRawSample] = useState<GazeRawSample | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [isEmbeddedFrame] = useState<boolean>(() => detectEmbeddedIframe());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const sessionSeqRef = useRef<number>(0);
  const lastProcessedAtRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);
  const filterRef = useRef<OneEuroGazeFilter>(new OneEuroGazeFilter());
  const rawMedianFilterRef = useRef<RollingRawGazeMedianFilter>(new RollingRawGazeMedianFilter(3));
  const filterHeldRef = useRef<boolean>(false);

  const calibrationRef = useRef<GazeCalibrationModel | null>(calibration);
  calibrationRef.current = calibration;
  const sensitivityRef = useRef<number>(sensitivity);
  sensitivityRef.current = sensitivity;
  const enabledRef = useRef<boolean>(enabled);
  enabledRef.current = enabled;

  const stopTracksOfStream = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.onended = null;
        track.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const teardownCameraAndLoop = useCallback(() => {
    sessionSeqRef.current += 1;
    inFlightRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      stopTracksOfStream(streamRef.current);
      streamRef.current = null;
    }
    setActiveStream(null);
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }
    filterRef.current.reset();
    rawMedianFilterRef.current.reset();
    lastVideoTimeRef.current = -1;
    setReceivingFrames(false);
    setFaceDetected(false);
    setBothEyesDetected(false);
    setLiveGaze(null);
    setLatestRawSample(null);
  }, [stopTracksOfStream]);

  // Track device orientation and viewport resize continuously
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOrientation = () => {
      const next = getCurrentOrientation(window.innerWidth, window.innerHeight);
      setOrientation((prev) => {
        if (prev !== next) {
          onOrientationChange?.(next);
        }
        return next;
      });
    };
    window.addEventListener("resize", syncOrientation);
    window.addEventListener("orientationchange", syncOrientation);
    return () => {
      window.removeEventListener("resize", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
    };
  }, [onOrientationChange]);

  const acquireVerifiedFrontStream = useCallback(async (): Promise<MediaStream> => {
    const baseConstraints: MediaTrackConstraints = {
      facingMode: { ideal: "user" },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 20, max: 30 },
    };

    const initialStream = await navigator.mediaDevices.getUserMedia({
      video: baseConstraints,
      audio: false,
    });

    const initialTracks = initialStream.getVideoTracks();
    const firstTrack = initialTracks[0];
    if (!firstTrack || firstTrack.readyState === "ended") {
      stopTracksOfStream(initialStream);
      const err = new Error("No active video track returned");
      err.name = "NotReadableError";
      throw err;
    }

    if (!isTrackLikelyRearCamera(firstTrack)) {
      return initialStream;
    }

    // Never silently use a rear camera: stop it and explicitly require facingMode exact: 'user'.
    stopTracksOfStream(initialStream);
    try {
      const exactStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 20, max: 30 },
        },
        audio: false,
      });
      const exactTrack = exactStream.getVideoTracks()[0];
      if (!exactTrack || exactTrack.readyState === "ended" || isTrackLikelyRearCamera(exactTrack)) {
        stopTracksOfStream(exactStream);
        const err = new Error("Front camera unavailable");
        err.name = "FrontCameraUnavailableError";
        throw err;
      }
      return exactStream;
    } catch (exactErr: unknown) {
      const errName = exactErr instanceof Error ? exactErr.name : "";
      if (errName === "OverconstrainedError" || errName === "NotFoundError") {
        const frontErr = new Error("Front camera unavailable");
        frontErr.name = "FrontCameraUnavailableError";
        throw frontErr;
      }
      throw exactErr;
    }
  }, [stopTracksOfStream]);

  const startPipeline = useCallback(async () => {
    if (!enabledRef.current) return;
    if (typeof window === "undefined") return;

    // Reuse already-active healthy front camera stream without starting duplicate streams.
    const existingTracks = streamRef.current?.getVideoTracks() ?? [];
    const existingTrack = existingTracks[0];
    if (
      streamRef.current &&
      existingTrack &&
      existingTrack.readyState !== "ended" &&
      !isTrackLikelyRearCamera(existingTrack) &&
      rafRef.current !== null
    ) {
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const sessionSeq = ++sessionSeqRef.current;
    const isCancelled = () => !enabledRef.current || sessionSeqRef.current !== sessionSeq;

    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      inFlightRef.current = false;
      setStatus("insecure-context");
      setErrorKind("insecure-context");
      setErrorMessage("წინა კამერის გამოყენებისთვის საჭიროა დაცული HTTPS კავშირი.");
      return;
    }

    const inIframe = detectEmbeddedIframe();
    const policyAllowsCamera = isCameraAllowedByPermissionsPolicy();

    if (!policyAllowsCamera) {
      inFlightRef.current = false;
      setStatus("denied");
      setErrorKind("not-allowed-iframe");
      setErrorMessage(
        "წინა კამერა დაბლოკილია ჩაშენებული ფანჯრის (iframe) პოლიტიკით. გახსენით აპლიკაცია ცალკე ჩანართში.",
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      inFlightRef.current = false;
      setStatus("unsupported");
      setErrorKind("unsupported");
      setErrorMessage("ეს ბრაუზერი არ უჭერს მხარს წინა კამერით თვალის თვალთვალს.");
      return;
    }

    const loadLandmarker = async () => {
      if (landmarkerRef.current) return landmarkerRef.current;
      setStatus("loading-model");
      // Install filter BEFORE WASM factory binds console.error so TFLite INFO/WARNING logs don't surface as console errors.
      if (!filterHeldRef.current) {
        acquireMediapipeStderrFilter();
        filterHeldRef.current = true;
      }
      const visionPkg = await import("@mediapipe/tasks-vision");
      const { FilesetResolver, FaceLandmarker: FaceLandmarkerCtor } = visionPkg;

      let fileset: Parameters<typeof FaceLandmarkerCtor.createFromOptions>[0];
      try {
        fileset = await FilesetResolver.forVisionTasks("/mediapipe-wasm");
      } catch {
        fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm",
        );
      }

      const createWithDelegate = async (delegate: "GPU" | "CPU") =>
        FaceLandmarkerCtor.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: DEFAULT_MODEL_URL,
            delegate,
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.45,
          minFacePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });

      try {
        landmarkerRef.current = await createWithDelegate("GPU");
      } catch {
        landmarkerRef.current = await createWithDelegate("CPU");
      }
      return landmarkerRef.current;
    };

    try {
      setErrorKind(null);
      setErrorMessage(null);
      setReceivingFrames(false);
      setFaceDetected(false);
      setBothEyesDetected(false);
      setStatus("requesting-camera");

      const stream = await acquireVerifiedFrontStream();

      if (isCancelled()) {
        stopTracksOfStream(stream);
        inFlightRef.current = false;
        return;
      }

      streamRef.current = stream;
      setActiveStream(stream);

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.onended = () => {
          if (enabledRef.current && sessionSeqRef.current === sessionSeq) {
            teardownCameraAndLoop();
            setStatus("interrupted");
            setErrorKind("interrupted");
            setErrorMessage("კამერაზე წვდომა შეწყდა სხვა აპლიკაციის გამო.");
          }
        };
      }

      const video = videoRef.current;
      if (!video) {
        teardownCameraAndLoop();
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await waitForVideoMetadata(video, isCancelled);
      await video.play();

      if (isCancelled()) {
        teardownCameraAndLoop();
        return;
      }

      const landmarker = await loadLandmarker();
      if (isCancelled()) {
        teardownCameraAndLoop();
        return;
      }

      inFlightRef.current = false;
      setStatus("active");

      const processFrame = (nowMs: number) => {
        if (isCancelled()) return;
        rafRef.current = requestAnimationFrame(processFrame);

        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
          return;
        }
        // Throttle to ~18 FPS on Android smartphones to save CPU and battery.
        if (nowMs - lastProcessedAtRef.current < 55) return;

        const vid = videoRef.current;
        if (!vid || vid.readyState < 2 || vid.videoWidth <= 0 || vid.videoHeight <= 0) return;
        if (vid.currentTime === lastVideoTimeRef.current) return;

        lastProcessedAtRef.current = nowMs;
        lastVideoTimeRef.current = vid.currentTime;
        setReceivingFrames(true);

        try {
          const result = landmarker.detectForVideo(vid, nowMs);
          const lm = result?.faceLandmarks?.[0];
          if (!lm || lm.length < 474) {
            setFaceDetected(false);
            setBothEyesDetected(false);
            setLatestRawSample(null);
            return;
          }

          const matrixData = result?.facialTransformationMatrixes?.[0]?.data ?? null;
          const blendshapes = result?.faceBlendshapes?.[0]?.categories ?? null;
          const extractedSample = extractGazeFeaturesFromLandmarks(
            lm,
            matrixData,
            blendshapes,
            nowMs,
          );
          if (!extractedSample) {
            setFaceDetected(false);
            setBothEyesDetected(false);
            setLatestRawSample(null);
            return;
          }

          const rawSample = rawMedianFilterRef.current.push(extractedSample);
          setFaceDetected(true);
          setBothEyesDetected(rawSample.bothEyesDetected);
          setLatestRawSample(rawSample);

          const { nx, ny } = predictNormalizedGaze(calibrationRef.current, rawSample);
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const rawX = nx * vw;
          const rawY = ny * vh;

          const smoothed = filterRef.current.filter(rawX, rawY, nowMs, sensitivityRef.current);
          setLiveGaze({
            clientX: Math.max(0, Math.min(vw, smoothed.x)),
            clientY: Math.max(0, Math.min(vh, smoothed.y)),
            nx: Math.max(0, Math.min(1, smoothed.x / Math.max(1, vw))),
            ny: Math.max(0, Math.min(1, smoothed.y / Math.max(1, vh))),
            confidence: rawSample.confidence,
            rawSample,
            timestamp: nowMs,
          });
        } catch {
          // Skip transient MediaPipe decode glitches without killing loop
        }
      };

      rafRef.current = requestAnimationFrame(processFrame);
    } catch (err: unknown) {
      inFlightRef.current = false;
      teardownCameraAndLoop();
      const classified = classifyCameraError(err, { inIframe, policyAllowsCamera });
      setStatus(classified.status);
      setErrorKind(classified.kind);
      setErrorMessage(classified.message);
    }
  }, [acquireVerifiedFrontStream, stopTracksOfStream, teardownCameraAndLoop]);

  const retryCamera = useCallback(() => {
    if (!enabledRef.current) return;
    if (inFlightRef.current) return;
    teardownCameraAndLoop();
    void startPipeline();
  }, [startPipeline, teardownCameraAndLoop]);

  // Lifecycle: start/stop camera & MediaPipe strictly following enabled state
  useEffect(() => {
    if (!enabled) {
      teardownCameraAndLoop();
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close?.();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
      }
      if (filterHeldRef.current) {
        releaseMediapipeStderrFilter();
        filterHeldRef.current = false;
      }
      setStatus("off");
      setErrorKind(null);
      setErrorMessage(null);
      return;
    }

    void startPipeline();

    const onVisibilityChange = () => {
      if (!enabledRef.current) return;
      if (document.visibilityState === "hidden") {
        teardownCameraAndLoop();
        setStatus("paused");
      } else if (document.visibilityState === "visible") {
        void startPipeline();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      teardownCameraAndLoop();
    };
  }, [enabled, startPipeline, teardownCameraAndLoop]);

  // Cleanup landmarker on unmount
  useEffect(() => {
    return () => {
      teardownCameraAndLoop();
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close?.();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
      }
      if (filterHeldRef.current) {
        releaseMediapipeStderrFilter();
        filterHeldRef.current = false;
      }
    };
  }, [teardownCameraAndLoop]);

  return {
    videoRef,
    activeStream,
    status,
    errorKind,
    errorMessage,
    isEmbeddedFrame,
    orientation,
    receivingFrames,
    faceDetected,
    bothEyesDetected,
    liveGaze,
    latestRawSample,
    retryCamera,
  };
}
