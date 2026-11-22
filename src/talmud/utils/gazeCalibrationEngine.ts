export type ScreenOrientationType = "portrait" | "landscape";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface GazeRawSample {
  irisX: number;
  irisY: number;
  eyeOpenness: number;
  bothEyesDetected: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
  timestamp: number;
}

export interface GazeCalibrationPoint {
  index: number;
  nx: number;
  ny: number;
}

export interface GazeCalibrationSample {
  targetNx: number;
  targetNy: number;
  sample: GazeRawSample;
}

export interface GazeCalibrationModel {
  version: 2;
  orientation: ScreenOrientationType;
  weightsX: number[];
  weightsY: number[];
  rmsePx: number;
  accuracyPct: number;
  sampleCount: number;
  viewportWidth: number;
  viewportHeight: number;
  calibratedAt: number;
}

export interface GazeSettings {
  /** Fixation stabilization lock time in ms before switching focus between targets. */
  stabilizationMs: number;
  /** Sensitivity 0.2 - 1.0 (higher = faster saccade response, lower = calmer gaze dot). */
  sensitivity: number;
  /** Minimum estimation confidence (0.2 - 0.85) required to update focus lock. */
  minConfidence: number;
  /** Enable passive continuous voice recognition for "გადადი" command. */
  voiceCommandsEnabled: boolean;
}

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  stabilizationMs: 220,
  sensitivity: 0.5,
  minConfidence: 0.42,
  voiceCommandsEnabled: true,
};

const CALIBRATION_KEY_PREFIX = "talmud_gaze_calibration_v2_";
const GAZE_SETTINGS_KEY = "talmud_gaze_settings_v2";
const FEATURE_VECTOR_LENGTH = 7;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) * 0.5;
}

export function getCurrentOrientation(
  width = typeof window !== "undefined" ? window.innerWidth : 390,
  height = typeof window !== "undefined" ? window.innerHeight : 844,
): ScreenOrientationType {
  return width > height ? "landscape" : "portrait";
}

export function getCalibrationPoints(): GazeCalibrationPoint[] {
  const cols = [0.14, 0.5, 0.86];
  const rows = [0.25, 0.52, 0.79];
  const points: GazeCalibrationPoint[] = [];
  let index = 0;
  for (let r = 0; r < rows.length; r++) {
    // Serpentine ordering reduces abrupt full-width eye jumps during mobile calibration.
    const orderedCols = r % 2 === 1 ? [...cols].reverse() : cols;
    for (let c = 0; c < orderedCols.length; c++) {
      const nx = orderedCols[c];
      const ny = rows[r];
      if (nx === undefined || ny === undefined) continue;
      points.push({ index: index++, nx, ny });
    }
  }
  return points;
}

/**
 * Extracts Euler head pose angles (radians) from MediaPipe's column-major 4x4 matrix.
 */
export function extractHeadPoseFromMatrix(matrixData: ArrayLike<number>): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  const m11 = matrixData[0] ?? 1;
  const m12 = matrixData[4] ?? 0;
  const m21 = matrixData[1] ?? 0;
  const m22 = matrixData[5] ?? 1;
  const m31 = matrixData[2] ?? 0;
  const m32 = matrixData[6] ?? 0;
  const m33 = matrixData[10] ?? 1;

  const pitch = Math.asin(clamp(-m32, -1, 1));
  let yaw = 0;
  let roll = 0;
  if (Math.cos(pitch) > 1e-4) {
    roll = Math.atan2(m12, m22);
    yaw = Math.atan2(m31, m33);
  } else {
    roll = Math.atan2(-m21, m11);
  }
  return { yaw, pitch, roll };
}

