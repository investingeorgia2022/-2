import { createFileRoute } from "@tanstack/react-router";
import { Type } from "@google/genai";
import { readUserGemini } from "@/server/geminiRouter";
import { errorResponse, getServerGeminiClient } from "@/server/talmudAi";

const MAX_B64 = 34_000_000; // ~24 MB audio
const MAX_REMOTE_AUDIO_BYTES = 24 * 1024 * 1024;
const INLINE_AUDIO_BYTES_LIMIT = 15 * 1024 * 1024;
const REMOTE_CHECK_TIMEOUT_MS = 6_000;
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

function isPrivateOrReservedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return false;
  const [a = 0, b = 0] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // Link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // Multicast / reserved
  return false;
}

function isPrivateOrReservedIpv6(host: string): boolean {
  const clean = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!clean.includes(":")) return false;
  if (clean === "::" || clean === "::1") return true;
  if (clean.startsWith("fc") || clean.startsWith("fd")) return true; // ULA fc00::/7
  if (
    clean.startsWith("fe8") ||
    clean.startsWith("fe9") ||
    clean.startsWith("fea") ||
    clean.startsWith("feb")
  ) {
    return true; // Link-local fe80::/10
  }
  const v4Match = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(clean);
  if (v4Match?.[1] && isPrivateOrReservedIpv4(v4Match[1])) return true;
  return false;
}

/**
 * Validates that an external audio URL uses https: on a public host,
 * blocking loopback, private LAN, CGNAT, and cloud metadata addresses.
 */
export function assertSafePublicAudioUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new Error("invalid_audio_url");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("invalid_audio_url");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("unsafe_protocol");
  }
  if (parsed.username || parsed.password) {
    throw new Error("unsafe_credentials");
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || !host.includes(".")) {
    throw new Error("unsafe_host");
  }
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("unsafe_host");
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    throw new Error("unsafe_host");
  }
  if (isPrivateOrReservedIpv4(host) || isPrivateOrReservedIpv6(host)) {
    throw new Error("unsafe_host");
  }
  return parsed;
}

function isAcceptedAudioContentType(contentTypeHeader: string | null): boolean {
  if (!contentTypeHeader) return true;
  const mime = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime) return true;
  if (mime.startsWith("audio/")) return true;
  return (
    mime === "application/ogg" ||
    mime === "application/octet-stream" ||
    mime === "binary/octet-stream" ||
    mime === "video/mp4" ||
    mime === "video/webm"
  );
}

async function fetchWithValidatedRedirects(
  initialUrl: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl.toString(), {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      try {
        await res.body?.cancel();
      } catch {
        // ignore cancel errors
      }
      if (!loc || hop === MAX_REDIRECTS) {
        throw new Error("too_many_redirects");
      }
      currentUrl = assertSafePublicAudioUrl(new URL(loc, currentUrl).toString());
      continue;
    }
    return res;
  }
  throw new Error("too_many_redirects");
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadRemoteAudioAsBase64(
  safeUrl: URL,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetchWithValidatedRedirects(
    safeUrl,
    { method: "GET" },
    REMOTE_FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    throw new Error(res.status === 404 ? "audio_not_found" : "remote_fetch_failed");
  }

  const contentType = res.headers.get("content-type");
  if (!isAcceptedAudioContentType(contentType)) {
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    throw new Error("unsupported_media_type");
  }

  const contentLenRaw = res.headers.get("content-length");
  if (contentLenRaw) {
    const parsedLen = Number(contentLenRaw);
    if (Number.isFinite(parsedLen) && parsedLen > MAX_REMOTE_AUDIO_BYTES) {
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      throw new Error("audio_too_large");
    }
  }

  let bytes: Uint8Array;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REMOTE_AUDIO_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("audio_too_large");
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_REMOTE_AUDIO_BYTES) {
      throw new Error("audio_too_large");
    }
    bytes = buf;
  }

  if (bytes.byteLength === 0) {
    throw new Error("audio_not_found");
  }

  const normalizedMime = contentType?.split(";")[0]?.trim() || "audio/mp3";
  return {
    base64: uint8ArrayToBase64(bytes),
    mimeType: normalizedMime,
  };
}

