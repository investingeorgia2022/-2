import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GalacticGlobeAndAiGreeter } from "../talmud/components/GalacticGlobeAndAiGreeter";
import { GalacticMainMenuModal } from "../talmud/components/GalacticMainMenuModal";
import { PopularTractatesD3Chart } from "../talmud/components/PopularTractatesD3Chart";
import {
  THIRTY_DAYS_MS,
  TRACTATE_SEARCH_EVENTS_KEY,
  getTopSearchedTractates30Days,
  recordTractateSearch,
  writeTractateSearchEvents,
} from "../talmud/utils/tractateSearchStats";

describe("tractateSearchStats (30-day rolling window)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("seeds baseline top 5 tractates when storage is empty", () => {
    const now = 1_750_000_000_000;
    const top5 = getTopSearchedTractates30Days(5, now);

    expect(top5).toHaveLength(5);
    expect(top5.map((t) => [t.tractateId, t.count])).toEqual([
      ["Berakhot", 42],
      ["Shabbat", 35],
      ["Bava_Metzia", 29],
      ["Pesachim", 23],
      ["Sanhedrin", 18],
    ]);
    expect(window.localStorage.getItem(TRACTATE_SEARCH_EVENTS_KEY)).toBeTruthy();
  });

  it("prunes events older than 30 days and updates ranking on recordTractateSearch", () => {
    const now = 1_750_000_000_000;
    writeTractateSearchEvents([
      { tractateId: "Yoma", searchedAt: now - THIRTY_DAYS_MS - 10_000 },
      { tractateId: "Yoma", searchedAt: now - THIRTY_DAYS_MS - 5_000 },
      { tractateId: "Sukkah", searchedAt: now - 1_000 },
    ]);

    recordTractateSearch("Sukkah", now);
    recordTractateSearch("Invalid_Tractate_Id", now);

    const top = getTopSearchedTractates30Days(5, now);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      tractateId: "Sukkah",
      count: 2,
      sharePct: 100,
    });
  });
});

describe("PopularTractatesD3Chart", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders a D3 packed bubble chart for top 5 tractates and notifies on click", () => {
    const stats = getTopSearchedTractates30Days(5, 1_750_000_000_000);
    const onSelect = vi.fn();

    render(
      <PopularTractatesD3Chart
        stats={stats}
        onSelectTractate={onSelect}
        theme="sanctuary-3d"
        isDark
      />,
    );

    const chart = document.querySelector('[data-d3-tractates-chart="true"]');
    expect(chart).not.toBeNull();
    expect(screen.getByText("ბოლო 30 დღის ტოპ 5 ტრაქტატი")).toBeInTheDocument();

    const circles = chart!.querySelectorAll("svg circle");
    expect(circles).toHaveLength(5);

    const shabbatBubble = screen.getByRole("button", {
      name: /შაბათი.*35 ძიება ბოლო 30 დღეში/,
    });
    fireEvent.click(shabbatBubble);
    expect(onSelect).toHaveBeenCalledWith("Shabbat");
  });
});

