import { splitSideAt, type DhHotspotRole, type DhLink } from "./dibburHamatchilMatcher";

export type GazeTargetKind = "rashi" | "tosafot" | "blue-marker";

export interface GazeHotspotLike {
  id: string;
  word: string;
  section: string;
  isSmallMarker?: boolean;
}

export interface GazeRectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ResolvedGazeTarget<T extends GazeHotspotLike = GazeHotspotLike> {
  hotspot: T;
  targetKey: string;
  targetKind: GazeTargetKind;
  linkKey: string | null;
  link: DhLink | null;
  rect: GazeRectBox;
  /** Synthetic X coordinate placed cleanly on Rashi's (>=50%) or Tosafot's (<50%) side for splitWord links. */
  splitClientX: number;
  distancePx: number;
}

export interface GazeFocusState<T extends GazeHotspotLike = GazeHotspotLike> {
  phase: "idle" | "stabilizing" | "focused";
  candidateKey: string | null;
  candidateTarget: ResolvedGazeTarget<T> | null;
  firstSeenMs: number;
  lastCandidateSeenMs: number;
  focusedTarget: ResolvedGazeTarget<T> | null;
  lastFocusedSeenMs: number;
}

export interface GazeFocusConfig {
  /** Time gaze must hold on a candidate before focus locks onto it (default ~220ms). */
  stabilizationMs: number;
  /** Minimum eye tracking confidence (0..1) required to advance focus. */
  minConfidence: number;
  /** How long a locked focus survives blinks, speaking "გადადი", or brief glances away (ms). */
  lockRetentionMs?: number;
  /** Brief grace period for candidate stabilization across single-frame blinks (ms). */
  blinkGraceMs?: number;
}

export function createInitialGazeFocusState<
  T extends GazeHotspotLike = GazeHotspotLike,
>(): GazeFocusState<T> {
  return {
    phase: "idle",
    candidateKey: null,
    candidateTarget: null,
    firstSeenMs: 0,
    lastCandidateSeenMs: 0,
    focusedTarget: null,
    lastFocusedSeenMs: 0,
  };
}

/**
 * Resolves viewport gaze coordinates (clientX, clientY) against:
 * 1) Gemara/Mishnah Green (Rashi) & Burgundy (Tosafot) dibbur-hamatchil links
 *    (dual splitWord targets automatically resolve right half -> Rashi, left half -> Tosafot), AND
 * 2) All Blue reference markers and citations across the Vilna Daf (`isSmallMarker || citationHotspotIds`).
 *
 * Strictly ignores unlinked plain text — returns null when no valid target sits within tolerance.
 */
export function resolveGazeTarget<T extends GazeHotspotLike>(params: {
  clientX: number;
  clientY: number;
  hotspots: T[];
  roles: Map<string, DhHotspotRole>;
  linksByKey: Map<string, DhLink>;
  citationHotspotIds?: Set<string> | undefined;
  getRect: (hotspotId: string) => GazeRectBox | null;
  maxRadiusPx?: number;
}): ResolvedGazeTarget<T> | null {
  const {
    clientX,
    clientY,
    hotspots,
    roles,
    linksByKey,
    citationHotspotIds,
    getRect,
    maxRadiusPx = 42,
  } = params;

  let best: {
    hotspot: T;
    targetKey: string;
    targetKind: GazeTargetKind;
    linkKey: string | null;
    link: DhLink | null;
    rect: GazeRectBox;
    splitClientX: number;
    score: number;
    distancePx: number;
  } | null = null;

  for (let i = 0; i < hotspots.length; i++) {
    const h = hotspots[i];
    if (!h) continue;

    const isBlueMarker = Boolean(h.isSmallMarker || citationHotspotIds?.has(h.id));
    let targetKind: GazeTargetKind | null = null;
    let linkKey: string | null = null;
    let link: DhLink | null = null;

    if (isBlueMarker) {
      targetKind = "blue-marker";
    } else if (h.section === "gemara" || h.section === "mishnah") {
      const role = roles.get(h.id);
      if (!role) continue;
      // Compute rect first so splitWord side depends directly on where the eye looks horizontally.
      const preliminaryRect = getRect(h.id);
      if (!preliminaryRect || preliminaryRect.width <= 0 || preliminaryRect.height <= 0) continue;

      let side: "rashi" | "tosafot" | undefined;
      if (role.splitWord) {
        side = splitSideAt(clientX, preliminaryRect);
      } else {
        side = role.rashi ? "rashi" : role.tosafot ? "tosafot" : undefined;
      }
      const key = side ? role[side] : undefined;
      if (!side || !key) continue;
      const foundLink = linksByKey.get(key);
      if (!foundLink || foundLink.dhIds.length === 0) continue;

      targetKind = side;
      linkKey = foundLink.key;
      link = foundLink;
    } else {
      continue;
    }

    const rect = getRect(h.id);
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;

    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const distancePx = Math.hypot(dx, dy);

    if (distancePx > maxRadiusPx) continue;

    // Tiny blue markers (already z-55 on the page) get slight tie-break priority when gaze lands inside them.
    const score =
      distancePx === 0
        ? isBlueMarker
          ? -0.5
          : 0
        : dy * 1.45 + dx * 0.9 + (isBlueMarker ? 0 : 0.25);

    if (!best || score < best.score) {
      const splitClientX =
        targetKind === "rashi"
          ? rect.left + rect.width * 0.78
          : targetKind === "tosafot"
            ? rect.left + rect.width * 0.22
            : rect.left + rect.width * 0.5;
      const targetKey =
        targetKind === "blue-marker" ? `blue:${h.id}` : `${targetKind}:${linkKey ?? h.id}`;

      best = {
        hotspot: h,
        targetKey,
        targetKind,
        linkKey,
        link,
        rect,
        splitClientX,
        score,
        distancePx,
      };
      if (score < 0) break;
    }
  }

  if (!best) return null;

  return {
    hotspot: best.hotspot,
    targetKey: best.targetKey,
    targetKind: best.targetKind,
    linkKey: best.linkKey,
    link: best.link,
    rect: best.rect,
    splitClientX: best.splitClientX,
    distancePx: best.distancePx,
  };
}

