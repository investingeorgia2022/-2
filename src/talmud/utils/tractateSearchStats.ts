import { TRACTATES } from "../data/tractates";

export const TRACTATE_SEARCH_EVENTS_KEY = "talmud-tractate-search-events-v1";
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface TractateSearchEvent {
  tractateId: string;
  searchedAt: number;
}

export interface TopTractateStat {
  tractateId: string;
  nameKa: string;
  shortNameKa: string;
  nameHe: string;
  sederKa: string;
  lastDaf: number;
  count: number;
  sharePct: number;
}

const VALID_TRACTATE_IDS = new Set(TRACTATES.map((tr) => tr.id));

const BASELINE_COUNTS: Array<{ tractateId: string; count: number }> = [
  { tractateId: "Berakhot", count: 42 },
  { tractateId: "Shabbat", count: 35 },
  { tractateId: "Bava_Metzia", count: 29 },
  { tractateId: "Pesachim", count: 23 },
  { tractateId: "Sanhedrin", count: 18 },
];

export function createBaselineTractateEvents(now = Date.now()): TractateSearchEvent[] {
  const events: TractateSearchEvent[] = [];
  const stepMs = Math.floor((24 * 24 * 60 * 60 * 1000) / 45);
  let offset = 1;
  for (const item of BASELINE_COUNTS) {
    if (!VALID_TRACTATE_IDS.has(item.tractateId)) continue;
    for (let i = 0; i < item.count; i++) {
      events.push({
        tractateId: item.tractateId,
        searchedAt: now - offset * stepMs,
      });
      offset++;
    }
  }
  return events;
}

function pruneLast30Days(events: TractateSearchEvent[], now: number): TractateSearchEvent[] {
  const cutoff = now - THIRTY_DAYS_MS;
  return events.filter(
    (ev) =>
      ev &&
      typeof ev.tractateId === "string" &&
      VALID_TRACTATE_IDS.has(ev.tractateId) &&
      typeof ev.searchedAt === "number" &&
      Number.isFinite(ev.searchedAt) &&
      ev.searchedAt >= cutoff &&
      ev.searchedAt <= now + 60_000,
  );
}

export function readTractateSearchEvents(now = Date.now()): TractateSearchEvent[] {
  if (typeof window === "undefined") {
    return createBaselineTractateEvents(now);
  }
  try {
    const raw = window.localStorage.getItem(TRACTATE_SEARCH_EVENTS_KEY);
    if (!raw) {
      const seeded = createBaselineTractateEvents(now);
      window.localStorage.setItem(TRACTATE_SEARCH_EVENTS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const seeded = createBaselineTractateEvents(now);
      window.localStorage.setItem(TRACTATE_SEARCH_EVENTS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return pruneLast30Days(parsed as TractateSearchEvent[], now);
  } catch {
    return createBaselineTractateEvents(now);
  }
}

export function writeTractateSearchEvents(events: TractateSearchEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRACTATE_SEARCH_EVENTS_KEY, JSON.stringify(events));
  } catch {
    // ignore storage quota errors
  }
}

export function recordTractateSearch(tractateId: string, now = Date.now()): TractateSearchEvent[] {
  if (!VALID_TRACTATE_IDS.has(tractateId)) {
    return readTractateSearchEvents(now);
  }
  const current = readTractateSearchEvents(now);
  const next = pruneLast30Days([...current, { tractateId, searchedAt: now }], now);
  writeTractateSearchEvents(next);
  return next;
}

export function getTopSearchedTractates30Days(limit = 5, now = Date.now()): TopTractateStat[] {
  const events = readTractateSearchEvents(now);
  const counts = new Map<string, number>();
  for (const ev of events) {
    counts.set(ev.tractateId, (counts.get(ev.tractateId) ?? 0) + 1);
  }

  const totalCount = Array.from(counts.values()).reduce((sum, n) => sum + n, 0) || 1;
  const indexMap = new Map<string, number>(TRACTATES.map((tr, i) => [tr.id, i]));

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return (indexMap.get(a[0]) ?? 999) - (indexMap.get(b[0]) ?? 999);
    })
    .slice(0, limit)
    .map(([tractateId, count]) => {
      const tr = TRACTATES.find((item) => item.id === tractateId)!;
      const shortNameKa = (tr.nameKa.split(" (")[0] ?? tr.nameKa).trim();
      return {
        tractateId,
        nameKa: tr.nameKa,
        shortNameKa,
        nameHe: tr.nameHe,
        sederKa: tr.sederKa ?? "",
        lastDaf: tr.lastDaf,
        count,
        sharePct: Math.round((count / totalCount) * 100),
      };
    });
}
