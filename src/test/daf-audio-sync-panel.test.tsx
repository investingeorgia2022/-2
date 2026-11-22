import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DafAudioSyncPanel } from "../talmud/components/DafAudioSyncPanel";
import { PdfInkHighlight } from "../talmud/components/PdfInkHighlight";
import { saveAudioSourceConfig, saveAudioSyncMap } from "../talmud/utils/audioSyncStorage";
import type { SyncHotspotLike } from "../talmud/utils/audioSyncTypes";

/**
 * @synthetic-fixture
 * Synthetic hotspots mimicking Berakhot 2a Mishnah + Gemara words for UI integration tests.
 */
function makeDafHotspots(): SyncHotspotLike[] {
  const words = ["מאימתי", "קורין", "את", "שמע", "בערבית", "תנא", "היכא", "קאי"];
  return words.map((word, idx) => ({
    id: `h-${idx}`,
    word,
    cleanWord: word,
    section: idx < 5 ? "mishnah" : "gemara",
    rowId: idx < 5 ? "mishnah-row-0" : "gemara-row-1",
    leftPct: 85 - idx * 8,
    topPct: idx < 5 ? 12 : 20,
    widthPct: 6,
    heightPct: 2.2,
    lineTextHe: idx < 5 ? "מאימתי קורין את שמע בערבית" : "תנא היכא קאי",
  }));
}