function extractSingleEyeMetric(
  landmarks: NormalizedLandmark[],
  cornerAIdx: number,
  cornerBIdx: number,
  upperLidIdx: number,
  lowerLidIdx: number,
  irisCenterIdx: number,
): { rx: number; ry: number; ear: number; weight: number } | null {
  const cA = landmarks[cornerAIdx];
  const cB = landmarks[cornerBIdx];
  const uLid = landmarks[upperLidIdx];
  const lLid = landmarks[lowerLidIdx];
  const iris = landmarks[irisCenterIdx];
  if (!cA || !cB || !uLid || !lLid || !iris) return null;

  // Ensure cornerLeft -> cornerRight consistently runs left-to-right in image space.
  const leftCorner = cA.x <= cB.x ? cA : cB;
  const rightCorner = cA.x <= cB.x ? cB : cA;
  const dx = rightCorner.x - leftCorner.x;
  const dy = rightCorner.y - leftCorner.y;
  const eyeWidth = Math.hypot(dx, dy);
  if (eyeWidth < 0.012) return null;

  const ux = dx / eyeWidth;
  const uy = dy / eyeWidth;
  // Perpendicular vector pointing downward in normalized image coordinates.
  const vx = -uy;
  const vy = ux;

  const cornerMidX = (leftCorner.x + rightCorner.x) * 0.5;
  const cornerMidY = (leftCorner.y + rightCorner.y) * 0.5;

  const lidDist = Math.abs((lLid.x - uLid.x) * vx + (lLid.y - uLid.y) * vy);
  const ear = lidDist / eyeWidth;

  const relX = iris.x - cornerMidX;
  const relY = iris.y - cornerMidY;

  // Mirror horizontal axis for front-facing camera so positive rx points screen-right.
  const projX = relX * ux + relY * uy;
  const projY = relX * vx + relY * vy;

  const rx = clamp(-projX / (eyeWidth * 0.42), -1.5, 1.5);
  const ry = clamp(projY / (eyeWidth * 0.28), -1.5, 1.5);
  return { rx, ry, ear, weight: eyeWidth };
}

/**
 * Extracts iris center offsets + 3D head pose + confidence from MediaPipe FaceLandmarker output.
 * Requires the 478-point mesh (indices 468 & 473 are right & left iris centers).
 */
export function extractGazeFeaturesFromLandmarks(
  landmarks: NormalizedLandmark[],
  facialMatrixData?: ArrayLike<number> | null,
  blendshapeCategories?: Array<{ categoryName: string; score: number }> | null,
  timestamp = performance.now(),
): GazeRawSample | null {
  if (!landmarks || landmarks.length < 474) return null;

  const rightEye = extractSingleEyeMetric(landmarks, 33, 133, 159, 145, 468);
  const leftEye = extractSingleEyeMetric(landmarks, 362, 263, 386, 374, 473);
  if (!rightEye && !leftEye) return null;

  const wR = rightEye ? rightEye.weight : 0;
  const wL = leftEye ? leftEye.weight : 0;
  const totalW = wR + wL;
  if (totalW <= 0) return null;

  const irisX = ((rightEye?.rx ?? 0) * wR + (leftEye?.rx ?? 0) * wL) / totalW;
  const irisY = ((rightEye?.ry ?? 0) * wR + (leftEye?.ry ?? 0) * wL) / totalW;
  const avgEar = ((rightEye?.ear ?? 0) * wR + (leftEye?.ear ?? 0) * wL) / totalW;

  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  if (facialMatrixData && facialMatrixData.length >= 12) {
    const pose = extractHeadPoseFromMatrix(facialMatrixData);
    yaw = pose.yaw;
    pitch = pose.pitch;
    roll = pose.roll;
  } else {
    // Fallback geometric estimate when transformation matrix is omitted.
    const nose = landmarks[1];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    if (nose && leftCheek && rightCheek) {
      const faceSpan = Math.max(
        0.05,
        Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y),
      );
      const midX = (leftCheek.x + rightCheek.x) * 0.5;
      yaw = clamp((nose.x - midX) / (faceSpan * 0.5), -0.9, 0.9);
      const midY = (leftCheek.y + rightCheek.y) * 0.5;
      pitch = clamp((nose.y - midY) / (faceSpan * 0.5), -0.9, 0.9);
      roll = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);
    }
  }

  let blinkScore = 0;
  if (blendshapeCategories && blendshapeCategories.length > 0) {
    for (const cat of blendshapeCategories) {
      if (cat.categoryName === "eyeBlinkLeft" || cat.categoryName === "eyeBlinkRight") {
        if (cat.score > blinkScore) blinkScore = cat.score;
      }
    }
  }

  // Filter blinks / squinting / extreme head turn out of confident gaze tracking.
  const opennessFromEar = clamp((avgEar - 0.1) / 0.16, 0, 1);
  const opennessFromBlink = clamp(1 - blinkScore * 1.4, 0, 1);
  const eyeOpenness = blendshapeCategories?.length
    ? Math.min(opennessFromEar, opennessFromBlink)
    : opennessFromEar;

  const bothEyesDetected = Boolean(rightEye && leftEye);
  const bothEyesBoost = bothEyesDetected ? 1 : 0.72;
  const extremePosePenalty = Math.abs(yaw) > 0.65 || Math.abs(pitch) > 0.65 ? 0.55 : 1;
  const confidence = clamp(eyeOpenness * bothEyesBoost * extremePosePenalty, 0, 1);

  return {
    irisX,
    irisY,
    eyeOpenness,
    bothEyesDetected,
    yaw,
    pitch,
    roll,
    confidence,
    timestamp,
  };
}

