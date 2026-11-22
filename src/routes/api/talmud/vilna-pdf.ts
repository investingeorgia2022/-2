import { createFileRoute } from "@tanstack/react-router";

// App tractate id -> shas.org daf-pdf API slug (per https://www.shas.org/daf-pdf/api/api-documentation.html)
const SHAS_SLUG: Record<string, string> = {
  Berakhot: "berachos", Shabbat: "shabbos", Eruvin: "eruvin", Pesachim: "pesachim",
  Shekalim: "shekalim", Yoma: "yoma", Sukkah: "sukkah", Beitzah: "beitzah",
  Rosh_Hashanah: "rosh-hashanah", Taanit: "taanis", Megillah: "megillah",
  Moed_Katan: "moed-katan", Chagigah: "chagigah", Yevamot: "yevamos", Ketubot: "kesubos",
  Nedarim: "nedarim", Nazir: "nazir", Sotah: "sotah", Gittin: "gittin",
  Kiddushin: "kiddushin", Bava_Kamma: "bava-kamma", Bava_Metzia: "bava-metzia",
  Bava_Batra: "bava-basra", Sanhedrin: "sanhedrin", Makkot: "makkos", Shevuot: "shevuos",
  Avodah_Zarah: "avodah-zarah", Horayot: "horayos", Zevachim: "zevachim",
  Menachot: "menachos", Chullin: "chullin", Bekhorot: "bechoros", Arakhin: "arachin",
  Temurah: "temurah", Keritot: "kereisos", Meilah: "meilah", Tamid: "tamid",
  Niddah: "niddah",
};

const TRACTATE_ALIASES: Record<string, string> = {
  berachos: "Berakhot",
  shabbos: "Shabbat",
  eiruvin: "Eruvin",
  beitza: "Beitzah",
  taanis: "Taanit",
  megila: "Megillah",
  chagiga: "Chagigah",
  yevamos: "Yevamot",
  kesubos: "Ketubot",
  nedorim: "Nedarim",
  sota: "Sotah",
  gitin: "Gittin",
  kidushin: "Kiddushin",
  baba_kamma: "Bava_Kamma",
  baba_kama: "Bava_Kamma",
  bava_kama: "Bava_Kamma",
  baba_metzia: "Bava_Metzia",
  baba_batra: "Bava_Batra",
  makkos: "Makkot",
  shevuos: "Shevuot",
  horayos: "Horayot",
  menachos: "Menachot",
  chulin: "Chullin",
  bechoros: "Bekhorot",
  arachin: "Arakhin",
  erechin: "Arakhin",
  kereisos: "Keritot",
  krisos: "Keritot",
  meilah: "Meilah",
  nida: "Niddah",
  suka: "Sukkah",
};

export function shasPdfUrl(tractate: string, daf: string): string | null {
  const norm = tractate.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliasTarget = TRACTATE_ALIASES[norm] || norm;
  const key = Object.keys(SHAS_SLUG).find(
    (k) => k.toLowerCase() === norm || k.toLowerCase() === aliasTarget.toLowerCase(),
  );
  const slug = key ? SHAS_SLUG[key] : undefined;
  let cleanDaf = daf.trim().toLowerCase().replace(/[()[\]\s]/g, "");
  if (/^\d{1,3}:$/.test(cleanDaf)) cleanDaf = `${cleanDaf.slice(0, -1)}b`;
  else if (/^\d{1,3}\.?$/.test(cleanDaf)) cleanDaf = `${cleanDaf.replace(/\.$/, "")}a`;
  else cleanDaf = cleanDaf.replace(/\.$/, "");
  const m = /^(\d{1,3})([ab])$/i.exec(cleanDaf);
  if (!slug || !m) return null;
  return `https://www.shas.org/daf-pdf/api/?masechta=${slug}&daf=${parseInt(m[1] ?? "2", 10)}&amud=${(m[2] ?? "a").toLowerCase()}`;
}

export const Route = createFileRoute("/api/talmud/vilna-pdf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tractate = url.searchParams.get("tractate") || "";
        const daf = url.searchParams.get("daf") || "";
        const upstreamUrl = shasPdfUrl(tractate, daf);
        if (!upstreamUrl) return new Response("Unknown tractate or daf", { status: 400 });

        if (request.signal?.aborted) {
          return new Response(null, { status: 499 });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const onClientAbort = () => controller.abort();
        request.signal?.addEventListener("abort", onClientAbort, { once: true });
        try {
          const upstream = await fetch(upstreamUrl, {
            signal: controller.signal,
            headers: { Accept: "application/pdf" },
          });
          if (!upstream.ok) return new Response("PDF not found", { status: 404 });
          const buf = await upstream.arrayBuffer();
          const h = new Uint8Array(buf.slice(0, 4));
          if (!(h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46)) {
            return new Response("Invalid PDF", { status: 502 });
          }
          const name = `Vilna-${tractate}-${daf}.pdf`;
          return new Response(buf, {
            headers: {
              "Content-Type": "application/pdf",
              "Cache-Control": "public, max-age=86400, s-maxage=2592000",
              "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
              // Source attribution required by the HebrewBooks.org license
              "X-Scan-Source": "shas.org / hebrewbooks.org / Moznaim",
            },
          });
        } catch {
          if (request.signal?.aborted) {
            return new Response(null, { status: 499 });
          }
          return new Response("Upstream unavailable", { status: 504 });
        } finally {
          clearTimeout(timer);
          request.signal?.removeEventListener("abort", onClientAbort);
        }
      },
    },
  },
});
