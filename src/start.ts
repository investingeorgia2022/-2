import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

function isAbortError(error: unknown, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object") return false;
  if (seen.has(error) || seen.size > 8) return false;
  seen.add(error);

  const err = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  if (
    err.name === "AbortError" ||
    err.name === "AbortException" ||
    err.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    err.code === "ERR_STREAM_ABORT" ||
    err.code === "ABORT_ERR" ||
    err.code === "ECONNRESET" ||
    err.code === "ECANCELED"
  ) {
    return true;
  }
  if (
    typeof err.message === "string" &&
    (/^(?:aborted|this operation was aborted|the operation was aborted\.?|request aborted|signal is aborted(?: without reason)?)$/i.test(
      err.message.trim(),
    ) ||
      /operation was aborted|request was aborted|connection closed prematurely/i.test(err.message))
  ) {
    return true;
  }
  if (err.cause !== undefined) {
    return isAbortError(err.cause, seen);
  }
  return false;
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (request?.signal?.aborted) {
    return new Response(null, { status: 499 });
  }
  try {
    return await next();
  } catch (error) {
    if (request?.signal?.aborted || isAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
