import { GoogleGenAI } from "@google/genai";
import {
  geminiGenerateJson,
  GeminiKeyError,
  GeminiBusyError,
  readUserGemini,
  type AiTier,
  type UserGemini,
} from "./geminiRouter";

export interface AiCtx {
  user: UserGemini | null;
  tier: AiTier;
}

const BASE_SYSTEM =
  "You are an expert Talmud scholar fluent in Hebrew, Aramaic and Georgian. " +
  "Answer accurately, cite real sources (Tractate + daf, Rambam, Shulchan Aruch, Tanakh) and never invent citations. " +
  "Georgian text must be natural literary Georgian using standard Jewish terminology (თალმუდი, გემარა, მიშნა, რაში, თოსაფოთი, ჰალახა).";

export class MissingAiConfigError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured on the server");
  }
}

export function getServerGeminiClient(overrideKey?: string): GoogleGenAI {
  const apiKey = (overrideKey || process.env["GEMINI_API_KEY"] || "").trim();
  if (!apiKey) throw new MissingAiConfigError();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function serverModelsForTier(tier: AiTier): string[] {
  if (tier === "lite") return ["gemini-3.1-flash-lite", "gemini-4-hydrogen"];
  return ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
}

/** Ask the model for a JSON object described by `shape`. Returns parsed object. */
export async function askJson(
  task: string,
  shape: string,
  payload: unknown,
  ctx?: AiCtx,
): Promise<Record<string, unknown>> {
  const prompt = `${task}\n\nReturn JSON only, with exactly this shape:\n${shape}\n\nInput:\n${JSON.stringify(payload)}`;
  if (ctx?.user) {
    // Gemini occasionally returns broken JSON (e.g. {"translation":}); retry once before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = parseJson(await geminiGenerateJson(ctx.user, ctx.tier, BASE_SYSTEM, prompt));
      if (Object.keys(out).length > 0) return out;
    }
    return {};
  }

  const ai = getServerGeminiClient();
  let lastErr: unknown;
  for (const model of serverModelsForTier(ctx?.tier ?? "balanced")) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: BASE_SYSTEM,
          responseMimeType: "application/json",
        },
      });
      const out = parseJson(response.text ?? "");
      if (Object.keys(out).length > 0) return out;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return {};
}

function parseJson(text: string): Record<string, unknown> {
  const raw = text.trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        // fall through: malformed model output must never crash the route
      }
    }
    return {};
  }
}

export interface TalmudBody {
  question?: unknown;
  scope?: unknown;
  query?: unknown;
  word?: unknown;
  sentence?: unknown;
  sourceType?: unknown;
  tractate?: unknown;
  daf?: unknown;
  text?: unknown;
  hebrewOriginal?: unknown;
  sectionType?: unknown;
  targetLang?: unknown;
  tractateHebrew?: unknown;
  tractateGeorgian?: unknown;
  dafExcerpt?: unknown;
  language?: unknown;
  audioBase64?: unknown;
  mimeType?: unknown;
  lang?: unknown;
}

export async function readJsonBody(request: Request): Promise<TalmudBody> {
  try {
    const b = await request.json();
    return b && typeof b === "object" ? (b as TalmudBody) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");

export function errorResponse(e: unknown): Response {
  if (e instanceof GeminiKeyError)
    return Response.json({ error: "invalid_gemini_key" }, { status: 401 });
  // Busy Gemini is temporary: answer 200 with a soft flag so the UI shows a retry hint instead of crashing.
  if (e instanceof GeminiBusyError)
    return Response.json(
      { error: "gemini_busy", busy: true, translation: "", text: "" },
      { status: 200 },
    );
  if (e instanceof MissingAiConfigError)
    return Response.json(
      { error: "ai_unavailable", code: "missing_gemini_api_key" },
      { status: 503 },
    );
  const status = (e as { status?: unknown })?.status;
  if (status === 429 || status === 402) {
    return Response.json({ error: "ai_unavailable", code: `status_${status}` }, { status });
  }
  console.error("talmud ai error", e);
  return Response.json({ error: "server_error" }, { status: 500 });
}

/** Wraps a JSON AI handler with body parsing and error handling. */
export function jsonAiHandler(
  tier: AiTier,
  fn: (body: TalmudBody, ctx: AiCtx) => Promise<unknown>,
) {
  return async ({ request }: { request: Request }) => {
    const body = await readJsonBody(request);
    const ctx: AiCtx = { user: readUserGemini(request), tier };
    try {
      return Response.json(await fn(body, ctx));
    } catch (e) {
      return errorResponse(e);
    }
  };
}
