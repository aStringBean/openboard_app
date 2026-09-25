/**
 * The problem catalogue as the list shows it: each problem summarised with
 * what its ascents say about it. Pure, so it can be tested in Node.
 */
import { averageStars, gradeAt, isFlash, type Tick } from "./tick";

export interface ProblemRow {
  id: string;
  name: string;
  /** The setter's grade, at the angle it was set. */
  grade: number;
  angle: number;
  createdAt: number;
  /** Who set it, where known. */
  setterId?: string | null;
}

export interface ProblemSummary extends ProblemRow {
  holdIds: number[];
  /** The grade ascents agree on at the set angle, the setter's vote included. */
  consensus: number;
  stars: number | null;
  ascents: number;
  ticked: boolean;
  flashed: boolean;
}

export function summarise(
  problems: readonly ProblemRow[],
  holds: readonly { problemId: string; holdId: number }[],
  ticks: readonly Tick[],
  /** Whose ticks make a problem "ticked": mine, plus any logged before signing in. */
  me: string | null = null,
): ProblemSummary[] {
  const holdsOf = new Map<string, number[]>();
  for (const h of holds) {
    const list = holdsOf.get(h.problemId);
    if (list) list.push(h.holdId);
    else holdsOf.set(h.problemId, [h.holdId]);
  }

  const ticksOf = new Map<string, Tick[]>();
  for (const t of ticks) {
    const list = ticksOf.get(t.problemId);
    if (list) list.push(t);
    else ticksOf.set(t.problemId, [t]);
  }

  return problems.map((p) => {
    /* Grade and stars come from everyone's ascents; ticked and flashed are mine. */
    const all = ticksOf.get(p.id) ?? [];
    const mine = all.filter((t) => t.userId === null || t.userId === me);
    /* A flash is a first ascent in one go; a one-go repeat is just a repeat. */
    const first = mine.reduce<Tick | null>((a, t) => (!a || t.climbedAt < a.climbedAt ? t : a), null);
    return {
      ...p,
      holdIds: holdsOf.get(p.id) ?? [],
      consensus: gradeAt(p, all, p.angle) ?? p.grade,
      stars: averageStars(all),
      ascents: all.length,
      ticked: mine.length > 0,
      flashed: first !== null && isFlash(first),
    };
  });
}

// -------------------------------------------------------------------- filters

export type Sort = "newest" | "easiest" | "hardest" | "best" | "popular" | "name";
export type TickedFilter = "all" | "ticked" | "unticked";

export interface ProblemFilter {
  search: string;
  /** Inclusive bounds on the consensus grade, as indices. */
  minGrade: number | null;
  maxGrade: number | null;
  /** Inclusive bounds on the rating, compared as the ★s the list shows. */
  minStars: number | null;
  maxStars: number | null;
  ticked: TickedFilter;
  /** Adjustable walls: only problems set at the angle the wall is at. */
  currentAngleOnly: boolean;
  /** Problems that use every one of these holds. */
  holdIds: number[];
  sort: Sort;
}

export const DEFAULT_FILTER: ProblemFilter = {
  search: "",
  minGrade: null,
  maxGrade: null,
  minStars: null,
  maxStars: null,
  ticked: "all",
  currentAngleOnly: false,
  holdIds: [],
  sort: "newest",
};

export const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "easiest", label: "Easiest" },
  { value: "hardest", label: "Hardest" },
  { value: "best", label: "Best rated" },
  { value: "popular", label: "Most climbed" },
  { value: "name", label: "Name" },
];

const byName = (a: ProblemSummary, b: ProblemSummary) => a.name.localeCompare(b.name);

const COMPARE: Record<Sort, (a: ProblemSummary, b: ProblemSummary) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  easiest: (a, b) => a.consensus - b.consensus || byName(a, b),
  hardest: (a, b) => b.consensus - a.consensus || byName(a, b),
  /* Unrated problems sort after every rated one, rather than as zero stars. */
  best: (a, b) => (b.stars ?? -1) - (a.stars ?? -1) || b.ascents - a.ascents || byName(a, b),
  popular: (a, b) => b.ascents - a.ascents || byName(a, b),
  name: byName,
};

/**
 * The problems a filter lets through, in its order. Grades are judged on the
 * consensus — the grade the list shows — not the setter's original.
 */
export function applyFilter(
  problems: readonly ProblemSummary[],
  f: ProblemFilter,
  currentAngle: number,
): ProblemSummary[] {
  const search = f.search.trim().toLowerCase();

  return problems
    .filter((p) => {
      if (search && !p.name.toLowerCase().includes(search)) return false;
      if (f.minGrade !== null && p.consensus < f.minGrade) return false;
      if (f.maxGrade !== null && p.consensus > f.maxGrade) return false;
      if (f.minStars !== null || f.maxStars !== null) {
        /* Unrated problems only pass the full range, which is no filter. */
        if (p.stars === null) return false;
        const shown = Math.round(p.stars);
        if (f.minStars !== null && shown < f.minStars) return false;
        if (f.maxStars !== null && shown > f.maxStars) return false;
      }
      if (f.ticked === "ticked" && !p.ticked) return false;
      if (f.ticked === "unticked" && p.ticked) return false;
      if (f.currentAngleOnly && p.angle !== currentAngle) return false;
      if (f.holdIds.length && !f.holdIds.every((h) => p.holdIds.includes(h))) return false;
      return true;
    })
    .sort(COMPARE[f.sort]);
}

/** How many filters narrow the list, search and sort aside. */
export function activeFilterCount(f: ProblemFilter): number {
  return (
    (f.minGrade !== null || f.maxGrade !== null ? 1 : 0) +
    (f.minStars !== null || f.maxStars !== null ? 1 : 0) +
    (f.ticked !== "all" ? 1 : 0) +
    (f.currentAngleOnly ? 1 : 0) +
    (f.holdIds.length ? 1 : 0)
  );
}

/**
 * A filter read back from storage. Anything missing or malformed falls back
 * to the default, so a stored filter from an older version never breaks the
 * list.
 */
export function parseFilter(raw: string | undefined): ProblemFilter {
  if (!raw) return DEFAULT_FILTER;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ProblemFilter, unknown>>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      search: typeof v.search === "string" ? v.search : "",
      minGrade: num(v.minGrade),
      maxGrade: num(v.maxGrade),
      minStars: num(v.minStars),
      maxStars: num(v.maxStars),
      ticked: v.ticked === "ticked" || v.ticked === "unticked" ? v.ticked : "all",
      currentAngleOnly: v.currentAngleOnly === true,
      holdIds: Array.isArray(v.holdIds) ? v.holdIds.filter((h): h is number => Number.isInteger(h)) : [],
      sort: SORTS.some((s) => s.value === v.sort) ? (v.sort as Sort) : "newest",
    };
  } catch {
    return DEFAULT_FILTER;
  }
}
