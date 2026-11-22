import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// The Talmud app uses browser-only APIs (pdf.js, canvas, localStorage) at import time,
// so it is loaded only in the browser. Retry once after transient Vite optimize-dep /
// network hiccups and fall back to a single guarded reload if stale dev chunks linger.
const RELOAD_GUARD_KEY = "talmud_chunk_reload_once";

async function loadTalmudApp() {
  try {
    const mod = await import("@/talmud/TalmudEntry");
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch {
        // ignore
      }
    }
    return mod;
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await import("@/talmud/TalmudEntry");
    } catch {
      if (typeof window !== "undefined") {
        try {
          if (!window.sessionStorage.getItem(RELOAD_GUARD_KEY)) {
            window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
            window.location.reload();
            return new Promise<typeof import("@/talmud/TalmudEntry")>(() => {});
          }
          window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }
}

const TalmudApp = lazy(loadTalmudApp);

const TITLE = "Talmud Bavli 3D — თალმუდ ბაბლი";
const DESC =
  "ინტერაქტიული თალმუდ ბაბლი კლასიკური ვილნის გვერდის სტრუქტურით (צורת הדף), ქართულ-ებრაული თარგმანით, რაშისა და თოსაფოთის კომენტარებით.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background text-foreground" role="status">
      <Loader2 className="size-6 animate-spin motion-reduce:animate-none text-primary" aria-hidden="true" />
      <span className="text-sm">იტვირთება… טוען</span>
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <TalmudApp />
      </Suspense>
    </ClientOnly>
  );
}
