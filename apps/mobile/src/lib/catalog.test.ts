import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  applyFilter,
  DEFAULT_FILTER,
  parseFilter,
  summarise,
  type ProblemFilter,
  type ProblemRow,
  type ProblemSummary,
} from "./catalog";
import type { Tick } from "./tick";

const row = (id: string, grade = 6): ProblemRow => ({ id, name: id, grade, angle: 40, createdAt: 1 });

const tick = (problemId: string, over: Partial<Tick> = {}): Tick => ({
  id: `${problemId}-${Math.random()}`,
  problemId,
  climbedAt: 1000,
  angle: 40,
  attempts: 3,
  grade: null,
  stars: null,
  comment: "",
  ...over,
});

describe("summarise", () => {
  it("gathers each problem's holds", () => {
    const [a, b] = summarise(
      [row("a"), row("b")],
      [
        { problemId: "a", holdId: 1 },
        { problemId: "a", holdId: 2 },
        { problemId: "b", holdId: 3 },
      ],
      [],
    );

    expect(a!.holdIds).toEqual([1, 2]);
    expect(b!.holdIds).toEqual([3]);
  });

  it("marks an unclimbed problem as such", () => {
    expect(summarise([row("a")], [], [])[0]).toMatchObject({
      consensus: 6,
      stars: null,
      ascents: 0,
      ticked: false,
      flashed: false,
    });
  });

  it("reflects its ascents", () => {
    const [a] = summarise(
      [row("a")],
      [],
      [tick("a", { grade: 8, stars: 3 }), tick("a", { grade: 8, stars: 2, climbedAt: 2000 })],
    );

    expect(a).toMatchObject({ consensus: 7, stars: 2.5, ascents: 2, ticked: true });
  });

  it("calls it a flash only when the first ascent took one go", () => {
    const flashed = summarise([row("a")], [], [
      tick("a", { attempts: 1, climbedAt: 1 }),
      tick("a", { attempts: 4, climbedAt: 9 }),
    ]);
    /* Sent in four, then repeated in one: a repeat, not a flash. */
    const repeatedInOne = summarise([row("a")], [], [
      tick("a", { attempts: 4, climbedAt: 1 }),
      tick("a", { attempts: 1, climbedAt: 9 }),
    ]);

    expect(flashed[0]!.flashed).toBe(true);
    expect(repeatedInOne[0]!.flashed).toBe(false);
  });
});

describe("applyFilter", () => {
  const p = (id: string, over: Partial<ProblemSummary> = {}): ProblemSummary => ({
    id,
    name: id,
    grade: 5,
    angle: 40,
    createdAt: 0,
    holdIds: [],
    consensus: 5,
    stars: null,
    ascents: 0,
    ticked: false,
    flashed: false,
    ...over,
  });

  const all = [
    p("Arete", { consensus: 3, createdAt: 3, stars: 2, ascents: 1, ticked: true, holdIds: [1, 2] }),
    p("Bloc", { consensus: 8, createdAt: 1, stars: 3, ascents: 5, ticked: true, holdIds: [2, 3], angle: 30 }),
    p("Crimps", { consensus: 5, createdAt: 2, holdIds: [1, 2, 3] }),
  ];
  const ids = (f: Partial<ProblemFilter>) => applyFilter(all, { ...DEFAULT_FILTER, ...f }, 40).map((x) => x.id);

  it("passes everything, newest first, by default", () => {
    expect(ids({})).toEqual(["Arete", "Crimps", "Bloc"]);
  });

  it("searches names, ignoring case", () => {
    expect(ids({ search: "  crIM " })).toEqual(["Crimps"]);
  });

  it("bounds the consensus grade inclusively", () => {
    expect(ids({ minGrade: 5, maxGrade: 8 })).toEqual(["Crimps", "Bloc"]);
    expect(ids({ maxGrade: 5 })).toEqual(["Arete", "Crimps"]);
  });

  it("needs ratings to pass a stars filter", () => {
    expect(ids({ minStars: 2 })).toEqual(["Arete", "Bloc"]);
    expect(ids({ minStars: 3 })).toEqual(["Bloc"]);
  });

  it("splits ticked from unticked", () => {
    expect(ids({ ticked: "ticked" })).toEqual(["Arete", "Bloc"]);
    expect(ids({ ticked: "unticked" })).toEqual(["Crimps"]);
  });

  it("keeps only problems set at the wall's current angle", () => {
    expect(ids({ currentAngleOnly: true })).toEqual(["Arete", "Crimps"]);
  });

  it("keeps problems using every chosen hold", () => {
    expect(ids({ holdIds: [2] })).toEqual(["Arete", "Crimps", "Bloc"]);
    expect(ids({ holdIds: [1, 3] })).toEqual(["Crimps"]);
  });

  it("sorts", () => {
    expect(ids({ sort: "easiest" })).toEqual(["Arete", "Crimps", "Bloc"]);
    expect(ids({ sort: "hardest" })).toEqual(["Bloc", "Crimps", "Arete"]);
    expect(ids({ sort: "popular" })).toEqual(["Bloc", "Arete", "Crimps"]);
    expect(ids({ sort: "name" })).toEqual(["Arete", "Bloc", "Crimps"]);
  });

  it("puts unrated problems after rated ones when sorting by stars", () => {
    expect(ids({ sort: "best" })).toEqual(["Bloc", "Arete", "Crimps"]);
  });

  it("does not reorder the list it was given", () => {
    applyFilter(all, { ...DEFAULT_FILTER, sort: "name" }, 40);
    expect(all.map((x) => x.id)).toEqual(["Arete", "Bloc", "Crimps"]);
  });
});

describe("activeFilterCount", () => {
  it("counts narrowing filters, not search or sort", () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTER, search: "x", sort: "name" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTER, minGrade: 3, maxGrade: 5, ticked: "ticked", holdIds: [1, 2] })).toBe(3);
  });
});

describe("parseFilter", () => {
  it("round-trips a filter", () => {
    const f: ProblemFilter = { ...DEFAULT_FILTER, minGrade: 4, holdIds: [7], sort: "best", ticked: "unticked" };
    expect(parseFilter(JSON.stringify(f))).toEqual(f);
  });

  it("falls back to defaults for anything missing or broken", () => {
    expect(parseFilter(undefined)).toEqual(DEFAULT_FILTER);
    expect(parseFilter("{not json")).toEqual(DEFAULT_FILTER);
    expect(parseFilter(JSON.stringify({ sort: "sideways", holdIds: [1, "x", 2.5], minStars: "3" }))).toEqual({
      ...DEFAULT_FILTER,
      holdIds: [1],
    });
  });
});
