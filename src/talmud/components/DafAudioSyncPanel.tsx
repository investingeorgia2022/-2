import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileText,
  Headphones,
  Link2,
  Loader2,
  MousePointerClick,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  classifyConfidenceBand,
  type AudioSyncMap,
  type AudioSyncSegment,
  type SyncHotspotLike,
} from "../utils/audioSyncTypes";
import {
  buildAudioProxyCheckUrl,
  buildAudioProxyStreamUrl,
  buildHotspotToSegmentMap,
  buildSyncMapStorageKey,
  deleteAudioSyncFile,
  deleteAudioSyncMap,
  exportSyncMapJson,
  findContinuousActiveSyncSegment,
  formatMsToTimestamp,
  importSyncMapJson,
  loadAudioSourceConfig,
  loadAudioSyncFile,
  loadAudioSyncMap,
  parseTranscriptToSegments,
  resolveAudioSourceUrl,
  resolveSegmentsWithApproximateFallback,
  saveAudioSourceConfig,
  saveAudioSyncFile,
  saveAudioSyncMap,
  type AudioSourceConfig,
  type SegmentMatchKind,
} from "../utils/audioSyncStorage";
import { alignGemaraSegments } from "../utils/gemaraPhraseAligner";

export interface DafAudioSyncPanelProps {
  open?: boolean;
  tractateId: string;
  dafId: string;
  tractateNameKa: string;
  dafMarkHe: string;
  isDark: boolean;
  hotspots: readonly SyncHotspotLike[];
  dafExcerptHe?: string;
  dafReferenceKa?: string;
  onClose: () => void;
  onActiveHighlightChange: (
    hotspotIds: ReadonlySet<string>,
    activeSegmentId: string | null,
  ) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onRegisterSeekHandler: (handler: ((hotspotId: string) => boolean) | null) => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const AUDIO_NOT_FOUND_MESSAGE = "ამ დაფზე აუდიო ფაილი ვერ მოიძებნა";

type AudioResolutionState = "idle" | "resolving" | "ready" | "not-found" | "error";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read audio file"));
    reader.readAsDataURL(blob);
  });
}