/**
 * 7-element well-conditioned gaze feature basis without collinear cross-term overfitting.
 */
export function buildGazeFeatureVector(
  s: Pick<GazeRawSample, "irisX" | "irisY" | "yaw" | "pitch">,
): number[] {
  const ix = clamp(s.irisX, -1.5, 1.5);
  const iy = clamp(s.irisY, -1.5, 1.5);
  const yaw = clamp(s.yaw, -1.0, 1.0);
  const pitch = clamp(s.pitch, -1.0, 1.0);
  return [1, ix, iy, yaw, pitch, ix * ix, iy * iy];
}

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((row, r) => [...row, b[r] ?? 0]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let bestVal = Math.abs(M[col]?.[col] ?? 0);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r]?.[col] ?? 0);
      if (val > bestVal) {
        bestVal = val;
        pivotRow = r;
      }
    }
    if (bestVal < 1e-10) return null;
    if (pivotRow !== col) {
      const colRow = M[col];
      const pivRow = M[pivotRow];
      if (!colRow || !pivRow) return null;
      M[col] = pivRow;
      M[pivotRow] = colRow;
    }

    const pivot = M[col];
    if (!pivot) return null;
    const diag = pivot[col] ?? 0;
    if (Math.abs(diag) < 1e-12) return null;
    for (let j = col; j <= n; j++) {
      pivot[j] = (pivot[j] ?? 0) / diag;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const targetRow = M[r];
      if (!targetRow) continue;
      const factor = targetRow[col] ?? 0;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        targetRow[j] = (targetRow[j] ?? 0) - factor * (pivot[j] ?? 0);
      }
    }
  }

  return M.map((row) => row[n] ?? 0);
}

function fitWeightedRidgeWeights(
  features: number[][],
  targets: number[],
  weights: number[],
): number[] | null {
  const dim = features[0]?.length ?? 0;
  if (dim === 0 || features.length < dim) return null;

  const XtX: number[][] = Array.from({ length: dim }, () => Array<number>(dim).fill(0));
  const Xty: number[] = Array<number>(dim).fill(0);
  let totalWeight = 0;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const y = targets[i];
    const w = weights[i] ?? 1;
    if (!f || y === undefined || w <= 0) continue;
    totalWeight += w;
    for (let r = 0; r < dim; r++) {
      const fr = f[r] ?? 0;
      Xty[r] = (Xty[r] ?? 0) + w * fr * y;
      const rowMat = XtX[r];
      if (!rowMat) continue;
      for (let c = 0; c < dim; c++) {
        rowMat[c] = (rowMat[c] ?? 0) + w * fr * (f[c] ?? 0);
      }
    }
  }

  // Tiny ridge on linear terms to avoid corner shrinkage; stronger ridge on quadratic terms to block tremor blowup.
  const linearLambda = Math.max(0.004, totalWeight * 0.0004);
  const quadLambda = Math.max(0.12, totalWeight * 0.012);
  for (let d = 1; d < dim; d++) {
    const diagRow = XtX[d];
    if (diagRow) {
      const penalty = d >= 5 ? quadLambda : linearLambda;
      diagRow[d] = (diagRow[d] ?? 0) + penalty;
    }
  }

  return solveLinearSystem(XtX, Xty);
}