/**
 * Pure non-jumping focus lock state machine.
 * Locks cleanly onto a hovered target (Green / Burgundy / Blue) after `stabilizationMs`,
 * preserves that lock through blinks & while speaking "გადადი", and NEVER auto-jumps.
 */
export function stepGazeTargetFocus<T extends GazeHotspotLike>(
  prev: GazeFocusState<T>,
  input: {
    nowMs: number;
    confidence: number;
    resolvedTarget: ResolvedGazeTarget<T> | null;
    isExecutingNavigation?: boolean;
  },
  config: GazeFocusConfig,
): GazeFocusState<T> {
  const { nowMs, confidence, resolvedTarget, isExecutingNavigation = false } = input;
  const lockRetentionMs = config.lockRetentionMs ?? 1400;
  const blinkGraceMs = config.blinkGraceMs ?? 240;

  if (isExecutingNavigation) {
    return createInitialGazeFocusState<T>();
  }

  // Low confidence or eye between targets: preserve existing lock across blinks/speech up to retention limit.
  if (confidence < config.minConfidence || !resolvedTarget) {
    if (prev.focusedTarget && nowMs - prev.lastFocusedSeenMs <= lockRetentionMs) {
      return {
        ...prev,
        phase: "focused",
        candidateKey: null,
        candidateTarget: null,
      };
    }
    if (
      !prev.focusedTarget &&
      prev.candidateKey &&
      nowMs - prev.lastCandidateSeenMs <= blinkGraceMs
    ) {
      return prev;
    }
    return createInitialGazeFocusState<T>();
  }

  // User is still looking at the already-locked target -> keep lock fresh with updated rect/coords.
  if (prev.focusedTarget && resolvedTarget.targetKey === prev.focusedTarget.targetKey) {
    return {
      phase: "focused",
      candidateKey: null,
      candidateTarget: null,
      firstSeenMs: 0,
      lastCandidateSeenMs: nowMs,
      focusedTarget: resolvedTarget,
      lastFocusedSeenMs: nowMs,
    };
  }

  // Same new candidate accumulating stabilization toward switching focus (or locking first focus).
  if (prev.candidateKey === resolvedTarget.targetKey) {
    const elapsed = Math.max(0, nowMs - prev.firstSeenMs);
    if (elapsed >= config.stabilizationMs) {
      return {
        phase: "focused",
        candidateKey: null,
        candidateTarget: null,
        firstSeenMs: 0,
        lastCandidateSeenMs: nowMs,
        focusedTarget: resolvedTarget,
        lastFocusedSeenMs: nowMs,
      };
    }
    // Keep existing focused target visible until the new candidate proves stable (hysteresis).
    if (prev.focusedTarget && nowMs - prev.lastFocusedSeenMs <= lockRetentionMs) {
      return {
        ...prev,
        phase: "focused",
        candidateTarget: resolvedTarget,
        lastCandidateSeenMs: nowMs,
      };
    }
    return {
      ...prev,
      phase: "stabilizing",
      candidateTarget: resolvedTarget,
      lastCandidateSeenMs: nowMs,
    };
  }

  // First frame seeing a new candidate target.
  if (prev.focusedTarget && nowMs - prev.lastFocusedSeenMs <= lockRetentionMs) {
    return {
      ...prev,
      phase: "focused",
      candidateKey: resolvedTarget.targetKey,
      candidateTarget: resolvedTarget,
      firstSeenMs: nowMs,
      lastCandidateSeenMs: nowMs,
    };
  }

  return {
    phase: "stabilizing",
    candidateKey: resolvedTarget.targetKey,
    candidateTarget: resolvedTarget,
    firstSeenMs: nowMs,
    lastCandidateSeenMs: nowMs,
    focusedTarget: null,
    lastFocusedSeenMs: 0,
  };
}
