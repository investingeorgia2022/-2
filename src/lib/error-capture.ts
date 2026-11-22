// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Expand Error-like args into a string that keeps the
// message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error || (typeof DOMException !== "undefined" && value instanceof DOMException)
  );
}

export function isAbortError(error: unknown, seen = new Set<object>()): boolean {
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

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are both
// recorded for consumeLastCapturedError and expanded before serialization.
// Abort errors (such as client disconnects wrapped in h3 HTTPError) are recorded
// for 499 conversion in server.ts without noisy console.error output.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  let hasAbortOrError = false;
  let hasNonAbortError = false;
  const expanded = args.map((arg) => {
    if (isErrorLike(arg)) {
      hasAbortOrError = true;
      record(arg);
      if (!isAbortError(arg)) {
        hasNonAbortError = true;
      }
      return describeError(arg);
    }
    if (isAbortError(arg)) {
      hasAbortOrError = true;
      record(arg);
    }
    return arg;
  });
  if (hasAbortOrError && !hasNonAbortError) {
    return;
  }
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
