// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, ScrollText, X, CheckCircle2, Lightbulb, Loader2 } from 'lucide-react';
import { getBackendUrl } from '../utils/georgianTranslator';

export interface MishnahItem {
  index: number; // 1-based within chapter
  he: string;
  translationKa?: string;
  sagesHe?: string;
  explanationKa?: string;
}

const stripNikud = (s: string) =>
  (s || '').replace(/<[^>]+>/g, '').replace(/[\u0591-\u05C7]/g, '').replace(/[^\u05D0-\u05EA ]/g, ' ').replace(/\s+/g, ' ').trim();

function dafToNum(d: string) {
  const m = /^(\d+)([ab])/.exec(d || '');
  return m ? Number(m[1]) * 2 + (m[2] === 'b' ? 1 : 0) : 0;
}

/** Loads the Mishnah chapter discussed on the current daf (Sefaria) + Georgian guide (AI, cached). */
export function useMishnahChapter(tractateId: string, dafId: string, dafMishnahHe: string[], enabled: boolean) {
  const [state, setState] = useState<{ chapter: number; items: MishnahItem[]; loading: boolean; error?: string; aiLoading: boolean }>({ chapter: 0, items: [], loading: false, aiLoading: false });

  useEffect(() => {
    if (!enabled || !tractateId) return;
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: undefined }));
      try {
        const idx = await fetch(`https://www.sefaria.org/api/v2/raw/index/${encodeURIComponent(tractateId)}`).then((r) => r.json());
        const nodes = idx?.alt_structs?.Chapters?.nodes || [];
        const cur = dafToNum(dafId);
        let chapter = 1;
        nodes.forEach((n, i) => {
          const m = /\s(\d+[ab])(?::\d+)?-(\d+[ab])/.exec(n.wholeRef || '');
          if (m && cur >= dafToNum(m[1]) && cur <= dafToNum(m[2])) chapter = i + 1;
        });
        const cacheKey = `talmud_mishnah_guide_v1_${tractateId}_${chapter}`;
        const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { return null; } })();
        if (cached?.items?.length) {
          if (!cancelled) setState({ chapter, items: cached.items, loading: false, aiLoading: false });
          return;
        }
        const txt = await fetch(`https://www.sefaria.org/api/v3/texts/Mishnah_${encodeURIComponent(tractateId)}.${chapter}?version=hebrew&return_format=text_only`).then((r) => r.json());
        const he: string[] = (txt?.versions?.[0]?.text || []).map((t) => String(t || '').replace(/<[^>]+>/g, ''));
        const base = he.map((h, i) => ({ index: i + 1, he: h }));
        if (cancelled) return;
        setState({ chapter, items: base, loading: false, aiLoading: true });
        const res = await fetch(getBackendUrl('/api/talmud/mishnah-guide'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tractate: tractateId, daf: String(chapter), mishnayot: he }),
        });
        const data = res.ok ? await res.json() : { items: [] };
        const merged = base.map((b, i) => ({ ...b, ...(data.items?.[i] || {}) }));
        if (merged.some((m) => m.translationKa)) localStorage.setItem(cacheKey, JSON.stringify({ items: merged }));
        if (!cancelled) setState({ chapter, items: merged, loading: false, aiLoading: false });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, aiLoading: false, error: 'მიშნის ჩატვირთვა ვერ მოხერხდა' }));
      }
    })();
    return () => { cancelled = true; };
  }, [tractateId, dafId, enabled]);

  // Which Mishnah does this daf discuss? Match daf Mishnah text against the chapter.
  const currentIndices = useMemo(() => {
    const out = new Set<number>();
    const dafTexts = dafMishnahHe.map(stripNikud).filter(Boolean);
    for (const dt of dafTexts) {
      const probe = dt.split(' ').slice(0, 4).join(' ');
      let best = 0, bestScore = 0;
      state.items.forEach((it) => {
        const t = stripNikud(it.he);
        const score = t.includes(probe) ? 10 : dt.split(' ').filter((w) => w.length > 2 && t.includes(w)).length;
        if (score > bestScore) { bestScore = score; best = it.index; }
      });
      if (best && bestScore >= 3) out.add(best);
    }
    if (!out.size && state.items.length) out.add(1);
    return out;
  }, [dafMishnahHe, state.items]);

  return { ...state, currentIndices };
}

const tabs = [
  { id: 'both', label: 'ორივე ერთად' },
  { id: 'daf', label: 'დაფის ნაწილი' },
  { id: 'chapter', label: 'თავის სრული მიშნა' },
] as const;

