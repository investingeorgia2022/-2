import type { VilnaPdfHotspot } from "../components/VilnaPdfInteractiveViewer";
import type { AudioSyncSegment, SyncHotspotLike } from "./audioSyncTypes";
import {
  buildIndexedMainTokens,
  normalizeLineFingerprint,
  resolveSyncHotspots as resolveAnchorSyncHotspots,
  toPlainHebrew,
  type AnchorMatchStatus,
  type AnchorResolutionResult,
  type ResolveAnchorOptions,
  type SegmentResolutionStatus,
  type SingleAnchorResolution,
} from "./syncAnchorResolver";

export type {
  AnchorMatchStatus,
  AnchorResolutionResult,
  ResolveAnchorOptions,
  SegmentResolutionStatus,
  SingleAnchorResolution,
};

export { buildIndexedMainTokens, normalizeLineFingerprint, toPlainHebrew };

/**
 * Maps a sync segment's stable `WordAnchor[]` references to extracted
 * `VilnaPdfHotspot` elements using normalized Hebrew word matching,
 * neighbor/row context, occurrence counts, and section isolation.
 */
export function resolveSyncHotspots<T extends SyncHotspotLike = VilnaPdfHotspot>(
  hotspots: readonly T[],
  segment: Pick<AudioSyncSegment, "id" | "anchors">,
  options: ResolveAnchorOptions = {},
): AnchorResolutionResult<T> {
  return resolveAnchorSyncHotspots(hotspots, segment, options);
}
