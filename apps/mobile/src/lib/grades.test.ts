import { describe, expect, it } from "vitest";

import {
  chooseGrade,
  DEFAULT_GRADE,
  gradeBound,
  GRADES,
  gradeLabel,
  gradeOptions,
  isGrade,
  optionMatches,
} from "./grades";

const index = (font: string) => GRADES.findIndex((g) => g.font === font);

describe("grade scale", () => {
  it("is ordered, with every step carrying both labels", () => {
    expect(GRADES.map((g) => g.font).slice(0, 6)).toEqual(["4", "4+", "5", "5+", "6A", "6A+"]);
    for (const g of GRADES) expect(g.v).toMatch(/^V\d+$/);
  });

  it("never lets V go down as Font goes up", () => {
    const vs = GRADES.map((g) => Number(g.v.slice(1)));
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThanOrEqual(vs[i - 1]!);
  });

  it("defaults new problems to 6A / V3", () => {
    expect(gradeLabel(DEFAULT_GRADE, "both")).toBe("6A / V3");
  });

  it("labels in whichever scale is chosen", () => {
    const i = index("7A+");
    expect(gradeLabel(i, "font")).toBe("7A+");
    expect(gradeLabel(i, "v")).toBe("V7");
    expect(gradeLabel(i, "both")).toBe("7A+ / V7");
  });

  it("rejects anything that is not a step on the scale", () => {
    expect(isGrade(0)).toBe(true);
    expect(isGrade(GRADES.length)).toBe(false);
    expect(isGrade(-1)).toBe(false);
    expect(isGrade(2.5)).toBe(false);
    expect(gradeLabel(99, "font")).toBe("?");
  });
});

describe("grade picker", () => {
  it("offers every Font step", () => {
    expect(gradeOptions("font")).toHaveLength(GRADES.length);
  });

  it("offers each V grade once", () => {
    const labels = gradeOptions("v").map((o) => o.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.slice(0, 5)).toEqual(["V0", "V1", "V2", "V3", "V4"]);
  });

  it("keeps a problem's exact Font step when a V climber re-picks the same V", () => {
    /* 6A+ shows as V3. Tapping V3 again must not flatten it to 6A. */
    const v3 = gradeOptions("v").find((o) => o.label === "V3")!;

    expect(chooseGrade(index("6A+"), v3, "v")).toBe(index("6A+"));
  });

  it("moves to the chosen grade when a different one is picked", () => {
    const v5 = gradeOptions("v").find((o) => o.label === "V5")!;

    expect(chooseGrade(index("6A+"), v5, "v")).toBe(index("6C"));
  });

  it("shows the matching V option as selected for any Font step inside it", () => {
    const v3 = gradeOptions("v").find((o) => o.label === "V3")!;

    expect(optionMatches(index("6A"), v3, "v")).toBe(true);
    expect(optionMatches(index("6A+"), v3, "v")).toBe(true);
    expect(optionMatches(index("6B"), v3, "v")).toBe(false);
  });
});

describe("gradeBound", () => {
  const v3 = () => gradeOptions("v").find((o) => o.label === "V3")!;

  it("starts a V range at the lowest Font step of that V grade", () => {
    expect(gradeBound(v3(), "v", "min")).toBe(index("6A"));
  });

  it("ends a V range at the highest Font step of that V grade", () => {
    /* "Up to V3" must include 6A+, which is also V3. */
    expect(gradeBound(v3(), "v", "max")).toBe(index("6A+"));
  });

  it("is exact in Font", () => {
    const o = gradeOptions("font").find((x) => x.label === "6A")!;
    expect(gradeBound(o, "font", "max")).toBe(index("6A"));
  });
});