export async function handleAudioSyncSourceProxyRequest(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const mode = reqUrl.searchParams.get("mode") ?? "check";
  const rawTargetUrl = reqUrl.searchParams.get("url") ?? "";

  let safeUrl: URL;
  try {
    safeUrl = assertSafePublicAudioUrl(rawTargetUrl);
  } catch {
    return Response.json({ exists: false, error: "invalid_audio_url" }, { status: 400 });
  }

  if (mode === "check") {
    try {
      let res = await fetchWithValidatedRedirects(
        safeUrl,
        { method: "HEAD" },
        REMOTE_CHECK_TIMEOUT_MS,
      );
      if (res.status === 405 || res.status === 501) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        res = await fetchWithValidatedRedirects(
          safeUrl,
          { method: "GET", headers: { Range: "bytes=0-0" } },
          REMOTE_CHECK_TIMEOUT_MS,
        );
      }
      const contentType = res.headers.get("content-type");
      const contentLengthHeader = res.headers.get("content-length");
      const contentRangeHeader = res.headers.get("content-range");
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }

      if (!res.ok || !isAcceptedAudioContentType(contentType)) {
        return Response.json({ exists: false, reason: "not_found" }, { status: 404 });
      }

      let sizeBytes: number | null = null;
      if (contentRangeHeader) {
        const totalMatch = /\/(\d+)$/.exec(contentRangeHeader);
        if (totalMatch?.[1]) sizeBytes = Number(totalMatch[1]);
      } else if (contentLengthHeader) {
        const parsedLen = Number(contentLengthHeader);
        if (Number.isFinite(parsedLen)) sizeBytes = parsedLen;
      }

      return Response.json({
        exists: true,
        mimeType: contentType?.split(";")[0]?.trim() || "audio/mpeg",
        sizeBytes,
      });
    } catch {
      return Response.json({ exists: false, error: "upstream_unreachable" }, { status: 502 });
    }
  }

  if (mode === "stream") {
    try {
      const rangeHeader = request.headers.get("range");
      const headers: Record<string, string> = {};
      if (rangeHeader) {
        headers["Range"] = rangeHeader;
      }
      const upstream = await fetchWithValidatedRedirects(
        safeUrl,
        { method: "GET", headers },
        REMOTE_FETCH_TIMEOUT_MS,
      );
      const contentType = upstream.headers.get("content-type");
      if (!upstream.ok || !isAcceptedAudioContentType(contentType)) {
        try {
          await upstream.body?.cancel();
        } catch {
          // ignore
        }
        return Response.json(
          { error: "audio_not_found" },
          { status: upstream.status === 404 ? 404 : 502 },
        );
      }

      const outHeaders = new Headers();
      outHeaders.set("Content-Type", contentType?.split(";")[0]?.trim() || "audio/mpeg");
      const contentLen = upstream.headers.get("content-length");
      if (contentLen) outHeaders.set("Content-Length", contentLen);
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) outHeaders.set("Content-Range", contentRange);
      outHeaders.set("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
      outHeaders.set("Cache-Control", "private, max-age=300");

      return new Response(upstream.body, {
        status: upstream.status === 206 ? 206 : 200,
        headers: outHeaders,
      });
    } catch {
      return Response.json({ error: "upstream_unreachable" }, { status: 502 });
    }
  }

  return Response.json({ error: "unsupported_mode" }, { status: 400 });
}

export interface TimedTranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  textHe: string;
  topicKa?: string | undefined;
}

/**
 * Parses a structured JSON array of `{ startMs, endMs, textHe, topicKa? }` returned by
 * Gemini multimodal audio-to-Daf alignment into chronological, continuous segments.
 */
