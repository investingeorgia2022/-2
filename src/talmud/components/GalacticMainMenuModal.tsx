import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  BookOpen,
  Compass,
  Database,
  Flame,
  Globe,
  Languages,
  Mic,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { SACRED_REALMS, SacredRealmId } from '../data/tanakhAndHalakhaData';
import type { AppTheme, UILang } from '../types/talmud';
import { LANGUAGE_OPTIONS } from './SettingsModal';

interface MenuEntry {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  searchKeywords: string;
  icon: React.ReactNode;
  active?: boolean;
  onSelect: () => void;
}

interface MenuCategory {
  id: string;
  title: string;
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
  onOpenVoiceAi?: (initialTab: 'voice' | 'ai') => void;
  onOpenExportModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenDedicationModal?: () => void;
  theme?: AppTheme;
  onToggleTheme?: () => void;
  uiLang?: UILang;
  onChangeUiLang?: (lang: UILang) => void;
  onlineCount?: number;
  isDark?: boolean;
}

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
  uiLang = 'ka',
  onChangeUiLang,
  onlineCount = 1,
  isDark = true,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedCategory('all');
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 60);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, onClose]);

  const categories = useMemo<MenuCategory[]>(() => {
    const talmudAndTanakh = SACRED_REALMS.filter(
      (r) => r.category === 'talmud' || r.category === 'tanakh'
    ).map<MenuEntry>((r) => ({
      id: `realm-${r.id}`,
      title: r.titleKa,
      subtitle: r.subtitleKa,
      badge: r.badgeHe,
      searchKeywords: `${r.titleKa} ${r.titleHe} ${r.subtitleKa} ${r.id} ${r.badgeHe}`,
      icon: <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />,
      active: activeRealm === r.id,
      onSelect: () => {
        onClose();
        onSelectRealm(r.id);
      },
    }));

    const halakhaAndPrayer = SACRED_REALMS.filter(
      (r) => r.category === 'halakha' || r.category === 'blessings' || r.category === 'calendar'
    ).map<MenuEntry>((r) => ({
      id: `realm-${r.id}`,
      title: r.titleKa,
      subtitle: r.subtitleKa,
      badge: r.badgeHe,
      searchKeywords: `${r.titleKa} ${r.titleHe} ${r.subtitleKa} ${r.id} ${r.badgeHe}`,
      icon: <Compass className="w-4 h-4 text-sky-400 shrink-0" />,
      active: activeRealm === r.id,
      onSelect: () => {
        onClose();
        onSelectRealm(r.id);
      },
    }));

    const tools: MenuEntry[] = [];
    if (onOpenCascadingSelector) {
      tools.push({
        id: 'tool-cascading',
        title: 'ტრაქტატისა და ფერეკის სარჩევი',
        subtitle: 'სედერი, ტრაქტატი, თავი, მიშნა და დაფის სწრაფი არჩევა',
        badge: 'ש״ס',
        searchKeywords: 'ტრაქტატი სარჩევი ფერეკი სედერი მიშნა tractate seder selector navigator',
        icon: <Compass className="w-4 h-4 text-amber-300 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenCascadingSelector();
        },
      });
    }
    if (onOpenSearchSheet) {
      tools.push({
        id: 'tool-search',
        title: 'სრული ძიება და სარჩევი',
        subtitle: 'სიტყვების, სუგიების და წყაროების მოძებნა ბაზაში',
        badge: 'חיפוש',
        searchKeywords: 'ძიება სარჩევი search finder lookup',
        icon: <Search className="w-4 h-4 text-emerald-400 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenSearchSheet();
        },
      });
    }
    if (onOpenVoiceAi) {
      tools.push({
        id: 'tool-ai-nav',
        title: 'ჭკვიანი AI და ხმოვანი ნავიგაცია',
        subtitle: 'საკითხის კითხვა, ხმოვანი ბრძანება და წყაროს პოვნა',
        badge: 'AI / קול',
        searchKeywords: 'ai ხმოვანი voice assistant navigation smart',
        icon: <Mic className="w-4 h-4 text-violet-300 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenVoiceAi('ai');
        },
      });
    }
    if (onOpenOfflineLibrary) {
      tools.push({
        id: 'tool-offline',
        title: 'დაფების ოფლაინ ბაზა',
        subtitle: 'ტრაქტატების ჩამოტვირთვა ინტერნეტის გარეშე კითხვისთვის',
        badge: 'Offline',
        searchKeywords: 'ოფლაინ ბაზა დაფები ჩამოტვირთვა offline cache database',
        icon: <Database className="w-4 h-4 text-amber-400 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenOfflineLibrary();
        },
      });
    }
    if (onOpenExportModal) {
      tools.push({
        id: 'tool-export',
        title: 'პროექტისა და APK ექსპორტი',
        subtitle: 'Source Code ZIP, Full Project და Android APK ჩამოტვირთვა',
        badge: 'ZIP / APK',
        searchKeywords: 'ექსპორტი apk zip download export',
        icon: <Archive className="w-4 h-4 text-amber-300 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenExportModal();
        },
      });
    }

    const accountAndPrefs: MenuEntry[] = [];
    if (onOpenSettings) {
      accountAndPrefs.push({
        id: 'pref-settings',
        title: 'აპლიკაციის პარამეტრები',
        subtitle: 'დიზაინი, შრიფტის ზომა, ნიკუდი, PDF მონიშვნები და რაშის ფოკუსი',
        badge: 'הגדרות',
        searchKeywords:
          'პარამეტრები settings preferences font bold rashi focus highlight ნიკუდი დიზაინი',
        icon: <Settings className="w-4 h-4 text-amber-300 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenSettings();
        },
      });
    }
    if (onToggleTheme) {
      accountAndPrefs.push({
        id: 'pref-theme',
        title: isDark ? 'დღის ნათელ დიზაინზე გადართვა' : 'ღამის მუქ დიზაინზე გადართვა',
        subtitle: `მიმდინარე თემა: ${theme || 'parchment-day'}`,
        searchKeywords: 'თემა დიზაინი დღე ღამე theme dark light mode',
        icon: isDark ? (
          <Sun className="w-4 h-4 text-amber-300 shrink-0" />
        ) : (
          <Moon className="w-4 h-4 text-sky-300 shrink-0" />
        ),
        onSelect: () => {
          onToggleTheme();
        },
      });
    }
    if (onOpenDedicationModal) {
      accountAndPrefs.push({
        id: 'comm-dedication',
        title: 'სწავლის მიძღვნა',
        subtitle: 'ლეილუი ნიშმათ ან რეფუა შელემას სწავლის მიძღვნა',
        badge: 'הקדשה',
        searchKeywords: 'მიძღვნა dedication leilu nishmat refua',
        icon: <Flame className="w-4 h-4 text-amber-400 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenDedicationModal();
        },
      });
    }
    if (onOpenAuthModal) {
      accountAndPrefs.push({
        id: 'comm-auth',
        title: 'ანგარიში და ონლაინ მომხმარებლები',
        subtitle: `აქტიური მომხმარებლები: ${onlineCount} • შესვლა / რეგისტრაცია`,
        badge: `${onlineCount}`,
        searchKeywords: 'ანგარიში რეგისტრაცია შესვლა მომხმარებლები auth account login users online',
        icon: <Users className="w-4 h-4 text-emerald-400 shrink-0" />,
        onSelect: () => {
          onClose();
          onOpenAuthModal();
        },
      });
    }

    return [
      { id: 'talmud-tanakh', title: 'თალმუდი და თანახი', items: talmudAndTanakh },
      { id: 'halakha-prayer', title: 'ჰალახა და ლოცვა', items: halakhaAndPrayer },
      { id: 'tools', title: 'სწავლის ხელსაწყოები', items: tools },
      { id: 'settings-community', title: 'პარამეტრები და საზოგადოება', items: accountAndPrefs },
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
    onOpenDedicationModal,
    onOpenAuthModal,
  ]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .filter((c) => selectedCategory === 'all' || c.id === selectedCategory)
      .map((cat) => ({
        ...cat,
        items: q
          ? cat.items.filter((item) => item.searchKeywords.toLowerCase().includes(q))
          : cat.items,
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, query, selectedCategory]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="galactic-main-menu-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="fixed inset-0 z-[560] bg-black/65 backdrop-blur-sm flex items-start sm:items-center justify-center p-2.5 sm:p-5"
        >
          <motion.div
            key="galactic-main-menu-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="აპლიკაციის მთავარი მენიუ"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-2xl border border-amber-300/35 bg-[#120D1A]/96 text-[#FAF5EB] shadow-[0_24px_70px_rgba(0,0,0,0.85)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl border border-amber-300/40 bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Globe className="w-4.5 h-4.5 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-extrabold tracking-tight truncate">
                    აპლიკაციის მთავარი მენიუ
                  </h2>
                  <p className="text-[11px] text-amber-100/70 truncate">
                    სფეროები · სწავლის ხელსაწყოები · პარამეტრები
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="მენიუს დახურვა"
                className="w-10 h-10 rounded-xl border border-white/15 bg-white/5 hover:bg-white/12 text-amber-100 flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Category Tabs */}
            <div className="px-4 pt-3 pb-2.5 border-b border-white/10 space-y-2.5 bg-black/20">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-amber-200/70 absolute left-3 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="სწრაფი ძიება მენიუში (თალმუდი, რამბამი, პარამეტრები...)"
                  aria-label="მენიუში ძიება"
                  className="w-full h-11 pl-9 pr-9 rounded-xl border border-white/15 bg-white/8 text-xs sm:text-sm text-[#FAF5EB] placeholder:text-amber-100/45 focus:outline-none focus:border-amber-300/70"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="ძიების გასუფთავება"
                    className="absolute right-2.5 p-1 rounded-lg text-amber-200/70 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-amber-400 text-stone-950'
                      : 'bg-white/8 text-amber-100/80 hover:bg-white/14'
                  }`}
                >
                  ყველა
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-amber-400 text-stone-950'
                        : 'bg-white/8 text-amber-100/80 hover:bg-white/14'
                    }`}
                  >
                    {cat.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Categorized List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {filteredCategories.length === 0 ? (
                <div className="py-10 text-center text-xs sm:text-sm text-amber-100/65">
                  „{query}“ — შესაბამისი არჩევანი ვერ მოიძებნა
                </div>
              ) : (
                filteredCategories.map((cat) => (
                  <section key={cat.id} aria-label={cat.title} className="space-y-2">
                    <div className="flex items-baseline justify-between border-b border-white/10 pb-1">
                      <h3 className="text-xs font-extrabold text-amber-300 tracking-wide">
                        {cat.title}
                      </h3>
                      <span className="text-[11px] text-amber-100/55 tabular-nums">
                        {cat.items.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cat.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={item.onSelect}
                          className={`min-h-[48px] w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2.5 cursor-pointer transition-colors ${
                            item.active
                              ? 'bg-amber-400/20 border-amber-300 text-white'
                              : 'bg-white/5 hover:bg-white/10 border-white/10 text-[#FAF5EB]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {item.icon}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold truncate">{item.title}</div>
                              <div className="text-[10.5px] text-amber-100/65 truncate">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>
                          {item.badge && (
                            <span
                              dir="rtl"
                              className="text-[11px] font-serif font-bold text-amber-200/85 shrink-0"
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                ))
              )}

              {/* Quick Language Strip */}
              {onChangeUiLang && (
                <section aria-label="ინტერფეისის ენა" className="pt-2 border-t border-white/10 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-300">
                    <Languages className="w-3.5 h-3.5" />
                    <span>ინტერფეისის ენა</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {LANGUAGE_OPTIONS.map((lang) => {
                      const active = uiLang === lang.id;
                      return (
                        <button
                          key={lang.id}
                          type="button"
                          onClick={() => onChangeUiLang(lang.id)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                            active
                              ? 'bg-amber-400 text-stone-950'
                              : 'bg-white/8 text-amber-100/80 hover:bg-white/14'
                          }`}
                        >
                          {lang.short} · {lang.label}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
