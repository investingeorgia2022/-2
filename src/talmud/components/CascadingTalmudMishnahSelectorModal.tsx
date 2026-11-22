// @ts-nocheck
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { X, Check, RotateCcw, History, ArrowRight, Sliders, Minus, Plus } from 'lucide-react';
import { SEDARIM, TRACTATES, toHebrewDafNumber } from '../data/tractates';
import { RecentlyViewedDaf } from '../types/talmud';

export type { RecentlyViewedDaf };

export interface CascadingTalmudMishnahSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSederId?: string;
  initialTractateId?: string;
  initialDafId?: string;
  initialChapter?: number;
  initialMishnah?: number;
  onSelectDaf?: (tractateId: string, dafId: string) => void;
  onSelectMishnah?: (tractateId: string, chapter: number, mishnah: number) => void;
  recentlyViewedDapim?: RecentlyViewedDaf[];
  onClearHistory?: () => void;
  isDark?: boolean;
  theme?: string;
}

// Complete Mishnah Tractate Catalog (all 63 tractates of the Shishah Sidrei Mishnah)
interface MishnahTractateMeta {
  id: string;
  sederId: string;
  nameKa: string;
  nameHe: string;
  chapters: number;
}

const ALL_MISHNAH_TRACTATES: MishnahTractateMeta[] = [
  // ZERAIM (11) — All 11 tractates of Seder Zeraim
  { id: 'Berakhot', sederId: 'zeraim', nameKa: 'ბერახოთი', nameHe: 'ברכות', chapters: 9 },
  { id: 'Peah', sederId: 'zeraim', nameKa: 'ფეა', nameHe: 'פאה', chapters: 8 },
  { id: 'Demai', sederId: 'zeraim', nameKa: 'დემაი', nameHe: 'דמאי', chapters: 7 },
  { id: 'Kilayim', sederId: 'zeraim', nameKa: 'კილაიიმი', nameHe: 'כלאים', chapters: 9 },
  { id: 'Sheviit', sederId: 'zeraim', nameKa: 'შევიითი', nameHe: 'שביעית', chapters: 10 },
  { id: 'Terumot', sederId: 'zeraim', nameKa: 'ტერუმოთი', nameHe: 'תרומות', chapters: 11 },
  { id: 'Maaserot', sederId: 'zeraim', nameKa: 'მაასეროთი', nameHe: 'מעשרות', chapters: 5 },
  { id: 'Maaser_Sheni', sederId: 'zeraim', nameKa: 'მაასერ შენი', nameHe: 'מעשר שני', chapters: 5 },
  { id: 'Challah', sederId: 'zeraim', nameKa: 'ხალა', nameHe: 'חלה', chapters: 4 },
  { id: 'Orlah', sederId: 'zeraim', nameKa: 'ორლა', nameHe: 'ערלה', chapters: 3 },
  { id: 'Bikkurim', sederId: 'zeraim', nameKa: 'ბიკურიმი', nameHe: 'ביכורים', chapters: 4 },

  // MOED (12)
  { id: 'Shabbat', sederId: 'moed', nameKa: 'შაბათი', nameHe: 'שבת', chapters: 24 },
  { id: 'Eruvin', sederId: 'moed', nameKa: 'ყერუვინი', nameHe: 'עירובין', chapters: 10 },
  { id: 'Pesachim', sederId: 'moed', nameKa: 'ფესახიმი', nameHe: 'פסחים', chapters: 10 },
  { id: 'Shekalim', sederId: 'moed', nameKa: 'შეკალიმი', nameHe: 'שקלים', chapters: 8 },
  { id: 'Yoma', sederId: 'moed', nameKa: 'იომა', nameHe: 'יומא', chapters: 8 },
  { id: 'Sukkah', sederId: 'moed', nameKa: 'სუქა', nameHe: 'סוכה', chapters: 5 },
  { id: 'Beitzah', sederId: 'moed', nameKa: 'ბეცა', nameHe: 'ביצה', chapters: 5 },
  { id: 'Rosh_Hashanah', sederId: 'moed', nameKa: 'როშ ჰაშანა', nameHe: 'ראש השנה', chapters: 4 },
  { id: 'Taanit', sederId: 'moed', nameKa: 'თაყანითი', nameHe: 'תענית', chapters: 4 },
  { id: 'Megillah', sederId: 'moed', nameKa: 'მეგილა', nameHe: 'מגילה', chapters: 4 },
  { id: 'Moed_Katan', sederId: 'moed', nameKa: 'მოყედ კატანი', nameHe: 'מועד קטן', chapters: 3 },
  { id: 'Chagigah', sederId: 'moed', nameKa: 'ხაგიგა', nameHe: 'חגיגה', chapters: 3 },

  // NASHIM (7)
  { id: 'Yevamot', sederId: 'nashim', nameKa: 'იევამოთი', nameHe: 'יבמות', chapters: 16 },
  { id: 'Ketubot', sederId: 'nashim', nameKa: 'ქეთუბოთი', nameHe: 'כתובות', chapters: 13 },
  { id: 'Nedarim', sederId: 'nashim', nameKa: 'ნედარიმი', nameHe: 'נדרים', chapters: 11 },
  { id: 'Nazir', sederId: 'nashim', nameKa: 'ნაზირი', nameHe: 'נזיר', chapters: 9 },
  { id: 'Sotah', sederId: 'nashim', nameKa: 'სოტა', nameHe: 'סוטה', chapters: 9 },
  { id: 'Gittin', sederId: 'nashim', nameKa: 'გიტინი', nameHe: 'גיטין', chapters: 9 },
  { id: 'Kiddushin', sederId: 'nashim', nameKa: 'კიდუშინი', nameHe: 'קידושין', chapters: 4 },

  // NEZIKIN (10)
  { id: 'Bava_Kamma', sederId: 'nezikin', nameKa: 'ბავა კამა', nameHe: 'בבא קמא', chapters: 10 },
  { id: 'Bava_Metzia', sederId: 'nezikin', nameKa: 'ბავა მეცია', nameHe: 'בבא מציעא', chapters: 10 },
  { id: 'Bava_Batra', sederId: 'nezikin', nameKa: 'ბავა ბათრა', nameHe: 'בבא בתרא', chapters: 10 },
  { id: 'Sanhedrin', sederId: 'nezikin', nameKa: 'სანჰედრინი', nameHe: 'סנהדרין', chapters: 11 },
  { id: 'Makkot', sederId: 'nezikin', nameKa: 'მაკოთი', nameHe: 'מכות', chapters: 3 },
  { id: 'Shevuot', sederId: 'nezikin', nameKa: 'შევუოთი', nameHe: 'שבועות', chapters: 8 },
  { id: 'Eduyot', sederId: 'nezikin', nameKa: 'ედუიოთი', nameHe: 'עדויות', chapters: 8 },
  { id: 'Avodah_Zarah', sederId: 'nezikin', nameKa: 'ავოდა ზარა', nameHe: 'עבודה זרה', chapters: 5 },
  { id: 'Avot', sederId: 'nezikin', nameKa: 'პირკეი ავოთი', nameHe: 'אבות', chapters: 6 },
  { id: 'Horayot', sederId: 'nezikin', nameKa: 'ჰორაიოთი', nameHe: 'הוריות', chapters: 3 },

  // KODASHIM (11)
  { id: 'Zevachim', sederId: 'kodashim', nameKa: 'ზევახიმი', nameHe: 'זבחים', chapters: 14 },
  { id: 'Menachot', sederId: 'kodashim', nameKa: 'მენახოთი', nameHe: 'מנחות', chapters: 13 },
  { id: 'Chullin', sederId: 'kodashim', nameKa: 'ხულინი', nameHe: 'חולין', chapters: 12 },
  { id: 'Bekhorot', sederId: 'kodashim', nameKa: 'ბეხოროთი', nameHe: 'בכורות', chapters: 9 },
  { id: 'Arakhin', sederId: 'kodashim', nameKa: 'არახინი', nameHe: 'ערכין', chapters: 9 },
  { id: 'Temurah', sederId: 'kodashim', nameKa: 'თემურა', nameHe: 'תמורה', chapters: 7 },
  { id: 'Keritot', sederId: 'kodashim', nameKa: 'კერითოთი', nameHe: 'כריתות', chapters: 6 },
  { id: 'Meilah', sederId: 'kodashim', nameKa: 'მეყილა', nameHe: 'מעילה', chapters: 6 },
  { id: 'Tamid', sederId: 'kodashim', nameKa: 'თამიდი', nameHe: 'תמיד', chapters: 7 },
  { id: 'Middot', sederId: 'kodashim', nameKa: 'მიდოთი', nameHe: 'מידות', chapters: 5 },
  { id: 'Kinnim', sederId: 'kodashim', nameKa: 'კინინი', nameHe: 'קינים', chapters: 3 },

  // TAHAROT (12)
  { id: 'Kelim', sederId: 'taharot', nameKa: 'კელიმი', nameHe: 'כלים', chapters: 30 },
  { id: 'Oholot', sederId: 'taharot', nameKa: 'ოჰოლოთი', nameHe: 'אהלות', chapters: 18 },
  { id: 'Negaim', sederId: 'taharot', nameKa: 'ნეგაიიმი', nameHe: 'נגעים', chapters: 14 },
  { id: 'Parah', sederId: 'taharot', nameKa: 'პარა', nameHe: 'פרה', chapters: 12 },
  { id: 'Taharot', sederId: 'taharot', nameKa: 'ტაჰაროთი', nameHe: 'טהרות', chapters: 10 },
  { id: 'Mikvaot', sederId: 'taharot', nameKa: 'მიკვაოთი', nameHe: 'מקוואות', chapters: 10 },
  { id: 'Niddah', sederId: 'taharot', nameKa: 'ნიდა', nameHe: 'נידה', chapters: 10 },
  { id: 'Makhshirin', sederId: 'taharot', nameKa: 'მახშირინი', nameHe: 'מכשירין', chapters: 6 },
  { id: 'Zavim', sederId: 'taharot', nameKa: 'ზავიმი', nameHe: 'זבים', chapters: 5 },
  { id: 'Tevul_Yom', sederId: 'taharot', nameKa: 'ტევულ იომი', nameHe: 'טבול יום', chapters: 4 },
  { id: 'Yadayim', sederId: 'taharot', nameKa: 'იადაიიმი', nameHe: 'ידים', chapters: 4 },
  { id: 'Uktzin', sederId: 'taharot', nameKa: 'უკცინი', nameHe: 'עוקצין', chapters: 3 },
];