export const DafAudioSyncPanel: React.FC<DafAudioSyncPanelProps> = ({
  open = true,
  tractateId,
  dafId,
  tractateNameKa,
  dafMarkHe,
  isDark,
  hotspots,
  dafExcerptHe,
  dafReferenceKa,
  onClose,
  onActiveHighlightChange,
  onAutoScrollChange,
  onRegisterSeekHandler,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const remoteAudioUrlRef = useRef<string | null>(null);
  const sourceKeyRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const autoSyncDesiredRef = useRef(false);
  const autoSyncTriggeredKeyRef = useRef<string | null>(null);
  const autoReSyncAttemptedKeyRef = useRef<string | null>(null);

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string | null>(null);
  const [resolutionState, setResolutionState] = useState<AudioResolutionState>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  const [sourceConfig, setSourceConfig] = useState<AudioSourceConfig>(() => loadAudioSourceConfig());
  const [templateDraft, setTemplateDraft] = useState("");
  const [dafUrlDraft, setDafUrlDraft] = useState("");

  const [syncMap, setSyncMap] = useState<AudioSyncMap | null>(null);
  const [hasLoadedPersistedMap, setHasLoadedPersistedMap] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wordSeekEnabled, setWordSeekEnabled] = useState(true);
  const [showToolsDrawer, setShowToolsDrawer] = useState(false);
  const [isSegmentsExpanded, setIsSegmentsExpanded] = useState(false);
  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<"all" | "needs-review">("all");
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingTextHe, setEditingTextHe] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const revokeCurrentAudioUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      onActiveHighlightChange(new Set(), null);
      onRegisterSeekHandler(null);
    }
  }, [open, onActiveHighlightChange, onRegisterSeekHandler]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      revokeCurrentAudioUrl();
      onActiveHighlightChange(new Set(), null);
      onRegisterSeekHandler(null);
    };
  }, [revokeCurrentAudioUrl, onActiveHighlightChange, onRegisterSeekHandler]);

  // Load persisted sync map, local cached file, and source URL settings for the active daf
  useEffect(() => {
    let cancelled = false;
    setIsPlaying(false);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setStatusMessage(null);
    setErrorMessage(null);
    setEditingSegmentId(null);
    setResolutionState("idle");
    setHasLoadedPersistedMap(false);
    revokeCurrentAudioUrl();
    setAudioUrl(null);
    setAudioFileName(null);
    audioBlobRef.current = null;
    remoteAudioUrlRef.current = null;
    sourceKeyRef.current = null;
    autoSyncDesiredRef.current = false;
    autoSyncTriggeredKeyRef.current = null;
    autoReSyncAttemptedKeyRef.current = null;

    const latestConfig = loadAudioSourceConfig();
    setSourceConfig(latestConfig);
    setTemplateDraft(latestConfig.urlTemplate);
    setDafUrlDraft(latestConfig.dafOverrides[buildSyncMapStorageKey(tractateId, dafId)] ?? "");

    Promise.all([loadAudioSyncMap(tractateId, dafId), loadAudioSyncFile(tractateId, dafId)])
      .then(([loadedMap, loadedFile]) => {
        if (cancelled) return;
        setSyncMap(loadedMap);
        if (loadedFile) {
          audioBlobRef.current = loadedFile.blob;
          sourceKeyRef.current = `local:${loadedFile.fileName}`;
          const url = URL.createObjectURL(loadedFile.blob);
          objectUrlRef.current = url;
          setAudioUrl(url);
          setAudioFileName(loadedFile.fileName);
          setResolutionState("ready");
        }
        setHasLoadedPersistedMap(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSyncMap(null);
          setHasLoadedPersistedMap(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tractateId, dafId, revokeCurrentAudioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

  // High-frequency playback clock synced to <audio>.currentTime so word highlights advance smoothly
  useEffect(() => {
    if (!open || !isPlaying || typeof requestAnimationFrame === "undefined") return;
    let rafId = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused) {
        const nextMs = Math.round(el.currentTime * 1000);
        setCurrentTimeMs((prev) => (Math.abs(nextMs - prev) >= 40 ? nextMs : prev));
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [open, isPlaying]);

  const resolutionSummary = useMemo(() => {
    if (!syncMap) return null;
    return resolveSegmentsWithApproximateFallback(syncMap, hotspots);
  }, [syncMap, hotspots]);

  const resolvedBySegment = useMemo(
    () => resolutionSummary?.bySegment ?? new Map<string, string[]>(),
    [resolutionSummary],
  );

  const matchKindBySegment = useMemo(
    () => resolutionSummary?.matchKindBySegment ?? new Map<string, SegmentMatchKind>(),
    [resolutionSummary],
  );

  const hasZeroMatches = Boolean(
    syncMap &&
      syncMap.segments.length > 0 &&
      hotspots.length > 0 &&
      (resolutionSummary?.matchedSegmentCount ?? 0) === 0,
  );

  const hotspotToSegment = useMemo(() => {
    if (!syncMap) return new Map<string, AudioSyncSegment>();
    return buildHotspotToSegmentMap(syncMap, resolvedBySegment);
  }, [syncMap, resolvedBySegment]);

  const activeSegment = useMemo(() => {
    if (!syncMap) return null;
    return findContinuousActiveSyncSegment(syncMap.segments, currentTimeMs);
  }, [syncMap, currentTimeMs]);

  useEffect(() => {
    if (!open) return;
    if (!activeSegment) {
      onActiveHighlightChange(new Set(), null);
      return;
    }
    const ids = resolvedBySegment.get(activeSegment.id) ?? [];
    onActiveHighlightChange(new Set(ids), activeSegment.id);
  }, [open, activeSegment, resolvedBySegment, onActiveHighlightChange]);

  useEffect(() => {
    onAutoScrollChange(autoScroll);
  }, [autoScroll, onAutoScrollChange]);

  const seekToMs = useCallback((targetMs: number) => {
    const clamped = Math.max(0, Math.round(targetMs));
    setCurrentTimeMs(clamped);
    const el = audioRef.current;
    if (el) {
      el.currentTime = clamped / 1000;
    }
  }, []);

  useEffect(() => {
    if (!open || !wordSeekEnabled || !syncMap) {
      onRegisterSeekHandler(null);
      return;
    }
    onRegisterSeekHandler((hotspotId: string) => {
      const seg = hotspotToSegment.get(hotspotId);
      if (!seg) return false;
      seekToMs(seg.startMs);
      return true;
    });
  }, [open, wordSeekEnabled, syncMap, hotspotToSegment, onRegisterSeekHandler, seekToMs]);

  const persistUpdatedMap = useCallback(async (nextMap: AudioSyncMap) => {
    setSyncMap(nextMap);
    await saveAudioSyncMap(nextMap);
  }, []);

  const alignTranscriptText = useCallback(
    async (rawText: string, sourceTitle?: string) => {
      setErrorMessage(null);
      const segments = parseTranscriptToSegments(rawText, durationMs > 0 ? durationMs : undefined);
      if (segments.length === 0) {
        setErrorMessage("ტექსტში ებრაული/არამეული ფრაზები ვერ მოიძებნა.");
        return;
      }
      if (hotspots.length === 0) {
        setErrorMessage("დაფის PDF სიტყვები ჯერ არ არის ჩატვირთული — დაელოდეთ გვერდის გახსნას.");
        return;
      }

      const run = alignGemaraSegments(hotspots, segments, {
        tractateId,
        dafId,
        title: sourceTitle ?? `${tractateNameKa} ${dafMarkHe}`,
      }, {
        allowApproximate: true,
      });
      await persistUpdatedMap(run.map);
      const matchedCount = run.results.filter((r) => r.matchedHotspotIds.length > 0).length;
      const reviewCount = run.map.segments.filter(
        (s) => s.reviewStatus === "needs-review" || s.reviewStatus === "unmatched",
      ).length;
      setStatusMessage(
        `სინქრონიზებულია ${run.map.segments.length} სეგმენტი (${matchedCount} მიბმული, ${reviewCount} შესამოწმებელი).`,
      );
      setIsSegmentsExpanded(true);
    },
    [dafId, dafMarkHe, durationMs, hotspots, persistUpdatedMap, tractateId, tractateNameKa],
  );

  const handleAudioFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setErrorMessage(null);
      setStatusMessage(null);

      revokeCurrentAudioUrl();
      audioBlobRef.current = file;
      remoteAudioUrlRef.current = null;
      sourceKeyRef.current = `local:${file.name}:${file.size}`;
      autoSyncDesiredRef.current = false;
      autoSyncTriggeredKeyRef.current = null;
      autoReSyncAttemptedKeyRef.current = null;

      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setAudioUrl(url);
      setAudioFileName(file.name);
      setResolutionState("ready");
      setIsPlaying(false);
      setCurrentTimeMs(0);

      await saveAudioSyncFile(tractateId, dafId, file, file.name);
      setStatusMessage(`აუდიო ჩატვირთულია: ${file.name}`);
    },
    [dafId, revokeCurrentAudioUrl, tractateId],
  );

  const handleRunAiTranscribe = useCallback(
    async (opts?: { auto?: boolean }) => {
      const blob = audioBlobRef.current;
      const remoteUrl = remoteAudioUrlRef.current;

      if (!blob && !remoteUrl) {
        if (!opts?.auto) {
          setErrorMessage("ჯერ ატვირთეთ აუდიო ფაილი ან მიუთითეთ აუდიოს ბმული.");
        }
        return;
      }
      if (blob && blob.size > MAX_UPLOAD_BYTES) {
        setErrorMessage("AI სინქრონიზაციისთვის აუდიო ფაილი 24 MB-ზე ნაკლები უნდა იყოს.");
        return;
      }
      if (hotspots.length === 0) {
        if (!opts?.auto) {
          setErrorMessage("დაფის PDF სიტყვები ჯერ არ არის მზად.");
        }
        return;
      }

      setIsTranscribing(true);
      setErrorMessage(null);
      setStatusMessage("AI სინქრონიზაცია მიმდინარეობს…");

      try {
        let resolvedDurationMs = durationMs > 0 ? durationMs : 0;
        const el = audioRef.current;
        if (resolvedDurationMs === 0 && el) {
          if (Number.isFinite(el.duration) && el.duration > 0) {
            resolvedDurationMs = Math.round(el.duration * 1000);
          } else if (el.src) {
            await new Promise<void>((resolve) => {
              let settled = false;
              const done = () => {
                if (settled) return;
                settled = true;
                el.removeEventListener("loadedmetadata", onMeta);
                window.clearTimeout(timer);
                resolve();
              };
              const onMeta = () => done();
              const timer = window.setTimeout(done, 160);
              el.addEventListener("loadedmetadata", onMeta, { once: true });
            });
            if (Number.isFinite(el.duration) && el.duration > 0) {
              resolvedDurationMs = Math.round(el.duration * 1000);
              setDurationMs(resolvedDurationMs);
            }
          }
        }

        const payload: Record<string, unknown> = {
          durationMs: resolvedDurationMs > 0 ? resolvedDurationMs : undefined,
          tractateId,
          dafId,
          dafExcerptHe,
          dafReferenceKa,
        };

        if (blob) {
          payload["audioBase64"] = await blobToBase64(blob);
          payload["mimeType"] = blob.type || "audio/mp3";
        } else if (remoteUrl) {
          payload["audioUrl"] = remoteUrl;
        }

        const res = await fetch("/api/talmud/audio-sync-transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = (await res.json()) as {
          transcript?: string;
          segments?: Array<{
            id: string;
            startMs: number;
            endMs: number;
            textHe: string;
            topicKa?: string;
          }>;
          error?: string;
          code?: string;
        };

        if (!res.ok || data.error) {
          if (data.code === "missing_gemini_api_key") {
            setErrorMessage(
              "AI გასაღები არ არის კონფიგურირებული — შეგიძლიათ ატვირთოთ ტექსტი ან JSON.",
            );
          } else if (data.error === "gemini_busy") {
            setErrorMessage("AI სერვისი დროებით დატვირთულია — სცადეთ თავიდან.");
          } else if (data.error === "audio_too_large") {
            setErrorMessage("AI სინქრონიზაციისთვის აუდიო ფაილი 24 MB-ზე ნაკლები უნდა იყოს.");
          } else {
            setErrorMessage(`AI ტრანსკრიპცია ვერ შესრულდა (${data.error ?? res.status}).`);
          }
          setStatusMessage(null);
          return;
        }

        const aiSegments = data.segments ?? [];
        if (aiSegments.length === 0) {
          setErrorMessage("AI-მ ტექსტი ვერ ამოიცნო — სცადეთ ტექსტის ხელით ჩასმა.");
          setStatusMessage(null);
          return;
        }

        const run = alignGemaraSegments(
          hotspots,
          aiSegments,
          {
            tractateId,
            dafId,
            title: audioFileName ?? `${tractateNameKa} ${dafMarkHe}`,
          },
          { allowApproximate: true },
        );
        await persistUpdatedMap(run.map);
        const boundCount = run.results.filter((r) => r.matchedHotspotIds.length > 0).length;
        setStatusMessage(
          `AI სინქი დასრულდა: ${boundCount}/${run.map.segments.length} სეგმენტი მიბმულია დაფაზე.`,
        );
        if (!opts?.auto) {
          setIsSegmentsExpanded(true);
        }
      } catch {
        setErrorMessage("ქსელის შეცდომა AI სინქრონიზაციისას.");
        setStatusMessage(null);
      } finally {
        setIsTranscribing(false);
      }
    },
    [
      audioFileName,
      dafExcerptHe,
      dafId,
      dafMarkHe,
      dafReferenceKa,
      durationMs,
      hotspots,
      persistUpdatedMap,
      tractateId,
      tractateNameKa,
    ],
  );

  // Automatic AI sync when audio plays without a map OR with a stale 0-match cached map
  useEffect(() => {
    if (!open || !hasLoadedPersistedMap || isTranscribing) return;
    if (hotspots.length === 0) return;
    if (!audioBlobRef.current && !remoteAudioUrlRef.current) return;

    const dedupeKey = sourceKeyRef.current
      ? `${tractateId}:${dafId}:${sourceKeyRef.current}`
      : null;
    if (!dedupeKey) return;

    if (!syncMap) {
      if (!autoSyncDesiredRef.current) return;
      if (autoSyncTriggeredKeyRef.current === dedupeKey) return;
      autoSyncTriggeredKeyRef.current = dedupeKey;
      void handleRunAiTranscribe({ auto: true });
      return;
    }

    if (hasZeroMatches && (autoSyncDesiredRef.current || isPlaying)) {
      if (autoReSyncAttemptedKeyRef.current === dedupeKey) return;
      autoReSyncAttemptedKeyRef.current = dedupeKey;
      void handleRunAiTranscribe({ auto: true });
    }
  }, [
    audioUrl,
    dafId,
    handleRunAiTranscribe,
    hasLoadedPersistedMap,
    hasZeroMatches,
    hotspots.length,
    isPlaying,
    isTranscribing,
    open,
    syncMap,
    tractateId,
  ]);

  const handlePlayOrResolve = useCallback(async () => {
    const el = audioRef.current;

    if (audioUrl && el) {
      if (el.paused) {
        setErrorMessage(null);
        if (!syncMap || hasZeroMatches) {
          autoSyncDesiredRef.current = true;
        }
        try {
          await el.play();
          setIsPlaying(true);
        } catch {
          setErrorMessage("ბრაუზერმა აუდიოს დაკვრა ვერ დაიწყო.");
        }
      } else {
        el.pause();
        setIsPlaying(false);
      }
      return;
    }

    setResolutionState("resolving");
    setErrorMessage(null);
    setStatusMessage("მიმდინარეობს დაფის აუდიოს ძიება…");

    // 1. Check cached local audio blob in IndexedDB
    try {
      const cached = audioBlobRef.current
        ? { blob: audioBlobRef.current, fileName: audioFileName ?? `${tractateId}-${dafId}` }
        : await loadAudioSyncFile(tractateId, dafId);
      if (cached) {
        revokeCurrentAudioUrl();
        audioBlobRef.current = cached.blob;
        remoteAudioUrlRef.current = null;
        sourceKeyRef.current = `local:${cached.fileName}`;
        autoSyncDesiredRef.current = !syncMap || hasZeroMatches;
        const url = URL.createObjectURL(cached.blob);
        objectUrlRef.current = url;
        setAudioUrl(url);
        setAudioFileName(cached.fileName);
        setResolutionState("ready");
        setStatusMessage(null);
        if (el) {
          el.src = url;
          el.playbackRate = playbackRate;
          try {
            await el.play();
            setIsPlaying(true);
          } catch {
            setErrorMessage("ბრაუზერმა აუდიოს დაკვრა ვერ დაიწყო.");
          }
        }
        return;
      }
    } catch {
      // Fall through to remote source check
    }

    // 2. Resolve configured storage URL / template for this (tractateId, dafId)
    const candidateUrl = resolveAudioSourceUrl(tractateId, dafId, sourceConfig);
    if (!candidateUrl) {
      setResolutionState("not-found");
      setStatusMessage(null);
      setErrorMessage(AUDIO_NOT_FOUND_MESSAGE);
      return;
    }

    try {
      const checkRes = await fetch(buildAudioProxyCheckUrl(candidateUrl));
      let checkData: { exists?: boolean; error?: string } = {};
      try {
        checkData = (await checkRes.json()) as { exists?: boolean; error?: string };
      } catch {
        checkData = {};
      }

      if (!checkRes.ok || !checkData.exists) {
        setResolutionState("not-found");
        setStatusMessage(null);
        setErrorMessage(AUDIO_NOT_FOUND_MESSAGE);
        return;
      }

      const streamUrl = buildAudioProxyStreamUrl(candidateUrl);
      revokeCurrentAudioUrl();
      audioBlobRef.current = null;
      remoteAudioUrlRef.current = candidateUrl;
      sourceKeyRef.current = `remote:${candidateUrl}`;
      autoSyncDesiredRef.current = !syncMap || hasZeroMatches;

      const derivedName = candidateUrl.split("/").pop()?.split("?")[0] || `${tractateNameKa} ${dafMarkHe}`;
      setAudioUrl(streamUrl);
      setAudioFileName(derivedName);
      setResolutionState("ready");
      setStatusMessage(null);

      if (el) {
        el.src = streamUrl;
        el.playbackRate = playbackRate;
        try {
          await el.play();
          setIsPlaying(true);
        } catch {
          setErrorMessage("ბრაუზერმა აუდიოს დაკვრა ვერ დაიწყო.");
        }
      }
    } catch {
      setResolutionState("not-found");
      setStatusMessage(null);
      setErrorMessage(AUDIO_NOT_FOUND_MESSAGE);
    }
  }, [
    audioFileName,
    audioUrl,
    dafId,
    dafMarkHe,
    hasZeroMatches,
    playbackRate,
    revokeCurrentAudioUrl,
    sourceConfig,
    syncMap,
    tractateId,
    tractateNameKa,
  ]);

  const handleSaveSourceConfig = useCallback(() => {
    const key = buildSyncMapStorageKey(tractateId, dafId);
    const nextOverrides = { ...sourceConfig.dafOverrides };
    const cleanDafUrl = dafUrlDraft.trim();
    if (cleanDafUrl) {
      nextOverrides[key] = cleanDafUrl;
    } else {
      delete nextOverrides[key];
    }

    const nextConfig: AudioSourceConfig = {
      urlTemplate: templateDraft.trim(),
      dafOverrides: nextOverrides,
    };
    saveAudioSourceConfig(nextConfig);
    setSourceConfig(nextConfig);

    // Clear stale remote source so the next Play press uses the newly saved link
    if (!audioBlobRef.current) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
      }
      remoteAudioUrlRef.current = null;
      sourceKeyRef.current = null;
      autoSyncDesiredRef.current = false;
      autoSyncTriggeredKeyRef.current = null;
      autoReSyncAttemptedKeyRef.current = null;
      setAudioUrl(null);
      setAudioFileName(null);
      setIsPlaying(false);
    }
    setResolutionState("idle");
    setErrorMessage(null);
    setStatusMessage("აუდიო წყაროს ბმული შენახულია — დააჭირეთ „ჩართვა“.");
  }, [dafId, dafUrlDraft, sourceConfig.dafOverrides, templateDraft, tractateId]);

  const handleClearSourceConfig = useCallback(() => {
    const key = buildSyncMapStorageKey(tractateId, dafId);
    const nextOverrides = { ...sourceConfig.dafOverrides };
    delete nextOverrides[key];
    const nextConfig: AudioSourceConfig = {
      urlTemplate: "",
      dafOverrides: nextOverrides,
    };
    saveAudioSourceConfig(nextConfig);
    setSourceConfig(nextConfig);
    setTemplateDraft("");
    setDafUrlDraft("");
    if (!audioBlobRef.current) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
      }
      remoteAudioUrlRef.current = null;
      sourceKeyRef.current = null;
      setAudioUrl(null);
      setAudioFileName(null);
      setIsPlaying(false);
    }
    setResolutionState("idle");
    setErrorMessage(null);
    setStatusMessage("აუდიო წყაროს პარამეტრები გასუფთავდა.");
  }, [dafId, sourceConfig.dafOverrides, tractateId]);

  const handleImportFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const text = await file.text();
        if (file.name.toLowerCase().endsWith(".json")) {
          const imported = importSyncMapJson(text);
          if (imported.tractateId !== tractateId || imported.dafId !== dafId) {
            setErrorMessage(
              `ეს JSON განკუთვნილია ${imported.tractateId} ${imported.dafId}-სთვის და არა მიმდინარე დაფისთვის (${tractateId} ${dafId}).`,
            );
            return;
          }
          await persistUpdatedMap(imported);
          setStatusMessage(`იმპორტირებულია ${imported.segments.length} სეგმენტი JSON-დან.`);
          setIsSegmentsExpanded(true);
        } else {
          await alignTranscriptText(text, file.name);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "ფაილის იმპორტი ვერ შესრულდა.");
      }
    },
    [alignTranscriptText, dafId, persistUpdatedMap, tractateId],
  );

  const handleApplyPastedTranscript = useCallback(async () => {
    const raw = transcriptDraft.trim();
    if (!raw) return;
    setErrorMessage(null);

    if (raw.startsWith("{")) {
      try {
        const imported = importSyncMapJson(raw);
        if (imported.tractateId !== tractateId || imported.dafId !== dafId) {
          setErrorMessage(`JSON ეკუთვნის სხვა დაფს (${imported.tractateId} ${imported.dafId}).`);
          return;
        }
        await persistUpdatedMap(imported);
        setShowTranscriptDrawer(false);
        setTranscriptDraft("");
        setStatusMessage(`ჩატვირთულია ${imported.segments.length} სეგმენტი JSON-დან.`);
        setIsSegmentsExpanded(true);
        return;
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "არასწორი JSON ფორმატი.");
        return;
      }
    }

    await alignTranscriptText(raw);
    setShowTranscriptDrawer(false);
  }, [alignTranscriptText, dafId, persistUpdatedMap, tractateId, transcriptDraft]);

  const handleExportJson = useCallback(() => {
    if (!syncMap) return;
    setErrorMessage(null);
    try {
      const json = exportSyncMapJson(syncMap);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tractateId}-${dafId}-audio-sync.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMessage("სინქრონიზაციის რუკა ექსპორტირდა JSON ფაილად.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "ექსპორტი ვერ შესრულდა.");
    }
  }, [dafId, syncMap, tractateId]);

  const handleClearSyncData = useCallback(async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
    revokeCurrentAudioUrl();
    audioBlobRef.current = null;
    remoteAudioUrlRef.current = null;
    sourceKeyRef.current = null;
    autoSyncDesiredRef.current = false;
    autoSyncTriggeredKeyRef.current = null;
    autoReSyncAttemptedKeyRef.current = null;
    setAudioUrl(null);
    setAudioFileName(null);
    setResolutionState("idle");
    setIsPlaying(false);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setSyncMap(null);
    setStatusMessage("მიმდინარე დაფის აუდიო სინქრონიზაცია გასუფთავდა.");
    setErrorMessage(null);
    await Promise.all([
      deleteAudioSyncMap(tractateId, dafId),
      deleteAudioSyncFile(tractateId, dafId),
    ]);
  }, [dafId, revokeCurrentAudioUrl, tractateId]);

  const handleCycleSpeed = useCallback(() => {
    const curIdx = SPEED_OPTIONS.indexOf(playbackRate as (typeof SPEED_OPTIONS)[number]);
    const next = SPEED_OPTIONS[(curIdx + 1) % SPEED_OPTIONS.length] ?? 1;
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }, [playbackRate]);

  const handleVerifySegment = useCallback(
    async (segmentId: string) => {
      if (!syncMap) return;
      const updated: AudioSyncMap = {
        ...syncMap,
        segments: syncMap.segments.map((s) =>
          s.id === segmentId ? { ...s, reviewStatus: "verified" } : s,
        ),
      };
      await persistUpdatedMap(updated);
    },
    [persistUpdatedMap, syncMap],
  );

  const handleRealignEditedSegment = useCallback(
    async (seg: AudioSyncSegment) => {
      if (!syncMap || !editingTextHe.trim()) return;
      const run = alignGemaraSegments(
        hotspots,
        [
          {
            id: seg.id,
            startMs: seg.startMs,
            endMs: seg.endMs,
            textHe: editingTextHe.trim(),
            ...(seg.dafId ? { dafId: seg.dafId } : {}),
          },
        ],
        { tractateId, dafId },
        { allowApproximate: true },
      );
      const realigned = run.map.segments[0];
      if (!realigned) return;

      const updated: AudioSyncMap = {
        ...syncMap,
        segments: syncMap.segments.map((s) => (s.id === seg.id ? realigned : s)),
      };
      await persistUpdatedMap(updated);
      setEditingSegmentId(null);
      setEditingTextHe("");
    },
    [dafId, editingTextHe, hotspots, persistUpdatedMap, syncMap, tractateId],
  );

  const effectiveDurationMs = useMemo(() => {
    if (durationMs > 0) return durationMs;
    const lastSeg = syncMap?.segments[syncMap.segments.length - 1];
    return lastSeg ? lastSeg.endMs : 0;
  }, [durationMs, syncMap]);

  const needsReviewCount = useMemo(() => {
    if (!syncMap) return 0;
    return syncMap.segments.filter(
      (s) => s.reviewStatus === "needs-review" || s.reviewStatus === "unmatched",
    ).length;
  }, [syncMap]);

  const visibleSegments = useMemo(() => {
    if (!syncMap) return [];
    if (segmentFilter === "needs-review") {
      return syncMap.segments.filter(
        (s) => s.reviewStatus === "needs-review" || s.reviewStatus === "unmatched",
      );
    }
    return syncMap.segments;
  }, [segmentFilter, syncMap]);

  const isResolvingAudio = resolutionState === "resolving";
  const hasAnyAudioSource = Boolean(audioUrl || audioBlobRef.current || remoteAudioUrlRef.current);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="daf-audio-sync-top-bar"
          data-daf-audio-sync-panel="true"
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.85 }}
          className="fixed top-0 left-0 right-0 z-[400] px-2 pt-2 pointer-events-none"
        >
          <section
            aria-label="აუდიო სინქრონიზაცია დაფაზე"
            data-testid="daf-audio-sync-panel"
            data-crystal-audio-panel="true"
            data-crystal-dark={isDark ? "true" : "false"}
            className={`${isDark ? "dark " : ""}pointer-events-auto mx-auto w-full max-w-4xl rounded-[22px] overflow-hidden crystal-window-shell max-h-[82dvh] flex flex-col`}
          >
            <audio
              ref={audioRef}
              src={audioUrl ?? undefined}
              preload="metadata"
              onTimeUpdate={(e) => setCurrentTimeMs(Math.round(e.currentTarget.currentTime * 1000))}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) setDurationMs(Math.round(d * 1000));
                e.currentTarget.playbackRate = playbackRate;
              }}
              onError={() => {
                if (audioUrl) {
                  setIsPlaying(false);
                  setResolutionState("not-found");
                  setErrorMessage(AUDIO_NOT_FOUND_MESSAGE);
                }
              }}
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => {
                setIsPlaying(true);
                if (!syncMap || hasZeroMatches) {
                  autoSyncDesiredRef.current = true;
                }
              }}
            />

            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleAudioFileSelected}
            />
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json,.srt,.vtt,.txt"
              className="hidden"
              onChange={handleImportFileSelected}
            />

            {/* Header Band */}
            <div className="crystal-window-header px-3 py-2 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="crystal-corner-orb w-7 h-7 shrink-0 pointer-events-none"
                  data-tone="amber"
                >
                  <Headphones className="w-3.5 h-3.5" />
                </span>
                <span className="text-xs font-extrabold tracking-tight truncate">
                  აუდიო სინქი • {tractateNameKa} {dafMarkHe}
                </span>
                {audioFileName && (
                  <span className="hidden sm:inline text-[11px] font-semibold opacity-75 truncate max-w-[170px]">
                    ({audioFileName})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  data-raw-btn="true"
                  aria-expanded={showToolsDrawer}
                  onClick={() => setShowToolsDrawer((v) => !v)}
                  data-tone={showToolsDrawer ? "amber" : undefined}
                  className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer"
                  title="აუდიო წყარო, ფაილი და დამატებითი ინსტრუმენტები"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                  <span>ინსტრუმენტები</span>
                  {showToolsDrawer ? (
                    <ChevronUp className="w-3 h-3 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  )}
                </button>

                <button
                  type="button"
                  data-raw-btn="true"
                  data-tone="rose"
                  onClick={onClose}
                  aria-label="აუდიო პანელის დახურვა"
                  className="crystal-corner-orb w-7 h-7 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Inner Body */}
            <div className="overflow-y-auto px-3 py-2 space-y-2">
              {/* Compact Mini-Player Trough */}
              <div className="crystal-window-trough rounded-2xl px-2.5 py-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-raw-btn="true"
                    onClick={() => seekToMs(currentTimeMs - 5000)}
                    aria-label="5 წამით უკან"
                    className="crystal-corner-orb w-8 h-8 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    data-raw-btn="true"
                    data-tone="sky"
                    disabled={isResolvingAudio}
                    onClick={handlePlayOrResolve}
                    aria-label={isPlaying ? "პაუზა" : "დაკვრა"}
                    className="crystal-action-orb h-8 px-3.5 font-extrabold text-xs cursor-pointer disabled:opacity-55 disabled:cursor-wait"
                  >
                    {isResolvingAudio ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : isPlaying ? (
                      <Pause className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Play className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {isResolvingAudio ? "იძებნება..." : isPlaying ? "პაუზა" : "ჩართვა"}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-raw-btn="true"
                    onClick={() => seekToMs(currentTimeMs + 5000)}
                    aria-label="5 წამით წინ"
                    className="crystal-corner-orb w-8 h-8 cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    data-raw-btn="true"
                    onClick={handleCycleSpeed}
                    className="crystal-corner-orb h-8 px-2.5 text-[11px] font-black tabular-nums cursor-pointer"
                    title="სიჩქარის შეცვლა"
                  >
                    {playbackRate}x
                  </button>
                </div>

                <div className="flex-1 min-w-[160px] flex items-center gap-2">
                  <span className="text-[11px] font-mono tabular-nums opacity-85 shrink-0">
                    {formatMsToTimestamp(currentTimeMs)}
                  </span>
                  <input
                    type="range"
                    data-crystal-range="true"
                    aria-label="აუდიოს პროგრესი"
                    min={0}
                    max={Math.max(1000, effectiveDurationMs)}
                    value={Math.min(currentTimeMs, Math.max(1000, effectiveDurationMs))}
                    onChange={(e) => seekToMs(Number(e.target.value))}
                    className="flex-1 cursor-pointer"
                  />
                  <span className="text-[11px] font-mono tabular-nums opacity-85 shrink-0">
                    {formatMsToTimestamp(effectiveDurationMs)}
                  </span>
                </div>
              </div>

              {/* Compact Follow Pills + AI Progress Badge */}
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-raw-btn="true"
                    aria-pressed={autoScroll}
                    data-tone={autoScroll ? "amber" : undefined}
                    onClick={() => setAutoScroll((v) => !v)}
                    className="crystal-action-orb h-7 px-2.5 text-[10px] font-bold cursor-pointer"
                  >
                    <Navigation className="w-3 h-3 shrink-0" />
                    <span>ავტო-სქროლი</span>
                  </button>

                  <button
                    type="button"
                    data-raw-btn="true"
                    aria-pressed={wordSeekEnabled}
                    data-tone={wordSeekEnabled ? "amber" : undefined}
                    onClick={() => setWordSeekEnabled((v) => !v)}
                    className="crystal-action-orb h-7 px-2.5 text-[10px] font-bold cursor-pointer"
                  >
                    <MousePointerClick className="w-3 h-3 shrink-0" />
                    <span>სიტყვით გადახტომა</span>
                  </button>

                  {syncMap && (
                    <button
                      type="button"
                      data-raw-btn="true"
                      aria-expanded={isSegmentsExpanded}
                      onClick={() => setIsSegmentsExpanded((v) => !v)}
                      className="crystal-action-orb h-7 px-2.5 text-[10px] font-extrabold cursor-pointer"
                    >
                      <span>სეგმენტები ({syncMap.segments.length})</span>
                      {isSegmentsExpanded ? (
                        <ChevronUp className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>

                {isTranscribing && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-600 dark:text-sky-300">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>AI სინქრონიზაცია მიმდინარეობს…</span>
                  </span>
                )}
              </div>

              {/* Live Active Spoken Phrase & Georgian Topic Preview */}
              {activeSegment && (
                <div
                  data-testid="active-sync-preview"
                  className="crystal-window-trough rounded-xl px-3 py-1.5 space-y-0.5"
                >
                  <div
                    dir="rtl"
                    className="text-sm font-serif flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-bold">{activeSegment.textHe}</span>
                    <span dir="ltr" className="text-[10px] font-mono opacity-80 shrink-0">
                      {formatMsToTimestamp(activeSegment.startMs)} –{" "}
                      {formatMsToTimestamp(activeSegment.endMs)}
                    </span>
                  </div>
                  {activeSegment.topicKa && (
                    <p
                      dir="ltr"
                      className={`text-[11px] font-semibold truncate ${
                        isDark ? "text-amber-200/90" : "text-amber-900/90"
                      }`}
                    >
                      {activeSegment.topicKa}
                    </p>
                  )}
                  {(() => {
                    const activeKind: SegmentMatchKind =
                      matchKindBySegment.get(activeSegment.id) ?? "unmatched";
                    const activeSpotCount = resolvedBySegment.get(activeSegment.id)?.length ?? 0;
                    if (activeKind === "exact" && activeSpotCount > 0) {
                      return (
                        <div
                          data-testid="active-sync-match-status"
                          data-match-kind="exact"
                          className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                            isDark ? "text-emerald-300/90" : "text-emerald-700"
                          }`}
                        >
                          <Check className="w-3 h-3 shrink-0" />
                          <span>მონიშნულია დაფზე ({activeSpotCount} სიტყვა)</span>
                        </div>
                      );
                    }
                    if (activeKind === "approximate" && activeSpotCount > 0) {
                      return (
                        <div
                          data-testid="active-sync-match-status"
                          data-match-kind="approximate"
                          className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                            isDark ? "text-amber-300" : "text-amber-800"
                          }`}
                        >
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>მიახლოებული მონიშვნა ({activeSpotCount} სიტყვა)</span>
                        </div>
                      );
                    }
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                        <span
                          data-testid="active-sync-match-status"
                          data-match-kind="unmatched"
                          className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                            isDark ? "text-rose-300" : "text-rose-700"
                          }`}
                        >
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>დაფზე ვერ მოიძებნა</span>
                        </span>
                        {hasAnyAudioSource && !isTranscribing && (
                          <button
                            type="button"
                            data-raw-btn="true"
                            onClick={() => void handleRunAiTranscribe({ auto: false })}
                            className="crystal-action-orb h-6 px-2.5 text-[10px] font-bold cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                            <span>AI განახლება</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Status / Not-Found Banner */}
              {(errorMessage || statusMessage) && (
                <div className="text-[11px] font-semibold">
                  {errorMessage ? (
                    <div
                      role="alert"
                      className={`rounded-xl border px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 ${
                        isDark
                          ? "bg-rose-950/45 border-rose-400/40 text-rose-200"
                          : "bg-rose-500/10 border-rose-500/35 text-rose-700"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errorMessage}</span>
                      </span>
                      {resolutionState === "not-found" && !showToolsDrawer && (
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() => setShowToolsDrawer(true)}
                          className="crystal-action-orb h-6 px-2.5 text-[10px] font-bold cursor-pointer"
                        >
                          <Link2 className="w-3 h-3 shrink-0" />
                          <span>წყაროს მითითება</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    !isTranscribing && (
                      <p className={isDark ? "text-emerald-300" : "text-emerald-700"}>
                        {statusMessage}
                      </p>
                    )
                  )}
                </div>
              )}

              {/* Collapsible Tools Drawer */}
              {showToolsDrawer && (
                <div
                  data-testid="audio-sync-tools-drawer"
                  className="pt-2 border-t border-current/15 space-y-2.5"
                >
                  {/* Storage / URL Source Configuration */}
                  <div className="crystal-window-trough rounded-xl p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                        <span>აუდიო წყარო (საცავი ან URL შაბლონი)</span>
                      </span>
                      <span className="text-[10px] opacity-70 hidden sm:inline">
                        ტოკენები: {"{tractate}"}, {"{daf}"}, {"{dafNum}"}, {"{amud}"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <input
                        type="url"
                        data-crystal-input="true"
                        aria-label="აუდიო საცავის URL შაბლონი"
                        value={templateDraft}
                        onChange={(e) => setTemplateDraft(e.target.value)}
                        placeholder="https://cdn.example.com/shiurim/{tractate}/{daf}.mp3"
                        className="h-8 px-2.5 rounded-lg text-[11px] outline-none w-full"
                      />
                      <input
                        type="url"
                        data-crystal-input="true"
                        aria-label="მიმდინარე დაფის აუდიო ბმული"
                        value={dafUrlDraft}
                        onChange={(e) => setDafUrlDraft(e.target.value)}
                        placeholder={`პირდაპირი ბმული (${tractateId} ${dafId})`}
                        className="h-8 px-2.5 rounded-lg text-[11px] outline-none w-full"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        data-raw-btn="true"
                        onClick={handleClearSourceConfig}
                        className="crystal-action-orb h-7 px-2.5 text-[10px] font-bold cursor-pointer"
                      >
                        <span>წყაროს გასუფთავება</span>
                      </button>
                      <button
                        type="button"
                        data-raw-btn="true"
                        data-tone="sky"
                        onClick={handleSaveSourceConfig}
                        className="crystal-action-orb h-7 px-3 text-[10px] font-bold cursor-pointer"
                      >
                        <Check className="w-3 h-3 shrink-0" />
                        <span>წყაროს შენახვა</span>
                      </button>
                    </div>
                  </div>

                  {/* Upload / AI Sync / Import / Export Action Row */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-raw-btn="true"
                      onClick={() => audioFileInputRef.current?.click()}
                      className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span>აუდიო ფაილი</span>
                    </button>

                    <button
                      type="button"
                      data-raw-btn="true"
                      disabled={!hasAnyAudioSource || isTranscribing}
                      onClick={() => void handleRunAiTranscribe({ auto: false })}
                      className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {isTranscribing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 shrink-0" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <span>AI სინქი</span>
                    </button>

                    <button
                      type="button"
                      data-raw-btn="true"
                      onClick={() => importFileInputRef.current?.click()}
                      className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      <span>ფაილი (JSON/SRT)</span>
                    </button>

                    <button
                      type="button"
                      data-raw-btn="true"
                      aria-pressed={showTranscriptDrawer}
                      data-tone={showTranscriptDrawer ? "amber" : undefined}
                      onClick={() => setShowTranscriptDrawer((v) => !v)}
                      className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer"
                    >
                      <span>ტექსტის ჩასმა</span>
                    </button>

                    {syncMap && (
                      <>
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={handleExportJson}
                          className="crystal-action-orb h-7 px-2.5 text-[11px] font-bold cursor-pointer"
                          title="JSON ექსპორტი"
                        >
                          <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span>ექსპორტი</span>
                        </button>
                        <button
                          type="button"
                          data-raw-btn="true"
                          data-tone="rose"
                          onClick={handleClearSyncData}
                          aria-label="სინქრონიზაციის გასუფთავება"
                          className="crystal-corner-orb w-7 h-7 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Paste Transcript / JSON Drawer */}
                  {showTranscriptDrawer && (
                    <div className="crystal-window-trough rounded-xl p-2.5 space-y-2">
                      <textarea
                        aria-label="ტრანსკრიპტის ტექსტი"
                        dir="rtl"
                        rows={4}
                        value={transcriptDraft}
                        onChange={(e) => setTranscriptDraft(e.target.value)}
                        placeholder="[00:00] מאימתי קורין את שמע בערבית&#10;[00:04] תנא היכא קאי דקתני מאימתי&#10;(ან ჩასვით SRT / VTT / AudioSyncMap JSON)"
                        className={`w-full rounded-lg border p-2 text-xs font-serif outline-none ${
                          isDark
                            ? "bg-[#091529]/90 border-amber-400/40 text-amber-50"
                            : "bg-white/90 border-sky-700/25 text-[#0F294A]"
                        }`}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() => setShowTranscriptDrawer(false)}
                          className="crystal-action-orb h-7 px-3 text-[11px] font-bold cursor-pointer"
                        >
                          დახურვა
                        </button>
                        <button
                          type="button"
                          data-raw-btn="true"
                          data-tone="sky"
                          onClick={handleApplyPastedTranscript}
                          className="crystal-action-orb h-7 px-3 text-[11px] font-bold cursor-pointer"
                        >
                          დაფთან მიბმა
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expandable Segment List & Review Controls */}
              {isSegmentsExpanded && syncMap && (
                <div className="pt-2 border-t border-current/15">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-raw-btn="true"
                        data-tone={segmentFilter === "all" ? "sky" : undefined}
                        onClick={() => setSegmentFilter("all")}
                        className="crystal-action-orb h-6 px-2.5 text-[10px] font-bold cursor-pointer"
                      >
                        ყველა ({syncMap.segments.length})
                      </button>
                      <button
                        type="button"
                        data-raw-btn="true"
                        data-tone={segmentFilter === "needs-review" ? "amber" : undefined}
                        onClick={() => setSegmentFilter("needs-review")}
                        className="crystal-action-orb h-6 px-2.5 text-[10px] font-bold cursor-pointer"
                      >
                        შესამოწმებელი ({needsReviewCount})
                      </button>
                    </div>
                    <span className="text-[10px] opacity-70 hidden sm:inline">
                      დააწკაპუნეთ სეგმენტზე აუდიოს გადასახტომად
                    </span>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {visibleSegments.map((seg) => {
                      const isActive = activeSegment?.id === seg.id;
                      const band = classifyConfidenceBand(seg.confidence);
                      const matchedCount = resolvedBySegment.get(seg.id)?.length ?? 0;
                      const matchKind = matchKindBySegment.get(seg.id) ?? "unmatched";
                      const isEditing = editingSegmentId === seg.id;

                      return (
                        <div
                          key={seg.id}
                          data-sync-segment-id={seg.id}
                          className={`crystal-window-trough rounded-xl p-2 transition-colors ${
                            isActive ? "ring-1 ring-amber-400/80" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              data-raw-btn="true"
                              onClick={() => seekToMs(seg.startMs)}
                              className="text-left flex-1 min-w-0 cursor-pointer flex items-center gap-2"
                            >
                              <span className="text-[10px] font-mono tabular-nums opacity-75 shrink-0">
                                {formatMsToTimestamp(seg.startMs)}–{formatMsToTimestamp(seg.endMs)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div dir="rtl" className="font-serif text-xs font-bold truncate">
                                  {seg.textHe}
                                </div>
                                {seg.topicKa && (
                                  <div dir="ltr" className="text-[10px] opacity-75 truncate">
                                    {seg.topicKa}
                                  </div>
                                )}
                              </div>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                                  seg.reviewStatus === "verified"
                                    ? "bg-emerald-500/20 text-emerald-500"
                                    : band === "high"
                                      ? "bg-sky-500/20 text-sky-500"
                                      : "bg-amber-500/20 text-amber-500"
                                }`}
                              >
                                {seg.reviewStatus} {Math.round(seg.confidence * 100)}%
                              </span>
                              <span className="text-[9px] opacity-70">
                                ({matchKind === "approximate" ? "~" : ""}
                                {matchedCount} სიტ.)
                              </span>
                              {seg.reviewStatus !== "verified" && (
                                <button
                                  type="button"
                                  data-raw-btn="true"
                                  data-tone="emerald"
                                  onClick={() => handleVerifySegment(seg.id)}
                                  aria-label={`დადასტურება ${seg.id}`}
                                  className="crystal-corner-orb h-6 w-6 cursor-pointer"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                data-raw-btn="true"
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingSegmentId(null);
                                    setEditingTextHe("");
                                  } else {
                                    setEditingSegmentId(seg.id);
                                    setEditingTextHe(seg.textHe);
                                  }
                                }}
                                aria-label={`რედაქტირება ${seg.id}`}
                                className="crystal-corner-orb h-6 w-6 cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {isEditing && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <input
                                dir="rtl"
                                type="text"
                                data-crystal-input="true"
                                value={editingTextHe}
                                onChange={(e) => setEditingTextHe(e.target.value)}
                                className="flex-1 h-7 px-2 rounded-lg text-xs font-serif outline-none"
                              />
                              <button
                                type="button"
                                data-raw-btn="true"
                                data-tone="sky"
                                onClick={() => handleRealignEditedSegment(seg)}
                                className="crystal-action-orb h-7 px-2.5 text-[10px] font-bold cursor-pointer"
                              >
                                ხელახალი მიბმა
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