function Shell({
  open,
  onClose,
  children,
  label,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
  isDark?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`${isDark === true ? 'dark ' : ''}fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#061124]/65 backdrop-blur-md`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-crystal-mishnah-modal="true"
            className="crystal-window-shell w-full max-w-[600px] max-h-[90dvh] sm:max-h-[min(86vh,780px)] rounded-t-[26px] sm:rounded-[28px] flex flex-col overflow-hidden select-none"
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.985 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MishnahMapModal({
  open,
  onClose,
  onOpenGuide,
  data,
  tractateNameKa,
  dafId,
  mishnahPct,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  onOpenGuide: () => void;
  data: ReturnType<typeof useMishnahChapter>;
  tractateNameKa: string;
  dafId: string;
  mishnahPct: number;
  isDark?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const first = [...data.currentIndices][0];
      listRef.current?.querySelector(`[data-mishnah="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 320);
    return () => clearTimeout(t);
  }, [open, data.currentIndices, data.items.length]);

  const n = data.items.length || 1;
  return (
    <Shell open={open} onClose={onClose} label="მიშნების რუკა" isDark={isDark}>
      <header className="crystal-window-header shrink-0 px-3 sm:px-4 pt-1.5 sm:pt-3 pb-2.5">
        <div
          aria-hidden="true"
          className="sm:hidden w-8 h-1 rounded-full mx-auto mb-1.5 bg-[#0F294A]/20 dark:bg-sky-200/35"
        />
        <div className="flex items-center justify-between gap-2.5">
          <span
            aria-hidden="true"
            data-tone="amber"
            className="crystal-corner-orb w-9 h-9 shrink-0 pointer-events-none"
          >
            <ScrollText className="w-4 h-4 stroke-[2.25]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] sm:text-base font-black tracking-tight text-[#0F294A] dark:text-slate-100 truncate">
              დაფის სარჩევი • რუკა
            </h2>
            <p className="text-[11px] font-bold text-[#0F294A]/70 dark:text-sky-200/75 truncate tabular-nums">
              {tractateNameKa} • თავი {data.chapter || '…'} • დაფი {dafId}
            </p>
          </div>
          <button
            type="button"
            data-raw-btn="true"
            data-tone="rose"
            className="crystal-corner-orb w-8 h-8 shrink-0 cursor-pointer"
            onClick={onClose}
            aria-label="დახურვა"
            title="დახურვა"
          >
            <X className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2.5 p-2.5 sm:p-3.5">
        <div className="crystal-window-trough shrink-0 rounded-xl px-3 py-2 flex flex-col gap-1.5">
          <div className="h-2 rounded-full overflow-hidden bg-[#0F294A]/15 dark:bg-[#051022]/85 border border-sky-900/10 dark:border-sky-300/20">
            <span
              className="block h-full rounded-full transition-all duration-500 bg-gradient-to-r from-sky-500 to-sky-600 dark:from-amber-400 dark:to-amber-500"
              style={{ width: `${mishnahPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-extrabold tabular-nums">
            <span className="text-sky-800 dark:text-amber-300">მიშნა {mishnahPct}%</span>
            <span className="text-[#0F294A]/70 dark:text-sky-200/75">გემარა {100 - mishnahPct}%</span>
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y flex flex-col gap-2 pr-0.5 select-text"
          ref={listRef}
        >
          {data.loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs font-bold text-[#0F294A]/70 dark:text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin" /> იტვირთება…
            </div>
          )}
          {data.error && (
            <div className="flex items-center justify-center py-4 text-xs font-bold text-rose-700 dark:text-rose-300">
              {data.error}
            </div>
          )}
          {data.items.map((it) => {
            const current = data.currentIndices.has(it.index);
            return (
              <button
                key={it.index}
                type="button"
                data-raw-btn="true"
                data-mishnah={it.index}
                data-mishnah-current={current ? 'true' : 'false'}
                onClick={onOpenGuide}
                className={`w-full text-start rounded-xl border p-3 sm:p-3.5 transition-all cursor-pointer active:scale-[0.99] shrink-0 ${
                  current
                    ? 'bg-gradient-to-r from-[#FFFBEB] via-[#FEF3C7] to-[#E0F2FE] text-[#0F294A] border-amber-500/80 shadow-[0_3px_10px_rgba(180,83,9,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] dark:from-amber-500/24 dark:via-sky-500/20 dark:to-amber-500/18 dark:text-slate-100 dark:border-amber-300/75 dark:shadow-[0_3px_12px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.18)]'
                    : 'bg-white/75 hover:bg-white text-[#0F294A] border-sky-200/85 dark:bg-[#0F223D]/70 dark:hover:bg-[#19355E]/85 dark:text-slate-100 dark:border-sky-300/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-black text-sky-800 dark:text-amber-300">
                    <ScrollText className="w-3.5 h-3.5 shrink-0" />
                    მიშნა {it.index}
                  </span>
                  {current ? (
                    <span className="text-[11px] font-black text-amber-800 dark:text-amber-200">
                      მიმდინარე დაფი
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold tabular-nums text-[#0F294A]/60 dark:text-sky-200/65">
                      ~{Math.round(((it.index - 0.5) / n) * 100)}% თავი
                    </span>
                  )}
                </div>
                <p className="mg-he text-[#0F294A] dark:text-slate-50" dir="rtl">
                  {it.he.split(' ').slice(0, 9).join(' ')}…
                </p>
                {it.translationKa ? (
                  <p className="mg-ka mg-ka-clamp mt-1 text-[#0F294A]/85 dark:text-slate-200/90">
                    {it.translationKa}
                  </p>
                ) : data.aiLoading ? (
                  <p className="mg-ka mg-ka-clamp mt-1 italic opacity-60">თარგმანი მზადდება…</p>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="crystal-window-header shrink-0 px-3 sm:px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] border-t border-amber-500/25 dark:border-amber-400/20">
        <button
          type="button"
          data-raw-btn="true"
          data-tone="sky"
          className="crystal-action-orb w-full h-10 sm:h-11 px-4 justify-center rounded-full! text-xs sm:text-sm font-black cursor-pointer"
          onClick={onOpenGuide}
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          <span>მიშნის იზოლირებული მეგზურის გახსნა</span>
        </button>
      </footer>
    </Shell>
  );
}

export function MishnahGuideModal({
  open,
  onClose,
  data,
  tractateNameKa,
  tractateNameHe,
  dafId,
  isDark,
}: {
  open: boolean;
  onClose: () => void;
  data: ReturnType<typeof useMishnahChapter>;
  tractateNameKa: string;
  tractateNameHe: string;
  dafId: string;
  isDark?: boolean;
}) {
  const [tab, setTab] = useState<'both' | 'daf' | 'chapter'>('both');
  const dafItems = data.items.filter((i) => data.currentIndices.has(i.index));
  const sections =
    tab === 'daf'
      ? [{ title: `მიმდინარე დაფის მიშნა (დაფი ${dafId})`, items: dafItems }]
      : tab === 'chapter'
        ? [{ title: `თავი ${data.chapter} — სრული მიშნა`, items: data.items }]
        : [
            { title: `მიმდინარე დაფის მიშნა (დაფი ${dafId})`, items: dafItems },
            { title: `თავი ${data.chapter} — სრული მიშნა`, items: data.items },
          ];
  return (
    <Shell open={open} onClose={onClose} label="მიშნის მეგზური" isDark={isDark}>
      <header className="crystal-window-header shrink-0 px-3 sm:px-4 pt-1.5 sm:pt-3 pb-2.5">
        <div
          aria-hidden="true"
          className="sm:hidden w-8 h-1 rounded-full mx-auto mb-1.5 bg-[#0F294A]/20 dark:bg-sky-200/35"
        />
        <div className="flex items-center justify-between gap-2.5">
          <span
            aria-hidden="true"
            data-tone="amber"
            className="crystal-corner-orb w-9 h-9 shrink-0 pointer-events-none"
          >
            <ScrollText className="w-4 h-4 stroke-[2.25]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] sm:text-base font-black tracking-tight text-[#0F294A] dark:text-slate-100 truncate">
              მიმდინარე გემარის მიშნა
            </h2>
            <p dir="rtl" className="mg-he-sub text-sky-800 dark:text-amber-300 truncate">
              משנה {tractateNameHe} • ({dafId})
            </p>
          </div>
          <button
            type="button"
            data-raw-btn="true"
            data-tone="rose"
            className="crystal-corner-orb w-8 h-8 shrink-0 cursor-pointer"
            onClick={onClose}
            aria-label="დახურვა"
            title="დახურვა"
          >
            <X className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>
      </header>

      <div
        className="crystal-window-trough shrink-0 mx-2.5 sm:mx-3.5 mt-2.5 rounded-full p-0.5 grid grid-cols-3 gap-0.5"
        role="tablist"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-raw-btn="true"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`h-8 px-2 rounded-full text-[11px] sm:text-xs font-extrabold leading-tight truncate cursor-pointer transition-all ${
                active
                  ? 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-xs dark:from-amber-400 dark:to-amber-600 dark:text-[#0B1D36]'
                  : 'text-[#0F294A]/75 hover:text-[#0F294A] dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {t.id === 'daf' ? `${t.label} (${dafId})` : t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 sm:p-3.5 flex flex-col gap-3 select-text">
        {data.loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs font-bold text-[#0F294A]/70 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin" /> იტვირთება…
          </div>
        )}
        {sections.map((s) => (
          <section key={s.title} className="flex flex-col gap-2.5">
            <h3 className="flex items-center justify-between gap-2 pb-1.5 border-b border-sky-900/12 dark:border-amber-400/20 text-xs font-black text-sky-800 dark:text-amber-300">
              <span>{s.title}</span>
              <span className="text-[11px] font-bold tabular-nums opacity-75">
                {s.items.length} მიშნა
              </span>
            </h3>
            {s.items.map((it) => {
              const current = data.currentIndices.has(it.index);
              return (
                <article
                  key={s.title + it.index}
                  className={`w-full rounded-xl border p-3.5 transition-all ${
                    current
                      ? 'bg-gradient-to-r from-[#FFFBEB] via-[#FEF3C7] to-[#E0F2FE] text-[#0F294A] border-amber-500/80 shadow-[0_3px_10px_rgba(180,83,9,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] dark:from-amber-500/24 dark:via-sky-500/20 dark:to-amber-500/18 dark:text-slate-100 dark:border-amber-300/75 dark:shadow-[0_3px_12px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.18)]'
                      : 'bg-white/75 text-[#0F294A] border-sky-200/85 dark:bg-[#0F223D]/70 dark:text-slate-100 dark:border-sky-300/20'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-black text-sky-800 dark:text-amber-300">
                      მიშნა {it.index}
                    </span>
                    {it.sagesHe && (
                      <span className="text-[11px] font-bold text-[#0F294A]/70 dark:text-sky-200/75 min-w-0 truncate">
                        • ბრძენნი: <span dir="rtl">{it.sagesHe}</span>
                      </span>
                    )}
                    {current && (
                      <CheckCircle2 className="w-4 h-4 ms-auto shrink-0 text-sky-700 dark:text-amber-300" />
                    )}
                  </div>
                  <p className="mg-he mg-he-full text-[#0F294A] dark:text-slate-50" dir="rtl">
                    {it.he}
                  </p>
                  <div className="h-px my-2.5 bg-sky-900/12 dark:bg-sky-300/15" />
                  {it.translationKa ? (
                    <p className="mg-ka text-[#0F294A]/90 dark:text-slate-200">
                      <b className="text-sky-800 dark:text-amber-300">თარგმანი: </b>
                      {it.translationKa}
                    </p>
                  ) : (
                    <p className="mg-ka italic opacity-60">
                      {data.aiLoading ? 'თარგმანი მზადდება…' : 'თარგმანი მიუწვდომელია'}
                    </p>
                  )}
                  {it.explanationKa && (
                    <div className="mt-3 rounded-xl p-3 bg-sky-50/75 border border-sky-200/85 dark:bg-[#091830]/80 dark:border-amber-400/25">
                      <h4 className="flex items-center gap-1.5 text-xs font-black text-sky-800 dark:text-amber-300 mb-1">
                        <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                        ჰალახური და კონცეპტუალური განმარტება
                      </h4>
                      <p className="text-[13px] leading-relaxed text-[#0F294A]/90 dark:text-slate-200">
                        {it.explanationKa}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      <footer className="crystal-window-header shrink-0 px-3 sm:px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex items-center justify-between gap-2.5 border-t border-amber-500/25 dark:border-amber-400/20">
        <span className="text-xs font-bold text-[#0F294A]/70 dark:text-slate-300 truncate">
          {tractateNameKa} • დაფი {dafId}
        </span>
        <button
          type="button"
          data-raw-btn="true"
          className="crystal-action-orb h-9 px-4 rounded-full! text-xs font-extrabold cursor-pointer shrink-0"
          onClick={onClose}
        >
          დახურვა
        </button>
      </footer>
    </Shell>
  );
}
