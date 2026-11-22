import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Archive,
  Award,
  BookKey,
  BookMarked,
  BookOpen,
  Calendar,
  CalendarCheck,
  Check,
  ChevronDown,
  Compass,
  Crown,
  Database,
  Flame,
  Globe,
  HeartHandshake,
  Languages,
  Layers,
  Library,
  Mic,
  Moon,
  Scale,
  Scroll,
  Search,
  Settings,
  Sparkles,
  Sun,
  SunMedium,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { SACRED_REALMS, SacredRealmId } from "../data/tanakhAndHalakhaData";
import type { AppTheme, UILang } from "../types/talmud";
import { LANGUAGE_OPTIONS } from "./SettingsModal";
import { AnimatedGlobeIconWrapper } from "./CrystalGlobeHelpers";

interface MenuEntry {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeDir?: "rtl" | "ltr";
  accent: string;
  searchKeywords: string;
  icon: React.ReactNode;
  active?: boolean;
  onSelect: () => void;
}

interface MenuCategory {
  id: string;
  shortTitle: string;
  title: string;
  subtitle: string;
  accent: string;
  icon: React.ReactNode;
  items: MenuEntry[];
}

interface GalacticMainMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRealm: SacredRealmId;
  onSelectRealm: (realmId: SacredRealmId) => void;
  onOpenSettings?: () => void;
  onOpenOfflineLibrary?: () => void;
  onOpenCascadingSelector?: () => void;
  onOpenSearchSheet?: () => void;
  onOpenVoiceAi?: (initialTab: "voice" | "ai") => void;
  onOpenExportModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenDedicationModal?: () => void;
  theme?: AppTheme;
  onToggleTheme?: () => void;
  kacunaAutoSpeak?: boolean;
  onToggleKacunaAutoSpeak?: () => void;
  uiLang?: UILang;
  onChangeUiLang?: (lang: UILang) => void;
  onlineCount?: number;
  isDark?: boolean;
}

const REALM_ICON_MAP: Record<SacredRealmId, React.ReactNode> = {
  talmud: <Scroll className="w-4 h-4 text-amber-200" />,
  torah: <BookOpen className="w-4 h-4 text-amber-200" />,
  neviim: <Compass className="w-4 h-4 text-sky-200" />,
  ketuvim: <BookMarked className="w-4 h-4 text-violet-200" />,
  mishnayot: <Layers className="w-4 h-4 text-emerald-200" />,
  siddur: <Flame className="w-4 h-4 text-amber-200" />,
  rambam: <Crown className="w-4 h-4 text-emerald-200" />,
  tur: <Library className="w-4 h-4 text-pink-200" />,
  "shulchan-aruch": <BookKey className="w-4 h-4 text-indigo-200" />,
  "mishnah-berurah": <SunMedium className="w-4 h-4 text-teal-200" />,
  "yalkut-yosef": <Scale className="w-4 h-4 text-orange-200" />,
  "daily-halakhot": <CalendarCheck className="w-4 h-4 text-emerald-200" />,
  "sephardic-halakha": <Award className="w-4 h-4 text-amber-200" />,
  calendar: <Calendar className="w-4 h-4 text-sky-200" />,
  blessings: <HeartHandshake className="w-4 h-4 text-rose-200" />,
};

const QUICK_REALM_IDS = new Set<SacredRealmId>(["talmud", "daily-halakhot", "calendar", "siddur"]);
const SILK_EASE = [0.22, 1, 0.36, 1] as const;