/**
 * Fits a robust, outlier-trimmed ridge regression gaze model across 9 calibration targets.
 * Rejects saccade/blink outlier frames per target via MAD and stabilizes fit around per-point centroids.
 */
export function fitGazeCalibrationModel(
  samples: GazeCalibrationSample[],
  orientation: ScreenOrientationType,
  viewportWidth: number,
  viewportHeight: number,
): GazeCalibrationModel | null {
  const valid = samples.filter((entry) => entry.sample.confidence >= 0.25);
  if (valid.length < 10) return null;

  // Group samples by calibration target coordinate to reject transient jitter outliers cleanly.
  const grouped = new Map<string, GazeCalibrationSample[]>();
  for (const entry of valid) {
    const key = `${entry.targetNx.toFixed(3)}:${entry.targetNy.toFixed(3)}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  const trimmedEntries: GazeCalibrationSample[] = [];
  const centroids: Array<{
    targetNx: number;
    targetNy: number;
    sample: Pick<GazeRawSample, "irisX" | "irisY" | "yaw" | "pitch">;
  }> = [];

  for (const bucket of grouped.values()) {
    const targetNx = bucket[0]?.targetNx ?? 0.5;
    const targetNy = bucket[0]?.targetNy ?? 0.5;
    const medIx = medianOf(bucket.map((b) => b.sample.irisX));
    const medIy = medianOf(bucket.map((b) => b.sample.irisY));

    const withDist = bucket.map((entry) => ({
      entry,
      dist: Math.hypot(entry.sample.irisX - medIx, entry.sample.irisY - medIy),
    }));
    const medDist = medianOf(withDist.map((d) => d.dist));
    const madDist = medianOf(withDist.map((d) => Math.abs(d.dist - medDist)));
    const cutoff = Math.max(0.11, medDist + 2.2 * madDist);

    let inliers = withDist.filter((d) => d.dist <= cutoff).map((d) => d.entry);
    if (inliers.length < Math.ceil(bucket.length * 0.5)) {
      inliers = [...withDist]
        .sort((a, b) => a.dist - b.dist)
        .slice(0, Math.max(1, Math.ceil(bucket.length * 0.5)))
        .map((d) => d.entry);
    }

    for (const item of inliers) {
      trimmedEntries.push(item);
    }

    // Confidence-weighted robust centroid per calibration target
    let wSum = 0;
    let sumIx = 0;
    let sumIy = 0;
    let sumYaw = 0;
    let sumPitch = 0;
    for (const item of inliers) {
      const w = Math.max(0.3, item.sample.confidence);
      wSum += w;
      sumIx += item.sample.irisX * w;
      sumIy += item.sample.irisY * w;
      sumYaw += item.sample.yaw * w;
      sumPitch += item.sample.pitch * w;
    }
    if (wSum > 0) {
      centroids.push({
        targetNx,
        targetNy,
        sample: {
          irisX: sumIx / wSum,
          irisY: sumIy / wSum,
          yaw: sumYaw / wSum,
          pitch: sumPitch / wSum,
        },
      });
    }
  }

  if (trimmedEntries.length < 10) return null;

  const trainFeatures: number[][] = [];
  const trainTargetsX: number[] = [];
  const trainTargetsY: number[] = [];
  const trainWeights: number[] = [];

  for (const item of trimmedEntries) {
    trainFeatures.push(buildGazeFeatureVector(item.sample));
    trainTargetsX.push(item.targetNx);
    trainTargetsY.push(item.targetNy);
    trainWeights.push(Math.max(0.4, item.sample.confidence));
  }

  // Anchors each target centroid with higher weight to suppress single-frame mobile tremor variance.
  for (const c of centroids) {
    trainFeatures.push(buildGazeFeatureVector(c.sample));
    trainTargetsX.push(c.targetNx);
    trainTargetsY.push(c.targetNy);
    trainWeights.push(3.5);
  }

  const weightsX = fitWeightedRidgeWeights(trainFeatures, trainTargetsX, trainWeights);
  const weightsY = fitWeightedRidgeWeights(trainFeatures, trainTargetsY, trainWeights);
  if (!weightsX || !weightsY) return null;

  // Evaluate accuracy over stabilized target centroids (what real fixation sees after smoothing).
  const vw = Math.max(240, viewportWidth);
  const vh = Math.max(240, viewportHeight);
  const evalSet =
    centroids.length >= 6
      ? centroids
      : trimmedEntries.map((e) => ({
          targetNx: e.targetNx,
          targetNy: e.targetNy,
          sample: e.sample,
        }));

  let sqErrSum = 0;
  for (const pt of evalSet) {
    const f = buildGazeFeatureVector(pt.sample);
    let px = 0;
    let py = 0;
    for (let d = 0; d < f.length; d++) {
      const fd = f[d] ?? 0;
      px += fd * (weightsX[d] ?? 0);
      py += fd * (weightsY[d] ?? 0);
    }
    const errPxX = (clamp(px, 0, 1) - pt.targetNx) * vw;
    const errPxY = (clamp(py, 0, 1) - pt.targetNy) * vh;
    sqErrSum += errPxX * errPxX + errPxY * errPxY;
  }

  const rmsePx = Math.round(Math.sqrt(sqErrSum / Math.max(1, evalSet.length)));
  const diag = Math.hypot(vw, vh);
  const accuracyPct = clamp(Math.round((1 - rmsePx / (diag * 0.25)) * 100), 15, 99);

  return {
    version: 2,
    orientation,
    weightsX,
    weightsY,
    rmsePx,
    accuracyPct,
    sampleCount: trimmedEntries.length,
    viewportWidth: vw,
    viewportHeight: vh,
    calibratedAt: Date.now(),
  };
}

/**
 * Maps live iris + head-pose sample into normalized screen coordinates [0, 1] x [0, 1].
 */
export function predictNormalizedGaze(
  model: GazeCalibrationModel | null,
  sample: Pick<GazeRawSample, "irisX" | "irisY" | "yaw" | "pitch">,
): { nx: number; ny: number } {
  if (!model) {
    // Uncalibrated geometric approximation before calibration runs.
    const nx = clamp(0.5 + sample.irisX * 0.65 - sample.yaw * 0.45, 0.02, 0.98);
    const ny = clamp(0.5 + sample.irisY * 0.85 + sample.pitch * 0.55, 0.02, 0.98);
    return { nx, ny };
  }
  const f = buildGazeFeatureVector(sample);
  let nx = 0;
  let ny = 0;
  for (let d = 0; d < f.length; d++) {
    const fd = f[d] ?? 0;
    nx += fd * (model.weightsX[d] ?? 0);
    ny += fd * (model.weightsY[d] ?? 0);
  }
  return {
    nx: clamp(nx, 0.01, 0.99),
    ny: clamp(ny, 0.01, 0.99),
  };
}

/**
 * Rolling median pre-filter for raw MediaPipe iris & pose coordinates to discard 1-frame landmark spikes.
 */
export class RollingRawGazeMedianFilter {
  private window: GazeRawSample[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 3) {
    this.maxSize = Math.max(1, maxSize);
  }

  reset(): void {
    this.window = [];
  }

  push(sample: GazeRawSample): GazeRawSample {
    this.window.push(sample);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }
    if (this.window.length < 3) {
      return sample;
    }
    return {
      ...sample,
      irisX: medianOf(this.window.map((s) => s.irisX)),
      irisY: medianOf(this.window.map((s) => s.irisY)),
      yaw: medianOf(this.window.map((s) => s.yaw)),
      pitch: medianOf(this.window.map((s) => s.pitch)),
    };
  }
}

/**
 * Stabilized One-Euro adaptive low-pass filter with fixation spatial deadband.
 * Eliminates handheld micro-jitter so the gaze indicator stays steady on a target word
 * while still gliding cleanly when the reader intentionally looks across columns.
 */
export class OneEuroGazeFilter {
  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevDx = 0;
  private prevDy = 0;
  private prevTime: number | null = null;

  reset(): void {
    this.prevX = null;
    this.prevY = null;
    this.prevDx = 0;
    this.prevDy = 0;
    this.prevTime = null;
  }

  private alpha(cutoff: number, dtSec: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(dtSec, 1 / 120));
  }

  filter(x: number, y: number, timestampMs: number, sensitivity = 0.5): { x: number; y: number } {
    if (this.prevX === null || this.prevY === null || this.prevTime === null) {
      this.prevX = x;
      this.prevY = y;
      this.prevTime = timestampMs;
      return { x, y };
    }

    const dtSec = clamp((timestampMs - this.prevTime) / 1000, 1 / 120, 0.25);
    this.prevTime = timestampMs;

    const sens = clamp(sensitivity, 0.2, 1.0);
    const deadbandPx = 12 - sens * 5; // ~7px - 11px steady reading deadband
    const delta = Math.hypot(x - this.prevX, y - this.prevY);

    // Suppress tiny fixation tremor completely inside inner zone; bleed gently toward target near edge.
    if (delta <= deadbandPx) {
      this.prevDx *= 0.6;
      this.prevDy *= 0.6;
      const creep = delta <= deadbandPx * 0.55 ? 0 : 0.08;
      this.prevX = this.prevX + (x - this.prevX) * creep;
      this.prevY = this.prevY + (y - this.prevY) * creep;
      return { x: this.prevX, y: this.prevY };
    }

    const minCutoff = 0.24 + sens * 0.48; // Calmer steady fixation (~0.34 - 0.72 Hz)
    const beta = 0.0018 + sens * 0.0055; // Responsive only on real eye saccades

    const dxRaw = (x - this.prevX) / dtSec;
    const dyRaw = (y - this.prevY) / dtSec;
    const dAlpha = this.alpha(0.8, dtSec);
    this.prevDx = dAlpha * dxRaw + (1 - dAlpha) * this.prevDx;
    this.prevDy = dAlpha * dyRaw + (1 - dAlpha) * this.prevDy;

    const speed = Math.hypot(this.prevDx, this.prevDy);
    const cutoff = minCutoff + beta * speed;
    const a = this.alpha(cutoff, dtSec);

    this.prevX = a * x + (1 - a) * this.prevX;
    this.prevY = a * y + (1 - a) * this.prevY;
    return { x: this.prevX, y: this.prevY };
  }
}

export function loadGazeCalibration(
  orientation: ScreenOrientationType,
): GazeCalibrationModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${CALIBRATION_KEY_PREFIX}${orientation}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GazeCalibrationModel;
    if (
      parsed?.version === 2 &&
      parsed.orientation === orientation &&
      Array.isArray(parsed.weightsX) &&
      Array.isArray(parsed.weightsY) &&
      parsed.weightsX.length === FEATURE_VECTOR_LENGTH &&
      parsed.weightsY.length === FEATURE_VECTOR_LENGTH
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveGazeCalibration(model: GazeCalibrationModel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${CALIBRATION_KEY_PREFIX}${model.orientation}`,
      JSON.stringify(model),
    );
  } catch {
    // ignore storage quota errors
  }
}

