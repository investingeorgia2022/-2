import { afterEach, describe, expect, it, vi } from "vitest";

const mockServerEntryFetch = vi.fn();

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: mockServerEntryFetch,
  },
}));

describe("AbortError handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockServerEntryFetch.mockReset();
  });

  it("server.fetch suppresses console.error and returns 499 on AbortError (including nested cause)", async () => {
    const { default: server } = await import("@/server");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const innerAbort = new DOMException("This operation was aborted", "AbortError");
    const outerAbort = new Error("This operation was aborted", { cause: innerAbort });
    outerAbort.name = "AbortError";
    mockServerEntryFetch.mockRejectedValueOnce(outerAbort);

    const res = await server.fetch(new Request("http://localhost/"), undefined, undefined);
    expect(res.status).toBe(499);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("server.fetch returns 499 without console.error when h3 swallows an aborted request", async () => {
    const { default: server } = await import("@/server");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ac = new AbortController();
    ac.abort(new DOMException("This operation was aborted", "AbortError"));
    mockServerEntryFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ unhandled: true, message: "HTTPError" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await server.fetch(
      new Request("http://localhost/", { signal: ac.signal }),
      undefined,
      undefined,
    );
    expect(res.status).toBe(499);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("server.fetch short-circuits pre-aborted requests with 499 before invoking server-entry", async () => {
    const { default: server } = await import("@/server");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ac = new AbortController();
    ac.abort(new DOMException("This operation was aborted", "AbortError"));

    const res = await server.fetch(
      new Request("http://localhost/", { signal: ac.signal }),
      undefined,
      undefined,
    );
    expect(res.status).toBe(499);
    expect(mockServerEntryFetch).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("error-capture suppresses originalConsoleError for h3-wrapped AbortError and records it for server.ts 499 normalization", async () => {
    const originalBeforeImport = console.error;
    const baseErrSpy = vi.fn();
    console.error = baseErrSpy;
    vi.resetModules();

    try {
      const { consumeLastCapturedError, isAbortError } = await import("@/lib/error-capture");
      const { requestHandler } = await import("@tanstack/start-server-core");
      const { default: server } = await import("@/server");

      const abortAc = new AbortController();
      abortAc.abort();
      const abortErr = abortAc.signal.reason;
      const realHandler = requestHandler(async () => {
        throw abortErr;
      });

      mockServerEntryFetch.mockImplementationOnce((req: Request) =>
        realHandler(req, undefined as never),
      );

      const res = await server.fetch(new Request("http://localhost/"), undefined, undefined);
      expect(res.status).toBe(499);
      expect(baseErrSpy).not.toHaveBeenCalled();
      expect(consumeLastCapturedError()).toBeUndefined();

      // Direct stream-pump log shape (`console.error("Error processing appStream:", abortErr)`)
      console.error("Error processing appStream:", abortErr);
      expect(baseErrSpy).not.toHaveBeenCalled();
      expect(isAbortError(consumeLastCapturedError())).toBe(true);

      // Node HTTP socket abort shape (`Error: aborted` with `ECONNRESET`)
      const nodeAbort = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
      console.error(nodeAbort);
      expect(baseErrSpy).not.toHaveBeenCalled();
      expect(isAbortError(consumeLastCapturedError())).toBe(true);

      // Non-abort errors still pass through to originalConsoleError and produce 500
      const realBoom = new Error("real-failure");
      const failingHandler = requestHandler(async () => {
        throw realBoom;
      });
      mockServerEntryFetch.mockImplementationOnce((req: Request) =>
        failingHandler(req, undefined as never),
      );
      const errRes = await server.fetch(new Request("http://localhost/"), undefined, undefined);
      expect(errRes.status).toBe(500);
      expect(baseErrSpy).toHaveBeenCalled();
      expect(String(baseErrSpy.mock.calls[0]?.[0] ?? "")).toContain("real-failure");
    } finally {
      console.error = originalBeforeImport;
      vi.resetModules();
    }
  });

  it("vilna-pdf GET returns 499 and aborts upstream fetch when client signal aborts", async () => {
    const { Route } = await import("@/routes/api/talmud/vilna-pdf");
    const handler = (
      Route.options.server?.handlers as { GET: (ctx: { request: Request }) => Promise<Response> }
    ).GET;

    const clientAc = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce((_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
      });
    });

    const req = new Request("http://localhost/api/talmud/vilna-pdf?tractate=Berakhot&daf=2a", {
      signal: clientAc.signal,
    });
    const pending = handler({ request: req });
    clientAc.abort();
    const res = await pending;
    expect(capturedSignal?.aborted).toBe(true);
    expect(res.status).toBe(499);
  });
});