describe("DafAudioSyncPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders Crystal Glass compact bar by default, aligns pasted timestamped phrases from tools drawer, and verifies segments", async () => {
    const activeChanges: Array<{ ids: string[]; segId: string | null }> = [];
    let registeredSeek: ((hotspotId: string) => boolean) | null = null;
    const autoScrollStates: boolean[] = [];

    render(
      <DafAudioSyncPanel
        tractateId="Berakhot"
        dafId="2a"
        tractateNameKa="ბერახოთი"
        dafMarkHe="ב׳ ע״א"
        isDark={false}
        hotspots={makeDafHotspots()}
        onClose={vi.fn()}
        onActiveHighlightChange={(ids, segId) => {
          activeChanges.push({ ids: Array.from(ids), segId });
        }}
        onAutoScrollChange={(enabled) => autoScrollStates.push(enabled)}
        onRegisterSeekHandler={(fn) => {
          registeredSeek = fn;
        }}
      />,
    );

    const panel = await screen.findByTestId("daf-audio-sync-panel");
    expect(panel).toHaveClass("crystal-window-shell");
    expect(screen.queryByTestId("audio-sync-tools-drawer")).toBeNull();

    // Open collapsible tools drawer, then paste transcript
    fireEvent.click(screen.getByRole("button", { name: /ინსტრუმენტები/i }));
    expect(screen.getByTestId("audio-sync-tools-drawer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ტექსტის ჩასმა/i }));
    const textarea = screen.getByRole("textbox", { name: /ტრანსკრიპტის ტექსტი/i });
    fireEvent.change(textarea, {
      target: {
        value: "[00:00] מאימתי קורין את שמע בערבית\n[00:05] תנא היכא מילה",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /დაფთან მიბმა/i }));

    // Segment 1 covers [0..5000ms], so at t=0ms spots h-0..h-4 highlight automatically
    await waitFor(() => {
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("seg-1");
      expect(latest?.ids).toEqual(["h-0", "h-1", "h-2", "h-3", "h-4"]);
    });

    // Seek forward to segment 2 by clicking its row button in expanded segment list
    const seg2Button = screen.getByRole("button", { name: /תנא היכא מילה/i });
    fireEvent.click(seg2Button);

    await waitFor(() => {
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("seg-2");
      expect(latest?.ids).toEqual(["h-5", "h-6"]);
    });

    // Click-word-to-seek handler jumps back to segment 1 when clicking hotspot h-1 ("קורין")
    expect(registeredSeek).not.toBeNull();
    let handled = false;
    act(() => {
      handled = registeredSeek!("h-1");
    });
    expect(handled).toBe(true);

    await waitFor(() => {
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("seg-1");
    });

    // Verify segment 2 marks it "verified"
    const verifySeg2 = screen.getByRole("button", { name: "დადასტურება seg-2" });
    fireEvent.click(verifySeg2);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "დადასტურება seg-2" })).toBeNull();
    });

    // Auto-scroll toggle updates parent state
    fireEvent.click(screen.getByRole("button", { name: /ავტო-სქროლი/i }));
    expect(autoScrollStates[autoScrollStates.length - 1]).toBe(false);
  });

  it("uploads local audio, invokes /api/talmud/audio-sync-transcribe, and aligns returned segments", async () => {
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-audio");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          transcript: "מאימתי קורין את שמע בערבית",
          segments: [
            {
              id: "ai-seg-1",
              startMs: 0,
              endMs: 3200,
              textHe: "מאימתי קורין את שמע בערבית",
              topicKa: "მიშნა: საღამოს შემაც კითხვის დაწყების დრო",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const activeChanges: Array<{ ids: string[]; segId: string | null }> = [];
    render(
      <DafAudioSyncPanel
        tractateId="Berakhot"
        dafId="2a"
        tractateNameKa="ბერახოთი"
        dafMarkHe="ב׳ ע״א"
        isDark={true}
        hotspots={makeDafHotspots()}
        dafExcerptHe="מאימתי קורין את שמע בערבית"
        dafReferenceKa="[1 • მიშნა] מאימתי קורין את שמע בערבית\n→ რა დროიდან კითხულობენ შემას საღამოს"
        onClose={vi.fn()}
        onActiveHighlightChange={(ids, segId) => {
          activeChanges.push({ ids: Array.from(ids), segId });
        }}
        onAutoScrollChange={vi.fn()}
        onRegisterSeekHandler={vi.fn()}
      />,
    );

    const fileInput = document.body.querySelector(
      'input[type="file"][accept="audio/*"]',
    ) as HTMLInputElement;
    const mockFile = new File([new Uint8Array([1, 2, 3, 4])], "shiur.mp3", {
      type: "audio/mp3",
    });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await waitFor(() => {
      expect(screen.getByText(/აუდიო ჩატვირთულია: shiur\.mp3/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /ინსტრუმენტები/i }));
    const aiBtn = screen.getByRole("button", { name: /AI სინქი/i });
    fireEvent.click(aiBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/talmud/audio-sync-transcribe",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("dafReferenceKa"),
        }),
      );
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("ai-seg-1");
      expect(latest?.ids).toEqual(["h-0", "h-1", "h-2", "h-3", "h-4"]);
      expect(screen.getByTestId("active-sync-preview")).toHaveTextContent(
        "მიშნა: საღამოს შემაც კითხვის დაწყების დრო",
      );
    });

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it("shows clear Georgian not-found message when pressing Play without available daf audio", async () => {
    render(
      <DafAudioSyncPanel
        tractateId="Shabbat"
        dafId="21b"
        tractateNameKa="შაბათი"
        dafMarkHe="כ״א ע״ב"
        isDark={true}
        hotspots={makeDafHotspots()}
        onClose={vi.fn()}
        onActiveHighlightChange={vi.fn()}
        onAutoScrollChange={vi.fn()}
        onRegisterSeekHandler={vi.fn()}
      />,
    );

    const playBtn = await screen.findByRole("button", { name: /დაკვრა/i });
    expect(playBtn).not.toBeDisabled();
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("ამ დაფზე აუდიო ფაილი ვერ მოიძებნა");
    });

    // Quick link opens the tools drawer for configuring audio source URL
    fireEvent.click(screen.getByRole("button", { name: /წყაროს მითითება/i }));
    expect(screen.getByTestId("audio-sync-tools-drawer")).toBeInTheDocument();
  });

  it("resolves configured storage audio URL on Play, plays audio, and auto-syncs Gemara highlights", async () => {
    saveAudioSourceConfig({
      urlTemplate: "https://cdn.example.com/shiurim/{tractate_lower}/{daf}.mp3",
      dafOverrides: {},
    });

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("mode=check")) {
        return new Response(JSON.stringify({ exists: true, mimeType: "audio/mpeg" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          transcript: "מאימתי קורין את שמע בערבית",
          segments: [
            {
              id: "ai-seg-1",
              startMs: 0,
              endMs: 4000,
              textHe: "מאימתי קורין את שמע בערבית",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const activeChanges: Array<{ ids: string[]; segId: string | null }> = [];
    render(
      <DafAudioSyncPanel
        tractateId="Berakhot"
        dafId="2a"
        tractateNameKa="ბერახოთი"
        dafMarkHe="ב׳ ע״א"
        isDark={false}
        hotspots={makeDafHotspots()}
        onClose={vi.fn()}
        onActiveHighlightChange={(ids, segId) => {
          activeChanges.push({ ids: Array.from(ids), segId });
        }}
        onAutoScrollChange={vi.fn()}
        onRegisterSeekHandler={vi.fn()}
      />,
    );

    const playBtn = await screen.findByRole("button", { name: /დაკვრა/i });
    fireEvent.click(playBtn);

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("mode=check"),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/talmud/audio-sync-transcribe",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("https://cdn.example.com/shiurim/berakhot/2a.mp3"),
        }),
      );
    });

    await waitFor(() => {
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("ai-seg-1");
      expect(latest?.ids).toEqual(["h-0", "h-1", "h-2", "h-3", "h-4"]);
    });
  });

  it("marks audio-synced glyph canvases with continuous glow attribute separately from blinking jump markers", () => {
    const baseRef = { current: null };
    const spots = makeDafHotspots().slice(0, 3);
    render(
      <PdfInkHighlight
        baseCanvasRef={baseRef}
        spots={spots}
        focusedIds={new Set(["h-2"])}
        audioSyncIds={new Set(["h-0", "h-1"])}
      />,
    );

    const h0 = document.querySelector('[data-daf-ink-highlight="h-0"]');
    const h1 = document.querySelector('[data-daf-ink-highlight="h-1"]');
    const h2 = document.querySelector('[data-daf-ink-highlight="h-2"]');
    expect(h0).toHaveAttribute("data-audio-sync-ink", "true");
    expect(h0).not.toHaveAttribute("data-focused-ink");
    expect(h1).toHaveAttribute("data-audio-sync-ink", "true");
    expect(h2).toHaveAttribute("data-focused-ink", "true");
    expect(h2).not.toHaveAttribute("data-audio-sync-ink");
  });

  it("shows approximate highlights immediately when cached map has empty anchors and auto-resyncs once when cached map matches 0 words during playback", async () => {
    const createUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-stale");
    const revokeUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    // 1) Cached map with unmatched phrase & 0 anchors -> should auto re-sync once Play starts
    await saveAudioSyncMap({
      version: 1,
      tractateId: "Berakhot",
      dafId: "2a",
      segments: [
        {
          id: "stale-0",
          startMs: 0,
          endMs: 5000,
          textHe: "מילה שלא נמצאת בכלל בדף",
          confidence: 0,
          reviewStatus: "unmatched",
          anchors: [],
        },
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          transcript: "היום תנא היכא עכשיו בבוקר",
          segments: [
            {
              id: "rescued-1",
              startMs: 0,
              endMs: 5000,
              textHe: "היום תנא היכא עכשיו בבוקר",
              topicKa: "გემარის საწყისი კითხვა",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const activeChanges: Array<{ ids: string[]; segId: string | null }> = [];
    render(
      <DafAudioSyncPanel
        tractateId="Berakhot"
        dafId="2a"
        tractateNameKa="ბერახოთი"
        dafMarkHe="ב׳ ע״א"
        isDark={false}
        hotspots={makeDafHotspots()}
        onClose={vi.fn()}
        onActiveHighlightChange={(ids, segId) => {
          activeChanges.push({ ids: Array.from(ids), segId });
        }}
        onAutoScrollChange={vi.fn()}
        onRegisterSeekHandler={vi.fn()}
      />,
    );

    const fileInput = document.body.querySelector(
      'input[type="file"][accept="audio/*"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "shiur.mp3", { type: "audio/mp3" })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-sync-match-status")).toHaveAttribute(
        "data-match-kind",
        "unmatched",
      );
    });

    // Pressing Play with 0-match stale map automatically invokes AI re-sync and lights up approximate words
    fireEvent.click(screen.getByRole("button", { name: /დაკვრა/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const latest = activeChanges[activeChanges.length - 1];
      expect(latest?.segId).toBe("rescued-1");
      expect(latest?.ids).toEqual(["h-5", "h-6"]);
      expect(screen.getByTestId("active-sync-match-status")).toHaveAttribute(
        "data-match-kind",
        "approximate",
      );
    });

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });
});
