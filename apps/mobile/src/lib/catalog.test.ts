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
import { mirrorMap } from "./mirror";
import type { Tick } from "./tick";

const row = (id: string, grade = 6): ProblemRow => ({ id, name: id, grade, angle: 40, createdAt: 1 });

const tick = (problemId: string, over: Partial<Tick> = {}): Tick => ({
  id: `${problemId}-${Math.random()}`,
  problemId,
  climbedAt: 1000,
  angle: 40,
  attempts: 3,
  mirrored: false,
  userId: null,
  grade: null,
  stars: null,
  comment: "",
  ...over,
});

describe("summarise", () => {
  it("counts everyone's ascents, but only mine as ticked", () => {
    const theirs = [tick("a", { userId: "them", climbedAt: 1, attempts: 1 })];
    expect(summarise([row("a")], [], theirs, "me")[0]).toMatchObject({ ascents: 1, ticked: false, flashed: false });

    const both = [...theirs, tick("a", { userId: "me", climbedAt: 2, attempts: 1 })];
    expect(summarise([row("a")], [], both, "me")[0]).toMatchObject({ ascents: 2, ticked: true, flashed: true });
  });

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

describe("on a mirror layout", () => {
  /* 1 and 2 mirror each other; 3 is on the centre line; 9 has no partner. */
  const mirror = mirrorMap({ pairs: [[1, 2], [3, 3]] });
  const holds = (problemId: string, ...hs: [number, "start" | "finish"][]) =>
    hs.map(([holdId, role]) => ({ problemId, holdId, role }));
  const sum = (problemHolds: ReturnType<typeof holds>, ticks: Tick[]) =>
    summarise([row("a")], problemHolds, ticks, "me", mirror)[0]!;
  const twin = holds("a", [1, "start"], [3, "finish"]);

  it("ticks a problem only once it is climbed both ways round", () => {
    expect(sum(twin, [tick("a", { userId: "me" })])).toMatchObject({ ticked: false, half: true });
    expect(sum(twin, [tick("a", { userId: "me", mirrored: true })])).toMatchObject({ ticked: false, half: true });
    expect(
      sum(twin, [tick("a", { userId: "me" }), tick("a", { userId: "me", mirrored: true })]),
    ).toMatchObject({ ticked: true, half: false });
  });

  it("calls it flashed only when each way round was flashed", () => {
    const set = (attempts: number, climbedAt = 1) => tick("a", { userId: "me", attempts, climbedAt });
    const mirrored = (attempts: number, climbedAt = 2) =>
      tick("a", { userId: "me", attempts, climbedAt, mirrored: true });
    /* Flashed as set, then mirrored in one go after: the mirrored problem is a
     * climb of its own, so that is a flash too. */
    expect(sum(twin, [set(1), mirrored(1)]).flashed).toBe(true);
    expect(sum(twin, [set(1), mirrored(3)]).flashed).toBe(false);
    expect(sum(twin, [set(3), mirrored(1)]).flashed).toBe(false);
    /* Half ticked: not flashed, however the one way went. */
    expect(sum(twin, [set(1)]).flashed).toBe(false);
  });

  it("needs one way only for a problem with no twin to climb", () => {
    /* A hold with no partner: no mirrored problem exists. */
    expect(sum(holds("a", [1, "start"], [9, "finish"]), [tick("a", { userId: "me" })])).toMatchObject({
      ticked: true,
      half: false,
    });
    /* Its own reflection: the same climb either way. */
    expect(sum(holds("a", [1, "start"], [2, "start"], [3, "finish"]), [tick("a", { userId: "me" })])).toMatchObject({
      ticked: true,
      half: false,
    });
  });

  it("leaves a wall that is not a mirror layout as it was", () => {
    expect(summarise([row("a")], twin, [tick("a", { userId: "me" })], "me")[0]).toMatchObject({
      ticked: true,
      half: false,
    });
  });

  it("files a half-ticked problem under not ticked", () => {
    const half = sum(twin, [tick("a", { userId: "me" })]);
    expect(applyFilter([half], { ...DEFAULT_FILTER, ticked: "unticked" }, 40)).toHaveLength(1);
    expect(applyFilter([half], { ...DEFAULT_FILTER, ticked: "ticked" }, 40)).toHaveLength(0);
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
    half: false,
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

  it("bounds stars from above too", () => {
    expect(ids({ maxStars: 2 })).toEqual(["Arete"]);
    expect(ids({ minStars: 2, maxStars: 2 })).toEqual(["Arete"]);
  });

  it("judges stars as the list shows them, rounded", () => {
    /* 2.5 shows as ★★★, so it belongs in a 3-star range, not a 2-star one. */
    const halfway = [p("Mid", { stars: 2.5 })];
    const f = (min: number, max: number) =>
      applyFilter(halfway, { ...DEFAULT_FILTER, minStars: min, maxStars: max }, 40).length;
    expect(f(3, 3)).toBe(1);
    expect(f(1, 2)).toBe(0);
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
    expect(activeFilterCount({ ...DEFAULT_FILTER, maxStars: 2 })).toBe(1);
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