describe("GalacticMainMenuModal (left glassmorphic sectioned drawer)", () => {
  it("opens without auto-focusing search, preserves input/filter on re-render, uses single-open accordion and language dropdown", () => {
    const onClose = vi.fn();
    const onSelectRealm = vi.fn();
    const onOpenSettings = vi.fn();
    const onChangeUiLang = vi.fn();

    const baseProps = {
      isOpen: true,
      activeRealm: "talmud" as const,
      onSelectRealm,
      onOpenSettings,
      onOpenOfflineLibrary: vi.fn(),
      onOpenCascadingSelector: vi.fn(),
      onOpenSearchSheet: vi.fn(),
      onOpenVoiceAi: vi.fn(),
      onOpenExportModal: vi.fn(),
      onOpenAuthModal: vi.fn(),
      onOpenDedicationModal: vi.fn(),
      onToggleTheme: vi.fn(),
      uiLang: "ka" as const,
      onChangeUiLang,
      onlineCount: 3,
      isDark: true,
    };

    const { rerender } = render(<GalacticMainMenuModal {...baseProps} onClose={onClose} />);

    const drawer = document.querySelector('[data-galactic-side-menu="true"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.tagName.toLowerCase()).toBe("aside");
    expect(drawer?.className).toContain("backdrop-blur-2xl");

    // 1. Search input is NOT auto-focused when entering the menu
    const searchInput = screen.getByLabelText("მენიუში ძიება") as HTMLInputElement;
    expect(document.activeElement).not.toBe(searchInput);

    // 2. Single-open accordion: first section expanded, others collapsed
    const quickHeader = screen.getByRole("button", { name: /დღის სწავლება და სწრაფი წვდომა/ });
    const libraryHeader = screen.getByRole("button", { name: /წმინდა წერილი და ჰალახა/ });
    expect(quickHeader).toHaveAttribute("aria-expanded", "true");
    expect(libraryHeader).toHaveAttribute("aria-expanded", "false");

    const spinningOrbs = document.querySelectorAll('[data-menu-spinning-orb="true"]');
    expect(spinningOrbs.length).toBeGreaterThanOrEqual(5);

    // 3. Clicking compact single-word filter chip switches section and survives parent re-renders
    const dayFilterChip = screen.getByRole("button", { name: "დღის" });
    fireEvent.click(dayFilterChip);
    expect(dayFilterChip).toHaveAttribute("aria-pressed", "true");

    // Simulate parent 3D animation frame passing a fresh inline onClose callback
    rerender(<GalacticMainMenuModal {...baseProps} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "დღის" })).toHaveAttribute("aria-pressed", "true");

    // Switch back to all and test typing in search input across parent re-render
    fireEvent.click(screen.getByRole("button", { name: "ყველა" }));
    fireEvent.change(searchInput, { target: { value: "პარამეტრები" } });
    rerender(<GalacticMainMenuModal {...baseProps} onClose={onClose} />);
    expect(searchInput.value).toBe("პარამეტრები");

    const settingsBtn = screen.getByRole("button", { name: /აპლიკაციის პარამეტრები/ });
    fireEvent.click(settingsBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // Clear search and verify language dropdown opens & changes language cleanly
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.queryByRole("listbox", { name: "ენის არჩევა" })).toBeNull();

    const langTrigger = document.querySelector('[data-menu-language-trigger="true"]')!;
    fireEvent.click(langTrigger);
    expect(screen.getByRole("listbox", { name: "ენის არჩევა" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /EN · ინგლისური/ }));
    expect(onChangeUiLang).toHaveBeenCalledWith("en");
  });

  it("opens the side menu drawer when clicking the top-left globe on the orbs screen", () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    try {
      render(
        <GalacticGlobeAndAiGreeter
          isGlobeOpen
          onCloseGlobe={vi.fn()}
          onSelectRealm={vi.fn()}
          activeRealm="talmud"
          isDark
        />,
      );

      expect(document.querySelector('[data-galactic-side-menu="true"]')).toBeNull();

      const topLeftGlobeBtn = screen.getByRole("button", { name: "აპლიკაციის მთავარი მენიუ" });
      fireEvent.click(topLeftGlobeBtn);

      expect(document.querySelector('[data-galactic-side-menu="true"]')).not.toBeNull();
    } finally {
      playSpy.mockRestore();
      pauseSpy.mockRestore();
    }
  });

  it("renders Smart Greeter auto-speak quick toggle in side menu defaulting off and toggles without closing drawer", () => {
    const onClose = vi.fn();
    const onToggleKacunaAutoSpeak = vi.fn();

    const baseProps = {
      isOpen: true,
      onClose,
      activeRealm: "talmud" as const,
      onSelectRealm: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleKacunaAutoSpeak,
      isDark: true,
    };

    const { rerender } = render(
      <GalacticMainMenuModal {...baseProps} kacunaAutoSpeak={false} />,
    );

    const searchInput = screen.getByLabelText("მენიუში ძიება") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "კაცუნა" } });

    const autoSpeakBtn = screen.getByRole("button", {
      name: /ჭკვიანი კაცუნას ავტო-ლაპარაკი/,
    });
    expect(autoSpeakBtn).toHaveTextContent("გამორთულია");

    fireEvent.click(autoSpeakBtn);
    expect(onToggleKacunaAutoSpeak).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    rerender(<GalacticMainMenuModal {...baseProps} kacunaAutoSpeak />);
    expect(
      screen.getByRole("button", { name: /ჭკვიანი კაცუნას ავტო-ლაპარაკი/ }),
    ).toHaveTextContent("ჩართულია ✓");
  });
});
