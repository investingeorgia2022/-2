import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2, Minimize2, Maximize2 } from 'lucide-react';
import {
  AnalysisMode,
  SelectedDafTarget,
  TalmudSentence,
} from '../types/talmud';
import {
  TUR_BOOKS,
  REALM_COLUMN_CONFIGS,
  SacredBookItem,
  buildCuratedSacredPage,
  numberToHebrewGematria,
} from '../data/tanakhAndHalakhaData';
import { normalizeHebrewWord } from '../data/lexicon';
import { Talmud3DViewer } from './Talmud3DViewer';
import { ReadingLineGuide } from './ReadingLineGuide';
import { FullScreenModal } from './FullScreenModal';
import {
  translateToGeorgianLive,
  normalizeGeorgianJewishTerms,
} from '../utils/georgianTranslator';
import {
  buildWordCitationIndexMap,
  DetectedSacredCitation,
} from '../utils/talmudCitationDetector';

export interface TurDafInterfaceProps {
  bookId: string;
  siman: number;
  direction: 1 | -1;
  isDark: boolean;
  dafFontSizeScale: number;
  selectedTarget?: SelectedDafTarget | null;
  onSelectWordOrSentence: (
    word: string,
    sentence: TalmudSentence,
    anchorRect: DOMRect,
    initialMode?: AnalysisMode
  ) => void;
  searchHighlightQuery?: string;
  onPrevSiman: () => void;
  onNextSiman: () => void;
  externalFullViewport?: boolean;
  onExternalToggleFullViewport?: () => void;
  onOpenFloatingSourceDaf?: (req: {
    tractateId: string;
    dafId: string;
    citeHe: string;
    citeEn?: string;
    snippetHe?: string;
    highlightSnippetHe?: string;
    anchorRect?: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    } | null;
    originLabelKa?: string;
    sourceContextLabelKa?: string;
  }) => void;
  onRecordCitationReturnPoint?: (origin: {
    fromBookId?: string;
    fromBookNameKa?: string;
    fromBookNameHe?: string;
    fromChapter?: number;
    fromSentenceId?: string | null;
    fromElementId?: string | null;
    fromWindowScrollY: number;
    sourceLabelKa: string;
    sourceLabelHe?: string;
    targetLabelKa?: string;
  }) => void;
  pendingReturnRestore?: {
    seq?: number;
    restoreTrigger?: number;
    fromBookId?: string;
    fromChapter?: number;
    fromSentenceId?: string | null;
    fromElementId?: string | null;
    fromWindowScrollY?: number;
  } | null;
}

type TurPaneId =
  | 'tur-main'
  | 'beit-yosef'
  | 'darkhei-moshe'
  | 'bach'
  | 'perisha'
  | 'drisha';

const PANE_LABELS: Record<TurPaneId, { titleHe: string; titleKa: string }> = {
  'tur-main': { titleHe: 'טור', titleKa: 'არბაა ტურიმი (ძირითადი ტექსტი)' },
  'beit-yosef': { titleHe: 'בית יוסף', titleKa: 'ბეთ იოსეფი (მარან იოსეფ კარო)' },
  'darkhei-moshe': { titleHe: 'דרכי משה', titleKa: 'დარხეი მოშე (რამა)' },
  bach: { titleHe: 'ב״ח • בית חדש', titleKa: 'ბახი (ბაით ხადაში)' },
  perisha: { titleHe: 'פרישה', titleKa: 'ფერიშა' },
  drisha: { titleHe: 'דרישה', titleKa: 'დრიშა' },
};

const TUR_VOLUME_SHORT_KA: Record<string, string> = {
  'Tur,_Orach_Chaim': 'ორახ ხაიმი',
  'Tur,_Yoreh_Deah': 'იორე დეა',
  'Tur,_Even_HaEzer': 'ებენ ჰაეზერი',
  'Tur,_Choshen_Mishpat': 'ხოშენ მიშფატი',
};