export const GalacticMainMenuModal: React.FC<GalacticMainMenuModalProps> = ({
  isOpen,
  onClose,
  activeRealm,
  onSelectRealm,
  onOpenSettings,
  onOpenOfflineLibrary,
  onOpenCascadingSelector,
  onOpenSearchSheet,
  onOpenVoiceAi,
  onOpenExportModal,
  onOpenAuthModal,
  onOpenDedicationModal,
  theme,
  onToggleTheme,
  kacunaAutoSpeak = false,
  onToggleKacunaAutoSpeak,
  uiLang = "ka",
  onChangeUiLang,
  onlineCount = 1,
  isDark = true,
}) => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>("quick-study");
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedCategory("all");
    setExpandedCategoryId("quick-study");
    setIsLangDropdownOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isOpen]);

  const categories = useMemo<MenuCategory[]>(() => {
    const mapRealmToEntry = (r: (typeof SACRED_REALMS)[number]): MenuEntry => ({
      id: `realm-${r.id}`,
      title: r.titleKa,
      subtitle: r.subtitleKa,
      badge: r.badgeHe,
      accent: r.accentColor || "#F59E0B",
      searchKeywords: `${r.titleKa} ${r.titleHe} ${r.subtitleKa} ${r.id} ${r.badgeHe}`,
      icon: REALM_ICON_MAP[r.id] || <BookOpen className="w-4 h-4 text-amber-200" />,
      active: activeRealm === r.id,
      onSelect: () => {
        onClose();
        onSelectRealm(r.id);
      },
    });

    const quickStudyItems: MenuEntry[] = SACRED_REALMS.filter((r) => QUICK_REALM_IDS.has(r.id)).map(
      mapRealmToEntry,
    );

    if (onOpenCascadingSelector) {
      quickStudyItems.push({
        id: "tool-cascading",
        title: "ტრაქტატისა და ფერეკის სარჩევი",
        subtitle: "სედერი, ტრაქტატი, თავი, მიშნა და დაფის სწრაფი არჩევა",
        badge: "ש״ס",
        accent: "#F59E0B",
        searchKeywords: "ტრაქტატი სარჩევი ფერეკი სედერი მიშნა tractate seder selector navigator",
        icon: <Compass className="w-4 h-4 text-amber-200" />,
        onSelect: () => {
          onClose();
          onOpenCascadingSelector();
        },
      });
    }

    const sacredLibraryItems: MenuEntry[] = SACRED_REALMS.filter(
      (r) => !QUICK_REALM_IDS.has(r.id),
    ).map(mapRealmToEntry);

    const tools: MenuEntry[] = [];
    if (onOpenSearchSheet) {
      tools.push({
        id: "tool-search",
        title: "სრული ძიება და სარჩევი",
        subtitle: "სიტყვების, სუგიების და წყაროების მოძებნა ბაზაში",
        badge: "חיפוש",
        accent: "#10B981",
        searchKeywords: "ძიება სარჩევი search finder lookup",
        icon: <Search className="w-4 h-4 text-emerald-200" />,
        onSelect: () => {
          onClose();
          onOpenSearchSheet();
        },
      });
    }
    if (onOpenVoiceAi) {
      tools.push({
        id: "tool-ai-nav",
        title: "ჭკვიანი AI და ხმოვანი ნავიგაცია",
        subtitle: "საკითხის კითხვა, ხმოვანი ბრძანება და წყაროს პოვნა",
        badge: "AI / קול",
        accent: "#A855F7",
        searchKeywords: "ai ხმოვანი voice assistant navigation smart",
        icon: <Mic className="w-4 h-4 text-violet-200" />,
        onSelect: () => {
          onClose();
          onOpenVoiceAi("ai");
        },
      });
    }
    if (onOpenOfflineLibrary) {
      tools.push({
        id: "tool-offline",
        title: "დაფების ოფლაინ ბაზა",
        subtitle: "ტრაქტატების ჩამოტვირთვა ინტერნეტის გარეშე კითხვისთვის",
        badge: "Offline",
        accent: "#38BDF8",
        searchKeywords: "ოფლაინ ბაზა დაფები ჩამოტვირთვა offline cache database",
        icon: <Database className="w-4 h-4 text-sky-200" />,
        onSelect: () => {
          onClose();
          onOpenOfflineLibrary();
        },
      });
    }
    if (onOpenExportModal) {
      tools.push({
        id: "tool-export",
        title: "პროექტისა და APK ექსპორტი",
        subtitle: "Source Code ZIP, Full Project და Android APK ჩამოტვირთვა",
        badge: "ZIP / APK",
        accent: "#F59E0B",
        searchKeywords: "ექსპორტი apk zip download export",
        icon: <Archive className="w-4 h-4 text-amber-200" />,
        onSelect: () => {
          onClose();
          onOpenExportModal();
        },
      });
    }

    const accountAndPrefs: MenuEntry[] = [];
    if (onOpenSettings) {
      accountAndPrefs.push({
        id: "pref-settings",
        title: "აპლიკაციის პარამეტრები",
        subtitle: "დიზაინი, შრიფტის ზომა, ნიკუდი, PDF მონიშვნები და რაშის ფოკუსი",
        badge: "הגדרות",
        accent: "#F59E0B",
        searchKeywords:
          "პარამეტრები settings preferences font bold rashi focus highlight ნიკუდი დიზაინი",
        icon: <Settings className="w-4 h-4 text-amber-200" />,
        onSelect: () => {
          onClose();
          onOpenSettings();
        },
      });
    }
    if (onToggleTheme) {
      accountAndPrefs.push({
        id: "pref-theme",
        title: isDark ? "დღის ნათელ დიზაინზე გადართვა" : "ღამის მუქ დიზაინზე გადართვა",
        subtitle: `მიმდინარე თემა: ${theme || "parchment-day"}`,
        accent: "#38BDF8",
        searchKeywords: "თემა დიზაინი დღე ღამე theme dark light mode",
        icon: isDark ? (
          <Sun className="w-4 h-4 text-amber-200" />
        ) : (
          <Moon className="w-4 h-4 text-sky-200" />
        ),
        onSelect: () => {
          onToggleTheme();
        },
      });
    }
    if (onToggleKacunaAutoSpeak) {
      accountAndPrefs.push({
        id: "pref-kacuna-autospeak",
        title: "ჭკვიანი კაცუნას ავტო-ლაპარაკი",
        subtitle: "მთავარ ეკრანზე შესვლისას ავტომატური მისალმება და შეხსენება",
        badge: kacunaAutoSpeak ? "ჩართულია ✓" : "გამორთულია",
        badgeDir: "ltr",
        accent: "#F59E0B",
        searchKeywords:
          "კაცუნა ჭკვიანი ლაპარაკი ხმა მისალმება შეხსენება kacuna autospeak voice greeter",
        icon: (
          <Volume2
            className={`w-4 h-4 ${kacunaAutoSpeak ? "text-amber-200" : "text-amber-100/70"}`}
          />
        ),
        active: Boolean(kacunaAutoSpeak),
        onSelect: () => {
          onToggleKacunaAutoSpeak();
        },
      });
    }
    if (onOpenDedicationModal) {
      accountAndPrefs.push({
        id: "comm-dedication",
        title: "სწავლის მიძღვნა",
        subtitle: "ლეილუი ნიშმათ ან რეფუა შელემას სწავლის მიძღვნა",
        badge: "הקדשה",
        accent: "#FB7185",
        searchKeywords: "მიძღვნა dedication leilu nishmat refua",
        icon: <Flame className="w-4 h-4 text-rose-200" />,
        onSelect: () => {
          onClose();
          onOpenDedicationModal();
        },
      });
    }
    if (onOpenAuthModal) {
      accountAndPrefs.push({
        id: "comm-auth",
        title: "ანგარიში და ონლაინ მომხმარებლები",
        subtitle: `აქტიური მომხმარებლები: ${onlineCount} • შესვლა / რეგისტრაცია`,
        badge: `${onlineCount}`,
        accent: "#10B981",
        searchKeywords: "ანგარიში რეგისტრაცია შესვლა მომხმარებლები auth account login users online",
        icon: <Users className="w-4 h-4 text-emerald-200" />,
        onSelect: () => {
          onClose();
          onOpenAuthModal();
        },
      });
    }

    return [
      {
        id: "quick-study",
        shortTitle: "დღის",
        title: "დღის სწავლება და სწრაფი წვდომა",
        subtitle: "დაფები, კალენდარი, სიდური და სარჩევი",
        accent: "#F59E0B",
        icon: <Sparkles className="w-3.5 h-3.5 text-amber-200" />,
        items: quickStudyItems,
      },
      {
        id: "sacred-library",
        shortTitle: "წერილი",
        title: "წმინდა წერილი და ჰალახა",
        subtitle: "თანახი, მიშნაიოთი და პოსკიმები",
        accent: "#38BDF8",
        icon: <BookOpen className="w-3.5 h-3.5 text-sky-200" />,
        items: sacredLibraryItems,
      },
      {
        id: "tools",
        shortTitle: "ბაზა",
        title: "სწავლის ხელსაწყოები და ბაზა",
        subtitle: "ძიება, AI ასისტენტი, ოფლაინ ბაზა და ექსპორტი",
        accent: "#A855F7",
        icon: <Compass className="w-3.5 h-3.5 text-violet-200" />,
        items: tools,
      },
      {
        id: "settings-community",
        shortTitle: "სისტემა",
        title: "პარამეტრები და საზოგადოება",
        subtitle: "თემა, მიძღვნა და ონლაინ მომხმარებლები",
        accent: "#10B981",
        icon: <Settings className="w-3.5 h-3.5 text-emerald-200" />,
        items: accountAndPrefs,
      },
    ].filter((cat) => cat.items.length > 0);
  }, [
    activeRealm,
    isDark,
    theme,
    onlineCount,
    onClose,
    onSelectRealm,
    onOpenCascadingSelector,
    onOpenSearchSheet,
    onOpenVoiceAi,
    onOpenOfflineLibrary,
    onOpenExportModal,
    onOpenSettings,
    onToggleTheme,
    kacunaAutoSpeak,
    onToggleKacunaAutoSpeak,
    onOpenDedicationModal,
    onOpenAuthModal,
  ]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .filter((c) => selectedCategory === "all" || c.id === selectedCategory)
      .map((cat) => ({
        ...cat,
        items: q
          ? cat.items.filter((item) =>
              `${item.title} ${item.subtitle} ${item.badge ?? ""} ${item.searchKeywords}`
                .toLowerCase()
                .includes(q),
            )
          : cat.items,
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, query, selectedCategory]);

  const currentLangOption =
    LANGUAGE_OPTIONS.find((lang) => lang.id === uiLang) ?? LANGUAGE_OPTIONS[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="galactic-main-menu-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={
            prefersReducedMotion ? { duration: 0.01 } : { duration: 0.44, ease: SILK_EASE }
          }
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="fixed inset-0 z-[560] bg-black/55 backdrop-blur-xs flex items-stretch justify-start"
        >
          <motion.aside
            key="galactic-main-menu-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="აპლიკაციის მთავარი მენიუ"
            data-galactic-side-menu="true"
            initial={{ x: "-100%", opacity: 0, scale: 0.985 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: "-100%", opacity: 0, scale: 0.985 }}
            transition={
              prefersReducedMotion
                ? { duration: 0.01 }
                : {
                    x: { duration: 0.44, ease: SILK_EASE },
                    opacity: { duration: 0.36, ease: SILK_EASE },
                    scale: { duration: 0.44, ease: SILK_EASE },
                  }
            }
            style={{ willChange: "transform, opacity" }}
            onClick={(e) => e.stopPropagation()}
            className="h-[100dvh] w-[min(92vw,400px)] flex flex-col border-r border-amber-300/30 bg-[#100A1B]/82 backdrop-blur-2xl text-[#FAF5EB] shadow-[20px_0_68px_rgba(0,0,0,0.78)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-white/12 flex items-center justify-between gap-3 bg-white/[0.03]">
              <div className="flex items-center gap-3 min-w-0">
                <AnimatedGlobeIconWrapper
                  withOrb
                  orbAccent="#F59E0B"
                  sizeClass="w-10 h-10"
                  duration={5.5}
                >
                  <Globe className="w-4.5 h-4.5 text-amber-200" />
                </AnimatedGlobeIconWrapper>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-extrabold tracking-tight truncate">
                    მთავარი სექციური მენიუ
                  </h2>
                  <p className="text-[11px] text-amber-100/70 truncate">
                    სფეროები · ხელსაწყოები · პარამეტრები
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="მენიუს დახურვა"
                className="w-10 h-10 rounded-xl border border-white/15 bg-white/6 hover:bg-white/14 text-amber-100 flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Compact Single-Word Filter Bar */}
            <div className="px-4 pt-3 pb-2.5 border-b border-white/10 space-y-2.5 bg-black/25">
              <div className="relative flex items-center">
                <span className="absolute left-2.5 z-10 pointer-events-none">
                  <AnimatedGlobeIconWrapper
                    withOrb
                    orbAccent="#F59E0B"
                    sizeClass="w-7 h-7"
                    duration={6.5}
                  >
                    <Search className="w-3.5 h-3.5 text-amber-200" />
                  </AnimatedGlobeIconWrapper>
                </span>
                <input
                  type="text"
                  inputMode="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="სწრაფი ძიება მენიუში (თალმუდი, რამბამი...)"
                  aria-label="მენიუში ძიება"
                  style={{ paddingLeft: "3rem", paddingRight: "2.25rem" }}
                  className="w-full h-11 rounded-xl border border-white/15 bg-white/10 text-xs sm:text-sm text-[#FAF5EB] placeholder:text-slate-500 dark:placeholder:text-amber-100/50 focus:outline-none focus:border-amber-300/70"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="ძიების გასუფთავება"
                    className="absolute right-2.5 z-10 p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:text-amber-200/80 dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setExpandedCategoryId((prev) => prev ?? "quick-study");
                  }}
                  aria-pressed={selectedCategory === "all"}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-xl text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    selectedCategory === "all"
                      ? "bg-amber-400 text-stone-950 shadow-xs"
                      : "bg-white/8 text-amber-100/85 hover:bg-white/15"
                  }`}
                >
                  <AnimatedGlobeIconWrapper
                    withOrb
                    orbAccent="#F59E0B"
                    sizeClass="w-5 h-5"
                    duration={6}
                  >
                    <Globe className="w-2.5 h-2.5 text-amber-200" />
                  </AnimatedGlobeIconWrapper>
                  <span>ყველა</span>
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(cat.id);
                      setExpandedCategoryId(cat.id);
                    }}
                    aria-pressed={selectedCategory === cat.id}
                    title={cat.title}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-xl text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                      selectedCategory === cat.id
                        ? "bg-amber-400 text-stone-950 shadow-xs"
                        : "bg-white/8 text-amber-100/85 hover:bg-white/15"
                    }`}
                  >
                    <AnimatedGlobeIconWrapper
                      withOrb
                      orbAccent={cat.accent}
                      sizeClass="w-5 h-5"
                      duration={6.5}
                    >
                      {cat.icon}
                    </AnimatedGlobeIconWrapper>
                    <span>{cat.shortTitle}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Accordion Sectioned List */}
            <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3">
              {filteredCategories.length === 0 ? (
                <div className="py-10 text-center text-xs sm:text-sm text-amber-100/65">
                  „{query}“ — შესაბამისი არჩევანი ვერ მოიძებნა
                </div>
              ) : (
                filteredCategories.map((cat) => {
                  const hasQuery = query.trim().length > 0;
                  const isExpanded = hasQuery || expandedCategoryId === cat.id;

                  return (
                    <section
                      key={cat.id}
                      aria-label={cat.title}
                      className="rounded-2xl border border-white/12 bg-white/[0.03] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCategoryId((prev) => (prev === cat.id ? null : cat.id))
                        }
                        aria-expanded={isExpanded}
                        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-white/[0.05] transition-colors min-h-[52px]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <AnimatedGlobeIconWrapper
                            withOrb
                            orbAccent={cat.accent}
                            sizeClass="w-7 h-7"
                            duration={6.5}
                          >
                            {cat.icon}
                          </AnimatedGlobeIconWrapper>
                          <div className="min-w-0">
                            <h3 className="text-xs font-extrabold text-amber-200 tracking-wide truncate">
                              {cat.title}
                            </h3>
                            <p className="text-[10px] text-amber-100/55 truncate">{cat.subtitle}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] font-semibold text-amber-100/60 tabular-nums">
                            {cat.items.length}
                          </span>
                          <motion.span
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={
                              prefersReducedMotion
                                ? { duration: 0.01 }
                                : { duration: 0.36, ease: SILK_EASE }
                            }
                            className="inline-flex items-center justify-center"
                          >
                            <ChevronDown className="w-4 h-4 text-amber-200/80" />
                          </motion.span>
                        </div>
                      </button>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            key={`accordion-body-${cat.id}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={
                              prefersReducedMotion
                                ? { duration: 0.01 }
                                : {
                                    height: { duration: 0.42, ease: SILK_EASE },
                                    opacity: { duration: 0.3, ease: SILK_EASE },
                                  }
                            }
                            className="overflow-hidden"
                          >
                            <motion.div
                              initial={{ y: -8, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              exit={{ y: -6, opacity: 0 }}
                              transition={
                                prefersReducedMotion
                                  ? { duration: 0.01 }
                                  : { duration: 0.34, ease: SILK_EASE }
                              }
                              className="p-2.5 border-t border-white/10 flex flex-col gap-2"
                            >
                              {cat.items.map((item, idx) => (
                                <motion.button
                                  key={item.id}
                                  type="button"
                                  onClick={item.onSelect}
                                  initial={{ opacity: 0, y: 6 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={
                                    prefersReducedMotion
                                      ? { duration: 0.01 }
                                      : {
                                          duration: 0.3,
                                          delay: Math.min(idx * 0.03, 0.15),
                                          ease: SILK_EASE,
                                        }
                                  }
                                  className={`min-h-[50px] w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2.5 cursor-pointer transition-all active:scale-[0.99] ${
                                    item.active
                                      ? "bg-amber-400/20 border-amber-300 text-white shadow-[0_0_20px_rgba(245,158,11,0.16)]"
                                      : "bg-white/[0.05] hover:bg-white/[0.11] border-white/10 text-[#FAF5EB]"
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span data-menu-spinning-orb="true" className="shrink-0">
                                      <AnimatedGlobeIconWrapper
                                        withOrb
                                        orbAccent={item.accent}
                                        sizeClass="w-8 h-8"
                                        duration={5.4 + (idx % 4) * 0.65}
                                      >
                                        {item.icon}
                                      </AnimatedGlobeIconWrapper>
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-bold truncate">{item.title}</div>
                                      <div className="text-[10.5px] text-amber-100/65 truncate">
                                        {item.subtitle}
                                      </div>
                                    </div>
                                  </div>
                                  {item.badge && (
                                    <span
                                      dir={item.badgeDir ?? "rtl"}
                                      className={
                                        item.badgeDir === "ltr"
                                          ? `text-[11px] font-bold shrink-0 ${
                                              item.active ? "text-amber-200" : "text-amber-100/70"
                                            }`
                                          : "text-[11px] font-serif font-bold text-amber-200/85 shrink-0"
                                      }
                                    >
                                      {item.badge}
                                    </span>
                                  )}
                                </motion.button>
                              ))}
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </section>
                  );
                })
              )}

              {/* Language Dropdown Section */}
              {onChangeUiLang && currentLangOption && (
                <section
                  aria-label="ინტერფეისის ენა"
                  className="pt-2 border-t border-white/12 space-y-2"
                >
                  <button
                    type="button"
                    data-menu-language-trigger="true"
                    aria-haspopup="listbox"
                    aria-expanded={isLangDropdownOpen}
                    onClick={() => setIsLangDropdownOpen((prev) => !prev)}
                    className="w-full min-h-[48px] px-3 py-2 rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-between gap-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span data-menu-spinning-orb="true" className="shrink-0">
                        <AnimatedGlobeIconWrapper
                          withOrb
                          orbAccent="#38BDF8"
                          sizeClass="w-8 h-8"
                          duration={6}
                        >
                          <Languages className="w-3.5 h-3.5 text-sky-200" />
                        </AnimatedGlobeIconWrapper>
                      </span>
                      <div className="min-w-0 text-left">
                        <div className="text-[10.5px] font-semibold text-amber-100/65 truncate">
                          ინტერფეისის ენა
                        </div>
                        <div className="text-xs font-extrabold text-[#FAF5EB] truncate">
                          {currentLangOption.short} · {currentLangOption.label}
                        </div>
                      </div>
                    </div>
                    <motion.span
                      animate={{ rotate: isLangDropdownOpen ? 180 : 0 }}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0.01 }
                          : { duration: 0.34, ease: SILK_EASE }
                      }
                      className="inline-flex items-center justify-center shrink-0"
                    >
                      <ChevronDown className="w-4 h-4 text-amber-200" />
                    </motion.span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isLangDropdownOpen && (
                      <motion.div
                        key="language-dropdown-list"
                        role="listbox"
                        aria-label="ენის არჩევა"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={
                          prefersReducedMotion
                            ? { duration: 0.01 }
                            : {
                                height: { duration: 0.38, ease: SILK_EASE },
                                opacity: { duration: 0.28, ease: SILK_EASE },
                              }
                        }
                        className="overflow-hidden"
                      >
                        <motion.div
                          initial={{ y: -6, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: -4, opacity: 0 }}
                          transition={
                            prefersReducedMotion
                              ? { duration: 0.01 }
                              : { duration: 0.3, ease: SILK_EASE }
                          }
                          className="p-1.5 rounded-xl border border-white/15 bg-black/40 backdrop-blur-xl flex flex-col gap-1"
                        >
                          {LANGUAGE_OPTIONS.map((lang, idx) => {
                            const active = uiLang === lang.id;
                            return (
                              <button
                                key={lang.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                  onChangeUiLang(lang.id);
                                  setIsLangDropdownOpen(false);
                                }}
                                className={`w-full min-h-[42px] px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs font-bold cursor-pointer transition-colors ${
                                  active
                                    ? "bg-amber-400/22 text-white border border-amber-300/60"
                                    : "text-amber-100/85 hover:bg-white/[0.08] border border-transparent"
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <AnimatedGlobeIconWrapper
                                    withOrb
                                    orbAccent={active ? "#F59E0B" : "#38BDF8"}
                                    sizeClass="w-6 h-6"
                                    duration={5.8 + idx * 0.45}
                                  >
                                    <Globe className="w-3 h-3 text-amber-200" />
                                  </AnimatedGlobeIconWrapper>
                                  <span className="truncate">
                                    {lang.short} · {lang.label}
                                  </span>
                                  <span className="text-[10px] font-medium text-amber-100/55 truncate">
                                    ({lang.native})
                                  </span>
                                </span>
                                {active && (
                                  <Check className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