const MISHNAH_CHAPTER_COUNT_MAP: Record<string, number[]> = {
  Berakhot: [5, 8, 6, 7, 5, 8, 5, 8, 5],
  Peah: [6, 8, 8, 11, 8, 11, 8, 9],
  Demai: [4, 5, 6, 7, 11, 12, 8],
  Kilayim: [9, 11, 7, 9, 8, 9, 8, 6, 10],
  Sheviit: [8, 10, 10, 10, 9, 6, 7, 11, 9, 9],
  Terumot: [10, 6, 9, 13, 9, 6, 7, 12, 7, 12, 10],
  Maaserot: [8, 8, 10, 6, 8],
  Maaser_Sheni: [7, 10, 13, 12, 15],
  Challah: [9, 8, 10, 11],
  Orlah: [9, 17, 9],
  Bikkurim: [11, 11, 12, 5],
  Shabbat: [11, 7, 6, 2, 4, 10, 4, 7, 7, 6, 6, 6, 7, 4, 3, 8, 8, 3, 6, 5, 3, 6, 5, 5],
  Eruvin: [10, 6, 9, 11, 9, 10, 11, 11, 4, 15],
  Pesachim: [7, 8, 8, 9, 10, 6, 13, 8, 11, 9],
  Shekalim: [7, 5, 4, 9, 6, 6, 7, 8],
  Yoma: [8, 7, 11, 6, 7, 8, 5, 9],
  Sukkah: [11, 9, 15, 10, 8], // Perek 1 has 11 mishnayot (exactly as in screenshot!)
  Beitzah: [10, 10, 8, 7, 7],
  Rosh_Hashanah: [9, 9, 8, 9],
  Taanit: [7, 10, 9, 8],
  Megillah: [11, 6, 6, 10],
  Moed_Katan: [10, 5, 9],
  Chagigah: [8, 7, 8],
  Yevamot: [4, 10, 10, 13, 6, 6, 6, 6, 6, 9, 7, 6, 13, 9, 10, 7],
  Ketubot: [10, 10, 9, 12, 9, 7, 10, 8, 9, 6, 6, 4, 11],
  Nedarim: [4, 5, 11, 8, 6, 10, 9, 7, 10, 8, 12],
  Nazir: [7, 10, 7, 7, 7, 11, 4, 2, 5],
  Sotah: [9, 6, 8, 5, 5, 4, 8, 7, 15],
  Gittin: [6, 7, 8, 9, 9, 7, 9, 10, 10],
  Kiddushin: [10, 10, 13, 14],
  Bava_Kamma: [4, 6, 11, 9, 7, 6, 7, 7, 12, 10],
  Bava_Metzia: [8, 11, 12, 12, 11, 8, 11, 9, 13, 6],
  Bava_Batra: [6, 14, 8, 9, 11, 8, 4, 8, 10, 8],
  Sanhedrin: [6, 5, 8, 5, 5, 6, 11, 7, 6, 6, 6],
  Makkot: [10, 8, 16],
  Shevuot: [7, 5, 11, 13, 5, 7, 8, 6],
  Avot: [18, 16, 18, 22, 23, 11],
};