export function parseStructuredAiSegments(
  rawText: string,
  durationMs?: number,
): TimedTranscriptSegment[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const arrMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    try {
      parsed = JSON.parse(arrMatch[0]);
    } catch {
      return [];
    }
  }

  const rawItems: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["segments"])
      ? ((parsed as Record<string, unknown>)["segments"] as unknown[])
      : [];

  if (rawItems.length === 0) return [];

  const collected: Array<{ startMs: number; endMs: number; textHe: string; topicKa?: string }> = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const textHe = typeof obj["textHe"] === "string" ? obj["textHe"].trim() : "";
    const startRaw = obj["startMs"];
    const endRaw = obj["endMs"];
    if (
      !textHe ||
      typeof startRaw !== "number" ||
      !Number.isFinite(startRaw) ||
      startRaw < 0
    ) {
      continue;
    }
    const startMs = Math.round(startRaw);
    const rawEndMs =
      typeof endRaw === "number" && Number.isFinite(endRaw) && endRaw > startMs
        ? Math.round(endRaw)
        : startMs + Math.max(2000, textHe.split(/\s+/).length * 500);
    const topicKa =
      typeof obj["topicKa"] === "string" && obj["topicKa"].trim().length > 0
        ? obj["topicKa"].trim().slice(0, 140)
        : undefined;
    collected.push({ startMs, endMs: rawEndMs, textHe, ...(topicKa ? { topicKa } : {}) });
  }

  if (collected.length === 0) return [];

  collected.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const safeDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 1000
      ? Math.round(durationMs)
      : undefined;

  const out: TimedTranscriptSegment[] = [];
  for (let i = 0; i < collected.length; i++) {
    const cur = collected[i];
    if (!cur) continue;
    const next = collected[i + 1];
    const startMs = safeDuration !== undefined ? Math.min(cur.startMs, Math.max(0, safeDuration - 500)) : cur.startMs;
    let endMs = cur.endMs;
    if (next && next.startMs > startMs) {
      // Bridge small commentary gaps so highlighting never flashes blank on the Daf
      endMs = Math.max(endMs, Math.min(next.startMs, safeDuration ?? next.startMs));
      if (endMs > next.startMs) endMs = next.startMs;
    } else if (!next && safeDuration !== undefined && safeDuration > startMs) {
      endMs = Math.max(endMs, safeDuration);
    }
    if (safeDuration !== undefined && endMs > safeDuration) {
      endMs = safeDuration;
    }
    if (endMs <= startMs) {
      endMs = startMs + 600;
    }
    out.push({
      id: `ai-seg-${out.length + 1}`,
      startMs,
      endMs,
      textHe: cur.textHe,
      ...(cur.topicKa ? { topicKa: cur.topicKa } : {}),
    });
  }
  return out;
}

function parseTimestampPrefix(line: string): { startMs: number; text: string } | null {
  const m = /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*(?:[-–—:]\s*)?(.+)$/.exec(
    line.trim(),
  );
  if (!m) return null;
  const hasHours = m[1] !== undefined;
  const hours = hasHours ? Number(m[1]) : 0;
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  const millis = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  const text = (m[5] ?? "").trim();
  if (!text || !Number.isFinite(mins) || !Number.isFinite(secs)) return null;
  return {
    startMs: ((hours * 60 + mins) * 60 + secs) * 1000 + millis,
    text,
  };
}

/**
 * Splits a transcribed Gemara text into chronological timestamped phrase segments,
 * honoring explicit [MM:SS] markers if present or distributing proportionally across durationMs.
 */