const stripHtmlTags = (raw: string): string =>
  (raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

export const TurDafInterface: React.FC<TurDafInterfaceProps> = React.memo(({
  bookId,
  siman,
  direction,
  isDark,
  dafFontSizeScale,
  selectedTarget,
  onSelectWordOrSentence,
  searchHighlightQuery = '',
  onPrevSiman,
  onNextSiman,
  externalFullViewport = false,
  onExternalToggleFullViewport,
  onOpenFloatingSourceDaf,
  onRecordCitationReturnPoint,
  pendingReturnRestore,
}) => {
  const currentBook: SacredBookItem = useMemo(
    () => TUR_BOOKS.find((b) => b.id === bookId) ?? TUR_BOOKS[0]!,
    [bookId]
  );

  const colConfig = REALM_COLUMN_CONFIGS.tur;
  const curatedPage = useMemo(
    () => buildCuratedSacredPage('tur', currentBook, siman),
    [currentBook, siman]
  );

  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [liveMain, setLiveMain] = useState<TalmudSentence[] | null>(null);
  const [liveBeitYosef, setLiveBeitYosef] = useState<TalmudSentence[] | null>(null);
  const [liveDarkheiMoshe, setLiveDarkheiMoshe] = useState<TalmudSentence[] | null>(null);
  const [liveBach, setLiveBach] = useState<TalmudSentence[] | null>(null);
  const [livePerisha, setLivePerisha] = useState<TalmudSentence[] | null>(null);
  const [liveDrisha, setLiveDrisha] = useState<TalmudSentence[] | null>(null);

  const [showInlineTranslation, setShowInlineTranslation] = useState<boolean>(false);
  const [focusedPane, setFocusedPane] = useState<TurPaneId>('tur-main');
  const [minimizedPanes, setMinimizedPanes] = useState<Record<string, boolean>>({});
  const [maximizedPaneModal, setMaximizedPaneModal] = useState<{
    paneId: TurPaneId;
    title: string;
    subtitle: string;
    hebrewText: string;
    georgianText: string;
  } | null>(null);

  const storageKey = `tur_stopped_idx_${currentBook.id}_${siman}`;
  const [stoppedIdx, setStoppedIdx] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`tur_stopped_idx_${currentBook.id}_${siman}`);
      const parsed = saved ? parseInt(saved, 10) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const parsed = saved ? parseInt(saved, 10) : 0;
      setStoppedIdx(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
    } catch {
      setStoppedIdx(0);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(stoppedIdx));
    } catch {
      // ignore storage errors
    }
  }, [storageKey, stoppedIdx]);

  // Fetch live Siman + Beit Yosef, Darkhei Moshe, Bach, Perisha, Drisha from Sefaria API with graceful fallback
  useEffect(() => {
    let cancelled = false;
    setLoadingLive(true);
    setLiveMain(null);
    setLiveBeitYosef(null);
    setLiveDarkheiMoshe(null);
    setLiveBach(null);
    setLivePerisha(null);
    setLiveDrisha(null);

    const ref = `${currentBook.sefariaRef}.${siman}`;
    fetch(`https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?commentary=1&context=0`)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (cancelled || !data) return;

        const heArr: string[] = Array.isArray(data.he)
          ? data.he.flat().map((s: unknown) => (typeof s === 'string' ? stripHtmlTags(s) : '')).filter(Boolean)
          : typeof data.he === 'string' && data.he.trim()
            ? [stripHtmlTags(data.he)]
            : [];
        const enArr: string[] = Array.isArray(data.text)
          ? data.text.flat().map((s: unknown) => (typeof s === 'string' ? stripHtmlTags(s) : '')).filter(Boolean)
          : typeof data.text === 'string' && data.text.trim()
            ? [stripHtmlTags(data.text)]
            : [];

        if (heArr.length > 0) {
          const slicedHe = heArr.slice(0, 12);
          const builtMain: TalmudSentence[] = await Promise.all(
            slicedHe.map(async (heText, i) => {
              const enText = enArr[i] || '';
              let kaText = '';
              if (i < 5) {
                try {
                  kaText = await translateToGeorgianLive(
                    enText || heText,
                    enText ? 'en' : 'iw'
                  );
                } catch {
                  kaText = '';
                }
              }
              if (kaText && !/[\u10A0-\u10FF]/.test(kaText)) {
                kaText = '';
              }
              return {
                id: `tur-live-main-${currentBook.id}-${siman}-${i + 1}`,
                source: 'gemara',
                dibburHamatchil: `סעיף ${numberToHebrewGematria(i + 1)}`,
                hebrewText: heText,
                translationKa: normalizeGeorgianJewishTerms(
                  kaText ||
                    `${currentBook.nameKa} • სიმანი ${siman}:${i + 1}`
                ),
                explanationKa: `${colConfig.centerMainHeaderKa} (${currentBook.nameHe} סי׳ ${numberToHebrewGematria(siman)})`,
              };
            })
          );
          if (!cancelled) setLiveMain(builtMain);
        }

        if (Array.isArray(data.commentary) && data.commentary.length > 0) {
          interface SefariaCommentaryRaw {
            he?: string | string[];
            sourceHeRef?: string;
            collectiveTitle?: { en?: string; he?: string };
          }
          const commItems = (data.commentary as SefariaCommentaryRaw[]).filter(
            (c) =>
              (typeof c.he === 'string' && stripHtmlTags(c.he).length > 8) ||
              (Array.isArray(c.he) && stripHtmlTags(c.he.flat().join(' ')).length > 8)
          );

          const toSentences = (
            items: SefariaCommentaryRaw[],
            prefix: string,
            source: 'rashi' | 'tosafot',
            defaultTitleHe: string,
            defaultLabelKa: string
          ): TalmudSentence[] =>
            items.slice(0, 8).map((c, idx) => {
              const heStr = Array.isArray(c.he)
                ? stripHtmlTags(c.he.flat().join(' '))
                : stripHtmlTags(c.he || '');
              return {
                id: `tur-${prefix}-${currentBook.id}-${siman}-${idx + 1}`,
                source,
                dibburHamatchil: c.collectiveTitle?.he || c.sourceHeRef || defaultTitleHe,
                hebrewText: heStr,
                translationKa: `${defaultLabelKa} — კლასიკური განმარტება (${c.sourceHeRef || `סי׳ ${siman}`}).`,
                explanationKa: defaultLabelKa,
              };
            });

          const byItems = commItems.filter((c) =>
            /Beit Yosef|בית יוסף/i.test(`${c.collectiveTitle?.en || ''} ${c.collectiveTitle?.he || ''}`)
          );
          const dmItems = commItems.filter((c) =>
            /Darkhei Moshe|דרכי משה/i.test(`${c.collectiveTitle?.en || ''} ${c.collectiveTitle?.he || ''}`)
          );
          const bachItems = commItems.filter((c) =>
            /Bach|Bayit Chadash|ב"ח|בית חדש|ב״ח/i.test(`${c.collectiveTitle?.en || ''} ${c.collectiveTitle?.he || ''}`)
          );
          const perishaItems = commItems.filter((c) =>
            /Perisha|פרישה/i.test(`${c.collectiveTitle?.en || ''} ${c.collectiveTitle?.he || ''}`)
          );
          const drishaItems = commItems.filter((c) =>
            /Drisha|Derisha|דרישה/i.test(`${c.collectiveTitle?.en || ''} ${c.collectiveTitle?.he || ''}`)
          );

          const used = new Set([
            ...byItems,
            ...dmItems,
            ...bachItems,
            ...perishaItems,
            ...drishaItems,
          ]);
          const rest = commItems.filter((c) => !used.has(c));

          if (!cancelled) {
            if (byItems.length > 0) {
              setLiveBeitYosef(
                toSentences(byItems, 'by', 'rashi', 'בית יוסף', colConfig.rightHeaderKa)
              );
            } else if (rest.length > 0) {
              setLiveBeitYosef(
                toSentences(rest.slice(0, 5), 'by', 'rashi', 'בית יוסף', colConfig.rightHeaderKa)
              );
            }
            if (dmItems.length > 0) {
              setLiveDarkheiMoshe(
                toSentences(dmItems, 'dm', 'tosafot', 'דרכי משה', colConfig.leftHeaderKa)
              );
            }
            if (bachItems.length > 0) {
              setLiveBach(
                toSentences(bachItems, 'bach', 'tosafot', 'ב״ח', colConfig.centerTopHeaderKa)
              );
            }
            if (perishaItems.length > 0) {
              setLivePerisha(
                toSentences(perishaItems, 'perisha', 'rashi', 'פרישה', colConfig.bottomRightHeaderKa)
              );
            }
            if (drishaItems.length > 0) {
              setLiveDrisha(
                toSentences(drishaItems, 'drisha', 'tosafot', 'דרישה', colConfig.bottomLeftHeaderKa)
              );
            }
          }
        }
      })
      .catch(() => {
        // Fallback smoothly to curated page
      })
      .finally(() => {
        if (!cancelled) setLoadingLive(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentBook, siman, colConfig]);

  const mainSentences = liveMain || curatedPage.centerMainSentences;
  const beitYosefSentences = liveBeitYosef || curatedPage.rightColSentences;
  const darkheiMosheSentences = liveDarkheiMoshe || curatedPage.leftColSentences;
  const bachSentences = liveBach || curatedPage.centerTopSentences;
  const perishaSentences = livePerisha || curatedPage.bottomRightSentences;
  const drishaSentences = liveDrisha || curatedPage.bottomLeftSentences;

  // Authentic stepped "Berech" (ברך) split: Beit Yosef frames the right pillar and wraps underneath Tur
  const { beitYosefSide, beitYosefWrap } = useMemo(() => {
    if (beitYosefSentences.length >= 3) {
      const splitIdx = Math.max(2, Math.ceil(beitYosefSentences.length * 0.58));
      return {
        beitYosefSide: beitYosefSentences.slice(0, splitIdx),
        beitYosefWrap: beitYosefSentences.slice(splitIdx),
      };
    }
    return {
      beitYosefSide: beitYosefSentences,
      beitYosefWrap: [] as TalmudSentence[],
    };
  }, [beitYosefSentences]);

  const getPaneSentences = useCallback(
    (paneId: TurPaneId): TalmudSentence[] => {
      switch (paneId) {
        case 'beit-yosef':
          return beitYosefSentences;
        case 'darkhei-moshe':
          return darkheiMosheSentences;
        case 'bach':
          return bachSentences;
        case 'perisha':
          return perishaSentences;
        case 'drisha':
          return drishaSentences;
        default:
          return mainSentences;
      }
    },
    [
      mainSentences,
      beitYosefSentences,
      darkheiMosheSentences,
      bachSentences,
      perishaSentences,
      drishaSentences,
    ]
  );

  // Sync pane focus to bottom panel's minimize/maximize buttons
  const focusPane = useCallback(
    (paneId: TurPaneId) => {
      setFocusedPane(paneId);
      const meta = PANE_LABELS[paneId];
      window.dispatchEvent(
        new CustomEvent('global-daf-pane-focus', {
          detail: {
            paneId,
            titleHe: meta.titleHe,
            titleKa: meta.titleKa,
            isMinimized: Boolean(minimizedPanes[paneId]),
            isMaximized: false,
          },
        })
      );
    },
    [minimizedPanes]
  );

  useEffect(() => {
    focusPane(focusedPane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, siman]);

  useEffect(() => {
    const onPaneAction = (e: Event) => {
      const detail = (e as CustomEvent<{ paneId?: string; action?: 'minimize' | 'maximize' }>).detail;
      if (!detail || !detail.paneId || !(detail.paneId in PANE_LABELS)) return;
      const paneId = detail.paneId as TurPaneId;
      const meta = PANE_LABELS[paneId];

      if (detail.action === 'minimize') {
        setMinimizedPanes((prev) => {
          const nextVal = !prev[paneId];
          const updated = { ...prev, [paneId]: nextVal };
          window.dispatchEvent(
            new CustomEvent('global-daf-pane-focus', {
              detail: {
                paneId,
                titleHe: meta.titleHe,
                titleKa: meta.titleKa,
                isMinimized: nextVal,
                isMaximized: false,
              },
            })
          );
          return updated;
        });
      } else if (detail.action === 'maximize') {
        const list = getPaneSentences(paneId);
        const heText = list
          .map((s, idx) => `(${numberToHebrewGematria(idx + 1)}) ${s.hebrewText || ''}`)
          .join('\n\n');
        const kaText = list
          .map((s, idx) => `(${idx + 1}) ${s.translationKa || s.explanationKa || ''}`)
          .join('\n\n');
        setMaximizedPaneModal({
          paneId,
          title: meta.titleKa,
          subtitle: `${currentBook.nameHe} סי׳ ${numberToHebrewGematria(siman)} • ${meta.titleHe}`,
          hebrewText: heText,
          georgianText: kaText,
        });
      }
    };

    window.addEventListener('global-daf-pane-action', onPaneAction);
    return () => window.removeEventListener('global-daf-pane-action', onPaneAction);
  }, [currentBook.nameHe, siman, getPaneSentences]);

  // Listen to global page step & bottom dock action events
  const onPrevRef = useRef(onPrevSiman);
  const onNextRef = useRef(onNextSiman);
  onPrevRef.current = onPrevSiman;
  onNextRef.current = onNextSiman;

  useEffect(() => {
    const onGlobalPrev = () => onPrevRef.current();
    const onGlobalNext = () => onNextRef.current();
    const onSacredStep = (e: Event) => {
      const dir = (e as CustomEvent<{ dir?: 'prev' | 'next' }>).detail?.dir;
      if (dir === 'prev') onPrevRef.current();
      else if (dir === 'next') onNextRef.current();
    };
    const onToggleLineTranslate = () => {
      setShowInlineTranslation((v) => !v);
    };

    window.addEventListener('global-page-prev', onGlobalPrev);
    window.addEventListener('global-page-next', onGlobalNext);
    window.addEventListener('sacred-daf-step', onSacredStep);
    window.addEventListener('talmud-toggle-line-translate', onToggleLineTranslate);

    return () => {
      window.removeEventListener('global-page-prev', onGlobalPrev);
      window.removeEventListener('global-page-next', onGlobalNext);
      window.removeEventListener('sacred-daf-step', onSacredStep);
      window.removeEventListener('talmud-toggle-line-translate', onToggleLineTranslate);
    };
  }, []);

  // Bookmark stopped-line stepper event from bottom dock
  useEffect(() => {
    const onBookmarkStep = (e: Event) => {
      const dir = (e as CustomEvent<{ dir?: 'jump' | 'prev' | 'next' }>).detail?.dir;
      const total = mainSentences.length;
      if (total === 0) return;
      let targetIdx = stoppedIdx;
      if (dir === 'prev') {
        targetIdx = Math.max(0, stoppedIdx - 1);
      } else if (dir === 'next') {
        targetIdx = Math.min(total - 1, stoppedIdx + 1);
      } else {
        targetIdx = Math.min(total - 1, Math.max(0, stoppedIdx));
      }
      setStoppedIdx(targetIdx);
      const sent = mainSentences[targetIdx];
      if (sent) {
        const el = document.getElementById(`tur-sent-${sent.id}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    window.addEventListener('global-talmud-bookmark-step', onBookmarkStep);
    return () => window.removeEventListener('global-talmud-bookmark-step', onBookmarkStep);
  }, [mainSentences, stoppedIdx]);

  // Restore scroll when returning from floating Talmud citation preview
  useEffect(() => {
    if (!pendingReturnRestore) return;
    if (pendingReturnRestore.fromElementId) {
      const el = document.getElementById(pendingReturnRestore.fromElementId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    if (typeof pendingReturnRestore.fromWindowScrollY === 'number') {
      window.scrollTo({ top: pendingReturnRestore.fromWindowScrollY, behavior: 'smooth' });
    }
  }, [pendingReturnRestore]);

  const handleCitationClick = useCallback(
    (cit: DetectedSacredCitation, sentence: TalmudSentence, rect: DOMRect) => {
      if (onRecordCitationReturnPoint) {
        onRecordCitationReturnPoint({
          fromBookId: currentBook.id,
          fromBookNameKa: currentBook.nameKa,
          fromBookNameHe: currentBook.nameHe,
          fromChapter: siman,
          fromSentenceId: sentence.id,
          fromElementId: `tur-sent-${sentence.id}`,
          fromWindowScrollY: typeof window !== 'undefined' ? window.scrollY : 0,
          sourceLabelKa: `${currentBook.nameKa.split(' (')[0]} • სი׳ ${siman}`,
          sourceLabelHe: `${currentBook.nameHe} סי׳ ${numberToHebrewGematria(siman)}`,
          targetLabelKa: cit.labelKa,
        });
      }
      if (onOpenFloatingSourceDaf && cit.tractateId && cit.dafId) {
        onOpenFloatingSourceDaf({
          tractateId: cit.tractateId,
          dafId: cit.dafId,
          citeHe: cit.labelHe,
          ...(sentence.hebrewText ? { snippetHe: sentence.hebrewText.slice(0, 140) } : {}),
          anchorRect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          originLabelKa: `${currentBook.nameKa.split(' (')[0]} סי׳ ${siman}`,
          sourceContextLabelKa: cit.labelKa,
        });
      }
    },
    [currentBook, siman, onRecordCitationReturnPoint, onOpenFloatingSourceDaf]
  );

  const normalizedSearch = searchHighlightQuery.trim();
  const normalizedSelectedWord = selectedTarget ? normalizeHebrewWord(selectedTarget.word) : '';

  const renderInteractiveWords = useCallback(
    (sentence: TalmudSentence, isMainColumn: boolean, sentenceIndex: number) => {
      const rawText = (sentence.hebrewText || '').trim();
      const words = rawText.split(/\s+/).filter(Boolean);
      const citeMap = buildWordCitationIndexMap(words, 'Shabbat');
      const isSelectedSent = selectedTarget?.sentence?.id === sentence.id;
      const isStoppedLine = isMainColumn && sentenceIndex === stoppedIdx;
      const isOpeningSentence = isMainColumn && sentenceIndex === 0;

      return (
        <span
          id={`tur-sent-${sentence.id}`}
          key={sentence.id}
          onClick={() => {
            if (isMainColumn) setStoppedIdx(sentenceIndex);
          }}
          className={`inline transition-colors ${
            isSelectedSent || isStoppedLine ? 'tur-daf-sentence-active' : ''
          }`}
        >
          {sentence.dibburHamatchil && (
            <span
              className={`${
                isOpeningSentence ? 'tur-daf-drop-word ml-1.5' : 'tur-daf-dibbur ml-1'
              }`}
            >
              {sentence.dibburHamatchil}
              {!isMainColumn ? '׃ ' : ' '}
            </span>
          )}
          {words.map((word, wIdx) => {
            const cit = citeMap.get(wIdx);
            const cleanWord = normalizeHebrewWord(word);
            const isSelectedWord =
              Boolean(normalizedSelectedWord) && cleanWord === normalizedSelectedWord;
            const isSearchMatch =
              Boolean(normalizedSearch) &&
              (word.includes(normalizedSearch) ||
                (sentence.translationKa || '').toLowerCase().includes(normalizedSearch.toLowerCase()));

            return (
              <React.Fragment key={`${sentence.id}-w-${wIdx}`}>
                <span
                  data-daf-word="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMainColumn) setStoppedIdx(sentenceIndex);
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (cit && (onOpenFloatingSourceDaf || onRecordCitationReturnPoint)) {
                      handleCitationClick(cit, sentence, rect);
                      return;
                    }
                    onSelectWordOrSentence(word, sentence, rect, 'word-ka');
                  }}
                  title={cit ? `წყარო თალმუდში: ${cit.labelKa}` : 'დააჭირეთ სიტყვის თარგმანისა და ანალიზისთვის'}
                  className={`tur-daf-word ${
                    isSelectedWord ? 'tur-daf-word-active' : ''
                  } ${cit ? 'tur-daf-word-cite' : ''} ${
                    isSearchMatch ? 'tur-daf-word-search' : ''
                  }`}
                >
                  {word}
                </span>{' '}
              </React.Fragment>
            );
          })}
          {showInlineTranslation && sentence.translationKa && (
            <span
              dir="ltr"
              lang="ka"
              className="block my-1.5 px-2.5 py-1 rounded border border-amber-800/30 bg-amber-900/5 text-[0.78em] font-sans leading-relaxed text-[#2b180b]"
            >
              {sentence.translationKa}
            </span>
          )}
          {!isMainColumn && <span className="text-[#3d2511]/70 mx-0.5">׃ </span>}
          {isMainColumn && <span className="inline-block w-1.5" />}
        </span>
      );
    },
    [
      selectedTarget,
      stoppedIdx,
      normalizedSelectedWord,
      normalizedSearch,
      showInlineTranslation,
      handleCitationClick,
      onOpenFloatingSourceDaf,
      onRecordCitationReturnPoint,
      onSelectWordOrSentence,
    ]
  );

  // Clean classic Hebrew column heading (zero Georgian noise on paper; mini controls reveal quietly on hover/focus)
  const renderPaneHeader = (paneId: TurPaneId, titleHe: string) => {
    const isMin = Boolean(minimizedPanes[paneId]);
    const isFocused = focusedPane === paneId;
    const meta = PANE_LABELS[paneId];
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          focusPane(paneId);
        }}
        title={meta.titleKa}
        className={`group/hdr relative flex items-center justify-center pb-1 mb-1.5 border-b ${
          isFocused ? 'border-amber-800/60' : 'border-stone-800/30'
        } cursor-pointer select-none`}
      >
        <span className="tur-daf-pane-heading font-black text-[0.95em] tracking-wide px-4 text-center">
          {titleHe}
        </span>

        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity ${
            isFocused || isMin ? 'opacity-70' : 'opacity-0 group-hover/hdr:opacity-90 focus-within:opacity-90'
          }`}
        >
          <button
            type="button"
            data-raw-btn="true"
            data-flat-btn="true"
            onClick={(e) => {
              e.stopPropagation();
              focusPane(paneId);
              setMinimizedPanes((prev) => ({ ...prev, [paneId]: !prev[paneId] }));
            }}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-amber-800/15 text-stone-800 cursor-pointer"
            title={isMin ? 'ველის გახსნა' : 'ველის ჩაკეცვა'}
            aria-label="ველის ჩაკეცვა"
          >
            <Minimize2 className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            data-raw-btn="true"
            data-flat-btn="true"
            onClick={(e) => {
              e.stopPropagation();
              focusPane(paneId);
              const list = getPaneSentences(paneId);
              setMaximizedPaneModal({
                paneId,
                title: meta.titleKa,
                subtitle: `${currentBook.nameHe} סי׳ ${numberToHebrewGematria(siman)} • ${meta.titleHe}`,
                hebrewText: list
                  .map((s, idx) => `(${numberToHebrewGematria(idx + 1)}) ${s.hebrewText || ''}`)
                  .join('\n\n'),
                georgianText: list
                  .map((s, idx) => `(${idx + 1}) ${s.translationKa || s.explanationKa || ''}`)
                  .join('\n\n'),
              });
            }}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-amber-800/15 text-stone-800 cursor-pointer"
            title="სრულ ეკრანზე გახსნა"
            aria-label="ველის გაშლა"
          >
            <Maximize2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    );
  };

  const simanGematria = numberToHebrewGematria(siman);
  const shortVolKa = TUR_VOLUME_SHORT_KA[currentBook.id] || 'არბაა ტურიმი';
  const scaledFontPercent = Math.max(70, Math.min(180, dafFontSizeScale));

  return (
    <div
      id="talmud-daf-folio-anchor"
      data-full-viewport-daf={externalFullViewport ? 'true' : 'false'}
      style={{
        scrollSnapType: 'none',
        scrollBehavior: 'smooth',
        scrollMarginTop: '64px',
      }}
      className={
        externalFullViewport
          ? 'fixed inset-0 z-[280] w-screen h-[100dvh] overflow-y-auto overflow-x-hidden flex flex-col items-center justify-start p-0 m-0 bg-[#FBF8F1] text-[#140d07]'
          : 'w-full max-w-full flex flex-col items-center justify-center mx-auto'
      }
    >
      <div
        className={
          externalFullViewport
            ? 'relative w-full max-w-none min-h-full flex flex-col items-center justify-start transition-all p-0 m-0'
            : 'relative w-full max-w-[960px] mx-auto flex flex-col items-center justify-center transition-all'
        }
      >
        <Talmud3DViewer
          pageKey={`tur-${currentBook.id}-${siman}`}
          direction={direction}
          isDark={isDark}
          showControlsAboveDaf={false}
          isFullScreen={externalFullViewport}
          {...(onExternalToggleFullViewport ? { onToggleFullScreen: onExternalToggleFullViewport } : {})}
          onPrevAmud={onPrevSiman}
          onNextAmud={onNextSiman}
          dafTitleLabel={`ტური • ${shortVolKa} • სიმანი ${siman}`}
        >
          <div className="crystal-daf-folio rounded-2xl p-1.5 sm:p-2.5 w-full">
            <article
              dir="rtl"
              style={{
                fontSize: `calc(clamp(9.2px, 1.52vw, 15.5px) * ${scaledFontPercent / 100})`,
              }}
              className="tur-daf-sheet rounded-xl px-2.5 py-2.5 sm:px-6 sm:py-5 relative overflow-hidden"
            >
              {/* SINGLE UNIFIED READING LINE GUIDE FOR ENTIRE FOLIO */}
              <ReadingLineGuide
                initialY={110}
                compact
                isDarkField={false}
                fieldLabel={`${currentBook.nameHe} סי׳ ${simanGematria}`}
              />

              {/* AUTHENTIC PRINTED HEBREW RUNNING HEADER INSIDE THE FOLIO (ZERO CLUTTER) */}
              <header className="tur-daf-header-rule pb-1.5 mb-2.5 grid grid-cols-3 items-end text-[#140d07]">
                <div className="text-right text-[0.88em] font-bold tracking-wide truncate">
                  {currentBook.nameHe}
                </div>

                <div className="text-center leading-tight">
                  <div className="text-[1.22em] font-black tracking-wide">
                    ארבעה טורים
                  </div>
                  <div className="text-[0.82em] font-bold text-[#2f1a0a]">
                    סימן {simanGematria}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 text-[0.88em] font-bold">
                  {loadingLive && (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-900/80" />
                  )}
                  <span>סי׳ {simanGematria}</span>
                </div>
              </header>

              {/* AUTHENTIC TZURAT HADAF PRINTED ENVELOPE GRID (ALWAYS HORIZONTAL MULTI-PILLAR AT ALL WIDTHS):
                  RTL Grid (col 1..12 = Right to Left):
                  - Col 1..9: Inner Envelope (Top = Right Beit Yosef + Center [Bach + Tur], Bottom Knee = Beit Yosef Wrap under Tur)
                  - Col 10..12 (Visual Left): Full-height Darkhei Moshe outer wing */}
              <div className="grid grid-cols-12 gap-0 border-t border-stone-800/50">
                {/* RIGHT & CENTER ENVELOPE (9 cols in RTL = Right + Center) */}
                <div className="col-span-9 flex flex-col border-l border-stone-800/50">
                  <div className="grid grid-cols-9 flex-1">
                    {/* VISUAL RIGHT WING: BEIT YOSEF (בית יוסף) */}
                    <section
                      onClick={() => focusPane('beit-yosef')}
                      className={`tur-daf-col col-span-4 px-2 py-2 sm:px-3 sm:py-2.5 border-l border-stone-800/45 ${
                        focusedPane === 'beit-yosef' ? 'tur-daf-col-focused' : ''
                      }`}
                    >
                      {renderPaneHeader('beit-yosef', 'בית יוסף')}
                      {!minimizedPanes['beit-yosef'] && (
                        <div className="tur-daf-commentary">
                          {beitYosefSide.map((s: TalmudSentence, idx: number) =>
                            renderInteractiveWords(s, false, idx)
                          )}
                        </div>
                      )}
                    </section>

                    {/* VISUAL CENTER PILLAR: BACH + MAIN TUR SIMAN */}
                    <section
                      onClick={() => focusPane('tur-main')}
                      className={`tur-daf-col col-span-5 px-2 py-2 sm:px-3.5 sm:py-2.5 bg-[#fcf7e9]/45 ${
                        focusedPane === 'tur-main' ? 'tur-daf-col-focused' : ''
                      }`}
                    >
                      {bachSentences.length > 0 && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            focusPane('bach');
                          }}
                          className={`tur-daf-col mb-2.5 pb-2 border-b border-stone-800/45 ${
                            focusedPane === 'bach' ? 'tur-daf-col-focused px-1 pt-0.5' : ''
                          }`}
                        >
                          {renderPaneHeader('bach', 'ב״ח • בית חדש')}
                          {!minimizedPanes['bach'] && (
                            <div className="tur-daf-commentary">
                              {bachSentences.map((s: TalmudSentence, idx: number) =>
                                renderInteractiveWords(s, false, idx)
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {renderPaneHeader('tur-main', `טור • סימן ${simanGematria}`)}
                      {!minimizedPanes['tur-main'] && (
                        <div className="tur-daf-main">
                          {mainSentences.map((s, idx) =>
                            renderInteractiveWords(s, true, idx)
                          )}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* STEPPED "BERECH" (בֶּרֶךְ): BEIT YOSEF CONTINUATION WRAPPING UNDER TUR */}
                  {beitYosefWrap.length > 0 && !minimizedPanes['beit-yosef'] && (
                    <section
                      onClick={() => focusPane('beit-yosef')}
                      className={`tur-daf-col ${
                        focusedPane === 'beit-yosef' ? 'tur-daf-col-focused' : ''
                      }`}
                    >
                      {/* Stepped horizontal rule closes bottom of Tur (5 center cols) while leaving Right Beit Yosef seamless */}
                      <div className="grid grid-cols-9 pointer-events-none">
                        <div className="col-span-4 border-t border-transparent" />
                        <div className="col-span-5 border-t border-stone-800/45" />
                      </div>
                      <div className="tur-daf-commentary px-2 py-2 sm:px-3 sm:py-2.5">
                        {beitYosefWrap.map((s: TalmudSentence, idx: number) =>
                          renderInteractiveWords(s, false, beitYosefSide.length + idx)
                        )}
                      </div>
                    </section>
                  )}
                </div>

                {/* VISUAL LEFT OUTER WING: DARKHEI MOSHE (דרכי משה) */}
                <section
                  onClick={() => focusPane('darkhei-moshe')}
                  className={`tur-daf-col col-span-3 px-2 py-2 sm:px-3 sm:py-2.5 ${
                    focusedPane === 'darkhei-moshe' ? 'tur-daf-col-focused' : ''
                  }`}
                >
                  {renderPaneHeader('darkhei-moshe', 'דרכי משה')}
                  {!minimizedPanes['darkhei-moshe'] && (
                    <div className="tur-daf-commentary">
                      {darkheiMosheSentences.map((s: TalmudSentence, idx: number) =>
                        renderInteractiveWords(s, false, idx)
                      )}
                    </div>
                  )}
                </section>
              </div>

              {/* BOTTOM PRINTED COMMENTARY BAND ON DOUBLE RULE: PERISHA (RIGHT) & DRISHA (LEFT) */}
              <div className="tur-daf-bottom-band grid grid-cols-2">
                <section
                  onClick={() => focusPane('perisha')}
                  className={`tur-daf-col px-2 py-2 sm:px-3 sm:py-2.5 border-l border-stone-800/40 ${
                    focusedPane === 'perisha' ? 'tur-daf-col-focused' : ''
                  }`}
                >
                  {renderPaneHeader('perisha', 'פרישה')}
                  {!minimizedPanes['perisha'] && (
                    <div className="tur-daf-commentary">
                      {perishaSentences.map((s: TalmudSentence, idx: number) =>
                        renderInteractiveWords(s, false, idx)
                      )}
                    </div>
                  )}
                </section>

                <section
                  onClick={() => focusPane('drisha')}
                  className={`tur-daf-col px-2 py-2 sm:px-3 sm:py-2.5 ${
                    focusedPane === 'drisha' ? 'tur-daf-col-focused' : ''
                  }`}
                >
                  {renderPaneHeader('drisha', 'דרישה')}
                  {!minimizedPanes['drisha'] && (
                    <div className="tur-daf-commentary">
                      {drishaSentences.map((s: TalmudSentence, idx: number) =>
                        renderInteractiveWords(s, false, idx)
                      )}
                    </div>
                  )}
                </section>
              </div>
            </article>
          </div>
        </Talmud3DViewer>
      </div>

      {maximizedPaneModal && (
        <FullScreenModal
          isOpen={Boolean(maximizedPaneModal)}
          onClose={() => setMaximizedPaneModal(null)}
          title={maximizedPaneModal.title}
          subtitle={maximizedPaneModal.subtitle}
          hebrewText={maximizedPaneModal.hebrewText}
          georgianText={maximizedPaneModal.georgianText}
          isDark={isDark}
        />
      )}
    </div>
  );
});