// Clean Hebrew numeral letter converter for Daf column (2-ב, 5-ה, 30-ל, etc.)
export const toCleanHebrewLetter = (num: number): string => {
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const h = Math.floor(num / 100);
  const rem = num % 100;
  if (rem === 15) return `${hundreds[h] || ''}טו`;
  if (rem === 16) return `${hundreds[h] || ''}טז`;
  const t = Math.floor(rem / 10);
  const o = rem % 10;
  return `${hundreds[h] || ''}${tens[t] || ''}${ones[o] || ''}`;
};

const cascadingModalContainerVariants: Variants = {
  hidden: {
    y: '100%',
    opacity: 0,
    transition: {
      duration: 0.36,
      ease: [0.32, 0.72, 0, 1] as const,
      when: 'afterChildren',
      staggerChildren: 0.045,
      staggerDirection: -1, // folds back in exact reverse order on close
    },
  },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.42,
      ease: [0.16, 1, 0.3, 1] as const,
      when: 'beforeChildren',
      staggerChildren: 0.055, // sequentially appears one by one on open
      delayChildren: 0.03,
    },
  },
};

const cascadingModalItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 16,
    scale: 0.985,
    transition: {
      duration: 0.22,
      ease: [0.32, 0.72, 0, 1] as const,
    },
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

