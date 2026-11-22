// @ts-nocheck
import { AnimatedMiniGlobeIcon } from './CrystalGlobeHelpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Search, X, ChevronUp, ChevronDown, History, Trash2 } from 'lucide-react';
import { searchDaf, type DafSearchHit, type SearchableSpot } from '../utils/dafSearch';

const SEARCH_HISTORY_KEY = 'talmud-daf-search-history-v1';
const SEARCH_LIST_HEIGHT_KEY = 'talmud-daf-search-list-height-v1';
const MAX_RECENT_SEARCHES = 5;
const COLLAPSE_THRESHOLD_PX = 56;
const MIN_OPEN_HEIGHT_PX = 76;

function getDefaultListHeight(): number {
  const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
  return Math.round(Math.max(140, Math.min(240, vh * 0.28)));
}

function getMaxListHeight(): number {
  const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
  return Math.round(Math.max(240, vh * 0.78));
}

function readSavedListHeight(): { height: number; collapsed: boolean } {
  const def = getDefaultListHeight();
  const max = getMaxListHeight();
  if (typeof window === 'undefined') return { height: def, collapsed: false };
  try {
    const raw = window.localStorage.getItem(SEARCH_LIST_HEIGHT_KEY);
    if (!raw) return { height: def, collapsed: false };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const h = Number((parsed as { height?: unknown }).height);
      const collapsed = Boolean((parsed as { collapsed?: unknown }).collapsed);
      return {
        height: Number.isFinite(h) ? Math.max(MIN_OPEN_HEIGHT_PX, Math.min(max, Math.round(h))) : def,
        collapsed,
      };
    }
  } catch {
    // ignore
  }
  return { height: def, collapsed: false };
}

function writeSavedListHeight(height: number, collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_LIST_HEIGHT_KEY, JSON.stringify({ height, collapsed }));
  } catch {
    // ignore storage quota errors
  }
}

function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length >= 2)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function writeRecentSearches(items: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    // ignore storage quota errors
  }
}

function mergeRecentSearch(prev: string[], term: string): string[] {
  const clean = term.trim();
  if (clean.length < 2) return prev;
  const lower = clean.toLowerCase();
  return [clean, ...prev.filter((item) => item.toLowerCase() !== lower)].slice(0, MAX_RECENT_SEARCHES);
}

const SECTION_LABEL: Record<string, string> = {
  mishnah: 'משנה · მიშნა',
  gemara: 'גמרא · გემარა',
  rashi: 'רש״י · რაში',
  tosafot: 'תוספות · თოსაფოთი',
  margin: 'גליון · კიდე',
};

interface Props {
  spots: SearchableSpot[];
  onPick: (hit: DafSearchHit) => void;
  /** Every current hit, so the daf can tint all of them at once (empty when closed). */
  onHits?: (hits: DafSearchHit[]) => void;
}

