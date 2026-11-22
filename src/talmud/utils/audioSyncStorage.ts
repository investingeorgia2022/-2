import type { AudioSyncMap, AudioSyncSegment, SyncHotspotLike } from "./audioSyncTypes";
import { assertValidAudioSyncMap } from "./audioSyncValidation";
import { findApproximatePhraseMatch, type AlignerSegmentInput } from "./gemaraPhraseAligner";
import { resolveSyncHotspots } from "./syncAnchorResolver";

const DB_NAME = "talmud-audio-sync-db";
const DB_VERSION = 1;
const STORE_MAPS = "syncMaps";
const STORE_AUDIO = "audioFiles";
const LOCAL_STORAGE_PREFIX = "talmud_audio_sync_map_v1:";
const AUDIO_SOURCE_CONFIG_KEY = "talmud_audio_source_config_v1";

export interface AudioSourceConfig {
  urlTemplate: string;
  dafOverrides: Record<string, string>;
}

export function getDefaultAudioBaseTemplate(): string {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    const raw = env?.["VITE_TALMUD_AUDIO_BASE_URL"];
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

export function loadAudioSourceConfig(): AudioSourceConfig {
  const empty: AudioSourceConfig = { urlTemplate: "", dafOverrides: {} };
  try {
    if (typeof localStorage === "undefined") return empty;
    const raw = localStorage.getItem(AUDIO_SOURCE_CONFIG_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const obj = parsed as Record<string, unknown>;
    const urlTemplate = typeof obj["urlTemplate"] === "string" ? obj["urlTemplate"].trim() : "";
    const rawOverrides = obj["dafOverrides"];
    const dafOverrides: Record<string, string> = {};
    if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
      for (const [k, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) {
          dafOverrides[k] = v.trim();
        }
      }
    }
    return { urlTemplate, dafOverrides };
  } catch {
    return empty;
  }
}

export function saveAudioSourceConfig(config: AudioSourceConfig): void {
  try {
    if (typeof localStorage === "undefined") return;
    const cleanedOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.dafOverrides)) {
      const trimmed = v.trim();
      if (trimmed) cleanedOverrides[k] = trimmed;
    }
    const normalized: AudioSourceConfig = {
      urlTemplate: config.urlTemplate.trim(),
      dafOverrides: cleanedOverrides,
    };
    if (!normalized.urlTemplate && Object.keys(normalized.dafOverrides).length === 0) {
      localStorage.removeItem(AUDIO_SOURCE_CONFIG_KEY);
    } else {
      localStorage.setItem(AUDIO_SOURCE_CONFIG_KEY, JSON.stringify(normalized));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function resolveAudioSourceUrl(
  tractateId: string,
  dafId: string,
  config?: AudioSourceConfig,
): string | null {
  const key = buildSyncMapStorageKey(tractateId, dafId);
  const directOverride = config?.dafOverrides[key]?.trim();
  if (directOverride) return directOverride;

  const template = (config?.urlTemplate ?? "").trim() || getDefaultAudioBaseTemplate();
  if (!template) return null;

  const dafMatch = /^(\d+)([abAB])?$/.exec(dafId.trim());
  const dafNum = dafMatch?.[1] ?? dafId.trim();
  const amud = (dafMatch?.[2] ?? "").toLowerCase();
  const tractateSlug = tractateId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (/\{[a-zA-Z0-9_]+\}/.test(template)) {
    return template
      .replace(/\{tractate\}/g, encodeURIComponent(tractateId))
      .replace(/\{tractate_lower\}/g, encodeURIComponent(tractateId.toLowerCase()))
      .replace(/\{tractate_slug\}/g, encodeURIComponent(tractateSlug))
      .replace(/\{daf\}/g, encodeURIComponent(dafId))
      .replace(/\{dafNum\}/g, encodeURIComponent(dafNum))
      .replace(/\{amud\}/g, encodeURIComponent(amud));
  }

  const base = template.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(tractateId)}/${encodeURIComponent(dafId)}.mp3`;
}

export function buildAudioProxyCheckUrl(targetUrl: string): string {
  return `/api/talmud/audio-sync-transcribe?mode=check&url=${encodeURIComponent(targetUrl)}`;
}

export function buildAudioProxyStreamUrl(targetUrl: string): string {
  return `/api/talmud/audio-sync-transcribe?mode=stream&url=${encodeURIComponent(targetUrl)}`;
}

export function buildSyncMapStorageKey(tractateId: string, dafId: string): string {
  return `${tractateId}:${dafId}`;
}

export function formatMsToTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parseTimestampToMs(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\[|\]$/g, "");
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(trimmed);
  if (!m) return null;
  const hours = m[1] !== undefined ? Number(m[1]) : 0;
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  const millis = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(mins) ||
    !Number.isInteger(secs) ||
    mins >= 60 ||
    secs >= 60
  ) {
    return null;
  }
  return ((hours * 60 + mins) * 60 + secs) * 1000 + millis;
}

/**
 * Parses SRT, WebVTT, bracketed `[MM:SS] ...`, or plain multi-line Hebrew transcripts
 * into chronological `AlignerSegmentInput[]`.
 */
export function parseTranscriptToSegments(
  rawText: string,
  defaultDurationMs?: number,
): AlignerSegmentInput[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // 1. SRT / WebVTT cue range format: 00:00:01,000 --> 00:00:04,200
  const rangeCueRegex =
    /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
  if (rangeCueRegex.test(normalized)) {
    const blocks = normalized
      .replace(/^WEBVTT[^\n]*\n+/i, "")
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);

    const cues: AlignerSegmentInput[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const lines = (blocks[i] ?? "").split("\n").map((l) => l.trim());
      const timingIdx = lines.findIndex((l) => rangeCueRegex.test(l));
      if (timingIdx === -1) continue;
      const timingLine = lines[timingIdx] ?? "";
      const match = rangeCueRegex.exec(timingLine);
      if (!match) continue;
      const startMs = parseTimestampToMs(match[1] ?? "");
      const endMs = parseTimestampToMs(match[2] ?? "");
      const textHe = lines
        .slice(timingIdx + 1)
        .join(" ")
        .trim();
      if (startMs === null || endMs === null || endMs <= startMs || !textHe) continue;
      cues.push({
        id: `cue-${cues.length + 1}`,
        startMs,
        endMs,
        textHe,
      });
    }
    if (cues.length > 0) return cues;
  }

  // 2. Line-by-line `[MM:SS] Hebrew phrase` or `MM:SS - Hebrew phrase`
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const prefixedLines: Array<{ startMs: number; textHe: string }> = [];
  for (const line of lines) {
    const m = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s*(?:[-–—:]\s*)?(.+)$/.exec(
      line,
    );
    if (!m) continue;
    const startMs = parseTimestampToMs(m[1] ?? "");
    const textHe = (m[2] ?? "").trim();
    if (startMs !== null && textHe) {
      prefixedLines.push({ startMs, textHe });
    }
  }

  if (prefixedLines.length > 0) {
    const sorted = [...prefixedLines].sort((a, b) => a.startMs - b.startMs);
    const out: AlignerSegmentInput[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      if (!cur) continue;
      const next = sorted[i + 1];
      const estimatedLen = Math.max(1800, cur.textHe.split(/\s+/).length * 420);
      const fallbackEnd =
        defaultDurationMs && defaultDurationMs > cur.startMs
          ? defaultDurationMs
          : cur.startMs + estimatedLen;
      const endMs =
        next && next.startMs > cur.startMs
          ? next.startMs
          : Math.max(cur.startMs + 800, fallbackEnd);
      out.push({
        id: `seg-${i + 1}`,
        startMs: cur.startMs,
        endMs,
        textHe: cur.textHe,
      });
    }
    return out;
  }

  // 3. Plain multi-line text -> distribute evenly by word count
  const weights = lines.map((l) => Math.max(1, l.split(/\s+/).length));
  const totalWords = weights.reduce((a, b) => a + b, 0);
  const totalDuration =
    typeof defaultDurationMs === "number" &&
    Number.isFinite(defaultDurationMs) &&
    defaultDurationMs > 1000
      ? Math.round(defaultDurationMs)
      : Math.max(lines.length * 2500, totalWords * 400);

  const out: AlignerSegmentInput[] = [];
  let cursorMs = 0;
  for (let i = 0; i < lines.length; i++) {
    const textHe = lines[i];
    if (!textHe) continue;
    const w = weights[i] ?? 1;
    const isLast = i === lines.length - 1;
    const slice = isLast
      ? Math.max(800, totalDuration - cursorMs)
      : Math.max(800, Math.round((w / totalWords) * totalDuration));
    out.push({
      id: `seg-${i + 1}`,
      startMs: cursorMs,
      endMs: cursorMs + slice,
      textHe,
    });
    cursorMs += slice;
  }
  return out;
}

export function exportSyncMapJson(map: AudioSyncMap): string {
  const validated = assertValidAudioSyncMap(map);
  return JSON.stringify(validated, null, 2);
}

export function importSyncMapJson(rawJson: string): AudioSyncMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid JSON syntax for AudioSyncMap.");
  }
  return assertValidAudioSyncMap(parsed);
}

function openAudioSyncDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MAPS)) {
          db.createObjectStore(STORE_MAPS);
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalFallback(key: string): AudioSyncMap | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    return assertValidAudioSyncMap(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalFallback(key: string, map: AudioSyncMap | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const fullKey = `${LOCAL_STORAGE_PREFIX}${key}`;
    if (!map) {
      localStorage.removeItem(fullKey);
    } else {
      localStorage.setItem(fullKey, JSON.stringify(map));
    }
  } catch {
    // ignore storage quota errors
  }
}

export async function saveAudioSyncMap(map: AudioSyncMap): Promise<void> {
  const validated = assertValidAudioSyncMap({
    ...map,
    updatedAt: new Date().toISOString(),
  });
  const key = buildSyncMapStorageKey(validated.tractateId, validated.dafId);
  writeLocalFallback(key, validated);

  const db = await openAudioSyncDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_MAPS, "readwrite");
      tx.objectStore(STORE_MAPS).put(validated, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadAudioSyncMap(
  tractateId: string,
  dafId: string,
): Promise<AudioSyncMap | null> {
  const key = buildSyncMapStorageKey(tractateId, dafId);
  const db = await openAudioSyncDb();
  if (db) {
    const fromDb = await new Promise<AudioSyncMap | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_MAPS, "readonly");
        const req = tx.objectStore(STORE_MAPS).get(key);
        req.onsuccess = () => {
          db.close();
          if (!req.result) {
            resolve(null);
            return;
          }
          try {
            resolve(assertValidAudioSyncMap(req.result));
          } catch {
            resolve(null);
          }
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    });
    if (fromDb) return fromDb;
  }
  return readLocalFallback(key);
}

export async function deleteAudioSyncMap(tractateId: string, dafId: string): Promise<void> {
  const key = buildSyncMapStorageKey(tractateId, dafId);
  writeLocalFallback(key, null);

  const db = await openAudioSyncDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_MAPS, "readwrite");
      tx.objectStore(STORE_MAPS).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function saveAudioSyncFile(
  tractateId: string,
  dafId: string,
  blob: Blob,
  fileName: string,
): Promise<void> {
  const db = await openAudioSyncDb();
  if (!db) return;
  const key = buildSyncMapStorageKey(tractateId, dafId);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_AUDIO, "readwrite");
      tx.objectStore(STORE_AUDIO).put({ blob, fileName }, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadAudioSyncFile(
  tractateId: string,
  dafId: string,
): Promise<{ blob: Blob; fileName: string } | null> {
  const db = await openAudioSyncDb();
  if (!db) return null;
  const key = buildSyncMapStorageKey(tractateId, dafId);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_AUDIO, "readonly");
      const req = tx.objectStore(STORE_AUDIO).get(key);
      req.onsuccess = () => {
        db.close();
        const val = req.result as { blob?: Blob; fileName?: string } | undefined;
        if (val?.blob instanceof Blob && typeof val.fileName === "string") {
          resolve({ blob: val.blob, fileName: val.fileName });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function deleteAudioSyncFile(tractateId: string, dafId: string): Promise<void> {
  const db = await openAudioSyncDb();
  if (!db) return;
  const key = buildSyncMapStorageKey(tractateId, dafId);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_AUDIO, "readwrite");
      tx.objectStore(STORE_AUDIO).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

/**
 * Finds the active segment whose `[startMs, endMs)` covers `timeMs`.
 */
export function findActiveSyncSegment(
  segments: readonly AudioSyncSegment[],
  timeMs: number,
): AudioSyncSegment | null {
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;
  for (const seg of segments) {
    if (timeMs >= seg.startMs && timeMs < seg.endMs) {
      return seg;
    }
  }
  return null;
}

/**
 * Finds the active segment while bridging lecture pauses/gaps between consecutive
 * segments so the highlighter on the Daf stays steadily visible during explanations.
 */
export function findContinuousActiveSyncSegment(
  segments: readonly AudioSyncSegment[],
  timeMs: number,
  maxBridgeGapMs = 20_000,
): AudioSyncSegment | null {
  if (!Number.isFinite(timeMs) || timeMs < 0 || segments.length === 0) return null;
  const exact = findActiveSyncSegment(segments, timeMs);
  if (exact) return exact;

  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    if (!cur) continue;
    const next = segments[i + 1];
    if (next) {
      if (timeMs >= cur.endMs && timeMs < next.startMs && timeMs - cur.endMs <= maxBridgeGapMs) {
        return cur;
      }
    } else if (timeMs >= cur.endMs && timeMs - cur.endMs <= Math.min(maxBridgeGapMs, 6_000)) {
      return cur;
    }
  }
  return null;
}

export type SegmentMatchKind = "exact" | "approximate" | "unmatched";

export interface AudioSyncResolutionSummary {
  bySegment: Map<string, string[]>;
  matchKindBySegment: Map<string, SegmentMatchKind>;
  matchedSegmentCount: number;
  exactSegmentCount: number;
  approximateSegmentCount: number;
}

/**
 * Resolves every segment's `WordAnchor[]` against live extracted PDF hotspots,
 * falling back cleanly to approximate `textHe` phrase matching (strictly within
 * Mishnah & Gemara tokens) whenever stored anchors are missing, tied, or drifted.
 */
export function resolveSegmentsWithApproximateFallback(
  map: AudioSyncMap,
  hotspots: readonly SyncHotspotLike[],
): AudioSyncResolutionSummary {
  const bySegment = new Map<string, string[]>();
  const matchKindBySegment = new Map<string, SegmentMatchKind>();
  let matchedSegmentCount = 0;
  let exactSegmentCount = 0;
  let approximateSegmentCount = 0;

  if (hotspots.length === 0) {
    return {
      bySegment,
      matchKindBySegment,
      matchedSegmentCount,
      exactSegmentCount,
      approximateSegmentCount,
    };
  }

  let softReadingCursor = 0;

  for (const seg of map.segments) {
    if (seg.dafTransition && seg.anchors.length === 0) {
      bySegment.set(seg.id, []);
      matchKindBySegment.set(seg.id, "unmatched");
      continue;
    }

    const wasApproxAligned = Boolean(
      seg.diagnostics?.some((d) => d.startsWith("approximate-")),
    );

    if (seg.anchors.length > 0) {
      const strictRes = resolveSyncHotspots(hotspots, seg);
      if (strictRes.hotspotIds.length > 0) {
        bySegment.set(seg.id, strictRes.hotspotIds);
        const kind: SegmentMatchKind = wasApproxAligned ? "approximate" : "exact";
        matchKindBySegment.set(seg.id, kind);
        matchedSegmentCount++;
        if (kind === "exact") exactSegmentCount++;
        else approximateSegmentCount++;
        const lastAnchor = seg.anchors[seg.anchors.length - 1];
        if (lastAnchor && lastAnchor.readingOrderIndex >= 0) {
          softReadingCursor = lastAnchor.readingOrderIndex + 1;
        }
        continue;
      }

      const approxAnchorRes = resolveSyncHotspots(hotspots, seg, {
        approximate: true,
        preferredOrderHint: softReadingCursor,
      });
      if (approxAnchorRes.hotspotIds.length > 0) {
        bySegment.set(seg.id, approxAnchorRes.hotspotIds);
        matchKindBySegment.set(seg.id, "approximate");
        matchedSegmentCount++;
        approximateSegmentCount++;
        const lastAnchor = seg.anchors[seg.anchors.length - 1];
        if (lastAnchor && lastAnchor.readingOrderIndex >= 0) {
          softReadingCursor = lastAnchor.readingOrderIndex + 1;
        }
        continue;
      }
    }

    // Fallback: align `seg.textHe` directly against Mishnah/Gemara hotspots when anchors are empty or drifted
    if (seg.textHe.trim().length > 0) {
      const approx = findApproximatePhraseMatch(hotspots, seg.textHe, softReadingCursor);
      if (approx && approx.hotspotIds.length > 0) {
        bySegment.set(seg.id, approx.hotspotIds);
        matchKindBySegment.set(seg.id, "approximate");
        matchedSegmentCount++;
        approximateSegmentCount++;
        if (approx.endTokenIdx >= softReadingCursor && approx.endTokenIdx - softReadingCursor <= 180) {
          softReadingCursor = approx.endTokenIdx + 1;
        }
        continue;
      }
    }

    bySegment.set(seg.id, []);
    matchKindBySegment.set(seg.id, "unmatched");
  }

  return {
    bySegment,
    matchKindBySegment,
    matchedSegmentCount,
    exactSegmentCount,
    approximateSegmentCount,
  };
}

/**
 * Resolves every segment's `WordAnchor[]` against live extracted PDF hotspots,
 * including approximate live phrase fallback when stored anchors are empty.
 */
export function resolveAllSegmentsToHotspots(
  map: AudioSyncMap,
  hotspots: readonly SyncHotspotLike[],
): Map<string, string[]> {
  return resolveSegmentsWithApproximateFallback(map, hotspots).bySegment;
}

/**
 * Builds an inverted `hotspotId -> AudioSyncSegment` lookup for instant click-to-seek.
 */
export function buildHotspotToSegmentMap(
  map: AudioSyncMap,
  resolvedBySegment: ReadonlyMap<string, readonly string[]>,
): Map<string, AudioSyncSegment> {
  const lookup = new Map<string, AudioSyncSegment>();
  for (const seg of map.segments) {
    const ids = resolvedBySegment.get(seg.id);
    if (!ids) continue;
    for (const id of ids) {
      if (!lookup.has(id)) {
        lookup.set(id, seg);
      }
    }
  }
  return lookup;
}