export const CascadingTalmudMishnahSelectorModal: React.FC<CascadingTalmudMishnahSelectorModalProps> = ({
  isOpen,
  onClose,
  initialSederId = 'moed',
  initialTractateId = 'Sukkah',
  initialDafId = '2a',
  initialChapter = 1,
  initialMishnah = 1,
  onSelectDaf,
  onSelectMishnah,
  recentlyViewedDapim,
  onClearHistory,
  isDark = false,
  theme,
}) => {
  // Mode: Default to 'talmud' (დაფი) as requested
  const [selectorMode, setSelectorMode] = useState<'mishnah' | 'talmud'>('talmud');

  // History of recently viewed Dapim (ბოლო დაფების ისტორია)
  const [historyList, setHistoryList] = useState<RecentlyViewedDaf[]>(() => {
    if (recentlyViewedDapim && recentlyViewedDapim.length > 0) return recentlyViewedDapim;
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('talmud_recently_viewed_v1');
        if (saved) return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return [];
  });

  useEffect(() => {
    if (recentlyViewedDapim && recentlyViewedDapim.length > 0) {
      setHistoryList(recentlyViewedDapim);
    } else if (isOpen && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('talmud_recently_viewed_v1');
        if (saved) setHistoryList(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, [recentlyViewedDapim, isOpen]);

  // Helper to reliably find tractate in both lists regardless of casing or underscores
  const resolveTractateMeta = useCallback((trId?: string) => {
    if (!trId) return null;
    const clean = trId.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      ALL_MISHNAH_TRACTATES.find((t) => t.id.toLowerCase().replace(/[^a-z0-9]/g, '') === clean) ||
      TRACTATES.find((t) => t.id.toLowerCase().replace(/[^a-z0-9]/g, '') === clean) ||
      ALL_MISHNAH_TRACTATES.find((t) => t.id === trId) ||
      TRACTATES.find((t) => t.id === trId) ||
      null
    );
  }, []);

  // Compute resolved initial Seder: The active tractate's OWN Seder always takes strict priority!
  const initialResolvedSeder = useMemo(() => {
    const tr = resolveTractateMeta(initialTractateId);
    if (tr?.sederId) return tr.sederId;
    if (initialSederId && initialSederId !== 'all') return initialSederId;
    return 'moed';
  }, [initialSederId, initialTractateId, resolveTractateMeta]);

  // Selected state for all 4 cascading columns
  const [selectedSederId, setSelectedSederId] = useState<string>(initialResolvedSeder);
  const [selectedTractateId, setSelectedTractateId] = useState<string>(() => {
    const tr = resolveTractateMeta(initialTractateId);
    return tr?.id || initialTractateId || 'Taanit';
  });
  const [selectedChapter, setSelectedChapter] = useState<number>(initialChapter);
  const [selectedMishnah, setSelectedMishnah] = useState<number>(initialMishnah);

  // Talmud mode specific selections (Bavli folios ALWAYS start from 2-ב!)
  const [selectedDafNum, setSelectedDafNum] = useState<number>(() => {
    if (initialDafId) {
      const match = initialDafId.match(/^(\d+)/);
      if (match) return Math.max(2, parseInt(match[1], 10));
    }
    return 2;
  });
  const [selectedAmud, setSelectedAmud] = useState<'a' | 'b'>(() => {
    if (initialDafId && initialDafId.endsWith('b')) return 'b';
    return 'a';
  });

  const handleSelectRecentDaf = (item: RecentlyViewedDaf, jumpNow: boolean = false) => {
    const tr = resolveTractateMeta(item.tractateId);
    if (tr) {
      setSelectedSederId(tr.sederId);
      setSelectedTractateId(tr.id);
    }
    const match = item.dafId.match(/^(\d+)([ab]?)$/);
    if (match) {
      setSelectedDafNum(Math.max(2, parseInt(match[1], 10)));
      setSelectedAmud((match[2] as 'a' | 'b') || 'a');
    }
    setSelectorMode('talmud');

    if (jumpNow && onSelectDaf) {
      onSelectDaf(item.tractateId, item.dafId);
      onClose();
    }
  };

  const handleClearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryList([]);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('talmud_recently_viewed_v1');
      } catch {
        // ignore
      }
    }
    onClearHistory?.();
  };

  // Sync with initial props whenever modal opens — guarantees focus is ALWAYS on the exact active Daf and tractate by default!
  useEffect(() => {
    if (isOpen) {
      setSelectorMode('talmud');
      const tr = resolveTractateMeta(initialTractateId);
      const targetSeder = tr?.sederId || (initialSederId !== 'all' ? initialSederId : 'moed');
      setSelectedSederId(targetSeder);

      const targetTrId = tr?.id || initialTractateId;
      if (targetTrId) {
        setSelectedTractateId(targetTrId);
      }
      if (initialChapter) setSelectedChapter(initialChapter);
      if (initialMishnah) setSelectedMishnah(initialMishnah);

      if (initialDafId) {
        const match = initialDafId.match(/^(\d+)([ab]?)$/);
        if (match) {
          const num = Math.max(2, parseInt(match[1], 10));
          setSelectedDafNum(num);
          setSelectedAmud((match[2] as 'a' | 'b') || 'a');
        }
      }
    }
  }, [isOpen, initialSederId, initialTractateId, initialDafId, initialChapter, initialMishnah, resolveTractateMeta]);

  // Auto-scroll the active/selected elements in each column into the center of view when the modal opens
  useEffect(() => {
    if (isOpen) {
      const scrollAllActiveColumns = () => {
        const columns = document.querySelectorAll('[data-cascading-column="true"]');
        columns.forEach((col) => {
          const active = col.querySelector('[data-cascading-active="true"]');
          if (active && col instanceof HTMLElement && active instanceof HTMLElement) {
            const colRect = col.getBoundingClientRect();
            const activeRect = active.getBoundingClientRect();
            const offsetDiff = activeRect.top - colRect.top;
            const targetScrollTop =
              col.scrollTop + offsetDiff - col.clientHeight / 2 + active.clientHeight / 2;
            col.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
          }
        });
      };
      const t1 = setTimeout(scrollAllActiveColumns, 40);
      const t2 = setTimeout(scrollAllActiveColumns, 150);
      const t3 = setTimeout(scrollAllActiveColumns, 380);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isOpen, selectedSederId, selectedTractateId, selectedDafNum, selectedAmud, selectorMode]);

  // Column 1: Sedarim list with clean names matching screenshot
  const sedarimList = useMemo(() => {
    return SEDARIM.map((s) => ({
      id: s.id,
      nameHe: s.nameHe.replace(/^סדר\s+/, ''),
      nameKa: s.nameKa.replace(/^სედერ\s+/, '').split(' (')[0],
      rawKa: s.nameKa,
    }));
  }, []);

  // Column 2: ALL tractates for the selected Seder
  const filteredTractates = useMemo(() => {
    const list = ALL_MISHNAH_TRACTATES.filter((t) => t.sederId === selectedSederId);
    if (list.length === 0) {
      return ALL_MISHNAH_TRACTATES.slice(0, 10);
    }
    return list;
  }, [selectedSederId]);

  // Current active tractate info
  const currentTractate = useMemo(() => {
    const cleanSel = (selectedTractateId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      ALL_MISHNAH_TRACTATES.find(
        (t) => t.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanSel
      ) ||
      TRACTATES.find(
        (t) => t.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanSel
      ) ||
      filteredTractates[0] ||
      ALL_MISHNAH_TRACTATES[0]
    );
  }, [selectedTractateId, filteredTractates]);

  const bavliMeta = useMemo(() => {
    return (
      TRACTATES.find((t) => t.id.toLowerCase() === currentTractate.id.toLowerCase()) ||
      TRACTATES.find((t) => t.nameKa === currentTractate.nameKa) ||
      TRACTATES[0]
    );
  }, [currentTractate]);

  const hasBavliGemara = Boolean(bavliMeta);

  // Column 3 (Mishnah Mode): Chapters for active tractate
  const chaptersList = useMemo(() => {
    const count = currentTractate.chapters || 5;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [currentTractate]);

  // Column 4 (Mishnah Mode): Mishnayot for active chapter
  const mishnayotList = useMemo(() => {
    const tractateChapterMap = MISHNAH_CHAPTER_COUNT_MAP[currentTractate.id];
    let count = 8;
    if (tractateChapterMap && tractateChapterMap[selectedChapter - 1]) {
      count = tractateChapterMap[selectedChapter - 1];
    }
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [currentTractate.id, selectedChapter]);

  // Column 3 (Talmud Mode): Daf numbers for active tractate
  // In Talmud Bavli, Daf 1 (1-א) DOES NOT EXIST! Daf numbering ALWAYS starts from 2-ב!
  const dafNumbersList = useMemo(() => {
    const last = bavliMeta?.lastDaf || 64;
    const count = Math.max(1, last - 1);
    return Array.from({ length: count }, (_, i) => i + 2);
  }, [bavliMeta]);

  // Handlers for cascading selections
  const handleSelectSeder = (sederId: string) => {
    setSelectedSederId(sederId);
    const tractatesInSeder = ALL_MISHNAH_TRACTATES.filter((t) => t.sederId === sederId);

    if (tractatesInSeder.length > 0) {
      const nextTr = tractatesInSeder[0];
      setSelectedTractateId(nextTr.id);
      setSelectedChapter(1);
      setSelectedMishnah(1);
      setSelectedDafNum(2);
      setSelectedAmud('a');
    }
  };

  const handleSelectTractate = (trId: string) => {
    setSelectedTractateId(trId);
    setSelectedChapter(1);
    setSelectedMishnah(1);
    setSelectedDafNum(2);
    setSelectedAmud('a');
  };

  const handleSelectChapter = (ch: number) => {
    setSelectedChapter(ch);
    setSelectedMishnah(1);
  };

  const handleConfirmAndClose = () => {
    if (hasBavliGemara && selectorMode === 'talmud') {
      if (onSelectDaf) {
        const effectiveDaf = Math.max(2, selectedDafNum);
        onSelectDaf(selectedTractateId, `${effectiveDaf}${selectedAmud}`);
      }
    } else {
      if (onSelectMishnah) {
        onSelectMishnah(selectedTractateId, selectedChapter, selectedMishnah);
      } else if (onSelectDaf) {
        const lastD = bavliMeta?.lastDaf || 64;
        const totalCh = currentTractate.chapters || 5;
        const estDaf = Math.min(
          lastD,
          Math.max(2, Math.round((selectedChapter / totalCh) * (lastD - 2) + 2))
        );
        onSelectDaf(selectedTractateId, `${estDaf}a`);
      }
    }
    onClose();
  };

  const handleResetFilters = () => {
    setSelectedSederId('zeraim');
    setSelectedTractateId('Berakhot');
    setSelectedChapter(1);
    setSelectedMishnah(1);
    setSelectedDafNum(2);
    setSelectedAmud('a');
  };

  const isDafModeActive = hasBavliGemara && selectorMode === 'talmud';

  const activeRowClass = isDark
    ? 'bg-gradient-to-r from-amber-500/28 via-sky-500/22 to-amber-500/22 text-amber-100 border-amber-300/75 shadow-[0_3px_12px_rgba(245,158,11,0.22),inset_0_1px_0_rgba(255,255,255,0.22)] font-black'
    : 'bg-gradient-to-r from-[#FFFBEB] via-[#FEF3C7] to-[#E0F2FE] text-[#0F294A] border-amber-500/80 shadow-[0_3px_10px_rgba(180,83,9,0.16),inset_0_1px_0_rgba(255,255,255,0.95)] font-black';

  const inactiveRowClass = isDark
    ? 'bg-[#0F223D]/60 hover:bg-[#19355E]/85 text-slate-100 border-transparent'
    : 'bg-white/60 hover:bg-white/90 text-[#0F294A] border-transparent';

  const dividerColorClass = isDark ? 'divide-sky-300/15' : 'divide-sky-900/10';
  const colHeaderClass = isDark
    ? 'bg-[#102646]/90 text-amber-200 border-b border-amber-400/20'
    : 'bg-[#E5F1FC]/90 text-[#0F294A] border-b border-amber-500/25';

  const maxDafNum = bavliMeta?.lastDaf || 64;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="cascading-selector-backdrop"
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[320] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#061124]/65 backdrop-blur-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="cascading-selector-sheet"
            data-crystal-selector="true"
            data-crystal-dark={isDark ? 'true' : 'false'}
            variants={cascadingModalContainerVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="crystal-window-shell w-full max-w-[660px] h-[92dvh] max-h-[92dvh] sm:h-[min(86vh,760px)] sm:max-h-[88vh] rounded-t-[26px] sm:rounded-[28px] flex flex-col overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ITEM 1: COMPACT CRYSTAL WINDOW HEADER */}
            <motion.div
              variants={cascadingModalItemVariants}
              className="crystal-window-header shrink-0 px-3 sm:px-4 pt-1.5 sm:pt-2.5 pb-2"
            >
              <div
                aria-hidden="true"
                className={`sm:hidden w-8 h-1 rounded-full mx-auto mb-1.5 ${
                  isDark ? 'bg-sky-200/35' : 'bg-[#0F294A]/20'
                }`}
              />
              <div className="flex items-center justify-between gap-2">
                <h2
                  className={`min-w-0 flex-1 text-[13px] sm:text-base font-black tracking-tight whitespace-nowrap truncate ${
                    isDark ? 'text-slate-100' : 'text-[#0F294A]'
                  }`}
                >
                  {selectorMode === 'mishnah' ? 'მიშნის არჩევა' : 'თალმუდის არჩევა'}
                  <span className="hidden sm:inline opacity-70 font-serif font-bold">
                    {' '}
                    · {selectorMode === 'mishnah' ? 'משנה' : 'תלמוד'}
                  </span>
                </h2>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasBavliGemara && (
                    <div className="crystal-window-trough flex items-center rounded-full p-0.5 gap-0.5">
                      <button
                        type="button"
                        data-raw-btn="true"
                        onClick={() => setSelectorMode('mishnah')}
                        className={`h-7 px-2.5 rounded-full text-[11px] font-extrabold whitespace-nowrap cursor-pointer transition-all ${
                          selectorMode === 'mishnah'
                            ? isDark
                              ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-[#0B1D36] shadow-xs'
                              : 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-xs'
                            : isDark
                              ? 'text-slate-300 hover:text-white'
                              : 'text-[#0F294A]/75 hover:text-[#0F294A]'
                        }`}
                      >
                        მიშნა
                      </button>
                      <button
                        type="button"
                        data-raw-btn="true"
                        onClick={() => setSelectorMode('talmud')}
                        className={`h-7 px-2.5 rounded-full text-[11px] font-extrabold whitespace-nowrap cursor-pointer transition-all ${
                          selectorMode === 'talmud'
                            ? isDark
                              ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-[#0B1D36] shadow-xs'
                              : 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-xs'
                            : isDark
                              ? 'text-slate-300 hover:text-white'
                              : 'text-[#0F294A]/75 hover:text-[#0F294A]'
                        }`}
                      >
                        დაფი
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    data-raw-btn="true"
                    data-tone="rose"
                    onClick={onClose}
                    className="crystal-corner-orb w-8 h-8 shrink-0 cursor-pointer"
                    title="დახურვა"
                    aria-label="დახურვა"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            </motion.div>

            {/* CONSTRAINED BODY (passes remaining flex height directly to the 4-column picker) */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-1.5 sm:gap-2 p-2 sm:p-3">
              {/* ITEM 2: COMPACT RECENT DAPIM HISTORY */}
              <motion.div
                variants={cascadingModalItemVariants}
                className="crystal-window-trough shrink-0 rounded-xl px-2.5 py-1.5 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <History
                      className={`w-3 h-3 shrink-0 ${
                        isDark ? 'text-amber-300' : 'text-sky-700'
                      }`}
                    />
                    <span
                      className={`text-[11px] font-extrabold tracking-tight truncate ${
                        isDark ? 'text-slate-100' : 'text-[#0F294A]'
                      }`}
                    >
                      ბოლო დაფების ისტორია
                    </span>
                    {historyList.length > 0 && (
                      <span
                        className={`text-[11px] font-bold tabular-nums shrink-0 ${
                          isDark ? 'text-amber-300/90' : 'text-[#0F294A]/65'
                        }`}
                      >
                        · {historyList.length}
                      </span>
                    )}
                  </div>
                  {historyList.length > 0 && (
                    <button
                      type="button"
                      data-raw-btn="true"
                      onClick={handleClearHistory}
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold cursor-pointer transition-colors shrink-0 ${
                        isDark
                          ? 'text-rose-300 hover:bg-rose-500/15 hover:text-rose-200'
                          : 'text-rose-700 hover:bg-rose-500/10 hover:text-rose-800'
                      }`}
                      title="ისტორიის გასუფთავება"
                    >
                      გასუფთავება
                    </button>
                  )}
                </div>

                {historyList.length > 0 ? (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                    {historyList.map((item, idx) => {
                      const isCurrent =
                        item.tractateId === selectedTractateId &&
                        item.dafId === `${selectedDafNum}${selectedAmud}`;
                      return (
                        <button
                          key={`hist-${item.tractateId}-${item.dafId}-${idx}`}
                          type="button"
                          data-raw-btn="true"
                          onClick={() => handleSelectRecentDaf(item, true)}
                          className={`group h-8 flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg border text-left transition-all cursor-pointer active:scale-[0.98] ${
                            isCurrent
                              ? activeRowClass
                              : isDark
                                ? 'bg-[#0F223D]/75 hover:bg-[#19355E]/90 text-slate-100 border-sky-300/20'
                                : 'bg-white/80 hover:bg-white text-[#0F294A] border-sky-200/85'
                          }`}
                          title={`${item.tractateNameKa} (${item.tractateNameHe}) ${item.dafId} — დააჭირეთ გადასასვლელად`}
                        >
                          <span className="text-[11px] font-black truncate max-w-[95px]">
                            {item.tractateNameKa.split(' (')[0]}
                          </span>
                          <span
                            className={`font-mono tabular-nums text-[10px] font-black shrink-0 ${
                              isCurrent
                                ? isDark
                                  ? 'text-amber-200'
                                  : 'text-sky-800'
                                : isDark
                                  ? 'text-amber-300/90'
                                  : 'text-sky-700'
                            }`}
                          >
                            {item.dafId}
                          </span>
                          <ArrowRight
                            className={`w-3 h-3 transition-transform group-hover:translate-x-0.5 shrink-0 ${
                              isCurrent
                                ? isDark
                                  ? 'text-amber-200'
                                  : 'text-sky-800'
                                : isDark
                                  ? 'text-sky-300'
                                  : 'text-sky-600'
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={`text-[10.5px] italic ${
                      isDark ? 'text-slate-300/80' : 'text-[#0F294A]/65'
                    }`}
                  >
                    ისტორია ჯერ ცარიელია — მონახულებული დაფები აქ გამოჩნდება.
                  </div>
                )}
              </motion.div>

              {/* ITEM 3: COMPACT CRYSTAL QUICK-JUMP BAR (TALMUD MODE) */}
              {isDafModeActive && (
                <motion.div
                  variants={cascadingModalItemVariants}
                  className="crystal-window-trough shrink-0 rounded-xl px-2.5 py-1.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Sliders
                        className={`w-3 h-3 shrink-0 ${
                          isDark ? 'text-amber-300' : 'text-sky-700'
                        }`}
                      />
                      <span
                        className={`text-[11px] font-extrabold truncate ${
                          isDark ? 'text-slate-100' : 'text-[#0F294A]'
                        }`}
                      >
                        დაფზე სწრაფი გადასვლა
                      </span>
                    </div>
                    <span
                      className={`font-mono tabular-nums text-[11px] font-black shrink-0 ${
                        isDark ? 'text-amber-200' : 'text-sky-800'
                      }`}
                    >
                      {selectedDafNum}-{toCleanHebrewLetter(selectedDafNum)} ·{' '}
                      {selectedAmud === 'a' ? '1-א' : '2-ב'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                    <input
                      type="range"
                      data-crystal-range="true"
                      min={2}
                      max={maxDafNum}
                      value={selectedDafNum}
                      onChange={(e) => setSelectedDafNum(Number(e.target.value))}
                      className="flex-1 min-w-0 cursor-pointer"
                      aria-label="დაფის სწრაფი სლაიდერი"
                      title={`დაფი ${selectedDafNum}`}
                    />

                    <div className="flex items-center justify-between sm:justify-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() => setSelectedDafNum((prev) => Math.max(2, prev - 1))}
                          disabled={selectedDafNum <= 2}
                          className="crystal-corner-orb w-7 h-7 cursor-pointer disabled:opacity-40"
                          aria-label="წინა დაფი"
                          title="წინა დაფი"
                        >
                          <Minus className="w-3 h-3 stroke-[2.5]" />
                        </button>
                        <input
                          type="number"
                          data-crystal-input="true"
                          inputMode="numeric"
                          min={2}
                          max={maxDafNum}
                          value={selectedDafNum}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val)) {
                              setSelectedDafNum(Math.min(maxDafNum, Math.max(2, val)));
                            }
                          }}
                          aria-label="დაფის ნომერი"
                          className="w-11 h-7 px-1 text-center font-mono tabular-nums font-black text-[11px] rounded-lg outline-none"
                        />
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() =>
                            setSelectedDafNum((prev) => Math.min(maxDafNum, prev + 1))
                          }
                          disabled={selectedDafNum >= maxDafNum}
                          className="crystal-corner-orb w-7 h-7 cursor-pointer disabled:opacity-40"
                          aria-label="შემდეგი დაფი"
                          title="შემდეგი დაფი"
                        >
                          <Plus className="w-3 h-3 stroke-[2.5]" />
                        </button>
                      </div>

                      <div
                        className={`flex items-center rounded-lg p-0.5 border gap-0.5 ${
                          isDark
                            ? 'bg-[#091830]/80 border-sky-300/20'
                            : 'bg-white/65 border-sky-200/80'
                        }`}
                      >
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() => setSelectedAmud('a')}
                          className={`h-6 px-2 rounded-md font-mono tabular-nums text-[10px] font-black cursor-pointer transition-all ${
                            selectedAmud === 'a'
                              ? isDark
                                ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-[#0B1D36] shadow-xs'
                                : 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-xs'
                              : isDark
                                ? 'text-slate-300 hover:text-white'
                                : 'text-[#0F294A]/75 hover:text-[#0F294A]'
                          }`}
                        >
                          1-א
                        </button>
                        <button
                          type="button"
                          data-raw-btn="true"
                          onClick={() => setSelectedAmud('b')}
                          className={`h-6 px-2 rounded-md font-mono tabular-nums text-[10px] font-black cursor-pointer transition-all ${
                            selectedAmud === 'b'
                              ? isDark
                                ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-[#0B1D36] shadow-xs'
                                : 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-xs'
                              : isDark
                                ? 'text-slate-300 hover:text-white'
                                : 'text-[#0F294A]/75 hover:text-[#0F294A]'
                          }`}
                        >
                          2-ב
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ITEM 4: EXPANDED & FREELY SCROLLABLE 4-COLUMN CASCADING PICKER */}
              <motion.div
                variants={cascadingModalItemVariants}
                data-cascading-grid-container="true"
                className="crystal-window-trough flex-1 min-h-[220px] rounded-xl overflow-hidden flex flex-col"
              >
                <div
                  className={`flex-1 min-h-0 h-full grid grid-cols-[1.25fr_1.45fr_64px_56px] sm:grid-cols-[1.35fr_1.65fr_76px_64px] grid-rows-[minmax(0,1fr)] divide-x ${dividerColorClass}`}
                >
                  {/* COLUMN 1: סדר · სედერი */}
                  <div className="flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
                    <div
                      className={`py-1.5 pl-2.5 pr-1 text-center font-extrabold text-[10.5px] sm:text-xs whitespace-nowrap select-none ${colHeaderClass}`}
                    >
                      სედერ · סדר
                    </div>
                    <div
                      data-cascading-column="true"
                      className={`flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y no-scrollbar flex flex-col divide-y ${dividerColorClass}`}
                    >
                      {sedarimList.map((s) => {
                        const isSelected = selectedSederId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            data-raw-btn="true"
                            data-cascading-active={isSelected ? 'true' : undefined}
                            onClick={() => handleSelectSeder(s.id)}
                            className={`w-full min-h-[42px] py-1.5 px-1.5 text-center transition-all cursor-pointer flex flex-col items-center justify-center leading-tight border-b shrink-0 ${
                              isSelected ? activeRowClass : inactiveRowClass
                            }`}
                          >
                            <span className="text-[12px] sm:text-[13px] font-black truncate max-w-full">
                              {s.nameKa}
                            </span>
                            <span
                              dir="rtl"
                              className={`font-serif text-[10.5px] mt-0.5 font-bold ${
                                isSelected
                                  ? isDark
                                    ? 'text-amber-200'
                                    : 'text-amber-900'
                                  : isDark
                                    ? 'text-amber-300/85'
                                    : 'text-sky-700'
                              }`}
                            >
                              {s.nameHe}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* COLUMN 2: מסכת · ტრაქ. */}
                  <div className="flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
                    <div
                      className={`py-1.5 px-1 text-center font-extrabold text-[10.5px] sm:text-xs whitespace-nowrap select-none ${colHeaderClass}`}
                    >
                      ტრაქ. · מסכת
                    </div>
                    <div
                      data-cascading-column="true"
                      className={`flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y no-scrollbar flex flex-col divide-y ${dividerColorClass}`}
                    >
                      {filteredTractates.map((tr) => {
                        const isSelected = selectedTractateId === tr.id;
                        const shortKa = tr.nameKa.split(' (')[0];
                        return (
                          <button
                            key={tr.id}
                            type="button"
                            data-raw-btn="true"
                            data-cascading-active={isSelected ? 'true' : undefined}
                            onClick={() => handleSelectTractate(tr.id)}
                            className={`w-full min-h-[42px] py-1.5 px-1.5 text-center transition-all cursor-pointer flex flex-col items-center justify-center leading-tight border-b shrink-0 ${
                              isSelected ? activeRowClass : inactiveRowClass
                            }`}
                          >
                            <span className="text-[12px] sm:text-[13px] font-black truncate max-w-full">
                              {shortKa}
                            </span>
                            <span
                              dir="rtl"
                              className={`font-serif text-[10.5px] mt-0.5 font-bold ${
                                isSelected
                                  ? isDark
                                    ? 'text-amber-200'
                                    : 'text-amber-900'
                                  : isDark
                                    ? 'text-amber-300/85'
                                    : 'text-sky-700'
                              }`}
                            >
                              {tr.nameHe}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* COLUMN 3: פרק / דף */}
                  <div className="flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
                    <div
                      className={`py-1.5 px-1 text-center font-extrabold text-[10.5px] sm:text-xs whitespace-nowrap select-none ${colHeaderClass}`}
                    >
                      {isDafModeActive ? 'דף' : 'פרק'}
                    </div>
                    <div
                      data-cascading-column="true"
                      className={`flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y no-scrollbar flex flex-col divide-y ${dividerColorClass}`}
                    >
                      {!isDafModeActive
                        ? chaptersList.map((ch) => {
                            const isSelected = selectedChapter === ch;
                            return (
                              <button
                                key={`ch-${ch}`}
                                type="button"
                                data-raw-btn="true"
                                data-cascading-active={isSelected ? 'true' : undefined}
                                onClick={() => handleSelectChapter(ch)}
                                className={`w-full min-h-[40px] py-1.5 text-center transition-all cursor-pointer flex items-center justify-center border-b shrink-0 ${
                                  isSelected ? activeRowClass : inactiveRowClass
                                }`}
                              >
                                <span className="font-mono tabular-nums text-xs sm:text-sm font-black">
                                  {ch}
                                </span>
                              </button>
                            );
                          })
                        : dafNumbersList.map((dNum) => {
                            const isSelected = selectedDafNum === dNum;
                            return (
                              <button
                                key={`dnum-${dNum}`}
                                type="button"
                                data-raw-btn="true"
                                data-cascading-active={isSelected ? 'true' : undefined}
                                onClick={() => setSelectedDafNum(dNum)}
                                className={`w-full min-h-[40px] py-1.5 text-center transition-all cursor-pointer flex items-center justify-center border-b shrink-0 ${
                                  isSelected ? activeRowClass : inactiveRowClass
                                }`}
                              >
                                <span className="font-mono tabular-nums text-xs sm:text-[13px] font-black tracking-tight whitespace-nowrap">
                                  {dNum}-{toCleanHebrewLetter(dNum)}
                                </span>
                              </button>
                            );
                          })}
                    </div>
                  </div>

                  {/* COLUMN 4: עמוד / משנה */}
                  <div className="flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
                    <div
                      className={`py-1.5 pl-1 pr-2.5 text-center font-extrabold text-[10.5px] sm:text-xs whitespace-nowrap select-none ${colHeaderClass}`}
                    >
                      {isDafModeActive ? 'עמוד' : 'משנה'}
                    </div>
                    <div
                      data-cascading-column="true"
                      className={`flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y no-scrollbar flex flex-col divide-y ${dividerColorClass}`}
                    >
                      {!isDafModeActive ? (
                        mishnayotList.map((m) => {
                          const isSelected = selectedMishnah === m;
                          return (
                            <button
                              key={`mish-${m}`}
                              type="button"
                              data-raw-btn="true"
                              data-cascading-active={isSelected ? 'true' : undefined}
                              onClick={() => setSelectedMishnah(m)}
                              className={`w-full min-h-[40px] py-1.5 text-center transition-all cursor-pointer flex items-center justify-center border-b shrink-0 ${
                                isSelected ? activeRowClass : inactiveRowClass
                              }`}
                            >
                              <span className="font-mono tabular-nums text-xs sm:text-sm font-black">
                                {m}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className={`flex flex-col divide-y ${dividerColorClass}`}>
                          <button
                            type="button"
                            data-raw-btn="true"
                            data-cascading-active={selectedAmud === 'a' ? 'true' : undefined}
                            onClick={() => setSelectedAmud('a')}
                            className={`w-full min-h-[46px] py-2.5 text-center transition-all cursor-pointer flex items-center justify-center border-b shrink-0 ${
                              selectedAmud === 'a' ? activeRowClass : inactiveRowClass
                            }`}
                            title="ამუდი 1 (א)"
                          >
                            <span className="font-mono tabular-nums text-xs font-black tracking-tight">
                              1-א
                            </span>
                          </button>
                          <button
                            type="button"
                            data-raw-btn="true"
                            data-cascading-active={selectedAmud === 'b' ? 'true' : undefined}
                            onClick={() => setSelectedAmud('b')}
                            className={`w-full min-h-[46px] py-2.5 text-center transition-all cursor-pointer flex items-center justify-center border-b shrink-0 ${
                              selectedAmud === 'b' ? activeRowClass : inactiveRowClass
                            }`}
                            title="ამუდი 2 (ב)"
                          >
                            <span className="font-mono tabular-nums text-xs font-black tracking-tight">
                              2-ב
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ITEM 5: COMPACT STICKY CRYSTAL FOOTER BAR */}
            <motion.div
              variants={cascadingModalItemVariants}
              className={`crystal-window-header shrink-0 sticky bottom-0 z-20 px-3 sm:px-4 py-2 pb-[max(8px,env(safe-area-inset-bottom))] flex items-center justify-between gap-2.5 border-t ${
                isDark ? 'border-amber-400/20' : 'border-amber-500/25'
              }`}
            >
              <button
                type="button"
                data-raw-btn="true"
                onClick={handleResetFilters}
                className="crystal-action-orb h-9 px-3.5 rounded-full! text-[11px] sm:text-xs font-extrabold cursor-pointer"
                title="ფილტრების გასუფთავება • נקה"
                aria-label="თავიდან"
              >
                <RotateCcw className="w-3.5 h-3.5 stroke-[2.25]" />
                <span>თავიდან</span>
              </button>

              <button
                type="button"
                data-raw-btn="true"
                data-tone="sky"
                onClick={handleConfirmAndClose}
                className="crystal-action-orb h-9 px-4 rounded-full! text-xs font-black cursor-pointer"
                title="დაკეტვა და არჩეულ დაფზე გადასვლა • אישור"
                aria-label="დაკეტვა და გადასვლა"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.75]" />
                <span>არჩევა და გადასვლა</span>
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