/** Floating daf search: every section, abbreviations (ק״ש ↔ קריאת שמע), prefixes, line breaks. */
export function DafSearchPanel({ spots, onPick, onHits, showButton = false }: Props & { showButton?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recentTerms, setRecentTerms] = useState<string[]>(() => readRecentSearches());
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (query.trim().length >= 2 ? searchDaf(spots, query) : []), [spots, query]);
  useEffect(() => { onHits?.(open ? hits : []); }, [hits, open]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('talmud-daf-search-state', { detail: { open } }));
  }, [open]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('talmud-daf-search-state', { detail: { open: false } }));
      }
    };
  }, []);

  const recordSearchTerm = useCallback((term: string) => {
    const clean = term.trim();
    if (clean.length < 2) return;
    setRecentTerms((prev) => {
      const next = mergeRecentSearch(prev, clean);
      writeRecentSearches(next);
      return next;
    });
  }, []);

  const clearRecentTerms = useCallback(() => {
    setRecentTerms([]);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(SEARCH_HISTORY_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  const picked = useRef(-1);
  const [showList, setShowList] = useState(true);
  const [listHeight, setListHeight] = useState<number>(() => readSavedListHeight().height);
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => readSavedListHeight().collapsed);
  const [isResizingList, setIsResizingList] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const listStateRef = useRef({ listHeight, listCollapsed });
  listStateRef.current = { listHeight, listCollapsed };
  useEffect(() => { setActive(0); picked.current = -1; setShowList(true); }, [query]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  const queryRef = useRef(query);
  queryRef.current = query;

  const startListResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const startY = Number(e.clientY);
    if (!Number.isFinite(startY)) return;
    e.preventDefault();
    e.stopPropagation();
    const { listHeight: curH, listCollapsed: wasCollapsed } = listStateRef.current;
    const measuredH = listRef.current?.getBoundingClientRect().height;
    const startH = wasCollapsed ? 0 : (measuredH && measuredH > 0 ? measuredH : curH);
    let moved = false;
    let latestHeight = curH;
    let latestCollapsed = wasCollapsed;
    setIsResizingList(true);

    const onMove = (ev: PointerEvent) => {
      if (!Number.isFinite(ev.clientY)) return;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      const maxH = getMaxListHeight();
      const next = Math.max(0, Math.min(maxH, Math.round(startH + dy)));
      if (next < COLLAPSE_THRESHOLD_PX) {
        latestCollapsed = true;
        setListCollapsed(true);
      } else {
        latestCollapsed = false;
        latestHeight = Math.max(MIN_OPEN_HEIGHT_PX, next);
        setListCollapsed(false);
        setListHeight(latestHeight);
      }
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setIsResizingList(false);
      if (!moved && wasCollapsed) {
        latestCollapsed = false;
        latestHeight = Math.max(MIN_OPEN_HEIGHT_PX, Math.min(getMaxListHeight(), curH || getDefaultListHeight()));
        setListCollapsed(false);
        setListHeight(latestHeight);
      }
      writeSavedListHeight(latestHeight, latestCollapsed);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setOpen(true); }
      if (e.key === 'Escape') {
        recordSearchTerm(queryRef.current);
        setOpen(false);
      }
    };
    const onOpen = () => setOpen((v) => !v);
    const onOtherTopDrawerState = (e: Event) => {
      if ((e as CustomEvent<{ open?: boolean }>).detail?.open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('talmud-open-daf-search', onOpen);
    window.addEventListener('talmud-gaze-hud-state', onOtherTopDrawerState);
    window.addEventListener('talmud-audio-sync-state', onOtherTopDrawerState);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('talmud-open-daf-search', onOpen);
      window.removeEventListener('talmud-gaze-hud-state', onOtherTopDrawerState);
      window.removeEventListener('talmud-audio-sync-state', onOtherTopDrawerState);
    };
  }, [recordSearchTerm]);

  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    recordSearchTerm(query);
    setActive(i);
    picked.current = i;
    // Keep only the search bar so the found words on the daf stay visible.
    setShowList(false);
    onPick(hit);
  };

  const rerunRecentTerm = (term: string) => {
    setQuery(term);
    recordSearchTerm(term);
    setShowList(true);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {!open && showButton && (
        <div className="fixed right-3 top-3 z-[400]" dir="rtl">
          <button type="button" aria-label="ძებნა დაფზე" onClick={() => setOpen(true)} className="rounded-full">
            <AnimatedMiniGlobeIcon sizeClass="w-11 h-11" iconSizeClass="w-5 h-5" search />
          </button>
        </div>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            key="daf-search-top-bar"
            data-daf-search-panel="true"
            dir="rtl"
            initial={{ y: '-100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.85 }}
            className="fixed top-0 left-0 right-0 z-[400] w-full"
          >
            <div className="w-full border-b border-[var(--study-rule)] bg-[var(--study-surface)]/95 text-[var(--study-ink)] shadow-[var(--study-shadow)] backdrop-blur-xl">
              <div className="mx-auto flex min-h-[54px] w-full items-center gap-2 px-2.5 sm:min-h-[58px] sm:px-4 lg:px-6">
                <Search className="h-4 w-4 shrink-0 text-[var(--study-muted)] sm:h-5 sm:w-5" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setShowList(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      recordSearchTerm(query);
                      if (hits.length) pick(picked.current === active ? (active + 1) % hits.length : active);
                    }
                    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); pick(Math.min(hits.length - 1, active + 1)); }
                    if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); pick(Math.max(0, active - 1)); }
                  }}
                  placeholder="חפש בדף… / მოძებნე დაფზე"
                  className="min-w-0 flex-1 bg-transparent font-serif text-base outline-none placeholder:text-[var(--study-muted)]"
                />
                {hits.length > 0 && (
                  <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--study-muted)]" dir="ltr">{active + 1}/{hits.length}</span>
                )}
                <button
                  type="button"
                  aria-label="წინა"
                  disabled={!hits.length}
                  onClick={() => pick((active - 1 + hits.length) % hits.length)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-black/5 active:scale-95 disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="შემდეგი"
                  disabled={!hits.length}
                  onClick={() => pick((active + 1) % hits.length)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-black/5 active:scale-95 disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="დახურვა"
                  onClick={() => {
                    recordSearchTerm(query);
                    setOpen(false);
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {query.trim().length < 2 && recentTerms.length > 0 && (
                <div className="border-t border-[var(--study-rule)]/50 px-2.5 py-2.5 sm:px-4 lg:px-6" dir="ltr">
                  <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--study-muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      <span>ბოლო 5 ძიება</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearRecentTerms}
                      aria-label="ძიების ისტორიის გასუფთავება"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>გასუფთავება</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recentTerms.map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => rerunRecentTerm(term)}
                        className="max-w-full truncate rounded-lg border border-[var(--study-rule)] px-2.5 py-1 font-serif text-sm transition-colors hover:border-[var(--study-accent)] hover:bg-[var(--study-accent)]/10"
                        title={term}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showList && query.trim().length >= 2 && (
                <>
                  <ul
                    ref={listRef}
                    data-daf-search-results-list="true"
                    style={{
                      maxHeight: listCollapsed ? '0px' : `${Math.min(listHeight, getMaxListHeight())}px`,
                      transition: isResizingList ? 'none' : 'max-height 160ms ease-out',
                    }}
                    className={`${
                      listCollapsed ? 'overflow-hidden border-t-0 py-0' : 'overflow-y-auto border-t border-[var(--study-rule)]/50 px-2 py-1.5 sm:px-4 lg:px-6'
                    }`}
                  >
                    {hits.length === 0 && <li className="p-3 text-center text-sm text-[var(--study-muted)]">ვერაფერი მოიძებნა</li>}
                    {hits.map((h, i) => (
                      <li key={h.ids.join('-')}>
                        <button
                          type="button"
                          onClick={() => pick(i)}
                          className={`w-full rounded-xl px-3 py-2 text-right transition-colors ${i === active ? 'bg-[var(--study-accent)] text-[var(--study-accent-ink)]' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                        >
                          <div className="text-[10px] opacity-70">{SECTION_LABEL[h.section] || h.section}</div>
                          <div className="font-serif text-[15px] leading-snug">
                            <span className="opacity-60">{h.contextBefore} </span>
                            <mark className="rounded bg-transparent font-bold text-inherit underline decoration-2 underline-offset-4">{h.match}</mark>
                            <span className="opacity-60"> {h.contextAfter}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="ძებნის სიის ზომის შეცვლა"
                    data-daf-search-resize-handle="true"
                    onPointerDown={startListResize}
                    className="flex h-7 w-full cursor-ns-resize touch-none select-none items-center justify-center border-t border-[var(--study-rule)]/45 hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                  >
                    <span className="h-1 w-10 rounded-full bg-[var(--study-muted)]/45" />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

