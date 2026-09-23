import { describe, expect, it } from "vitest";

import { averageStars, byAngle, gradeAt, isFlash, shortDate, validateTick } from "./tick";

const problem = { grade: 6, angle: 40 };
const t = (angle: number, grade: number | null, stars: number | null = null) => ({ angle, grade, stars });

describe("validateTick", () => {
  it("accepts a plain ascent", () => {
    expect(validateTick({ attempts: 3, grade: null, stars: null })).toEqual([]);
  });

  it("rejects impossible values", () => {
    expect(validateTick({ attempts: 0, grade: 99, stars: 4 })).toHaveLength(3);
    expect(validateTick({ attempts: 1.5, grade: null, stars: 0 })).toHaveLength(2);
  });

  it("calls one attempt a flash", () => {
    expect(isFlash({ attempts: 1 })).toBe(true);
    expect(isFlash({ attempts: 2 })).toBe(false);
  });
});

describe("gradeAt", () => {
  it("is the setter's grade before anyone has graded it", () => {
    expect(gradeAt(problem, [], 40)).toBe(6);
  });

  it("counts the setter as one vote among the ascents", () => {
    /* 6, 8, 8 → 7.33 → 7: two climbers disagreeing moves it, but a single
     * dissent would only have met the setter halfway. */
    expect(gradeAt(problem, [t(40, 8), t(40, 8)], 40)).toBe(7);
    expect(gradeAt(problem, [t(40, 9)], 40)).toBe(8);
  });

  it("ignores ungraded ascents and ascents at other angles", () => {
    expect(gradeAt(problem, [t(40, null), t(30, 2)], 40)).toBe(6);
  });

  it("has no grade at an angle nobody has graded it at", () => {
    expect(gradeAt(problem, [t(30, null)], 30)).toBeNull();
    expect(gradeAt(problem, [t(30, 4), t(30, 5)], 30)).toBe(5);
  });
});

describe("averageStars", () => {
  it("averages the stars given", () => {
    expect(averageStars([t(40, null, 3), t(40, null, 2), t(40, null, null)])).toBe(2.5);
  });

  it("is null when nobody gave any", () => {
    expect(averageStars([t(40, null)])).toBeNull();
  });
});

describe("byAngle", () => {
  it("lists the set angle and every angle climbed at", () => {
    expect(byAngle(problem, [t(30, 4), t(40, null), t(30, null)])).toEqual([
      { angle: 30, ascents: 2, grade: 4 },
      { angle: 40, ascents: 1, grade: 6 },
    ]);
  });
});

describe("shortDate", () => {
  const now = new Date(2026, 8, 23).getTime();

  it("omits the year within the current year", () => {
    expect(shortDate(new Date(2026, 0, 5).getTime(), now)).toBe("5 Jan");
  });

  it("includes it otherwise", () => {
    expect(shortDate(new Date(2025, 11, 31).getTime(), now)).toBe("31 Dec 2025");
  });
});
