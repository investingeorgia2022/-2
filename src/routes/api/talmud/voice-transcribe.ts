import { createFileRoute } from "@tanstack/react-router";
import { readUserGemini } from "@/server/geminiRouter";
import { errorResponse, getServerGeminiClient, readJsonBody, str } from "@/server/talmudAi";

const MAX_B64 = 14_000_000; // ~10 MB audio

export const Route = createFileRoute("/api/talmud/voice-transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const b = await readJsonBody(request);
        const b64 = str(b.audioBase64, MAX_B64 + 1);
        if (!b64 || b64.length > MAX_B64)
          return Response.json({ error: "bad_audio" }, { status: 400 });
        const mime = str(b.mimeType, 60) || "audio/webm";
        const lang = str(b.lang, 10).slice(0, 2);
        const user = readUserGemini(request);
        try {
          const ai = getServerGeminiClient(user?.key);
          const langHint =
            lang === "ka"
              ? "Georgian"
              : lang === "he"
                ? "Hebrew"
                : lang === "en"
                  ? "English"
                  : lang === "ru"
                    ? "Russian"
                    : "Georgian, Hebrew, or English";
          const res = await ai.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: mime.split(";")[0] || "audio/webm",
                    data: b64,
                  },
                },
                {
                  text: `Transcribe this audio verbatim in ${langHint}. Context: Talmud, Gemara, Mishnah, tractate names, daf numbers, Hebrew and Georgian terms. Return only the transcription text.`,
                },
              ],
            },
          });
          const transcript = (res.text ?? "").trim();
          return Response.json({ transcript });
        } catch (e) {
          return errorResponse(e);
        }
      },
    },
  },
});