export function buildTimedSegmentsFromTranscript(
  transcript: string,
  durationMs?: number,
): TimedTranscriptSegment[] {
  const rawLines = transcript
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) return [];

  const parsedTimed: Array<{ startMs: number; text: string }> = [];
  for (const line of rawLines) {
    const p = parseTimestampPrefix(line);
    if (p) parsedTimed.push(p);
  }

  if (parsedTimed.length >= Math.max(2, Math.floor(rawLines.length / 2))) {
    const out: TimedTranscriptSegment[] = [];
    for (let i = 0; i < parsedTimed.length; i++) {
      const cur = parsedTimed[i];
      if (!cur) continue;
      const next = parsedTimed[i + 1];
      const fallbackEnd =
        durationMs && durationMs > cur.startMs
          ? durationMs
          : cur.startMs + Math.max(1500, cur.text.split(/\s+/).length * 420);
      const endMs =
        next && next.startMs > cur.startMs
          ? next.startMs
          : Math.max(cur.startMs + 800, fallbackEnd);
      out.push({
        id: `ai-seg-${i + 1}`,
        startMs: cur.startMs,
        endMs,
        textHe: cur.text,
      });
    }
    return out;
  }

  // Split by lines or Hebrew/punctuation clause boundaries (., :, ;) into Gemara-sized phrases
  const clauses = rawLines
    .flatMap((line) => line.split(/(?<=[.:;?!])\s+/))
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const weights = clauses.map((c) => Math.max(1, c.split(/\s+/).length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const safeTotalDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 1000
      ? Math.round(durationMs)
      : Math.max(clauses.length * 1800, totalWeight * 360);

  const out: TimedTranscriptSegment[] = [];
  let cursorMs = 0;
  for (let i = 0; i < clauses.length; i++) {
    const textHe = clauses[i];
    if (!textHe) continue;
    const w = weights[i] ?? 1;
    const isLast = i === clauses.length - 1;
    const sliceMs = isLast
      ? Math.max(600, safeTotalDurationMs - cursorMs)
      : Math.max(600, Math.round((w / totalWeight) * safeTotalDurationMs));
    const endMs = cursorMs + sliceMs;
    out.push({
      id: `ai-seg-${i + 1}`,
      startMs: cursorMs,
      endMs,
      textHe,
    });
    cursorMs = endMs;
  }
  return out;
}

export async function handleAudioSyncTranscribeRequest(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    body = {};
  }

  let audioBase64 = typeof body["audioBase64"] === "string" ? body["audioBase64"] : "";
  const rawMime = typeof body["mimeType"] === "string" ? body["mimeType"].slice(0, 60) : "";
  let mimeType = rawMime.split(";")[0]?.trim() || "audio/mp3";

  if (!audioBase64) {
    const audioUrl = typeof body["audioUrl"] === "string" ? body["audioUrl"].trim() : "";
    if (!audioUrl) {
      return Response.json({ error: "bad_audio" }, { status: 400 });
    }
    let safeUrl: URL;
    try {
      safeUrl = assertSafePublicAudioUrl(audioUrl);
    } catch {
      return Response.json({ error: "bad_audio" }, { status: 400 });
    }
    try {
      const downloaded = await downloadRemoteAudioAsBase64(safeUrl);
      audioBase64 = downloaded.base64;
      if (!rawMime) {
        mimeType = downloaded.mimeType;
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "remote_fetch_failed";
      if (code === "audio_too_large") {
        return Response.json({ error: "audio_too_large" }, { status: 413 });
      }
      if (code === "audio_not_found") {
        return Response.json({ error: "audio_not_found" }, { status: 404 });
      }
      return Response.json({ error: code }, { status: 502 });
    }
  }

  if (!audioBase64 || audioBase64.length > MAX_B64) {
    return Response.json({ error: "bad_audio" }, { status: 400 });
  }

  const tractateId = typeof body["tractateId"] === "string" ? body["tractateId"].slice(0, 80) : "";
  const dafId = typeof body["dafId"] === "string" ? body["dafId"].slice(0, 20) : "";
  const dafExcerptHe =
    typeof body["dafExcerptHe"] === "string" ? body["dafExcerptHe"].slice(0, 10_000) : "";
  const dafReferenceKa =
    typeof body["dafReferenceKa"] === "string" ? body["dafReferenceKa"].slice(0, 12_000) : "";
  const durationMs =
    typeof body["durationMs"] === "number" && Number.isFinite(body["durationMs"])
      ? body["durationMs"]
      : undefined;

  const user = readUserGemini(request);
  let ai: ReturnType<typeof getServerGeminiClient> | null = null;
  let uploadedFileName: string | null = null;
  try {
    ai = getServerGeminiClient(user?.key);
    const durationHint =
      durationMs && durationMs > 0
        ? `Total audio duration: ${Math.round(durationMs)} ms (${(durationMs / 1000).toFixed(1)} s). Cover timestamps inside [0, ${Math.round(durationMs)}].`
        : "";

    const contextSections = [
      tractateId && dafId ? `Tractate: ${tractateId}, Daf: ${dafId}.` : "",
      durationHint,
      dafExcerptHe
        ? `Printed Vilna Daf MAIN TEXT ONLY (Mishnah & Gemara in reading order — copy "textHe" phrases verbatim from here):\n${dafExcerptHe}`
        : "",
      dafReferenceKa
        ? `Bilingual Georgian Reference (use this to understand when the lecturer explains a Mishnah/Gemara clause in Georgian without reading every Hebrew word):\n${dafReferenceKa}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const prompt =
      "You are synchronizing a Talmud lecture audio recording (primarily in Georgian / ქართული, with periodic Hebrew/Aramaic quotes) to the printed Vilna Daf (ONLY Mishnah & Gemara main text; never Rashi or Tosafot).\n\n" +
      "Task:\n" +
      "1. Listen carefully across the entire recording from start (0 ms) to end.\n" +
      "2. Break the lecture into chronological, non-overlapping time intervals ([startMs, endMs]) whenever the speaker advances to a new Mishnah/Gemara clause or quote.\n" +
      "3. For EVERY interval — both when reading Hebrew/Aramaic aloud AND while translating/explaining it in Georgian — copy the exact matching Hebrew/Aramaic phrase (3 to 12 consecutive words, plain Hebrew letters without nikud, NO Georgian words and NO bracketed reference numbers like [1] or (א)) verbatim from the provided Mishnah & Gemara main text into `textHe`.\n" +
      "4. Keep the intervals continuous (minimal or zero gaps) so the highlighted spot stays on the right Gemara/Mishnah phrase throughout Georgian explanations.\n" +
      "5. Provide a concise 3–8 word Georgian topic summary (`topicKa`) describing what the lecturer is currently discussing in that interval.\n\n" +
      contextSections;

    const rawBytesEstimate = Math.floor((audioBase64.length * 3) / 4);
    let mediaPart:
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { fileUri: string; mimeType: string } };

    if (rawBytesEstimate > INLINE_AUDIO_BYTES_LIMIT && typeof Buffer !== "undefined") {
      const audioBytes = Buffer.from(audioBase64, "base64");
      const uploaded = await ai.files.upload({
        file: new Blob([audioBytes], { type: mimeType }),
        config: { mimeType },
      });
      if (uploaded.name) uploadedFileName = uploaded.name;
      if (uploaded.uri) {
        mediaPart = {
          fileData: {
            fileUri: uploaded.uri,
            mimeType: uploaded.mimeType ?? mimeType,
          },
        };
      } else {
        mediaPart = { inlineData: { mimeType, data: audioBase64 } };
      }
    } else {
      mediaPart = { inlineData: { mimeType, data: audioBase64 } };
    }

    const res = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: {
        parts: [mediaPart, { text: prompt }],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description:
            "Chronological intervals mapping Georgian explanations and Hebrew citations to verbatim Mishnah/Gemara phrases on the Daf.",
          items: {
            type: Type.OBJECT,
            properties: {
              startMs: {
                type: Type.INTEGER,
                description: "Segment start time in milliseconds (>= 0).",
              },
              endMs: {
                type: Type.INTEGER,
                description: "Segment end time in milliseconds (> startMs).",
              },
              textHe: {
                type: Type.STRING,
                description:
                  "Exact verbatim Hebrew/Aramaic phrase copied from the Daf's Mishnah/Gemara text.",
              },
              topicKa: {
                type: Type.STRING,
                description:
                  "Short 3-8 word Georgian summary of what the lecturer is explaining.",
              },
            },
            required: ["startMs", "endMs", "textHe"],
          },
        },
      },
    });

    const rawText = (res.text ?? "").trim();
    const structured = parseStructuredAiSegments(rawText, durationMs);
    const segments =
      structured.length > 0
        ? structured
        : buildTimedSegmentsFromTranscript(rawText, durationMs);
    return Response.json({ transcript: rawText, segments });
  } catch (e) {
    return errorResponse(e);
  } finally {
    if (uploadedFileName && ai) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => {});
    }
  }
}

export const Route = createFileRoute("/api/talmud/audio-sync-transcribe")({
  server: {
    handlers: {
      GET: ({ request }) => handleAudioSyncSourceProxyRequest(request),
      POST: ({ request }) => handleAudioSyncTranscribeRequest(request),
    },
  },
});