export function clearGazeCalibration(orientation: ScreenOrientationType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${CALIBRATION_KEY_PREFIX}${orientation}`);
  } catch {
    // ignore
  }
}

export function loadGazeSettings(): GazeSettings {
  if (typeof window === "undefined") return DEFAULT_GAZE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(GAZE_SETTINGS_KEY);
    if (!raw) return DEFAULT_GAZE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GazeSettings>;
    return {
      stabilizationMs: clamp(
        Number(parsed.stabilizationMs) || DEFAULT_GAZE_SETTINGS.stabilizationMs,
        140,
        450,
      ),
      sensitivity: clamp(Number(parsed.sensitivity) || DEFAULT_GAZE_SETTINGS.sensitivity, 0.2, 1.0),
      minConfidence: clamp(
        Number(parsed.minConfidence) || DEFAULT_GAZE_SETTINGS.minConfidence,
        0.2,
        0.85,
      ),
      voiceCommandsEnabled:
        typeof parsed.voiceCommandsEnabled === "boolean"
          ? parsed.voiceCommandsEnabled
          : DEFAULT_GAZE_SETTINGS.voiceCommandsEnabled,
    };
  } catch {
    return DEFAULT_GAZE_SETTINGS;
  }
}

export function saveGazeSettings(settings: GazeSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GAZE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}
