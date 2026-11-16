// @ts-nocheck
import { AnimatedMiniGlobeIcon } from './CrystalGlobeHelpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronUp, ChevronDown, History, Trash2 } from 'lucide-react';
import { searchDaf, type DafSearchHit, type SearchableSpot } from '../utils/dafSearch';

const SEARCH_HISTORY_KEY = 'talmud-daf-search-history-v1';
const MAX_RECENT_SEARCHES = 5;

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
  useEffect(() => { setActive(0); picked.current = -1; setShowList(true); }, [query]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setOpen(true); }
      if (e.key === 'Escape') {
        recordSearchTerm(queryRef.current);
        setOpen(false);
      }
    };
    const onOpen = () => setOpen((v) => !v);
    window.addEventListener('keydown', onKey);
    window.addEventListener('talmud-open-daf-search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('talmud-open-daf-search', onOpen);
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
    <div className="fixed right-3 top-[132px] z-[400] flex flex-col items-end gap-2" dir="rtl">
      {!open ? (
        showButton ? (
          <button type="button" aria-label="ძებნა დაფზე" onClick={() => setOpen(true)} className="rounded-full">
            <AnimatedMiniGlobeIcon sizeClass="w-11 h-11" iconSizeClass="w-5 h-5" search />
          </button>
        ) : null
      ) : (
        <div className="w-[min(92vw,380px)] rounded-2xl border border-[var(--study-rule)] bg-[var(--study-surface)] text-[var(--study-ink)] shadow-[var(--study-shadow)]">
          <div className="flex items-center gap-2 border-b border-[var(--study-rule)] p-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--study-muted)]" />
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
              <span className="shrink-0 text-xs text-[var(--study-muted)]" dir="ltr">{active + 1}/{hits.length}</span>
            )}
            <button type="button" aria-label="წინა" disabled={!hits.length} onClick={() => pick((active - 1 + hits.length) % hits.length)} className="p-1 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
            <button type="button" aria-label="შემდეგი" disabled={!hits.length} onClick={() => pick((active + 1) % hits.length)} className="p-1 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
            <button
              type="button"
              aria-label="დახურვა"
              onClick={() => {
                recordSearchTerm(query);
                setOpen(false);
              }}
              className="p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {query.trim().length < 2 && recentTerms.length > 0 && (
            <div className="border-t border-[var(--study-rule)]/50 p-2.5" dir="ltr">
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
            <ul className="max-h-[45vh] overflow-y-auto p-1">
              {hits.length === 0 && <li className="p-3 text-center text-sm text-[var(--study-muted)]">ვერაფერი მოიძებნა</li>}
              {hits.map((h, i) => (
                <li key={h.ids.join('-')}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    className={`w-full rounded-xl px-3 py-2 text-right ${i === active ? 'bg-[var(--study-accent)] text-[var(--study-accent-ink)]' : ''}`}
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
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
